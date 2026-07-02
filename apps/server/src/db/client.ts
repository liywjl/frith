import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/app';

export const sql = postgres(url);
export const db = drizzle(sql, { schema });
