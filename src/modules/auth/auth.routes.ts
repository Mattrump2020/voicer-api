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

const IS_DEV = process.env.NODE_ENV !== 'production';

// ── helper: sign JWT ──────────────────────────────────────────────────────────
const signToken = (userId: string, email: string): string =>
  jwt.sign({ userId, email }, process.env.JWT_SECRET!, { expiresIn: '7d' });

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', validate(schemas.register), async (req: Request, res: Response) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    // Check duplicate email
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return sendError(res, 'An account with this email already exists', 409);
    }

    const passwordHash  = await bcrypt.hash(password, 12);
    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // ── DEV MODE: auto-verify so you're never blocked by email ───────────────
    // In development the user is immediately verified — no email needed.
    // In production the token is saved and a real email is sent.
    if (IS_DEV) {
      const [newUser] = await db.insert(users)
        .values({
          firstName,
          lastName,
          email,
          passwordHash,
          emailVerified: true,   // ← auto-verified
          verifyToken:   null,
          verifyTokenExpiresAt: null,
        })
        .returning({ id: users.id });

      // Audit log AFTER the insert is committed
      await createAuditLog(newUser.id, 'USER_REGISTERED', newUser.id);

      logger.info(`[DEV] User registered and auto-verified: ${email}`);

      return sendCreated(res, { userId: newUser.id },
        'Registered successfully (dev mode — auto-verified, no email sent)'
      );
    }

    // ── PRODUCTION: save token, send real verification email ─────────────────
    const [newUser] = await db.insert(users)
      .values({
        firstName,
        lastName,
        email,
        passwordHash,
        emailVerified:        false,
        verifyToken,
        verifyTokenExpiresAt: verifyExpires,
      })
      .returning({ id: users.id });

    // Audit log AFTER the insert is committed — fixes the FK 23503 error
    await createAuditLog(newUser.id, 'USER_REGISTERED', newUser.id);

    // Email is non-blocking — a failure is logged but doesn't break registration
    await sendVerificationEmail(email, verifyToken);

    return sendCreated(res, { userId: newUser.id },
      'Registration successful. Check your email to verify your account.'
    );
  } catch (err) {
    logger.error('Register error', { err });
    return sendServerError(res);
  }
});

// ── POST /auth/dev/force-verify ───────────────────────────────────────────────
// DEV ONLY — force-verify any account by email without needing the token.
// Returns 404 in production as if the route doesn't exist.
router.post('/dev/force-verify', async (req: Request, res: Response) => {
  if (!IS_DEV) return sendNotFound(res);

  const { email } = req.body;
  if (!email) return sendError(res, 'email is required');

  try {
    const [user] = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) return sendNotFound(res, 'No account found with that email');
    if (user.emailVerified) return sendSuccess(res, null, 'Already verified');

    await db.update(users)
      .set({ emailVerified: true, verifyToken: null, verifyTokenExpiresAt: null })
      .where(eq(users.id, user.id));

    return sendSuccess(res, null, `${email} has been force-verified`);
  } catch (err) {
    logger.error('Force verify error', { err });
    return sendServerError(res);
  }
});

// ── GET /auth/verify-email?token= ─────────────────────────────────────────────
// Production flow — user clicks the link in their email
router.get('/verify-email', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') return sendError(res, 'Token is required');

  try {
    const [user] = await db
      .select({ id: users.id, verifyTokenExpiresAt: users.verifyTokenExpiresAt })
      .from(users)
      .where(eq(users.verifyToken, token))
      .limit(1);

    if (!user) return sendError(res, 'Invalid or expired verification link', 400);

    if (user.verifyTokenExpiresAt && user.verifyTokenExpiresAt < new Date()) {
      return sendError(res, 'This verification link has expired. Please register again.', 400);
    }

    await db.update(users)
      .set({ emailVerified: true, verifyToken: null, verifyTokenExpiresAt: null })
      .where(eq(users.id, user.id));

    return sendSuccess(res, null, 'Email verified successfully. You can now log in.');
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
        id:            users.id,
        firstName:     users.firstName,
        lastName:      users.lastName,
        email:         users.email,
        passwordHash:  users.passwordHash,
        status:        users.status,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) return sendUnauthorized(res, 'Invalid email or password');

    if (!user.emailVerified) {
      // Give a clearer message in dev so you know what's happening
      const msg = IS_DEV
        ? 'Email not verified. In dev mode, use POST /auth/dev/force-verify or register again (auto-verified).'
        : 'Please verify your email before logging in. Check your inbox.';
      return sendUnauthorized(res, msg);
    }

    if (user.status === 'SUSPENDED') {
      return sendUnauthorized(res, 'Your account has been suspended. Contact support.');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return sendUnauthorized(res, 'Invalid email or password');

    const token = signToken(user.id, user.email);

    await createAuditLog(user.id, 'USER_LOGIN', user.id, {}, req.ip ?? undefined);

    return sendSuccess(res, {
      token,
      user: {
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        email:     user.email,
      },
    }, 'Login successful');
  } catch (err) {
    logger.error('Login error', { err });
    return sendServerError(res);
  }
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
router.post('/forgot-password', validate(schemas.forgotPassword), async (req: Request, res: Response) => {
  const { email } = req.body;
  // Always return the same message — prevents email enumeration attacks
  const MSG = 'If an account exists for that email, a reset link has been sent.';

  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) return sendSuccess(res, null, MSG);

    const resetToken   = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(
      Date.now() + parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '60') * 60 * 1000
    );

    await db.update(users)
      .set({ resetToken, resetTokenExpiresAt: resetExpires })
      .where(eq(users.id, user.id));

    await sendPasswordResetEmail(email, resetToken);

    // In dev, log the token so you can use it without email
    if (IS_DEV) {
      logger.info(`[DEV] Password reset token for ${email}: ${resetToken}`);
    }

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

    if (!user) return sendError(res, 'Invalid or expired reset link', 400);

    if (user.resetTokenExpiresAt && user.resetTokenExpiresAt < new Date()) {
      return sendError(res, 'This reset link has expired. Please request a new one.', 400);
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
        ...(firstName !== undefined && { firstName }),
        ...(lastName  !== undefined && { lastName  }),
        ...(country   !== undefined && { country   }),
        ...(gender    !== undefined && { gender    }),
        ...(ageRange  !== undefined && { ageRange  }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id:        users.id,
        firstName: users.firstName,
        lastName:  users.lastName,
        email:     users.email,
        country:   users.country,
        gender:    users.gender,
        ageRange:  users.ageRange,
      });

    return sendSuccess(res, updated, 'Profile updated successfully');
  } catch (err) {
    logger.error('Update profile error', { err });
    return sendServerError(res);
  }
});

export default router;
