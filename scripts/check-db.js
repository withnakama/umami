/* eslint-disable no-console */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import chalk from 'chalk';
import { PrismaClient } from '../generated/prisma/client.js';

if (process.env.SKIP_DB_CHECK) {
  console.log('Skipping database check.');
  process.exit(0);
}

function success(msg) {
  console.log(chalk.greenBright(`✓ ${msg}`));
}

function error(msg) {
  console.log(chalk.redBright(`✗ ${msg}`));
}

async function checkEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined.');
  } else if (!process.env.DATABASE_URL.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a SQLite file: URL.');
  } else {
    success('DATABASE_URL is defined.');
  }

  if (process.env.REDIS_URL) {
    success('REDIS_URL is defined.');
  }

  if (!process.env.APP_SECRET) {
    throw new Error('APP_SECRET is not defined.');
  }
}

async function checkConnection() {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL }),
  });
  try {
    await prisma.$connect();

    success('Database connection successful.');
  } catch (e) {
    throw new Error(`Unable to connect to the database: ${e.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function applyMigration() {
  if (!process.env.SKIP_DB_MIGRATION) {
    const directUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    console.log(
      execSync('prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: directUrl },
      }).toString(),
    );

    success('Database is up to date.');
  }
}

(async () => {
  let err = false;
  for (const fn of [checkEnv, checkConnection, applyMigration]) {
    try {
      await fn();
    } catch (e) {
      error(e.message);
      err = true;
    } finally {
      if (err) {
        process.exit(1);
      }
    }
  }
})();
