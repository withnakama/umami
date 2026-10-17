export interface AllowlistEntry {
  /** Operation key, e.g. "POST /api/auth/sso" */
  key: string;
  /** Why this operation cannot be exercised by the harness. */
  reason: string;
}

/**
 * Operations that are intentionally not covered. Keep this list short and every
 * entry justified — the reporter warns when an allowlisted operation is
 * actually called, so entries can be removed once they gain a test.
 */
export const allowlist: AllowlistEntry[] = [
  {
    key: 'POST /api/auth/sso',
    reason:
      'Cloud single sign-on handoff. Requires REDIS_URL (returns 500 "Redis is disabled" otherwise); Redis is out of scope for the harness.',
  },
  {
    key: 'GET /api/auth/subscription',
    reason: 'Cloud billing/subscription lookup; only meaningful under CLOUD_MODE.',
  },
];
