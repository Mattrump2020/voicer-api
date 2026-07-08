import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import { db, users, projectMembers, projects, organizations } from '../db';
import { sendUnauthorized, sendForbidden } from '../utils/response';

// Extend Express Request so downstream handlers see req.user with full types
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        status: string;
      };
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
}

// ─────────────────────────────────────────────────────────────
// authenticate — verifies JWT and loads user onto req.user
// Apply to every protected route
// ─────────────────────────────────────────────────────────────

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return sendUnauthorized(res);

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    const [user] = await db
      .select({
        id:        users.id,
        email:     users.email,
        firstName: users.firstName,
        lastName:  users.lastName,
        status:    users.status,
      })
      .from(users)
      .where(eq(users.id, decoded.userId))
      .limit(1);

    if (!user)                        return sendUnauthorized(res, 'User not found');
    if (user.status === 'SUSPENDED')  return sendForbidden(res, 'Account suspended');

    req.user = user;
    next();
  } catch {
    return sendUnauthorized(res, 'Invalid or expired token');
  }
};

// ─────────────────────────────────────────────────────────────
// requireProjectRole — checks the user's role on a specific project
// Usage: router.patch('/:projectId', requireProjectRole(['PROJECT_ADMIN']), handler)
// ─────────────────────────────────────────────────────────────

export const requireProjectRole = (allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const projectId = req.params.projectId ?? req.body.projectId;
    const userId    = req.user!.id;

    if (!projectId) return sendForbidden(res, 'Project ID required');

    // Org owners always have full access — check that first
    const [ownerCheck] = await db
      .select({ ownerId: organizations.ownerId })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(eq(projects.id, projectId))
      .limit(1);

    if (ownerCheck?.ownerId === userId) return next();

    // Otherwise check project membership role
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, userId),
          eq(projectMembers.userId, userId)
        )
      )
      .limit(1);

    if (!membership)                          return sendForbidden(res, 'You are not a member of this project');
    if (!allowedRoles.includes(membership.role)) return sendForbidden(res);

    next();
  };
};

// ─────────────────────────────────────────────────────────────
// requireOrgOwner — only the organization owner can proceed
// ─────────────────────────────────────────────────────────────

export const requireOrgOwner = async (req: Request, res: Response, next: NextFunction) => {
  const orgId  = req.params.organizationId ?? req.body.organizationId;
  const userId = req.user!.id;

  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org || org.ownerId !== userId) {
    return sendForbidden(res, 'Only the organization owner can perform this action');
  }

  next();
};
