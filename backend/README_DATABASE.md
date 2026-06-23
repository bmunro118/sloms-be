# SLOMS Backend — Database Configuration

The application uses **PostgreSQL** in all environments. The database connection is built from environment variables by `src/config/database.config.ts`. If `DATABASE_URL` is set directly it takes precedence over the individual `DB_*` variables.

---

## Environment Variables

### Development (`NODE_ENV=development`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(unset)* | Full connection string — overrides all DB_* vars if set |
| `DB_HOST_DEV` | `localhost` | PostgreSQL host |
| `DB_PORT_DEV` | `5432` | PostgreSQL port |
| `DB_USERNAME_DEV` | `postgres` | Database user |
| `DB_PASSWORD_DEV` | *(empty)* | Database password |
| `DB_DATABASE_DEV` | `slomsdb` | Database name |

### Production (`NODE_ENV=production`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(unset)* | Full connection string — overrides all DB_* vars if set |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | Database user |
| `DB_PASSWORD` | *(empty)* | Database password |
| `DB_DATABASE` | `slomsdb` | Database name |

Other variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `8h`) |
| `PORT` | HTTP port (default `3000`) |

---

## Quick Start

### Development

```bash
cp .env.dev .env
# Edit DB_PASSWORD_DEV with your local postgres password
npm run prisma:generate
npm run start:dev
```

### Production

```bash
cp .env.prod .env
# Edit with actual credentials or set DATABASE_URL directly
npm run build
npm start
```

---

## Applying Migrations

Migrations are plain SQL files. Apply them with `psql`:

```bash
psql "$DATABASE_URL" -f prisma/migrations/001_initial_schema/migration.sql
```

After schema changes, regenerate the Prisma client:

```bash
npm run prisma:generate
```

See `prisma/MIGRATION_GUIDE.md` for the full workflow.

---

## Seeding Development Data

```bash
psql "$DATABASE_URL" -f prisma/seed.sql
```

---

## Docker

```bash
# Dev
docker-compose up --build

# The entrypoint applies migrations then starts the app
```

---

## Troubleshooting

### Cannot connect

```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# List databases
psql -U postgres -c "\l"

# Test connection
psql -U postgres -d slomsdb -c "SELECT 1"
```

### Prisma client out of sync

```bash
npm run prisma:generate
```

---

## Security

1. **Never commit `.env`** — only commit `.env.dev` and `.env.prod` as templates with no real credentials
2. Use `DATABASE_URL` with a secrets manager in production CI/CD
3. Use least-privilege database roles in production

---

**Last Updated:** 2026-04-09
