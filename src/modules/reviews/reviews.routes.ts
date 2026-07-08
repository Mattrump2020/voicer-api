import { Router, Request, Response } from 'express';
import { eq, and, inArray } from 'drizzle-orm';
import {
  db, reviews, submissions, tasks, projects,
  projectMembers, userLanguages, notifications,
  languages, users,
} from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import {
  sendSuccess, sendCreated, sendError,
  sendNotFound, sendServerError,
} from '../../utils/response';
import { getSignedUrl } from '../../utils/supabase';
import { sendReviewNotificationEmail } from '../../utils/email';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── GET /reviews/queue ─────────────────────────────────────────────────────────
// Submissions the logged-in reviewer can review:
// - must be PENDING_REVIEW
// - reviewer must be on the project
// - reviewer must speak the submission language
// - reviewer hasn't already reviewed it
router.get('/queue', async (req: Request, res: Response) => {
  const { projectId } = req.query;
  const reviewerId = req.user!.id;

  try {
    // Projects where user is REVIEWER
    const reviewerProjects = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, reviewerId), eq(projectMembers.role, 'REVIEWER')));

    if (!reviewerProjects.length) return sendSuccess(res, []);

    const projectIds = projectId
      ? [projectId as string]
      : reviewerProjects.map(p => p.projectId);

    // Languages reviewer speaks
    const spokenLangs = await db
      .select({ languageId: userLanguages.languageId })
      .from(userLanguages)
      .where(eq(userLanguages.userId, reviewerId));

    if (!spokenLangs.length) return sendSuccess(res, []);
    const langIds = spokenLangs.map(l => l.languageId);

    // Tasks in those projects
    const projectTasks = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds));

    if (!projectTasks.length) return sendSuccess(res, []);
    const taskIds = projectTasks.map(t => t.id);

    // Submissions reviewer has already reviewed
    const alreadyReviewed = await db
      .select({ submissionId: reviews.submissionId })
      .from(reviews)
      .where(eq(reviews.reviewerId, reviewerId));

    const reviewedIds = alreadyReviewed.map(r => r.submissionId);

    // Fetch the queue
    const pendingSubs = await db
      .select({
        id:            submissions.id,
        storagePath:   submissions.storagePath,
        audioDuration: submissions.audioDuration,
        submittedAt:   submissions.submittedAt,
        taskTitle:     tasks.title,
        taskType:      tasks.taskType,
        instructions:  tasks.instructions,
        languageName:  languages.name,
        languageCode:  languages.code,
        projectId:     tasks.projectId,
        contributorFirstName: users.firstName,
        contributorLastName:  users.lastName,
      })
      .from(submissions)
      .innerJoin(tasks,     eq(tasks.id,     submissions.taskId))
      .innerJoin(languages, eq(languages.id, submissions.languageId))
      .innerJoin(users,     eq(users.id,     submissions.contributorId))
      .where(
        and(
          eq(submissions.status, 'PENDING_REVIEW'),
          inArray(submissions.taskId, taskIds),
          inArray(submissions.languageId, langIds),
          reviewedIds.length ? undefined : undefined // handled by filter below
        )
      )
      .orderBy(submissions.submittedAt);

    // Filter out already-reviewed (done in JS since drizzle notInArray needs values)
    const filtered = reviewedIds.length
      ? pendingSubs.filter(s => !reviewedIds.includes(s.id))
      : pendingSubs;

    // Attach signed URLs
    const withUrls = await Promise.all(
      filtered.map(async (s) => ({
        ...s,
        audioUrl: await getSignedUrl(s.storagePath, 3600).catch(() => null),
      }))
    );

    return sendSuccess(res, withUrls);
  } catch (err) {
    logger.error('Review queue error', { err });
    return sendServerError(res);
  }
});

// ── POST /reviews ──────────────────────────────────────────────────────────────
router.post('/', validate(schemas.createReview), async (req: Request, res: Response) => {
  const { submissionId, rating, status, feedback } = req.body;
  const reviewerId = req.user!.id;

  // feedback is conditionally required — double-check here even though Joi handles it
  if (status === 'REJECTED' && !feedback?.trim()) {
    return sendError(res, 'Feedback is required when rejecting a submission');
  }

  try {
    // Verify reviewer has access to this submission's project
    const [sub] = await db
      .select({
        id:            submissions.id,
        contributorId: submissions.contributorId,
        storagePath:   submissions.storagePath,
        taskId:        submissions.taskId,
        status:        submissions.status,
      })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!sub) return sendNotFound(res, 'Submission not found');
    if (sub.status !== 'PENDING_REVIEW') {
      return sendError(res, 'This submission has already been reviewed');
    }

    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks).where(eq(tasks.id, sub.taskId)).limit(1);

    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, task.projectId), eq(projectMembers.userId, reviewerId)))
      .limit(1);

    if (membership?.role !== 'REVIEWER') {
      return sendError(res, 'Only reviewers can review submissions', 403);
    }

    // Duplicate review guard
    const [dup] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.submissionId, submissionId), eq(reviews.reviewerId, reviewerId)))
      .limit(1);

    if (dup) return sendError(res, 'You have already reviewed this submission');

    // Derive final status:
    // POOR rating always means REJECTED
    // FAIR rating means APPROVED (with note in feedback)
    const finalStatus: 'APPROVED' | 'REJECTED' = rating === 'POOR' ? 'REJECTED' : status;
    const submissionStatus = finalStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED';

    // Insert review
    const [review] = await db.insert(reviews)
      .values({ submissionId, reviewerId, rating, feedback, reviewStatus: finalStatus })
      .returning({ id: reviews.id, reviewedAt: reviews.reviewedAt });

    // Update submission status
    await db.update(submissions)
      .set({ status: submissionStatus, updatedAt: new Date() })
      .where(eq(submissions.id, submissionId));

    // Notify contributor — in-app + email
    const [contributor] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users).where(eq(users.id, sub.contributorId)).limit(1);

    const [taskInfo] = await db
      .select({ title: tasks.title })
      .from(tasks).where(eq(tasks.id, sub.taskId)).limit(1);

    await db.insert(notifications).values({
      userId:  sub.contributorId,
      title:   submissionStatus === 'APPROVED' ? '✅ Recording Approved' : '🔄 Recording Needs Revision',
      message: submissionStatus === 'APPROVED'
        ? `Your recording for "${taskInfo.title}" was approved.`
        : `Your recording for "${taskInfo.title}" was rejected. ${feedback ?? ''}`.trim(),
      type:  'REVIEW',
      refId: submissionId,
    });

    // Email is non-blocking
    sendReviewNotificationEmail(contributor.email, submissionStatus, taskInfo.title, feedback).catch(() => {});

    await createAuditLog(reviewerId, 'REVIEW_COMPLETED', review.id, { submissionId, rating, finalStatus });

    return sendCreated(res, {
      reviewId:         review.id,
      submissionStatus,
    }, 'Review submitted');
  } catch (err) {
    logger.error('Create review error', { err });
    return sendServerError(res);
  }
});

// ── GET /reviews/reviewer/history ─────────────────────────────────────────────
router.get('/reviewer/history', async (req: Request, res: Response) => {
  const { projectId } = req.query;
  const reviewerId = req.user!.id;

  try {
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, reviewerId), eq(projectMembers.role, 'REVIEWER')));

    if (!memberships.length) return sendSuccess(res, []);

    const projectIds = projectId ? [projectId as string] : memberships.map(m => m.projectId);

    const projectTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds));

    if (!projectTasks.length) return sendSuccess(res, []);

    const taskIds = projectTasks.map(t => t.id);

    const rows = await db
      .select({
        reviewId:          reviews.id,
        rating:            reviews.rating,
        reviewStatus:      reviews.reviewStatus,
        feedback:          reviews.feedback,
        reviewedAt:        reviews.reviewedAt,
        submissionId:      submissions.id,
        submissionStatus:  submissions.status,
        taskTitle:         tasks.title,
        languageName:      languages.name,
        contributorFirst:  users.firstName,
        contributorLast:   users.lastName,
      })
      .from(reviews)
      .innerJoin(submissions, eq(submissions.id, reviews.submissionId))
      .innerJoin(tasks,       eq(tasks.id,        submissions.taskId))
      .innerJoin(languages,   eq(languages.id,    submissions.languageId))
      .innerJoin(users,       eq(users.id,        submissions.contributorId))
      .where(
        and(
          eq(reviews.reviewerId, reviewerId),
          inArray(submissions.taskId, taskIds)
        )
      )
      .orderBy(reviews.reviewedAt);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('Review history error', { err });
    return sendServerError(res);
  }
});

// ── GET /reviews/reviewer/dashboard ───────────────────────────────────────────
router.get('/reviewer/dashboard', async (req: Request, res: Response) => {
  const reviewerId = req.user!.id;
  try {
    const allReviews = await db
      .select({ reviewStatus: reviews.reviewStatus })
      .from(reviews)
      .where(eq(reviews.reviewerId, reviewerId));

    return sendSuccess(res, {
      totalReviews: allReviews.length,
      approved:     allReviews.filter(r => r.reviewStatus === 'APPROVED').length,
      rejected:     allReviews.filter(r => r.reviewStatus === 'REJECTED').length,
    });
  } catch (err) {
    logger.error('Reviewer dashboard error', { err });
    return sendServerError(res);
  }
});

export default router;
