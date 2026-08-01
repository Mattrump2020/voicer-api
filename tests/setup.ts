import { db } from '../src/db';
import { sql } from 'drizzle-orm';

// Global setup run before every test file
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
});

// A helper to clean tables after tests
export async function cleanDatabase() {
  const tables = [
    'audit_logs',
    'dataset_exports',
    'notifications',
    'reviews',
    'submissions',
    'tasks',
    'project_members',
    'project_languages',
    'invitations',
    'projects',
    'organization_members',
    'organizations',
    'user_languages',
    'users',
    'languages'
  ];

  for (const table of tables) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`));
    } catch (err) {
      // Ignore errors for tables that might not exist or be truncated
    }
  }
}
