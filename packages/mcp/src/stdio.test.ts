import { describe, expect, test } from 'vitest';
import { resolveClientOptions } from './stdio';

describe('resolveClientOptions', () => {
  test('appends /api to a self-hosted instance URL', () => {
    expect(
      resolveClientOptions({ UMAMI_URL: 'https://analytics.example.com/', UMAMI_API_TOKEN: 't' }),
    ).toEqual({ baseUrl: 'https://analytics.example.com/api', token: 't' });
  });

  test('uses UMAMI_API_URL verbatim', () => {
    expect(
      resolveClientOptions({
        UMAMI_API_URL: 'https://analytics.example.com/api',
        UMAMI_API_TOKEN: 't',
      }),
    ).toEqual({ baseUrl: 'https://analytics.example.com/api', token: 't' });
  });

  test('requires a server URL', () => {
    expect(() => resolveClientOptions({ UMAMI_API_TOKEN: 't' })).toThrow(/UMAMI_URL/);
  });

  test('requires credentials', () => {
    expect(() => resolveClientOptions({})).toThrow(/UMAMI_API_TOKEN/);
  });
});
