import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { UmamiClient, type UmamiClientOptions } from '@umami/api-client';
import { type McpLogger, stderrLogger } from './lib/logger';
import { createUmamiMcpServer } from './server';

export interface StdioEnvironment {
  UMAMI_URL?: string;
  UMAMI_API_URL?: string;
  UMAMI_API_TOKEN?: string;
  [key: string]: string | undefined;
}

function trimSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

/**
 * Resolves client options from environment variables:
 *
 * - `UMAMI_API_URL` — full API base URL (e.g. `https://example.com/api`).
 * - `UMAMI_URL` — self-hosted instance URL; `/api` is appended automatically.
 * - `UMAMI_API_TOKEN` — bearer token (login token or self-hosted API key).
 */
export function resolveClientOptions(env: StdioEnvironment = process.env): UmamiClientOptions {
  const apiUrl = env.UMAMI_API_URL?.trim();
  const instanceUrl = env.UMAMI_URL?.trim();
  const token = env.UMAMI_API_TOKEN?.trim();
  if (!token) {
    throw new Error('Missing credentials. Set UMAMI_API_TOKEN to an API key or login token.');
  }

  let baseUrl: string;

  if (apiUrl) {
    baseUrl = trimSlashes(apiUrl);
  } else if (instanceUrl) {
    const trimmed = trimSlashes(instanceUrl);
    baseUrl = /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
  } else {
    throw new Error('Missing server URL. Set UMAMI_URL or UMAMI_API_URL.');
  }

  return { baseUrl, token };
}

export interface ServeStdioOptions {
  env?: StdioEnvironment;
  logger?: McpLogger;
}

/** Serves the Umami MCP server over stdio for local agents (Claude Desktop, Cursor, …). */
export function serveUmamiStdio(options: ServeStdioOptions = {}) {
  const client = new UmamiClient(resolveClientOptions(options.env));
  const logger = options.logger ?? stderrLogger;

  return serveStdio(() => createUmamiMcpServer({ client, logger }));
}
