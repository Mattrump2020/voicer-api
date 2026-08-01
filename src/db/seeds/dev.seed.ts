import {
  db, users, organizations, organizationMembers,
  projects, projectMembers, projectLanguages, languages,
  userLanguages, tasks, submissions, reviews, auditLogs
} from '../index';
import bcrypt from 'bcryptjs';
import logger from '../../utils/logger';

const LANGUAGES = [
  { name: 'English',          code: 'en'  },
  { name: 'Yoruba',           code: 'yo'  },
  { name: 'Hausa',            code: 'ha'  },
  { name: 'Igbo',             code: 'ig'  },
  { name: 'Nigerian Pidgin',  code: 'pcm' },
];

async function seed() {
  logger.info('🚀 Starting Development Database Seeding...');

  try {
    // 1. Seed Languages
    logger.info('Seeding languages...');
    const seededLangs: Record<string, string> = {};
    for (const lang of LANGUAGES) {
      const [inserted] = await db.insert(languages)
        .values(lang)
        .onConflictDoNothing()
        .returning();
      
      if (inserted) {
        seededLangs[lang.code] = inserted.id;
      } else {
        const [existing] = await db.select().from(languages).where(require('drizzle-orm').eq(languages.code, lang.code)).limit(1);
        seededLangs[lang.code] = existing.id;
      }
    }
    logger.info(`✅ Seeded ${Object.keys(seededLangs).length} languages.`);

    // 2. Create Users
    logger.info('Seeding users...');
    const passwordHash = await bcrypt.hash('password123', 12);
    
    // Org Owner
    const [owner] = await db.insert(users).values({
      firstName: 'Isaac',
      lastName: 'Sulaimon',
      email: 'owner@voicer.ai',
      passwordHash,
      emailVerified: true,
      country: 'Nigeria',
      gender: 'MALE',
      ageRange: '25-34',
    }).returning();

    // Project Admin
    const [admin] = await db.insert(users).values({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'admin@voicer.ai',
      passwordHash,
      emailVerified: true,
      country: 'Kenya',
      gender: 'FEMALE',
      ageRange: '18-24',
    }).returning();

    // Contributor
    const [contributor] = await db.insert(users).values({
      firstName: 'David',
      lastName: 'Okonkwo',
      email: 'contributor@voicer.ai',
      passwordHash,
      emailVerified: true,
      country: 'Nigeria',
      gender: 'MALE',
      ageRange: '18-24',
    }).returning();

    // Reviewer
    const [reviewer] = await db.insert(users).values({
      firstName: 'Amina',
      lastName: 'Yusuf',
      email: 'reviewer@voicer.ai',
      passwordHash,
      emailVerified: true,
      country: 'Nigeria',
      gender: 'FEMALE',
      ageRange: '35-44',
    }).returning();

    logger.info('✅ Seeded users: owner@voicer.ai, admin@voicer.ai, contributor@voicer.ai, reviewer@voicer.ai');

    // 3. User Language Proficiencies
    logger.info('Seeding contributor and reviewer language proficiencies...');
    // Contributor speaks English and Yoruba
    await db.insert(userLanguages).values([
      { userId: contributor.id, languageId: seededLangs['en'], proficiencyLevel: 'NATIVE' },
      { userId: contributor.id, languageId: seededLangs['yo'], proficiencyLevel: 'ADVANCED' },
    ]).onConflictDoNothing();

    // Reviewer reviews English and Yoruba
    await db.insert(userLanguages).values([
      { userId: reviewer.id, languageId: seededLangs['en'], proficiencyLevel: 'NATIVE' },
      { userId: reviewer.id, languageId: seededLangs['yo'], proficiencyLevel: 'NATIVE' },
    ]).onConflictDoNothing();

    // 4. Create Organization
    logger.info('Seeding organization...');
    const [org] = await db.insert(organizations).values({
      name: 'Nithub Lagos',
      description: 'Innovation hub for African language speech AI',
      country: 'Nigeria',
      organizationType: 'Research Institution',
      ownerId: owner.id,
    }).returning();

    await db.insert(organizationMembers).values([
      { organizationId: org.id, userId: owner.id, role: 'OWNER' },
      { organizationId: org.id, userId: admin.id, role: 'ADMIN' },
    ]).onConflictDoNothing();

    // 5. Create Project
    logger.info('Seeding project...');
    const [project] = await db.insert(projects).values({
      organizationId: org.id,
      name: 'Yoruba & English Speech Corpus',
      description: 'Collecting native recordings for low-resource speech engines',
      status: 'ACTIVE',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      createdBy: owner.id,
    }).returning();

    await db.insert(projectLanguages).values([
      { projectId: project.id, languageId: seededLangs['en'] },
      { projectId: project.id, languageId: seededLangs['yo'] },
    ]).onConflictDoNothing();

    // Add members to the project
    await db.insert(projectMembers).values([
      { projectId: project.id, userId: admin.id, role: 'PROJECT_ADMIN', invitedBy: owner.id },
      { projectId: project.id, userId: contributor.id, role: 'CONTRIBUTOR', invitedBy: admin.id },
      { projectId: project.id, userId: reviewer.id, role: 'REVIEWER', invitedBy: admin.id },
    ]).onConflictDoNothing();

    // 6. Create Tasks
    logger.info('Seeding tasks...');
    const [englishTask] = await db.insert(tasks).values({
      projectId: project.id,
      title: 'Read English Market Dialogue',
      description: 'Read the dialogue script representing a marketplace negotiation.',
      instructions: 'Speak clearly and naturally. Do not rush.',
      languageId: seededLangs['en'],
      taskType: 'READ_PROMPT',
      targetDuration: 30,
      status: 'ACTIVE',
      createdBy: admin.id,
    }).returning();

    const [yorubaTask] = await db.insert(tasks).values({
      projectId: project.id,
      title: 'Yoruba Folk Storytelling',
      description: 'Narrate a short traditional Yoruba folk story in your local dialect.',
      instructions: 'Ensure pronunciation is expressive and standard Yoruba.',
      languageId: seededLangs['yo'],
      taskType: 'SPONTANEOUS_SPEECH',
      targetDuration: 60,
      status: 'ACTIVE',
      createdBy: admin.id,
    }).returning();

    // 7. Create Submissions
    logger.info('Seeding contributor submissions...');
    const [submission] = await db.insert(submissions).values({
      taskId: englishTask.id,
      contributorId: contributor.id,
      audioUrl: 'https://voicer-audio.supabase.co/storage/v1/object/sign/voicer-audio/recordings/english_market_scene_1.webm',
      storagePath: 'recordings/english_market_scene_1.webm',
      fileSize: 409600,
      audioDuration: 28,
      languageId: seededLangs['en'],
      status: 'APPROVED',
    }).returning();

    // 8. Create Review
    logger.info('Seeding reviewer approvals...');
    await db.insert(reviews).values({
      submissionId: submission.id,
      reviewerId: reviewer.id,
      rating: 'EXCELLENT',
      feedback: 'Excellent vocal clarity, standard dialect, no clipping.',
      reviewStatus: 'APPROVED',
    });

    // 9. Seeding Audit Logs
    logger.info('Seeding audit logs...');
    await db.insert(auditLogs).values([
      { userId: owner.id, eventType: 'ORG_CREATED', entityId: org.id },
      { userId: owner.id, eventType: 'PROJECT_CREATED', entityId: project.id },
      { userId: admin.id, eventType: 'TASK_CREATED', entityId: englishTask.id },
      { userId: admin.id, eventType: 'TASK_CREATED', entityId: yorubaTask.id },
      { userId: contributor.id, eventType: 'SUBMISSION_CREATED', entityId: submission.id },
      { userId: reviewer.id, eventType: 'REVIEW_COMPLETED', entityId: submission.id },
    ]);

    logger.info('🎉 Seeding successfully completed!');
  } catch (error) {
    logger.error('❌ Seeding failed with error:', error);
  } finally {
    process.exit(0);
  }
}

seed();
