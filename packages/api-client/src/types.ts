export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface UmamiClientOptions {
  /**
   * Instance URL plus `/api`, e.g. `https://analytics.example.com/api`.
   */
  baseUrl: string;
  /**
   * Bearer token: a login token from `POST /api/auth/login`, or a
   * self-hosted API key (`umami_…`).
   */
  token?: string;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Custom fetch implementation (testing, alternative runtimes, in-process dispatch). */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Disabled by default. */
  timeout?: number;
}

export interface RequestOptions {
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** Abort signal for this request. */
  signal?: AbortSignal;
}
