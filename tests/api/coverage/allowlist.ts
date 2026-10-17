export interface AllowlistEntry {
  /** Operation key, e.g. "GET /api/config" */
  key: string;
  /** Why this operation cannot be exercised by the harness. */
  reason: string;
}

/**
 * Operations that are intentionally not covered. Keep this list short and every
 * entry justified — the reporter warns when an allowlisted operation is
 * actually called, so entries can be removed once they gain a test.
 */
export const allowlist: AllowlistEntry[] = [];
