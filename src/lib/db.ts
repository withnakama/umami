export const SQLITE = 'file';

export function getDatabaseType(url = process.env.DATABASE_URL) {
  return url?.split(':')[0];
}

export function isRelationalOnly() {
  return getDatabaseType() === SQLITE;
}
