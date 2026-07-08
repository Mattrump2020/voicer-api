import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in your .env file');
}

// postgres.js connection — used by Drizzle
// max: 10 keeps connection pool reasonable for a hobby/startup Supabase plan
const client = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// db is the object you import in every route file
// passing { schema } enables relational queries with .query.tableName.findMany()
export const db = drizzle(client, { schema });

// Export the schema separately so routes can import table definitions
export * from './schema';
