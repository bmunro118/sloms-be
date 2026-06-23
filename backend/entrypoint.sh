#!/bin/sh
set -e

echo "=========================================="
echo "  SLOMS API Entrypoint"
echo "=========================================="

# ── Wait for Postgres ──────────────────────────────────────────────────────────
echo "[INFO] Waiting for PostgreSQL to be ready..."
until pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -q; do
  sleep 1
done
echo "[OK]   PostgreSQL is ready"

# ── Apply migrations ───────────────────────────────────────────────────────────
echo "[INFO] Applying migrations..."
node_modules/.bin/prisma migrate deploy
echo "[OK]   Migrations applied"

# ── Seed (development only) ────────────────────────────────────────────────────
if [ "${SEED_DB:-false}" = "true" ]; then
  echo "[INFO] Seeding database..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/prisma/seed.sql
  echo "[OK]   Database seeded"
fi

# ── Start application ──────────────────────────────────────────────────────────
echo "=========================================="
echo "  Starting application..."
echo "=========================================="
exec node /app/dist/main.js
