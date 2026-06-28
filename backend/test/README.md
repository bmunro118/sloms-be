# SLOMS e2e / integration test framework

End-to-end tests that drive the **real HTTP pipeline** (routing, JWT + roles
guards, the global `ValidationPipe`, serialization) against a **live Postgres**.
They exist because the mock-based unit specs structurally cannot catch the bugs
that actually shipped — `forbidNonWhitelisted` 400s, date-only 500s, the
`Counter` column-casing serial bug. See [orders.e2e-spec.ts](orders.e2e-spec.ts).

> For **manual** 2FA testing from the Swagger UI (TOTP enrollment, email OTP,
> new-device challenge, recovery codes), see
> [docs/testing-2fa-via-swagger.md](../docs/testing-2fa-via-swagger.md).

## Running

```bash
docker compose up -d postgres        # dev DB must be up …
# … migrated + seeded, with DATABASE_URL set (loaded from .env)

npm run test:e2e                      # run the suite (reports coverage gaps)
npm run test:e2e:cov                  # same, but FAILS if any endpoint is uncovered
npm run test:e2e -- customers         # one file while developing
```

Specs run in a **single worker** (`maxWorkers: 1` in `jest-e2e.json`) — required
both for data isolation against the shared DB and for the coverage guard to
aggregate hits across files.

## Layout

| Path | Purpose |
|------|---------|
| `support/app.ts` | `createTestApp()` — boots Nest with the **exact** `main.ts` globals (prefix, ValidationPipe, cookie-parser). Single source of pipeline truth. |
| `support/auth.ts` | `login()` / `loginAllRoles()` — seed credentials per `Role`; tokens cached per spec. |
| `support/http.ts` | `api(app)` — supertest wrapper that records every route for the coverage guard; `authHeader(token)`. |
| `support/factories.ts` | Tagged test data (`__E2E__` marker, reserved order-number namespace ≥ 990000) + `cleanupE2E()`. |
| `support/openapi.ts` | Builds the OpenAPI doc from the app and flattens it to the operation list — the "every endpoint + parameter" source of truth. |
| `support/coverage.ts` | Cross-spec hit recorder (temp file). |
| `*.e2e-spec.ts` | One spec per controller. |
| `zz-coverage.e2e-spec.ts` | Runs last; diffs exercised routes against the OpenAPI doc. |

## The per-controller matrix

[`customers.e2e-spec.ts`](customers.e2e-spec.ts) is the reference template. For
every endpoint, assert across these axes:

| Axis | Assertion |
|------|-----------|
| **auth** | no token → **401** |
| **authz** | a role lacking the `@Roles` → **403**; an allowed role → **2xx** |
| **happy** | valid request → 2xx + body shape |
| **validation** | each DTO field bad / unknown prop → **400** (`forbidNonWhitelisted`); bad `ParseIntPipe` param → **400** |
| **not-found** | bad path param → **404** |
| **effects** | a follow-up GET confirms the write |

Use `it.each` over a table of `{ field, value, expect }` rows to keep
per-parameter validation coverage compact and visible.

## Coverage guard

`zz-coverage.e2e-spec.ts` builds the OpenAPI document and checks every
operation was hit at least once by the suite. By default it only **prints** the
gap (so a single-file run doesn't fail spuriously); `COVERAGE_GUARD=1`
(`test:e2e:cov`, and CI) turns an uncovered endpoint into a **hard failure**.
Add a route → the guard fails until a test exercises it.

## Data isolation

Currently runs against the **shared dev DB** with tagged, self-cleaning
fixtures. The DB target is just `DATABASE_URL`, so a hermetic CI variant is a
drop-in: point it at a throwaway DB and `prisma migrate reset --force` +
`psql -f prisma/seed.sql` before the run. Seed bcrypt hashes **must** match the
documented passwords in `prisma/seed.sql` (`support/auth.ts` relies on them).

## Coverage status

**All controllers covered — every documented operation, 172 tests.** Specs:
`auth`, `2fa`, `customers` (full template), `customer-onboarding`, `orders`,
`price-list`, `settings`, `stats`, `users`, `vat-rates`, plus `zz-coverage`. Run
`npm run test:e2e:cov` to enforce; any new endpoint will fail the guard until a
spec exercises it.

The suite found and drove fixes for three real route/validation bugs:
`GET /users/audit-log` filters rejected by `forbidNonWhitelisted` (fixed via
`FindAuditLogQueryDto`), and two route-ordering shadows where `GET /orders/items/:serial`
and `GET /settings/user` were swallowed by earlier `:param` routes (handlers
reordered).
