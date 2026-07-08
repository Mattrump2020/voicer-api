import { Router, Request, Response } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import {
  db, submissions, tasks, projects, projectMembers,
  userLanguages, notifications, languages, users, reviews,
} from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import {
  sendSuccess, sendCreated, sendError,
  sendNotFound, sendServerError,
} from '../../utils/response';
import { getSignedUrl, getSignedUploadUrl } from '../../utils/supabase';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(authenticate);

// ── POST /submissions/upload-url ──────────────────────────────────────────────
// Frontend requests a signed upload URL from the server.
// Server controls the storage path (prevents path traversal / manipulation).
// Frontend uses this URL to PUT the audio file directly to Supabase Storage.
// Nothing passes through the Express server — keeps memory usage flat.
router.post('/upload-url', validate(schemas.requestUploadUrl), async (req: Request, res: Response) => {
  const { taskId, fileName, mimeType } = req.body;
  const userId = req.user!.id;

  try {
    // Verify contributor has access to this task
    const [task] = await db
      .select({ projectId: tasks.projectId, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) return sendError(res, 'Task not found', 404);
    if (task.status === 'CLOSED') return sendError(res, 'This task is no longer accepting submissions');

    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, task.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (membership?.role !== 'CONTRIBUTOR') {
      return sendError(res, 'Only contributors can upload recordings', 403);
    }

    // Build a deterministic storage path: audio/{userId}/{taskId}/{uuid}.{ext}
    const ext         = fileName.split('.').pop() || 'webm';
    const storagePath = `audio/${userId}/${taskId}/${uuidv4()}.${ext}`;
    const uploadUrl   = await getSignedUploadUrl(storagePath);

    return sendSuccess(res, { uploadUrl, storagePath }, 'Upload URL generated — valid for 5 minutes');
  } catch (err) {
    logger.error('Get upload URL error', { err });
    return sendServerError(res);
  }
});

// ── POST /submissions ─────────────────────────────────────────────────────────
// Called AFTER the frontend has uploaded the file directly to Supabase Storage.
// Body contains the storagePath returned from /upload-url.
router.post('/', validate(schemas.createSubmission), async (req: Request, res: Response) => {
  const { taskId, storagePath, languageId, audioDuration, fileSize, parentId } = req.body;
  const contributorId = req.user!.id;

  try {
    const [task] = await db
      .select({ projectId: tasks.projectId, status: tasks.status, languageId: tasks.languageId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) return sendError(res, 'Task not found', 404);
    if (task.status === 'CLOSED') return sendError(res, 'This task is no longer accepting submissions');

    // Verify contributor membership
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, task.projectId), eq(projectMembers.userId, contributorId)))
      .limit(1);

    if (membership?.role !== 'CONTRIBUTOR') {
      return sendError(res, 'You are not a contributor on this project', 403);
    }

    // Verify contributor speaks this language
    const [langCheck] = await db
      .select({ id: userLanguages.id })
      .from(userLanguages)
      .where(and(eq(userLanguages.userId, contributorId), eq(userLanguages.languageId, languageId)))
      .limit(1);

    if (!langCheck) return sendError(res, 'You have not set proficiency for this language');

    // Generate a permanent-ish public reference URL
    // We store the storagePath and generate signed URLs on read
    const audioUrl = `${process.env.SUPABASE_URL}/storage/v1/object/${process.env.SUPABASE_AUDIO_BUCKET}/${storagePath}`;

    const [sub] = await db.insert(submissions)
      .values({
        taskId,
        contributorId,
        audioUrl,
        storagePath,
        audioDuration,
        fileSize,
        languageId,
        parentId: parentId ?? null,
      })
      .returning({ id: submissions.id, status: submissions.status, submittedAt: submissions.submittedAt });

    // Notify all reviewers on this project
    const reviewers = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, task.projectId), eq(projectMembers.role, 'REVIEWER')));

    if (reviewers.length) {
      await db.insert(notifications).values(
        reviewers.map(r => ({
          userId:  r.userId,
          title:   'New Recording to Review',
          message: 'A new audio submission is waiting for your review.',
          type:    'SUBMISSION',
          refId:   sub.id,
        }))
      );
    }

    await createAuditLog(contributorId, 'SUBMISSION_CREATED', sub.id, { taskId });
    return sendCreated(res, { submissionId: sub.id, status: sub.status }, 'Recording submitted successfully');
  } catch (err) {
    logger.error('Create submission error', { err });
    return sendServerError(res);
  }
});

// ── GET /submissions/:submissionId ────────────────────────────────────────────
router.get('/:submissionId', async (req: Request, res: Response) => {
  try {
    const [sub] = await db
      .select({
        id:            submissions.id,
        status:        submissions.status,
        storagePath:   submissions.storagePath,
        audioDuration: submissions.audioDuration,
        fileSize:      submissions.fileSize,
        submittedAt:   submissions.submittedAt,
        parentId:      submissions.parentId,
        taskId:        tasks.id,
        taskTitle:     tasks.title,
        instructions:  tasks.instructions,
        languageName:  languages.name,
        contributorId: users.id,
        firstName:     users.firstName,
        lastName:      users.lastName,
      })
      .from(submissions)
      .innerJoin(tasks,     eq(tasks.id,     submissions.taskId))
      .innerJoin(languages, eq(languages.id, submissions.languageId))
      .innerJoin(users,     eq(users.id,     submissions.contributorId))
      .where(eq(submissions.id, req.params.submissionId))
      .limit(1);

    if (!sub) return sendNotFound(res, 'Submission not found');

    // Generate a signed URL — valid 1 hour — so audio is playable
    // but the bucket stays private
    const signedAudioUrl = await getSignedUrl(sub.storagePath, 3600);

    return sendSuccess(res, { ...sub, audioUrl: signedAudioUrl });
  } catch (err) {
    logger.error('Get submission error', { err });
    return sendServerError(res);
  }
});

// ── GET /submissions/contributor/history ──────────────────────────────────────
router.get('/contributor/history', async (req: Request, res: Response) => {
  const { projectId, status } = req.query;
  const userId = req.user!.id;

  try {
    // Get task IDs for this contributor's projects
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, 'CONTRIBUTOR')));

    if (!memberships.length) return sendSuccess(res, []);

    const projectIds = projectId
      ? [projectId as string]
      : memberships.map(m => m.projectId);

    const projectTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds));

    if (!projectTasks.length) return sendSuccess(res, []);

    const taskIds = projectTasks.map(t => t.id);

    const rows = await db
      .select({
        id:           submissions.id,
        status:       submissions.status,
        submittedAt:  submissions.submittedAt,
        audioDuration: submissions.audioDuration,
        taskTitle:    tasks.title,
        taskType:     tasks.taskType,
        languageName: languages.name,
      })
      .from(submissions)
      .innerJoin(tasks,     eq(tasks.id,     submissions.taskId))
      .innerJoin(languages, eq(languages.id, submissions.languageId))
      .where(
        and(
          eq(submissions.contributorId, userId),
          inArray(submissions.taskId, taskIds),
          status ? eq(submissions.status, status as 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION') : undefined
        )
      )
      .orderBy(submissions.submittedAt);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('Submission history error', { err });
    return sendServerError(res);
  }
});

// ── GET /submissions/contributor/dashboard ────────────────────────────────────
router.get('/contributor/dashboard', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const allSubs = await db
      .select({ status: submissions.status })
      .from(submissions)
      .where(eq(submissions.contributorId, userId));

    const [availableTasks] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, 'CONTRIBUTOR')));

    return sendSuccess(res, {
      totalSubmissions: allSubs.length,
      approved:         allSubs.filter(s => s.status === 'APPROVED').length,
      rejected:         allSubs.filter(s => s.status === 'REJECTED').length,
      pendingReview:    allSubs.filter(s => s.status === 'PENDING_REVIEW').length,
      needsRevision:    allSubs.filter(s => s.status === 'NEEDS_REVISION').length,
    });
  } catch (err) {
    logger.error('Contributor dashboard error', { err });
    return sendServerError(res);
  }
});

export default router;
