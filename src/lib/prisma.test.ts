import { beforeAll, describe, expect, test, vi } from 'vitest';

process.env.DATABASE_URL ??= 'file:./umami-test.db';
delete process.env.DATABASE_REPLICA_URL;

vi.mock('@prisma/adapter-better-sqlite3', () => ({
  PrismaBetterSqlite3: class PrismaBetterSqlite3 {},
}));

vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: class PrismaClient {
    $executeRawUnsafe = vi.fn();
    $queryRawUnsafe = vi.fn();
    $transaction = vi.fn();
    $on = vi.fn();
    $extends() {
      return this;
    }
  },
}));

let prisma!: typeof import('./prisma').default;

beforeAll(async () => {
  ({ default: prisma } = await import('./prisma'));
});

describe('getDateSQL timezone formatting', () => {
  test('formats UTC buckets as ISO timestamps', () => {
    expect(prisma.getDateSQL('website_event.created_at', 'hour')).toBe(
      `strftime('%Y-%m-%dT%H:00:00Z', website_event.created_at)`,
    );
    expect(prisma.getDateSQL('website_event.created_at', 'hour', 'UTC')).toBe(
      `strftime('%Y-%m-%dT%H:00:00Z', website_event.created_at)`,
    );
  });

  test('converts named timezones before bucketing', () => {
    expect(prisma.getDateSQL('website_event.created_at', 'hour', 'Asia/Tehran')).toBe(
      `strftime('%Y-%m-%dT%H:00:00Z', timezone_datetime(website_event.created_at, 'Asia/Tehran'))`,
    );
  });
});

test('serializes bigint query values as numbers', () => {
  expect(JSON.stringify({ count: BigInt(42) })).toBe('{"count":42}');
});

describe('getDateStringSQL timezone formatting', () => {
  test('formats UTC second-precision values', () => {
    expect(prisma.getDateStringSQL('event_data.date_value', 'second')).toBe(
      `strftime('%Y-%m-%dT%H:%M:%SZ', event_data.date_value)`,
    );
  });

  test('defaults to explicit UTC formatting regardless of unit when no timezone is given', () => {
    expect(prisma.getDateStringSQL('event_data.date_value')).toBe(
      `strftime('%Y-%m-%dT%H:%M:%SZ', event_data.date_value)`,
    );
  });
});

describe('getDateWeeklySQL timezone formatting', () => {
  test('formats weekly UTC buckets', () => {
    expect(prisma.getDateWeeklySQL('website_event.created_at')).toBe(
      `strftime('%w:%H', website_event.created_at)`,
    );
  });

  test('converts named timezones', () => {
    expect(prisma.getDateWeeklySQL('website_event.created_at', 'Asia/Tehran')).toBe(
      `strftime('%w:%H', timezone_datetime(website_event.created_at, 'Asia/Tehran'))`,
    );
  });
});

describe('pagedRawQuery default ordering', () => {
  function mockQueries(count = '4') {
    const queryRaw = vi.mocked((prisma.client as any).$queryRawUnsafe);
    queryRaw.mockClear();
    queryRaw.mockImplementation(async (sql: string) =>
      sql.includes('count(*) as num') ? [{ num: count }] : [{ id: 1 }],
    );
    return queryRaw;
  }

  test.each([undefined, 5])(
    'applies trusted default order only to the page query with cap %s',
    async maxResults => {
      const queryRaw = mockQueries('5');
      const result = await prisma.pagedRawQuery(
        'select * from thing',
        {},
        { page: 2, pageSize: 2, maxResults },
        'test',
        'max(created_at) desc, session_id',
      );

      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(queryRaw.mock.calls[0][0]).not.toContain('order by max(created_at) desc');
      expect(queryRaw.mock.calls[1][0]).toContain('order by max(created_at) desc, session_id');
      expect(queryRaw.mock.calls[1][0]).toContain('limit 2 offset 2');
      expect(result).toEqual({
        data: [{ id: 1 }],
        count: 5,
        page: 2,
        pageSize: 2,
        isCapped: !!maxResults,
        orderBy: undefined,
      });
    },
  );

  test('keeps explicit ordering and legacy no-order behavior', async () => {
    const queryRaw = mockQueries();
    const result = await prisma.pagedRawQuery(
      'select * from thing',
      {},
      { page: 1, pageSize: 2, orderBy: 'name', sortDescending: true },
      undefined,
      'max(created_at) desc, session_id',
    );
    expect(queryRaw.mock.calls[1][0]).toContain('order by name desc');
    expect(queryRaw.mock.calls[1][0]).not.toContain('order by max(created_at) desc, session_id');
    expect(result.orderBy).toBe('name');
    queryRaw.mockClear();
    await prisma.pagedRawQuery('select * from thing', {}, { page: 1, pageSize: 2 });
    expect(queryRaw.mock.calls[1][0]).not.toMatch(/order by/);
  });
});

test('translates ordered percentiles for SQLite', async () => {
  const queryRaw = vi.mocked((prisma.client as any).$queryRawUnsafe);
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);

  await prisma.rawQuery('select percentile_cont(0.75) within group (order by duration) as p75', {});

  expect(queryRaw.mock.calls[0][0]).toBe('select percentile_cont(duration, 0.75) as p75');
});
