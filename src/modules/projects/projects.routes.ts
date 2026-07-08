import { Router, Request, Response } from 'express';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  db, projects, organizations, projectMembers, projectLanguages,
  languages, tasks, submissions, reviews,
} from '../../db';
import { authenticate, requireProjectRole } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError } from '../../utils/response';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── POST /projects ────────────────────────────────────────────────────────────
router.post('/', validate(schemas.createProject), async (req: Request, res: Response) => {
  const { organizationId, name, description, languages: langIds, startDate, endDate } = req.body;
  const userId = req.user!.id;

  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org || org.ownerId !== userId) return sendForbidden(res, 'Only organization owners can create projects');

  try {
    const [project] = await db.insert(projects)
      .values({ organizationId, name, description, startDate, endDate, createdBy: userId })
      .returning({ id: projects.id });

    // Link languages
    if (langIds?.length) {
      await db.insert(projectLanguages).values(
        langIds.map((lid: string) => ({ projectId: project.id, languageId: lid }))
      ).onConflictDoNothing();
    }

    // Add creator as PROJECT_ADMIN
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: 'PROJECT_ADMIN',
      invitedBy: userId,
    });

    await createAuditLog(userId, 'PROJECT_CREATED', project.id, { organizationId });
    return sendCreated(res, { projectId: project.id }, 'Project created');
  } catch (err) {
    logger.error('Create project error', { err });
    return sendServerError(res);
  }
});

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { organizationId } = req.query;

  try {
    // Get projects the user is a member of
    const memberProjects = await db
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.userId, req.user!.id));

    if (!memberProjects.length) return sendSuccess(res, []);

    const projectIds = memberProjects.map(m => m.projectId);

    const result = await db
      .select({
        id:             projects.id,
        name:           projects.name,
        description:    projects.description,
        status:         projects.status,
        startDate:      projects.startDate,
        endDate:        projects.endDate,
        organizationId: projects.organizationId,
        createdAt:      projects.createdAt,
      })
      .from(projects)
      .where(
        and(
          inArray(projects.id, projectIds),
          organizationId ? eq(projects.organizationId, organizationId as string) : undefined
        )
      );

    return sendSuccess(res, result);
  } catch (err) {
    logger.error('List projects error', { err });
    return sendServerError(res);
  }
});

// ── GET /projects/:projectId ──────────────────────────────────────────────────
router.get('/:projectId', async (req: Request, res: Response) => {
  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, req.params.projectId))
      .limit(1);

    if (!project) return sendNotFound(res, 'Project not found');

    const langs = await db
      .select({ id: languages.id, name: languages.name, code: languages.code })
      .from(projectLanguages)
      .innerJoin(languages, eq(languages.id, projectLanguages.languageId))
      .where(eq(projectLanguages.projectId, project.id));

    return sendSuccess(res, { ...project, languages: langs });
  } catch (err) {
    logger.error('Get project error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /projects/:projectId ────────────────────────────────────────────────
router.patch('/:projectId', requireProjectRole(['PROJECT_ADMIN']), validate(schemas.updateProject), async (req: Request, res: Response) => {
  const { name, description, languages: langIds, startDate, endDate, status } = req.body;

  try {
    const [updated] = await db.update(projects)
      .set({
        ...(name        && { name }),
        ...(description && { description }),
        ...(startDate   && { startDate }),
        ...(endDate     && { endDate }),
        ...(status      && { status }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, req.params.projectId))
      .returning();

    if (langIds?.length) {
      await db.delete(projectLanguages).where(eq(projectLanguages.projectId, req.params.projectId));
      await db.insert(projectLanguages).values(
        langIds.map((lid: string) => ({ projectId: req.params.projectId, languageId: lid }))
      );
    }

    await createAuditLog(req.user!.id, 'PROJECT_UPDATED', req.params.projectId);
    return sendSuccess(res, updated, 'Project updated');
  } catch (err) {
    logger.error('Update project error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /projects/:projectId/archive ───────────────────────────────────────
router.patch('/:projectId/archive', async (req: Request, res: Response) => {
  try {
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, req.params.projectId))
      .limit(1);

    if (!project) return sendNotFound(res, 'Project not found');

    const [org] = await db
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId))
      .limit(1);

    if (org?.ownerId !== req.user!.id) return sendForbidden(res, 'Only org owners can archive projects');

    await db.update(projects)
      .set({ status: 'ARCHIVED', updatedAt: new Date() })
      .where(eq(projects.id, req.params.projectId));

    await createAuditLog(req.user!.id, 'PROJECT_ARCHIVED', req.params.projectId);
    return sendSuccess(res, null, 'Project archived');
  } catch (err) {
    logger.error('Archive project error', { err });
    return sendServerError(res);
  }
});

// ── DELETE /projects/:projectId ───────────────────────────────────────────────
router.delete('/:projectId', async (req: Request, res: Response) => {
  try {
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects).where(eq(projects.id, req.params.projectId)).limit(1);

    if (!project) return sendNotFound(res);

    const [org] = await db.select({ ownerId: organizations.ownerId })
      .from(organizations).where(eq(organizations.id, project.organizationId)).limit(1);

    if (org?.ownerId !== req.user!.id) return sendForbidden(res, 'Only org owners can delete projects');

    await db.delete(projects).where(eq(projects.id, req.params.projectId));
    await createAuditLog(req.user!.id, 'PROJECT_DELETED', req.params.projectId);
    return sendSuccess(res, null, 'Project deleted');
  } catch (err) {
    logger.error('Delete project error', { err });
    return sendServerError(res);
  }
});

// ── GET /projects/:projectId/dashboard ───────────────────────────────────────
router.get('/:projectId/dashboard', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const [taskCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'ACTIVE')));

    const members = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));

    const projectTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));

    const taskIds = projectTasks.map(t => t.id);

    let submissionStats = { total: 0, approved: 0, rejected: 0, pending: 0 };
    if (taskIds.length) {
      const subs = await db
        .select({ status: submissions.status })
        .from(submissions)
        .where(inArray(submissions.taskId, taskIds));

      submissionStats = {
        total:    subs.length,
        approved: subs.filter(s => s.status === 'APPROVED').length,
        rejected: subs.filter(s => s.status === 'REJECTED').length,
        pending:  subs.filter(s => s.status === 'PENDING_REVIEW').length,
      };
    }

    return sendSuccess(res, {
      activeTasks:      taskCount?.count ?? 0,
      contributors:     members.filter(m => m.role === 'CONTRIBUTOR').length,
      reviewers:        members.filter(m => m.role === 'REVIEWER').length,
      submissions:      submissionStats,
    });
  } catch (err) {
    logger.error('Project dashboard error', { err });
    return sendServerError(res);
  }
});

export default router;
