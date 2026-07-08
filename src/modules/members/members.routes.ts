import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, invitations, projectMembers, projects, organizations, users, notifications } from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendServerError } from '../../utils/response';
import { sendInvitationEmail } from '../../utils/email';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── POST /members/invite ──────────────────────────────────────────────────────
router.post('/invite', validate(schemas.inviteMember), async (req: Request, res: Response) => {
  const { projectId, email, role } = req.body;
  const inviterId = req.user!.id;

  try {
    // Must be PROJECT_ADMIN or org owner
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, inviterId)))
      .limit(1);

    const [orgCheck] = await db
      .select({ ownerId: organizations.ownerId })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(eq(projects.id, projectId))
      .limit(1);

    const canInvite = membership?.role === 'PROJECT_ADMIN' || orgCheck?.ownerId === inviterId;
    if (!canInvite) return sendError(res, 'You do not have permission to invite members', 403);

    // Check already a member
    const [existingMember] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(users.email, email)))
      .limit(1);

    if (existingMember) return sendError(res, 'This user is already a member of this project');

    // Check pending invite
    const [pendingInvite] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.projectId, projectId), eq(invitations.email, email), eq(invitations.status, 'PENDING')))
      .limit(1);

    if (pendingInvite) return sendError(res, 'A pending invitation already exists for this email');

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + parseInt(process.env.INVITATION_EXPIRY_HOURS || '72') * 3600 * 1000);

    await db.insert(invitations).values({ email, projectId, role, token, invitedBy: inviterId, expiresAt });

    // Get names for email
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const [inviter] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users).where(eq(users.id, inviterId)).limit(1);

    const inviterName   = `${inviter.firstName} ${inviter.lastName}`;
    await sendInvitationEmail(email, token, project.name, role, inviterName);

    // In-app notification if user already has an account
    const [invitedUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (invitedUser) {
      await db.insert(notifications).values({
        userId:  invitedUser.id,
        title:   'Project Invitation',
        message: `You have been invited to join ${project.name} as ${role}`,
        type:    'INVITATION',
        refId:   projectId,
      });
    }

    await createAuditLog(inviterId, 'INVITATION_SENT', projectId, { email, role });
    return sendCreated(res, null, 'Invitation sent');
  } catch (err) {
    logger.error('Invite error', { err });
    return sendServerError(res);
  }
});

// ── POST /members/accept-invitation ──────────────────────────────────────────
router.post('/accept-invitation', validate(schemas.acceptInvitation), async (req: Request, res: Response) => {
  const { token } = req.body;
  const userId = req.user!.id;

  try {
    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1);

    if (!invite) return sendNotFound(res, 'Invitation not found');
    if (invite.status === 'ACCEPTED') return sendError(res, 'Invitation already accepted');
    if (invite.status === 'EXPIRED' || invite.expiresAt < new Date()) {
      await db.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, invite.id));
      return sendError(res, 'This invitation has expired', 410);
    }

    // Email must match — prevents one user accepting an invite meant for another
    const [acceptingUser] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (acceptingUser.email !== invite.email) {
      return sendError(res, 'This invitation was sent to a different email address', 403);
    }

    await db.insert(projectMembers)
      .values({ projectId: invite.projectId, userId, role: invite.role })
      .onConflictDoNothing();

    await db.update(invitations)
      .set({ status: 'ACCEPTED', acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id));

    await createAuditLog(userId, 'INVITATION_ACCEPTED', invite.projectId);
    return sendSuccess(res, { projectId: invite.projectId }, 'You have joined the project');
  } catch (err) {
    logger.error('Accept invitation error', { err });
    return sendServerError(res);
  }
});

// ── GET /members/projects/:projectId ─────────────────────────────────────────
router.get('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const members = await db
      .select({
        id:        projectMembers.id,
        role:      projectMembers.role,
        joinedAt:  projectMembers.joinedAt,
        userId:    users.id,
        firstName: users.firstName,
        lastName:  users.lastName,
        email:     users.email,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, req.params.projectId));

    const pending = await db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
      .from(invitations)
      .where(and(eq(invitations.projectId, req.params.projectId), eq(invitations.status, 'PENDING')));

    return sendSuccess(res, { members, pendingInvitations: pending });
  } catch (err) {
    logger.error('Get members error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /members/:memberId/role ─────────────────────────────────────────────
router.patch('/:memberId/role', async (req: Request, res: Response) => {
  const { role } = req.body;
  if (!['PROJECT_ADMIN', 'CONTRIBUTOR', 'REVIEWER'].includes(role)) {
    return sendError(res, 'Invalid role');
  }

  try {
    const [updated] = await db.update(projectMembers)
      .set({ role })
      .where(eq(projectMembers.id, req.params.memberId))
      .returning({ id: projectMembers.id, role: projectMembers.role });

    if (!updated) return sendNotFound(res, 'Member not found');
    return sendSuccess(res, updated, 'Role updated');
  } catch (err) {
    logger.error('Update member role error', { err });
    return sendServerError(res);
  }
});

// ── DELETE /members/:memberId ─────────────────────────────────────────────────
router.delete('/:memberId', async (req: Request, res: Response) => {
  try {
    await db.delete(projectMembers).where(eq(projectMembers.id, req.params.memberId));
    return sendSuccess(res, null, 'Member removed');
  } catch (err) {
    logger.error('Remove member error', { err });
    return sendServerError(res);
  }
});

export default router;
