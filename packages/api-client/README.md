# @umami/api-client

Typed TypeScript client for the [Umami](https://umami.is) API. Every method is generated from
Umami's OpenAPI contract (`public/openapi.json` in the main repository), so the client can never
drift from the server.

```bash
pnpm add @umami/api-client
```

## Usage

```ts
import { UmamiClient } from '@umami/api-client';

const umami = new UmamiClient({
  baseUrl: 'https://analytics.example.com/api',
  token: process.env.UMAMI_API_TOKEN, // API key (umami_…) or login token
});

const websites = await umami.listWebsites();

const stats = await umami.getWebsiteStats({
  websiteId,
  startAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  endAt: Date.now(),
});

const pages = await umami.getWebsiteMetrics({ websiteId, startAt, endAt, type: 'path', limit: 10 });
```

Every method takes **one object** that merges path parameters, query parameters and the request
body. Method names are the OpenAPI `operationId`s; hover in your editor for the parameter and
response types, or import `OperationInput<'getWebsiteStats'>` / `OperationOutput<'…'>`.

### Options

| Option    | Description                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `baseUrl` | Required API root, for example `https://your-umami/api`.                    |
| `token`   | Bearer token: login token or self-hosted API key.                                      |
| `headers` | Extra headers for every request.                                                                            |
| `fetch`   | Custom `fetch` (tests, other runtimes, in-process dispatch).                                                |
| `timeout` | Per-request timeout in milliseconds.                                                                        |

### Errors

Non-2xx responses throw `UmamiApiError` with `status`, `code` (`unauthorized`, `forbidden`,
`not-found`, `bad-request`, …), `message` and the parsed `body`.

```ts
import { isUmamiApiError } from '@umami/api-client';

try {
  await umami.getWebsite({ websiteId });
} catch (error) {
  if (isUmamiApiError(error) && error.isNotFound) {
    // …
  }
}
```

### Escape hatch

`umami.call('operationId', input)` invokes any operation by ID; `operations` exports the full
table of methods, paths and parameters.

## Regenerating

From the Umami repository root:

```bash
pnpm generate:api      # public/openapi.json → packages/api-client/src/generated
pnpm check:api:client  # CI: fail if generated files are stale
```

See [MIGRATION.md](./MIGRATION.md) if you are upgrading from the previous hand-written client.
