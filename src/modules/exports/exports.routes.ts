import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { Parser } from 'json2csv';
import { eq, and, inArray } from 'drizzle-orm';
import {
  db, datasetExports, projects, organizations,
  projectMembers, submissions, tasks, languages, users, reviews,
} from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import {
  sendSuccess, sendCreated, sendError,
  sendNotFound, sendServerError,
} from '../../utils/response';
import { uploadBuffer, getSignedUrl } from '../../utils/supabase';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(authenticate);

// ── helper: verify export access ──────────────────────────────────────────────
const canExport = async (projectId: string, userId: string) => {
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (org?.ownerId === userId) return true;

  const [mem] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  return mem?.role === 'PROJECT_ADMIN';
};

// ── helper: fetch submission data for export ───────────────────────────────────
const fetchExportRows = async (
  projectId: string,
  approvedOnly: boolean,
  languageId?: string,
  startDate?: string,
  endDate?: string
) => {
  const projectTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  if (!projectTasks.length) return [];
  const taskIds = projectTasks.map(t => t.id);

  const conditions = [inArray(submissions.taskId, taskIds)];
  if (approvedOnly) conditions.push(eq(submissions.status, 'APPROVED'));
  if (languageId)   conditions.push(eq(submissions.languageId, languageId));

  const rows = await db
    .select({
      submissionId:    submissions.id,
      status:          submissions.status,
      storagePath:     submissions.storagePath,
      audioDuration:   submissions.audioDuration,
      fileSize:        submissions.fileSize,
      submittedAt:     submissions.submittedAt,
      taskTitle:       tasks.title,
      taskType:        tasks.taskType,
      language:        languages.name,
      languageCode:    languages.code,
      contributorName: users.firstName,
      contributorEmail:users.email,
      rating:          reviews.rating,
      feedback:        reviews.feedback,
    })
    .from(submissions)
    .innerJoin(tasks,     eq(tasks.id,     submissions.taskId))
    .innerJoin(languages, eq(languages.id, submissions.languageId))
    .innerJoin(users,     eq(users.id,     submissions.contributorId))
    .leftJoin(reviews,    eq(reviews.submissionId, submissions.id))
    .where(and(...conditions))
    .orderBy(submissions.submittedAt);

  // Apply date filters in JS (simpler than drizzle date range syntax)
  return rows.filter(r => {
    const t = new Date(r.submittedAt).getTime();
    if (startDate && t < new Date(startDate).getTime()) return false;
    if (endDate   && t > new Date(endDate).getTime())   return false;
    return true;
  });
};

// ── POST /exports ──────────────────────────────────────────────────────────────
router.post('/', validate(schemas.generateExport), async (req: Request, res: Response) => {
  const { projectId, format, approvedOnly, languageId, startDate, endDate } = req.body;
  const userId = req.user!.id;

  if (!(await canExport(projectId, userId))) {
    return sendError(res, 'Only project admins can export datasets', 403);
  }

  // Create export record immediately so frontend can show "processing"
  const [exportRecord] = await db.insert(datasetExports)
    .values({
      projectId,
      generatedBy: userId,
      exportType:  format,
      status:      'PROCESSING',
      filters:     { approvedOnly, languageId, startDate, endDate },
    })
    .returning({ id: datasetExports.id });

  // Process async — in a production app this would be a queue job
  // For now we process inline but respond after writing the record
  ;(async () => {
    try {
      const rows = await fetchExportRows(projectId, approvedOnly, languageId, startDate, endDate);

      if (!rows.length) {
        await db.update(datasetExports).set({ status: 'FAILED' }).where(eq(datasetExports.id, exportRecord.id));
        return;
      }

      let buffer: Buffer;
      let contentType: string;

      if (format === 'CSV') {
        const fields = ['submissionId','taskTitle','taskType','language','contributorName',
          'status','rating','feedback','audioDuration','submittedAt','storagePath'];
        const parser = new Parser({ fields });
        buffer = Buffer.from(parser.parse(rows), 'utf-8');
        contentType = 'text/csv';
      } else if (format === 'JSON') {
        buffer = Buffer.from(JSON.stringify(rows, null, 2), 'utf-8');
        contentType = 'application/json';
      } else {
        // ZIP — metadata.json + manifest.csv + README
        buffer = await new Promise<Buffer>((resolve, reject) => {
          const arc = archiver('zip', { zlib: { level: 9 } });
          const chunks: Buffer[] = [];
          arc.on('data', c => chunks.push(c));
          arc.on('end', () => resolve(Buffer.concat(chunks)));
          arc.on('error', reject);
          arc.append(JSON.stringify(rows, null, 2), { name: 'metadata.json' });
          const parser = new Parser({ fields: ['submissionId','taskTitle','language','status','audioDuration','storagePath'] });
          arc.append(parser.parse(rows), { name: 'manifest.csv' });
          arc.append(
            `VOICER AI DATASET EXPORT\nProject: ${projectId}\nDate: ${new Date().toISOString()}\nRecords: ${rows.length}\n\nFiles:\n- metadata.json  Full submission metadata\n- manifest.csv   Summary manifest\n\nNote: audio files are referenced by storagePath. Generate signed URLs via the API.`,
            { name: 'README.txt' }
          );
          arc.finalize();
        });
        contentType = 'application/zip';
      }

      const ext         = format.toLowerCase();
      const storagePath = `exports/${projectId}/${uuidv4()}.${ext}`;
      await uploadBuffer(storagePath, buffer, contentType);

      await db.update(datasetExports)
        .set({ storagePath, status: 'READY' })
        .where(eq(datasetExports.id, exportRecord.id));

      await createAuditLog(userId, 'DATASET_EXPORTED', exportRecord.id, { projectId, format, count: rows.length });
    } catch (err) {
      logger.error('Export processing error', { err });
      await db.update(datasetExports).set({ status: 'FAILED' }).where(eq(datasetExports.id, exportRecord.id));
    }
  })();

  return sendCreated(res, { exportId: exportRecord.id }, 'Export started — poll GET /exports/:id for status');
});

// ── GET /exports/:exportId ─────────────────────────────────────────────────────
router.get('/:exportId', async (req: Request, res: Response) => {
  try {
    const [exp] = await db
      .select()
      .from(datasetExports)
      .where(and(eq(datasetExports.id, req.params.exportId), eq(datasetExports.generatedBy, req.user!.id)))
      .limit(1);

    if (!exp) return sendNotFound(res, 'Export not found');
    return sendSuccess(res, exp);
  } catch (err) {
    logger.error('Get export error', { err });
    return sendServerError(res);
  }
});

// ── GET /exports/:exportId/download ───────────────────────────────────────────
router.get('/:exportId/download', async (req: Request, res: Response) => {
  try {
    const [exp] = await db
      .select({ status: datasetExports.status, storagePath: datasetExports.storagePath, exportType: datasetExports.exportType })
      .from(datasetExports)
      .where(and(eq(datasetExports.id, req.params.exportId), eq(datasetExports.generatedBy, req.user!.id)))
      .limit(1);

    if (!exp) return sendNotFound(res, 'Export not found');
    if (exp.status === 'PROCESSING') return sendError(res, 'Export is still being processed — try again shortly', 202);
    if (exp.status === 'FAILED')     return sendError(res, 'Export failed. Please regenerate.', 500);
    if (!exp.storagePath)            return sendError(res, 'Export file not found', 404);

    const downloadUrl = await getSignedUrl(exp.storagePath, 600); // 10 min
    return sendSuccess(res, { downloadUrl, format: exp.exportType });
  } catch (err) {
    logger.error('Download export error', { err });
    return sendServerError(res);
  }
});

// ── GET /exports?projectId= ────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { projectId } = req.query;

  try {
    const conditions = [eq(datasetExports.generatedBy, req.user!.id)];
    if (projectId) conditions.push(eq(datasetExports.projectId, projectId as string));

    const rows = await db
      .select()
      .from(datasetExports)
      .where(and(...conditions))
      .orderBy(datasetExports.createdAt);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('List exports error', { err });
    return sendServerError(res);
  }
});

export default router;
