import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, notifications } from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { sendSuccess, sendServerError } from '../../utils/response';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── GET /notifications ─────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { unreadOnly } = req.query;

  try {
    const conditions = [eq(notifications.userId, req.user!.id)];
    if (unreadOnly === 'true') conditions.push(eq(notifications.isRead, false));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const unreadCount = rows.filter(n => !n.isRead).length;

    return sendSuccess(res, { notifications: rows, unreadCount });
  } catch (err) {
    logger.error('Get notifications error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /notifications/:id/read ──────────────────────────────────────────────
router.patch('/:notificationId/read', async (req: Request, res: Response) => {
  try {
    await db.update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, req.params.notificationId),
          eq(notifications.userId, req.user!.id)
        )
      );

    return sendSuccess(res, null, 'Marked as read');
  } catch (err) {
    logger.error('Mark read error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /notifications/read-all ──────────────────────────────────────────────
router.patch('/read-all', async (req: Request, res: Response) => {
  try {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.user!.id));

    return sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) {
    logger.error('Mark all read error', { err });
    return sendServerError(res);
  }
});

export default router;
