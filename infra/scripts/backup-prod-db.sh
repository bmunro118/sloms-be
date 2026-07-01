#!/bin/sh
# Dumps the prod Postgres database to a local file before a risky operation
# (e.g. promoting integration -> main, which redeploys prod and runs
# `prisma migrate deploy` against it on container start).
#
# Requires: az CLI (logged in, with read access to the target Key Vault).
# Uses a local `pg_dump` if one is on PATH; otherwise falls back to running
# pg_dump inside a throwaway postgres:16-alpine container via Docker.
#
# Usage:
#   ./infra/scripts/backup-prod-db.sh [env]
#
#   env defaults to "prod". Pass "stage" to back up stage instead.

set -eu

ENV="${1:-prod}"
RESOURCE_GROUP="sloms-${ENV}"
SERVER_NAME="sloms-postgres-${ENV}"
KEY_VAULT="sloms-kv-${ENV}"
OUT_DIR="$(dirname "$0")/../../backups"
OUT_FILE="${OUT_DIR}/slomsdb-${ENV}-$(date +%Y%m%dT%H%M%S).dump"

mkdir -p "$OUT_DIR"

echo "[INFO] Resolving connection details for ${SERVER_NAME} (rg ${RESOURCE_GROUP})..."
FQDN=$(az postgres flexible-server show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$SERVER_NAME" \
  --query fullyQualifiedDomainName -o tsv)

# database-url in Key Vault is the full DSN the app uses; pg_dump accepts it directly.
DATABASE_URL=$(az keyvault secret show \
  --vault-name "$KEY_VAULT" \
  --name database-url \
  --query value -o tsv)

echo "[INFO] Dumping ${SERVER_NAME} (${FQDN}) to ${OUT_FILE}..."
export DATABASE_URL
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" -Fc -f "$OUT_FILE"
else
  echo "[INFO] pg_dump not found locally — running it via Docker (postgres:16-alpine)..."
  # -e DATABASE_URL (no '=value') forwards the exported var without ever
  # putting the connection string on the docker command line itself.
  docker run --rm -e DATABASE_URL \
    -v "$(cd "$OUT_DIR" && pwd)":/backup \
    postgres:16-alpine \
    pg_dump "$DATABASE_URL" -Fc -f "/backup/$(basename "$OUT_FILE")"
fi
unset DATABASE_URL

echo "[OK] Backup written to ${OUT_FILE}"
echo "[INFO] Restore with: pg_restore -d <target-database-url> --clean --if-exists ${OUT_FILE}"
