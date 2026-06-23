# SLOMS Backend — Agent Reference

This file provides agentic tools (Claude Code, etc.) with the context needed to work efficiently in this codebase without unnecessary exploration.

---

## Project Identity

**SLOMS** is a NestJS REST API for order management in a hearing-aid / healthcare context.  
Stack: **NestJS 10 + TypeScript 5 + Prisma 7 + PostgreSQL**

**Working directory:** `C:\Users\sammu\Development\sloms\backend`  
**API base prefix:** `/api`  
**Swagger docs:** `http://localhost:3000/api/docs`  
**Default port:** `3000`

---

## Directory Map

```
src/
  main.ts                  # Bootstrap, global pipes/prefix/swagger
  app.module.ts            # Root module — all feature modules imported here
  auth/                    # JWT login, Passport strategies, guards
  users/                   # User CRUD, audit log, password management
  customers/               # Customer accounts + nested addresses
  orders/                  # Orders + ordered items (sub-resource)
  vat-rates/               # VAT rate history and active rate lookup
  price-list/              # Product price lookup table
  settings/                # Global settings + per-user settings
  prisma/                  # PrismaService (singleton DB client)
  config/                  # database.config.ts (env-aware connection)
  common/                  # Shared paging helpers

prisma/
  schema.prisma            # Single source of truth for DB schema
  migrations/              # Plain SQL migration files
  seed.sql                 # Development seed data

Dockerfile                 # Multi-stage Node 20 Alpine build
docker-compose.yml         # Dev composition
entrypoint.sh              # Docker start: applies migrations then starts app
.env.dev                   # Dev environment template (PostgreSQL localhost)
.env.prod                  # Prod environment template (PostgreSQL)
Makefile                   # Build/run shortcuts
```

---

## Module Conventions

Every feature module follows the same structure:

```
src/<feature>/
  <feature>.module.ts       # @Module — declares controller, service, imports
  <feature>.controller.ts   # HTTP routes, guards, Swagger decorators
  <feature>.service.ts      # Business logic, Prisma queries
  <feature>.service.spec.ts # Jest unit tests
  dto/
    create-<feature>.dto.ts
    update-<feature>.dto.ts (or upsert-/close- where appropriate)
  entities/
    <feature>.entity.ts     # TypeScript interface for the response shape
```

When adding a new feature, create all files and register the module in `app.module.ts`.

---

## Database

### ORM: Prisma 7

- Schema: `prisma/schema.prisma`
- Client is accessed via `PrismaService` (`src/prisma/prisma.service.ts`)
- Inject with `constructor(private prisma: PrismaService)`
- After schema changes: `npm run prisma:generate`

### Tables

| Prisma Model    | Table               | PK                                    |
|-----------------|---------------------|---------------------------------------|
| `User`          | `Users`          | `userId` (autoincrement)              |
| `Customer`      | `Customers`      | `customerId` (autoincrement)          |
| `CustomerAddress` | `CustomerAddress` | `addressId` (autoincrement)        |
| `Order`         | `Order`          | `(orderNumber, orderBatch)` composite |
| `OrderedItem`   | `OrderedItems`   | `serialNumber` (9-char string)        |
| `VatRate`       | `VatRates`       | `vatRateId` (autoincrement)           |
| `PriceList`     | `PriceList`      | `itemId` (string)                     |
| `GlobalSetting` | `GlobalSettings` | `key` (string)                        |
| `UserSetting`   | `UserSettings`   | `(userId, key)` composite             |
| `Sequence`      | `Sequences`      | `key` (string)                        |
| `UserAuditLog`  | `UserAuditLog`   | `auditId` (autoincrement)             |

### VAT Rates

`Order.vatRateId` is a FK to `VatRates`. The active rate is the row where `validFrom <= today AND (validTo IS NULL OR validTo >= today)`. The service resolves and assigns the current rate automatically on order creation — callers do not pass a VAT value.

To change the VAT rate: `PATCH /api/vat-rates/:id/close` with a `validTo` date, then `POST /api/vat-rates` with the new rate.

### Settings

- **Global settings** (`GlobalSettings`): app-wide key/value config. `exposed = true` means readable by all roles; `false` is Admin-only.
- **User settings** (`UserSettings`): per-user key/value preferences. Scoped automatically to the authenticated user via `CurrentUser`.

### Soft-deletes

Records with a `void` column are **never physically deleted** — set `void = true` instead.  
Always filter `where: { void: false }` in list queries unless intentionally including voided records.

### Environments

Both dev and prod use **PostgreSQL**. The `database.config.ts` builds a `postgresql://` URL from env vars. `DATABASE_URL` can also be set directly to override.

| Env | Default host | Config file |
|-----|-------------|-------------|
| `development` | `localhost:5432` | `.env.dev` |
| `production` | configured via env | `.env.prod` |

---

## Authentication & Authorization

### Flow

1. `POST /api/auth/login` → `LocalAuthGuard` → returns JWT
2. Protected routes: `JwtAuthGuard` validates token → injects `CurrentUser`
3. `RolesGuard` checks `@Roles(...)` decorator on the handler

### Roles (enum `Role`)

```
Admin       — full access
Manager     — most operations
Operative   — order/item operations
ReadOnly    — read-only
Customer    — scoped to their linked customerId
```

### Guard application pattern

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager)
@Get()
findAll() { ... }
```

### Current user injection

```typescript
@CurrentUser() user: CurrentUserPayload  // src/auth/decorators/current-user.decorator.ts
```

### Account lockout

`User.failedLoginCount` + `User.lockedUntil` — checked in `AuthService`.  
`User.mustChangePassword` — forces password-change flow via `PasswordChangeGuard`.

---

## API Patterns

### Route structure

```
/api/<resource>              GET (list), POST (create)
/api/<resource>/:id          GET (one), PUT (replace), DELETE
/api/<resource>/:id/<verb>   PATCH for state transitions (void, dispatch, close, etc.)
```

Orders use a **composite key** in the URL: `/:orderNumber/:orderBatch`

### DTOs

- All request bodies are DTOs with `class-validator` decorators
- Global `ValidationPipe` with `whitelist: true` — extra properties are stripped
- Use `@IsOptional()` for partial-update DTOs

### Swagger

- Every controller has `@ApiTags(...)` and `@ApiBearerAuth('access-token')`
- Docs auto-generated at `/api/docs`

### Paging

List endpoints accept `?page=1&limit=25` via `PagingDto` and return `PagedResult<T> { data, total, page, limit }`.

---

## Key Commands

```bash
# Development
npm run start:dev          # Hot-reload dev server
npm run start:debug        # Debug + hot-reload

# Build
npm run build              # Compile to dist/

# Database
npm run prisma:generate    # Re-generate Prisma client after schema change

# Quality
npm run lint               # ESLint --fix
npm run format             # Prettier --write

# Tests
npm run test               # Jest unit tests (*.spec.ts in src/)
npm run test:cov           # With coverage
npm run test:e2e           # End-to-end
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` or `production` |
| `DATABASE_URL` | Full PostgreSQL connection string (overrides individual DB_* vars) |
| `DB_HOST_DEV` / `DB_HOST` | PostgreSQL host |
| `DB_PORT_DEV` / `DB_PORT` | PostgreSQL port (default `5432`) |
| `DB_USERNAME_DEV` / `DB_USERNAME` | Database user (default `postgres`) |
| `DB_PASSWORD_DEV` / `DB_PASSWORD` | Database password |
| `DB_DATABASE_DEV` / `DB_DATABASE` | Database name (default `slomsdb`) |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `8h`) |
| `PORT` | HTTP port (default `3000`) |

`.env` is git-ignored. Use `.env.dev` / `.env.prod` as templates.

---

## Docker

```bash
# Build
docker build -t sloms-backend .

# Dev compose
docker-compose up --build

# Production entrypoint runs:
#   applies SQL migrations
#   node dist/main
```

Multi-stage Dockerfile: `builder` (compile) → `production` (runtime, non-root `nodejs:1001`, Tini).

---

## Adding New Features — Checklist

1. Create module folder: `src/<feature>/`
2. Add files: `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.service.spec.ts`, `dto/`, `entities/`
3. Register in `app.module.ts` imports array
4. Add Swagger tag in `src/main.ts`
5. If new DB table: add model to `prisma/schema.prisma`, write SQL in a new `prisma/migrations/` file, run `npm run prisma:generate`
6. Add `@ApiTags`, `@ApiBearerAuth`, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles(...)` on controller
7. Add `void Boolean @default(false)` to new tables that need soft-delete

---

## Known Patterns to Follow

- **Soft-delete** everything that should be recoverable (`void` column, never hard-delete)
- **Audit log** authentication events via `UserAuditLog` — see `AuthService`
- **Role-scoped queries**: Customer-role users must be scoped to `linkedCustomerId`
- **Composite order PK**: always use `{ orderNumber_orderBatch: { orderNumber, orderBatch } }` in Prisma where clauses
- **Sequence table**: used for serial number generation — do not use raw autoincrement for business keys (see `generateSerial()` in `OrdersService`)
- **VAT rate**: never accept a raw VAT value from callers — always resolve from `VatRates` at create time
- **User settings**: always scope to `CurrentUser.userId` — never accept a userId from the request body
