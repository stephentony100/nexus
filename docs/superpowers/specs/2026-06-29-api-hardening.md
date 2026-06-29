# API Hardening — Design Spec

**Date:** 2026-06-29
**Scope:** `api/` package only — no changes to actionflow, agentrunner, or policyloop

---

## Goal

Tighten the `api/` surface before Phase 8 introduces real operator/user traffic:
stable error envelopes, structured request logging, unauthenticated liveness, version
from package metadata.

---

## What is NOT in scope

- Changes to agentrunner, policyloop, actionflow, or daemon bin
- Rate limiting, JWT/OAuth, TLS
- Metrics or distributed tracing (future observability layer)
- Changing the authentication model

---

## Task 1 — Custom error handler

### What to add

Register a `setErrorHandler` on the **root** fastify instance inside `buildServer`, before
any route or scope registration:

```ts
fastify.setErrorHandler(async (_err, _request, reply) => {
  console.error(_err)   // full Error to stderr; captured by process manager in prod
  return reply.status(500).send({ error: 'internal_error' })
})
```

This replaces Fastify's default serializer (which leaks `_err.message` in the response)
with a stable JSON envelope. `console.error` is used because `logger: false` is the
default in `buildServer` (see Task 2 for logger configurability).

### Test change

Existing Test 8 checks `statusCode === 500` when `runPolicyCycle` throws. Strengthen it
to also assert the response body equals `{ error: 'internal_error' }`.

---

## Task 2 — Structured request logging

### Design

Make `logger` configurable in `buildServer` so tests keep `logger: false` (no noise)
and the bin can pass a real pino config. Add a `logger` parameter to `buildServer`'s
own options (distinct from `ServerDeps` which carries execution dependencies):

```ts
export interface BuildServerOptions {
  deps: ServerDeps
  logger?: FastifyServerOptions['logger']  // defaults to false
}

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const { deps, logger = false } = opts
  const fastify = Fastify({ logger })
  // ...
}
```

Callers that currently pass `buildServer(deps)` must change to
`buildServer({ deps })`.

> **Alternative considered:** keep `buildServer(deps)` and add a second optional arg.
> Rejected — object options are more extensible and consistent with the rest of the codebase.

### Logging behaviour

When `logger` is truthy, Fastify's built-in pino logger emits one JSON line per
request automatically (requestId, method, url, statusCode, responseTime). No
`onRequest`/`onResponse` hook is needed.

`request.id` is available on every request (Fastify assigns it regardless of logger
setting); it appears in pino's auto-logged lines when pino is enabled.

### Changes required

- `api/src/server.ts` — rename `buildServer(deps)` to `buildServer(opts)`, accept `logger`
- `api/src/server.test.ts` — all 8 calls change from `buildServer({ config, signer, uploader })` to
  `buildServer({ deps: { config, signer, uploader } })`
- `api/bin/server.ts` — pass `logger: true` (JSON pino output, no pretty-print for prod)

### No new tests

Logging is not unit-tested — log output is not part of the function contract. The bin
integration is tested implicitly by the existing tests once the call site is updated.

---

## Task 3 — `/live` endpoint (unauthenticated)

### Design

`/live` must bypass the auth hook. Fastify scopes (registered via `fastify.register()`)
do NOT inherit hooks added to the parent AFTER the child is registered — but they DO
inherit hooks added BEFORE. The cleanest solution is to reorganise `buildServer` into
two scopes:

```
fastify (root) ─── setErrorHandler (Task 1)
├── /live scope (no auth hook)
│     └── GET /live
└── protected scope (auth hook added inside)
      ├── GET /health
      ├── GET /version
      └── POST /policies/:id/run-cycle
```

Implementation:

```ts
// Public scope — no auth
fastify.register(async (pub) => {
  pub.get('/live', async () => ({ status: 'ok' as const }))
})

// Protected scope — auth hook registered inside
fastify.register(async (prot) => {
  const secretBytes = Buffer.from(config.secretKey)
  prot.addHook('onRequest', async (request, reply) => {
    const raw = request.headers['x-api-key']
    const provided = typeof raw === 'string' ? Buffer.from(raw) : Buffer.alloc(0)
    const valid = provided.length === secretBytes.length && timingSafeEqual(provided, secretBytes)
    if (!valid) return reply.status(401).send({ error: 'unauthorized' })
  })
  prot.get('/health', async () => ({ status: 'ok' as const }))
  prot.get('/version', async () => ({ version: pkg.version }))
  prot.post<{ Params: { id: string } }>('/policies/:id/run-cycle', ...)
})
```

### Test additions

Add two new tests (total goes from 8 → 10):
- `GET /live` with no `X-Api-Key` → 200, `{ status: 'ok' }`
- `GET /live` with wrong `X-Api-Key` → 200 (auth not checked)

---

## Task 4 — Version from `package.json`

### Design

Add `"resolveJsonModule": true` to `api/tsconfig.json`, then import version:

```ts
import pkg from '../package.json' with { type: 'json' }
```

Use in `/version` route: `{ version: pkg.version }`.

TypeScript 5.3+ (and TypeScript 6 which is installed) supports `with { type: 'json' }`
(import attributes). `resolveJsonModule: true` is required for the import to type-check.

The import path from `api/src/server.ts` to `api/package.json` is `'../package.json'`
(one level up from `src/`).

### No test change

The `/version` test already asserts `{ version: '0.1.0' }`. Since the current
`package.json` version IS `0.1.0`, the test continues to pass without modification.
The benefit is that a future `npm version patch` automatically updates the route response.

---

## Environment variables — no changes

Same required/optional set as Phase 7. No new env vars.

---

## File change summary

| File | Change |
|---|---|
| `api/src/server.ts` | error handler, logger param, /live scope, version from pkg |
| `api/src/server.test.ts` | strengthen test 8 body; update buildServer call sites; add 2 /live tests |
| `api/bin/server.ts` | pass `logger: true` to buildServer |
| `api/tsconfig.json` | add `"resolveJsonModule": true` |

No other files change.

---

## Verification

After all 4 tasks:
- `npx vitest run` from `api/` → 10 tests pass
- `npx tsc --noEmit` from `api/` → clean
- `npx vitest run` from policyloop, agentrunner, actionflow → 63/18/43 unchanged
- `npx tsc --noEmit` from policyloop, agentrunner, actionflow → clean
