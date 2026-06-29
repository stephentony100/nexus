# API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the `api/` package before Phase 8: stable error envelopes, structured request logging, unauthenticated liveness, version from package metadata.

**Spec:** `docs/superpowers/specs/2026-06-29-api-hardening.md`

**Tech Stack:** TypeScript ESM, Fastify 5, vitest, Node.js — api/ package only.

## Global Constraints

- Changes are limited to: `api/src/server.ts`, `api/src/server.test.ts`, `api/bin/server.ts`, `api/tsconfig.json`
- No changes to actionflow, agentrunner, or policyloop
- All local TypeScript imports use `.js` extension (ESM)
- TypeScript strict mode — `npx tsc --noEmit` must pass in `api/` after each task
- vitest — run tests with `npx vitest run` from inside `api/`
- Fastify logger defaults to `false` in `buildServer` to keep test output quiet
- `runPolicyCycle` remains mocked in tests — no real Sui network calls
- Auth hook applies to `/health`, `/version`, and `POST /policies/:id/run-cycle`
- `/live` must NOT require `X-Api-Key`
- All 8 existing tests must continue to pass; tests added in Tasks 1 and 3 bring the total to 10

---

### Task 1: Custom error handler

**Files to change:**
- `api/src/server.ts`
- `api/src/server.test.ts`

**What to do:**

- [ ] **`api/src/server.ts`** — register `setErrorHandler` on the root fastify instance,
  immediately after `const fastify = Fastify({ logger: false })` and before any route or
  scope. The handler must:
  1. Call `console.error(_err)` to preserve the full Error on stderr
  2. Return `reply.status(500).send({ error: 'internal_error' })`

  ```ts
  fastify.setErrorHandler(async (err, _request, reply) => {
    console.error(err)
    return reply.status(500).send({ error: 'internal_error' })
  })
  ```

- [ ] **`api/src/server.test.ts`** — existing test 8 checks `statusCode === 500`.
  Strengthen it to also assert the response body equals `{ error: 'internal_error' }`.
  No new tests.

**Verification:**
- `npx vitest run` from `api/` — still 8 tests, all pass
- `npx tsc --noEmit` from `api/` — clean

---

### Task 2: Structured request logging

**Files to change:**
- `api/src/server.ts`
- `api/src/server.test.ts`
- `api/bin/server.ts`

**What to do:**

- [ ] **`api/src/server.ts`** — change `buildServer(deps: ServerDeps)` to accept an
  options object:

  ```ts
  export interface BuildServerOptions {
    deps: ServerDeps
    logger?: FastifyServerOptions['logger']
  }

  export function buildServer({ deps, logger = false }: BuildServerOptions): FastifyInstance {
    const { config, signer, uploader, scallop, ai } = deps
    const fastify = Fastify({ logger })
    // ... rest unchanged
  }
  ```

  Import `FastifyServerOptions` from `'fastify'`.

- [ ] **`api/src/server.test.ts`** — update all `buildServer({...})` call sites to use
  `buildServer({ deps: { config, signer, uploader } })`. No new tests.

- [ ] **`api/bin/server.ts`** — change `buildServer({ config, signer, uploader, scallop, ai })`
  to `buildServer({ deps: { config, signer, uploader, scallop, ai }, logger: true })`.

**Verification:**
- `npx vitest run` from `api/` — still 8 tests, all pass
- `npx tsc --noEmit` from `api/` — clean
- `npx tsc --noEmit` from `api/` must also type-check `bin/server.ts`

---

### Task 3: `/live` endpoint (unauthenticated)

**Files to change:**
- `api/src/server.ts`
- `api/src/server.test.ts`

**What to do:**

- [ ] **`api/src/server.ts`** — restructure so the auth hook lives in a registered
  **protected scope** rather than on the root instance. The `/live` route goes in a
  separate **public scope** with no hook.

  The final structure must be:
  ```
  fastify (root)
    setErrorHandler(...)      ← Task 1
    register(pub scope)
      GET /live  →  { status: 'ok' }    ← NO auth required
    register(protected scope)
      addHook('onRequest', authHook)    ← timingSafeEqual check from Phase 7
      GET /health  →  { status: 'ok' }
      GET /version  →  { version: '0.1.0' }   (hardcoded still — Task 4 changes this)
      POST /policies/:id/run-cycle  →  ...
  ```

  Move `secretBytes` and the `addHook` call inside the protected scope.

- [ ] **`api/src/server.test.ts`** — add 2 new tests (total: 10):
  1. `GET /live` with no `X-Api-Key` header → 200, body `{ status: 'ok' }`
  2. `GET /live` with wrong `X-Api-Key` value → 200, body `{ status: 'ok' }` (auth not checked)

**Verification:**
- `npx vitest run` from `api/` — 10 tests pass
- `npx tsc --noEmit` from `api/` — clean
- Confirm: `GET /health` without key still returns 401 (auth hook still covers it)

---

### Task 4: Version from `package.json`

**Files to change:**
- `api/tsconfig.json`
- `api/src/server.ts`

**What to do:**

- [ ] **`api/tsconfig.json`** — add `"resolveJsonModule": true` to `compilerOptions`:
  ```json
  {
    "compilerOptions": {
      "resolveJsonModule": true,
      ...
    }
  }
  ```

- [ ] **`api/src/server.ts`** — add import at top of file:
  ```ts
  import pkg from '../package.json' with { type: 'json' }
  ```
  Replace the hardcoded `'0.1.0'` in the `/version` handler with `pkg.version`.

**Verification:**
- `npx vitest run` from `api/` — still 10 tests pass (version is still `'0.1.0'` in package.json)
- `npx tsc --noEmit` from `api/` — clean

---

### Task 5: Final verification

**No file changes.** Read-only pass.

- [ ] `npx vitest run` from `api/` — 10 tests pass
- [ ] `npx vitest run` from `policyloop/` — 63 tests pass
- [ ] `npx vitest run` from `agentrunner/` — 18 tests pass
- [ ] `npx vitest run` from `actionflow/` — 43 tests pass
- [ ] `npx tsc --noEmit` from `api/` — clean
- [ ] `npx tsc --noEmit` from `policyloop/` — clean
- [ ] `npx tsc --noEmit` from `agentrunner/` — clean
- [ ] `npx tsc --noEmit` from `actionflow/` — clean

Report totals. If any test fails, report the failure — do not fix it.
