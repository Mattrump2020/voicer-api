import request from 'supertest';
import app from '../src/index';
import { db, languages, users, organizations, projects, projectMembers, userLanguages, tasks } from '../src/db';
import { cleanDatabase } from './setup';
import { eq } from 'drizzle-orm';

describe('Tasks Integration & Language Matching Tests', () => {
  let adminToken: string;
  let contributorToken: string;
  let contributorId: string;
  let projectId: string;
  let englishId: string;
  let yorubaId: string;

  async function getOrCreateLanguage(name: string, code: string): Promise<string> {
    const [existing] = await db.select({ id: languages.id }).from(languages).where(eq(languages.code, code)).limit(1);
    if (existing) return existing.id;

    const [inserted] = await db.insert(languages).values({ name, code }).returning();
    return inserted.id;
  }

  beforeEach(async () => {
    await cleanDatabase();

    // 1. Get or Create Languages
    englishId = await getOrCreateLanguage('English', 'en');
    yorubaId = await getOrCreateLanguage('Yoruba', 'yo');

    // 2. Register Admin/Owner
    const adminRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Project',
        lastName: 'Admin',
        email: 'admin@example.com',
        password: 'password123',
      });

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    adminToken = adminLogin.body.data.token;

    // 3. Register Contributor
    const contributorRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Contributor',
        lastName: 'User',
        email: 'contrib@example.com',
        password: 'password123',
      });
    contributorId = contributorRes.body.data.userId;

    const contribLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'contrib@example.com', password: 'password123' });
    contributorToken = contribLogin.body.data.token;

    // 4. Create Organization
    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Organization',
        description: 'Org for running testing suites',
        country: 'US',
        organizationType: 'Research',
      });
    const organizationId = orgRes.body.data.organizationId;

    // 5. Create Project
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        organizationId,
        name: 'Multi-lingual Audio Project',
        description: 'ASR testing dataset',
        languages: [englishId, yorubaId],
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      });
    projectId = projRes.body.data.projectId;

    // 6. Invite & Add Contributor to Project
    await db.insert(projectMembers).values({
      projectId,
      userId: contributorId,
      role: 'CONTRIBUTOR',
    });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('should only show tasks matching the contributors language proficiency', async () => {
    // 1. Assign Contributor language proficiency as English only
    await request(app)
      .post('/api/v1/languages/user')
      .set('Authorization', `Bearer ${contributorToken}`)
      .send({
        languages: [
          { languageId: englishId, proficiency: 'NATIVE' },
        ],
      });

    // 2. Create one English task and one Yoruba task under project
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId,
        title: 'English Reading task',
        description: 'Read the greeting prompt',
        instructions: 'Read aloud',
        languageId: englishId,
        taskType: 'READ_PROMPT',
        targetDuration: 15,
      });

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId,
        title: 'Yoruba narrative task',
        description: 'Spontaneous speech task',
        instructions: 'Speak Yoruba',
        languageId: yorubaId,
        taskType: 'SPONTANEOUS_SPEECH',
        targetDuration: 30,
      });

    // 3. Contributor queries available tasks
    const availableRes = await request(app)
      .get('/api/v1/tasks/contributor/available')
      .set('Authorization', `Bearer ${contributorToken}`);

    expect(availableRes.status).toBe(200);
    expect(availableRes.body.success).toBe(true);

    // Contributor should see the English task but NOT the Yoruba task
    const visibleTasks = availableRes.body.data;
    expect(visibleTasks.length).toBe(1);
    expect(visibleTasks[0].title).toBe('English Reading task');
  });
});
