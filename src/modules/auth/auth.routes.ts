import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db';
import { validate, schemas } from '../../middleware/validate.middleware';
import { authenticate } from '../../middleware/auth.middleware';
import {
  sendSuccess, sendCreated, sendError,
  sendUnauthorized, sendNotFound, sendServerError,
} from '../../utils/response';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../utils/email';
import { createAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';

const router = Router();

// Helper — keeps expiresIn type-safe for jsonwebtoken
const signToken = (userId: string, email: string) =>
  jwt.sign({ userId, email }, process.env.JWT_SECRET!, { expiresIn: '7d' });

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', validate(schemas.register), async (req: Request, res: Response) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return sendError(res, 'An account with this email already exists', 409);

    const passwordHash   = await bcrypt.hash(password, 12);
    const verifyToken    = crypto.randomBytes(32).toString('hex');
    const verifyExpires  = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [newUser] = await db.insert(users).values({
      firstName,
      lastName,
      email,
      passwordHash,
      verifyToken,
      verifyTokenExpiresAt: verifyExpires,
    }).returning({ id: users.id });

    await sendVerificationEmail(email, verifyToken);
    await createAuditLog(newUser.id, 'USER_REGISTERED', newUser.id);

    return sendCreated(res, { userId: newUser.id }, 'Registration successful. Check your email to verify your account.');
  } catch (err) {
    logger.error('Register error', { err });
    return sendServerError(res);
  }
});

// ── GET /auth/verify-email?token= ─────────────────────────────────────────────
router.get('/verify-email', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') return sendError(res, 'Token required');

  try {
    const now = new Date();
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.verifyToken, token))
      .limit(1);

    if (!user) return sendError(res, 'Invalid or expired verification link', 400);

    await db.update(users)
      .set({ emailVerified: true, verifyToken: null, verifyTokenExpiresAt: null })
      .where(eq(users.id, user.id));

    return sendSuccess(res, null, 'Email verified. You can now log in.');
  } catch (err) {
    logger.error('Verify email error', { err });
    return sendServerError(res);
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', validate(schemas.login), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const [user] = await db
      .select({
        id:           users.id,
        firstName:    users.firstName,
        lastName:     users.lastName,
        email:        users.email,
        passwordHash: users.passwordHash,
        status:       users.status,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) return sendUnauthorized(res, 'Invalid email or password');
    if (!user.emailVerified) return sendUnauthorized(res, 'Please verify your email before logging in');
    if (user.status === 'SUSPENDED') return sendUnauthorized(res, 'Your account has been suspended');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return sendUnauthorized(res, 'Invalid email or password');

    const token = signToken(user.id, user.email);

    await createAuditLog(user.id, 'USER_LOGIN', user.id, {}, req.ip);

    return sendSuccess(res, {
      token,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
    }, 'Login successful');
  } catch (err) {
    logger.error('Login error', { err });
    return sendServerError(res);
  }
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
router.post('/forgot-password', validate(schemas.forgotPassword), async (req: Request, res: Response) => {
  const { email } = req.body;
  // Always return the same message — prevents email enumeration
  const MSG = 'If an account exists, a reset link has been sent.';

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return sendSuccess(res, null, MSG);

    const resetToken   = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '60') * 60 * 1000);

    await db.update(users)
      .set({ resetToken, resetTokenExpiresAt: resetExpires })
      .where(eq(users.id, user.id));

    await sendPasswordResetEmail(email, resetToken);
    return sendSuccess(res, null, MSG);
  } catch (err) {
    logger.error('Forgot password error', { err });
    return sendServerError(res);
  }
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
router.post('/reset-password', validate(schemas.resetPassword), async (req: Request, res: Response) => {
  const { token, password } = req.body;

  try {
    const [user] = await db
      .select({ id: users.id, resetTokenExpiresAt: users.resetTokenExpiresAt })
      .from(users)
      .where(eq(users.resetToken, token))
      .limit(1);

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      return sendError(res, 'Invalid or expired reset link', 400);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(users)
      .set({ passwordHash, resetToken: null, resetTokenExpiresAt: null })
      .where(eq(users.id, user.id));

    return sendSuccess(res, null, 'Password reset successfully. You can now log in.');
  } catch (err) {
    logger.error('Reset password error', { err });
    return sendServerError(res);
  }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const [user] = await db
      .select({
        id:             users.id,
        firstName:      users.firstName,
        lastName:       users.lastName,
        email:          users.email,
        profilePicture: users.profilePicture,
        status:         users.status,
        country:        users.country,
        gender:         users.gender,
        ageRange:       users.ageRange,
        createdAt:      users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (!user) return sendNotFound(res, 'User not found');
    return sendSuccess(res, user);
  } catch (err) {
    logger.error('Get me error', { err });
    return sendServerError(res);
  }
});

// ── PATCH /auth/profile ───────────────────────────────────────────────────────
router.patch('/profile', authenticate, validate(schemas.updateProfile), async (req: Request, res: Response) => {
  const { firstName, lastName, country, gender, ageRange } = req.body;

  try {
    const [updated] = await db.update(users)
      .set({
        ...(firstName && { firstName }),
        ...(lastName  && { lastName  }),
        ...(country   && { country   }),
        ...(gender    && { gender    }),
        ...(ageRange  && { ageRange  }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id: users.id, firstName: users.firstName, lastName: users.lastName,
        email: users.email, country: users.country, gender: users.gender, ageRange: users.ageRange,
      });

    return sendSuccess(res, updated, 'Profile updated');
  } catch (err) {
    logger.error('Update profile error', { err });
    return sendServerError(res);
  }
});

export default router;
