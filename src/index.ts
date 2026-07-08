import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';

import { swaggerSpec } from './config/swagger';
import logger from './utils/logger';
import { sendError } from './utils/response';

import authRoutes         from './modules/auth/auth.routes';
import organizationRoutes from './modules/organizations/organizations.routes';
import projectRoutes      from './modules/projects/projects.routes';
import memberRoutes       from './modules/members/members.routes';
import languageRoutes     from './modules/languages/languages.routes';
import taskRoutes         from './modules/tasks/tasks.routes';
import submissionRoutes   from './modules/submissions/submissions.routes';
import reviewRoutes       from './modules/reviews/reviews.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import exportRoutes       from './modules/exports/exports.routes';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = '/api/v1';

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

app.use(cors({
  origin:      process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      200,
  message:  { success: false, message: 'Too many requests, slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { success: false, message: 'Too many auth attempts. Try again in 15 minutes.' },
});

app.use(globalLimiter);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Swagger UI ────────────────────────────────────────────────────────────────
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Voicer AI API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1BB8C4; }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
  },
}));

app.get('/docs.json', (_req: Request, res: Response) => res.json(swaggerSpec));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'voicer-api' });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use(`${BASE}/auth`,          authLimiter, authRoutes);
app.use(`${BASE}/organizations`, organizationRoutes);
app.use(`${BASE}/projects`,      projectRoutes);
app.use(`${BASE}/members`,       memberRoutes);
app.use(`${BASE}/languages`,     languageRoutes);
app.use(`${BASE}/tasks`,         taskRoutes);
app.use(`${BASE}/submissions`,   submissionRoutes);
app.use(`${BASE}/reviews`,       reviewRoutes);
app.use(`${BASE}/notifications`, notificationRoutes);
app.use(`${BASE}/exports`,       exportRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => sendError(res, 'Route not found', 404));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  sendError(res, 'Internal server error', 500);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀  Voicer API running on http://localhost:${PORT}`);
  logger.info(`📖  Swagger UI   → http://localhost:${PORT}/docs`);
  logger.info(`📋  Raw JSON     → http://localhost:${PORT}/docs.json`);
  logger.info(`💚  Health check → http://localhost:${PORT}/health`);
});

export default app;
