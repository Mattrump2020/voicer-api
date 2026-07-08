import { Router, Request, Response } from 'express';
import { eq, and, count } from 'drizzle-orm';
import { db, organizations, organizationMembers, projects } from '../../db';
import { authenticate, requireOrgOwner } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendServerError } from '../../utils/response';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── POST /organizations ───────────────────────────────────────────────────────
router.post('/', validate(schemas.createOrganization), async (req: Request, res: Response) => {
  const { name, description, country, organizationType } = req.body;
  const ownerId = req.user!.id;

  try {
    const [org] = await db.insert(organizations)
      .values({ name, description, country, organizationType, ownerId })
      .returning({ id: organizations.id });

    // Add creator as OWNER in org_members
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: ownerId,
      role: 'OWNER',
    });

    await createAuditLog(ownerId, 'ORG_CREATED', org.id);
    return sendCreated(res, { organizationId: org.id }, 'Organization created');
  } catch (err) {
    logger.error('Create org error', { err });
    return sendServerError(res);
  }
});

// ── GET /organizations ────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const orgs = await db
      .select({
        id:               organizations.id,
        name:             organizations.name,
        description:      organizations.description,
        country:          organizations.country,
        organizationType: organizations.organizationType,
        createdAt:        organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.ownerId, req.user!.id));

    return sendSuccess(res, orgs);
  } catch (err) {
    logger.error('List orgs error', { err });
    return sendServerError(res);
  }
});

// ── GET /organizations/:organizationId ────────────────────────────────────────
router.get('/:organizationId', async (req: Request, res: Response) => {
  try {
    const [org] = await db
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.id, req.params.organizationId),
          eq(organizations.ownerId, req.user!.id)
        )
      )
      .limit(1);

    if (!org) return sendNotFound(res, 'Organization not found');
    return sendSuccess(res, org);
  } catch (err) {
    logger.error('Get org error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /organizations/:organizationId ──────────────────────────────────────
router.patch('/:organizationId', requireOrgOwner, validate(schemas.updateOrganization), async (req: Request, res: Response) => {
  const { name, description, country, organizationType } = req.body;

  try {
    const [updated] = await db.update(organizations)
      .set({
        ...(name             && { name }),
        ...(description      && { description }),
        ...(country          && { country }),
        ...(organizationType && { organizationType }),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, req.params.organizationId))
      .returning();

    await createAuditLog(req.user!.id, 'ORG_UPDATED', req.params.organizationId);
    return sendSuccess(res, updated, 'Organization updated');
  } catch (err) {
    logger.error('Update org error', { err });
    return sendServerError(res);
  }
});

// ── DELETE /organizations/:organizationId ─────────────────────────────────────
router.delete('/:organizationId', requireOrgOwner, async (req: Request, res: Response) => {
  try {
    // Guard: cannot delete if active projects exist
    const [activeProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, req.params.organizationId),
          eq(projects.status, 'ACTIVE')
        )
      )
      .limit(1);

    if (activeProject) {
      return sendError(res, 'Archive all active projects before deleting the organization', 400);
    }

    await db.delete(organizations).where(eq(organizations.id, req.params.organizationId));
    await createAuditLog(req.user!.id, 'ORG_DELETED', req.params.organizationId);
    return sendSuccess(res, null, 'Organization deleted');
  } catch (err) {
    logger.error('Delete org error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /organizations/:organizationId/transfer-ownership ──────────────────
router.patch('/:organizationId/transfer-ownership', requireOrgOwner, async (req: Request, res: Response) => {
  const { newOwnerId } = req.body;
  if (!newOwnerId) return sendError(res, 'newOwnerId is required');

  try {
    // New owner must be an org member
    const [member] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, req.params.organizationId),
          eq(organizationMembers.userId, newOwnerId)
        )
      )
      .limit(1);

    if (!member) return sendError(res, 'The new owner must already be a member of this organization');

    await db.update(organizations)
      .set({ ownerId: newOwnerId, updatedAt: new Date() })
      .where(eq(organizations.id, req.params.organizationId));

    // Update roles in org_members
    await db.update(organizationMembers)
      .set({ role: 'ADMIN' })
      .where(
        and(
          eq(organizationMembers.organizationId, req.params.organizationId),
          eq(organizationMembers.userId, req.user!.id)
        )
      );

    await db.update(organizationMembers)
      .set({ role: 'OWNER' })
      .where(
        and(
          eq(organizationMembers.organizationId, req.params.organizationId),
          eq(organizationMembers.userId, newOwnerId)
        )
      );

    return sendSuccess(res, null, 'Ownership transferred successfully');
  } catch (err) {
    logger.error('Transfer ownership error', { err });
    return sendServerError(res);
  }
});

// ── GET /organizations/:organizationId/dashboard ──────────────────────────────
router.get('/:organizationId/dashboard', async (req: Request, res: Response) => {
  const { organizationId } = req.params;
  try {
    const projectRows = await db
      .select({ id: projects.id, name: projects.name, status: projects.status, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    return sendSuccess(res, {
      totalProjects: projectRows.length,
      activeProjects: projectRows.filter(p => p.status === 'ACTIVE').length,
      recentProjects: projectRows.slice(0, 5),
    });
  } catch (err) {
    logger.error('Org dashboard error', { err });
    return sendServerError(res);
  }
});

export default router;
