import { db, auditLogs } from '../db';
import logger from './logger';

type AuditEvent =
  | 'USER_LOGIN' | 'USER_LOGOUT' | 'USER_REGISTERED'
  | 'ORG_CREATED' | 'ORG_UPDATED' | 'ORG_DELETED'
  | 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'PROJECT_ARCHIVED' | 'PROJECT_DELETED'
  | 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_DELETED'
  | 'INVITATION_SENT' | 'INVITATION_ACCEPTED'
  | 'SUBMISSION_CREATED' | 'REVIEW_COMPLETED'
  | 'DATASET_EXPORTED';

export const createAuditLog = async (
  userId: string | null,
  eventType: AuditEvent,
  entityId?: string,
  metadata?: Record<string, unknown>,
  ipAddress?: string
) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      eventType,
      entityId,
      metadata,
      ipAddress,
    });
  } catch (err) {
    // Never throw — audit logging failure should never break a request
    logger.error('Audit log failed', { err, eventType });
  }
};
