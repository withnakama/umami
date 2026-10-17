import { afterAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { SqliteAdapter } from './sqlite';

const prisma = new PrismaClient({ adapter: new SqliteAdapter({ url: ':memory:' }) });

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SQLite functions', () => {
  test('uses the event date for daylight saving time', async () => {
    const rows = await prisma.$queryRawUnsafe<{ winter: string; summer: string }[]>(
      `select timezone_datetime('2025-01-01T12:00:00Z', 'America/New_York') as winter,
              timezone_datetime('2025-07-01T12:00:00Z', 'America/New_York') as summer`,
    );

    expect(rows[0]).toEqual({ winter: '2025-01-01 07:00:00', summer: '2025-07-01 08:00:00' });
  });

  test('matches case insensitive regular expressions', async () => {
    const rows = await prisma.$queryRawUnsafe<{ match: number }[]>(
      `select 'Example.com' regexp '^example' as match`,
    );

    expect(rows[0].match).toBe(1);
  });

  test('chooses the lowest value when modal counts tie', async () => {
    const rows = await prisma.$queryRawUnsafe<{ value: number }[]>(
      `select mode(x) as value from (select 2 as x union all select 1 union all select 2 union all select 1)`,
    );

    expect(rows[0].value).toBe(1);
  });

  test('interpolates percentiles and ignores null values', async () => {
    const rows = await prisma.$queryRawUnsafe<{ median: number; p75: number }[]>(
      `select percentile_cont(x, 0.5) as median, percentile_cont(x, 0.75) as p75
       from (select 10 as x union all select 20 union all select 30 union all select null)`,
    );

    expect(rows[0]).toEqual({ median: 20, p75: 25 });
  });
});
