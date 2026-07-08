import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, languages, userLanguages } from '../../db';
import { authenticate } from '../../middleware/auth.middleware';
import { validate, schemas } from '../../middleware/validate.middleware';
import { sendSuccess, sendServerError } from '../../utils/response';
import logger from '../../utils/logger';

const router = Router();

// ── GET /languages ─────────────────────────────────────────────────────────
// PUBLIC — no auth needed. Frontend needs this for dropdowns before login.
router.get('/', async (_req, res: Response) => {
  try {
    const rows = await db
      .select({ id: languages.id, name: languages.name, code: languages.code })
      .from(languages)
      .orderBy(languages.name);
    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('List languages error', { err });
    return sendServerError(res);
  }
});

// Everything below this line requires a JWT
router.use(authenticate);

// ── POST /languages/user ───────────────────────────────────────────────────
router.post('/user', validate(schemas.setUserLanguages), async (req: Request, res: Response) => {
  const { languages: langs } = req.body;
  const userId = req.user!.id;

  try {
    await db.delete(userLanguages).where(eq(userLanguages.userId, userId));

    await db.insert(userLanguages).values(
      langs.map((l: { languageId: string; proficiency: string }) => ({
        userId,
        languageId:       l.languageId,
        proficiencyLevel: l.proficiency as 'BASIC' | 'INTERMEDIATE' | 'ADVANCED' | 'NATIVE',
      }))
    );

    const saved = await db
      .select({
        languageId:       userLanguages.languageId,
        proficiencyLevel: userLanguages.proficiencyLevel,
        name:             languages.name,
        code:             languages.code,
      })
      .from(userLanguages)
      .innerJoin(languages, eq(languages.id, userLanguages.languageId))
      .where(eq(userLanguages.userId, userId));

    return sendSuccess(res, saved, 'Language proficiencies updated');
  } catch (err) {
    logger.error('Set user languages error', { err });
    return sendServerError(res);
  }
});

// ── GET /languages/user ────────────────────────────────────────────────────
router.get('/user', async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        languageId:       userLanguages.languageId,
        proficiencyLevel: userLanguages.proficiencyLevel,
        name:             languages.name,
        code:             languages.code,
      })
      .from(userLanguages)
      .innerJoin(languages, eq(languages.id, userLanguages.languageId))
      .where(eq(userLanguages.userId, req.user!.id))
      .orderBy(languages.name);

    return sendSuccess(res, rows);
  } catch (err) {
    logger.error('Get user languages error', { err });
    return sendServerError(res);
  }
});

export default router;
