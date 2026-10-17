import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let db!: typeof import('./db');

beforeEach(async () => {
  vi.resetModules();
  db = await import('./db');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDatabaseType', () => {
  test('returns file for a SQLite URL', () => {
    expect(db.getDatabaseType('file:./umami.db')).toBe('file');
  });

  test('returns the raw scheme for other databases', () => {
    expect(db.getDatabaseType('mysql://user:pass@localhost:3306/umami')).toBe('mysql');
  });

  test('reads process.env.DATABASE_URL by default', () => {
    vi.stubEnv('DATABASE_URL', 'file:./umami.db');
    expect(db.getDatabaseType()).toBe('file');
  });

  test('falls back to the DATABASE_URL default when called with undefined', () => {
    vi.stubEnv('DATABASE_URL', 'file:./umami.db');
    expect(db.getDatabaseType(undefined)).toBe('file');
  });
});

describe('isRelationalOnly', () => {
  test('returns true for a SQLite database', () => {
    vi.stubEnv('DATABASE_URL', 'file:./umami.db');

    expect(db.isRelationalOnly()).toBe(true);
  });

  test('returns false for unsupported non-relational databases', () => {
    vi.stubEnv('DATABASE_URL', 'mysql://user:pass@localhost:3306/umami');

    expect(db.isRelationalOnly()).toBe(false);
  });
});
