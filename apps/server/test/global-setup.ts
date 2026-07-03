import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const TEST_URL = 'postgres://app:app@localhost:5433/app_test';

export default async function setup() {
  const admin = postgres('postgres://app:app@localhost:5433/app', { max: 1 });
  const exists = await admin`select 1 from pg_database where datname = 'app_test'`;
  if (exists.length === 0) await admin.unsafe('create database app_test');
  await admin.end();

  const sql = postgres(TEST_URL, { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
}
