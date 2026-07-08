import { Router, Request, Response } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import {
  db, tasks, projects, organizations, projectMembers,
  submissions, languages, userLanguages,
} from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import {
  sendSuccess, sendCreated, sendError,
  sendNotFound, sendForbidden, sendServerError,
} from '../../utils/response';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ─── helper: check if user can admin a project ────────────────────────────────
const canAdminProject = async (projectId: string, userId: string): Promise<boolean> => {
  const [ownerCheck] = await db
    .select({ ownerId: organizations.ownerId })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (ownerCheck?.ownerId === userId) return true;

  const [mem] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  return mem?.role === 'PROJECT_ADMIN';
};

// ── POST /tasks ────────────────────────────────────────────────────────────────
router.post('/', validate(schemas.createTask), async (req: Request, res: Response) => {
  const { projectId, title, description, instructions, languageId, taskType, targetDuration } = req.body;
  const userId = req.user!.id;

  if (!(await canAdminProject(projectId, userId))) {
    return sendForbidden(res, 'Only project admins can create tasks');
  }

  try {
    const [task] = await db.insert(tasks)
      .values({ projectId, title, description, instructions, languageId, taskType, targetDuration, createdBy: userId })
      .returning();

    await createAuditLog(userId, 'TASK_CREATED', task.id, { projectId });
    return sendCreated(res, task, 'Task created');
  } catch (err) {
    logger.error('Create task error', { err });
    return sendServerError(res);
  }
});

// ── GET /tasks?projectId= ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { projectId } = req.query;
  if (!projectId) return sendError(res, 'projectId query param is required');

  try {
    const rows = await db
      .select({
        id:             tasks.id,
        title:          tasks.title,
        description:    tasks.description,
        instructions:   tasks.instructions,
        taskType:       tasks.taskType,
        targetDuration: tasks.targetDuration,
        status:         tasks.status,
        createdAt:      tasks.createdAt,
        languageId:     languages.id,
        languageName:   languages.name,
        languageCode:   languages.code,
      })
      .from(tasks)
      .innerJoin(languages, eq(languages.id, tasks.languageId))
      .where(eq(tasks.projectId, projectId as string))
      .orderBy(tasks.createdAt);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('List tasks error', { err });
    return sendServerError(res);
  }
});

// ── GET /tasks/contributor/available ─────────────────────────────────────────
// Returns ACTIVE tasks in projects the user is a CONTRIBUTOR on,
// filtered to only languages the contributor speaks.
router.get('/contributor/available', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { projectId } = req.query;

  try {
    // Languages the contributor speaks
    const spokenLangs = await db
      .select({ languageId: userLanguages.languageId })
      .from(userLanguages)
      .where(eq(userLanguages.userId, userId));

    if (!spokenLangs.length) return sendSuccess(res, []);

    const langIds = spokenLangs.map(l => l.languageId);

    // Projects user is a contributor on
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, 'CONTRIBUTOR')));

    if (!memberships.length) return sendSuccess(res, []);

    const projectIds = memberships.map(m => m.projectId);

    const rows = await db
      .select({
        id:             tasks.id,
        title:          tasks.title,
        description:    tasks.description,
        instructions:   tasks.instructions,
        taskType:       tasks.taskType,
        targetDuration: tasks.targetDuration,
        projectId:      tasks.projectId,
        languageName:   languages.name,
        languageCode:   languages.code,
        createdAt:      tasks.createdAt,
      })
      .from(tasks)
      .innerJoin(languages, eq(languages.id, tasks.languageId))
      .where(
        and(
          eq(tasks.status, 'ACTIVE'),
          inArray(tasks.projectId, projectId ? [projectId as string] : projectIds),
          inArray(tasks.languageId, langIds)
        )
      )
      .orderBy(tasks.createdAt);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('Contributor tasks error', { err });
    return sendServerError(res);
  }
});

// ── GET /tasks/:taskId ────────────────────────────────────────────────────────
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const [task] = await db
      .select({
        id:             tasks.id,
        title:          tasks.title,
        description:    tasks.description,
        instructions:   tasks.instructions,
        taskType:       tasks.taskType,
        targetDuration: tasks.targetDuration,
        status:         tasks.status,
        projectId:      tasks.projectId,
        createdAt:      tasks.createdAt,
        languageId:     languages.id,
        languageName:   languages.name,
        languageCode:   languages.code,
      })
      .from(tasks)
      .innerJoin(languages, eq(languages.id, tasks.languageId))
      .where(eq(tasks.id, req.params.taskId))
      .limit(1);

    if (!task) return sendNotFound(res, 'Task not found');
    return sendSuccess(res, task);
  } catch (err) {
    logger.error('Get task error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /tasks/:taskId ──────────────────────────────────────────────────────
router.patch('/:taskId', validate(schemas.updateTask), async (req: Request, res: Response) => {
  const { title, description, instructions, languageId, taskType, targetDuration, status } = req.body;

  try {
    const [existing] = await db.select({ projectId: tasks.projectId }).from(tasks)
      .where(eq(tasks.id, req.params.taskId)).limit(1);

    if (!existing) return sendNotFound(res, 'Task not found');
    if (!(await canAdminProject(existing.projectId, req.user!.id))) {
      return sendForbidden(res, 'Only project admins can update tasks');
    }

    const [updated] = await db.update(tasks)
      .set({
        ...(title          && { title }),
        ...(description    && { description }),
        ...(instructions   && { instructions }),
        ...(languageId     && { languageId }),
        ...(taskType       && { taskType }),
        ...(targetDuration && { targetDuration }),
        ...(status         && { status }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, req.params.taskId))
      .returning();

    await createAuditLog(req.user!.id, 'TASK_UPDATED', req.params.taskId);
    return sendSuccess(res, updated, 'Task updated');
  } catch (err) {
    logger.error('Update task error', { err });
    return sendServerError(res);
  }
});

// ── DELETE /tasks/:taskId ─────────────────────────────────────────────────────
router.delete('/:taskId', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select({ projectId: tasks.projectId }).from(tasks)
      .where(eq(tasks.id, req.params.taskId)).limit(1);

    if (!existing) return sendNotFound(res, 'Task not found');
    if (!(await canAdminProject(existing.projectId, req.user!.id))) {
      return sendForbidden(res, 'Only project admins can delete tasks');
    }

    // Block if approved submissions exist
    const [approvedSub] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.taskId, req.params.taskId), eq(submissions.status, 'APPROVED')))
      .limit(1);

    if (approvedSub) {
      return sendError(res, 'Cannot delete a task that has approved submissions', 400);
    }

    await db.delete(tasks).where(eq(tasks.id, req.params.taskId));
    await createAuditLog(req.user!.id, 'TASK_DELETED', req.params.taskId);
    return sendSuccess(res, null, 'Task deleted');
  } catch (err) {
    logger.error('Delete task error', { err });
    return sendServerError(res);
  }
});

export default router;
