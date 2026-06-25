# Prod cutover runbook — migrating onto the Bicep-defined stack

The hardening this template adds **cannot be toggled in place**:

- Container Apps environment **zone redundancy** is set only at environment
  creation.
- Postgres **HA tier** (Burstable → General Purpose) and **zone-redundant HA**
  effectively require a new server; geo-redundant backup likewise is cleanest on
  a fresh server.

So going live means **building the hardened stack alongside the current one and
cutting over**, not running `what-if` against today's prod and expecting a no-op.

This runbook does a side-by-side migration with minimal downtime. Times are
indicative; the only user-visible outage is the final DB sync + URL switch
(typically minutes, dominated by data size).

---

## 0. Prerequisites

- `az` logged in to subscription `295f53a3-9253-4547-8062-51d425160903`, with
  Contributor on `sloms-prod` and the shared `sloms` (ACR) RG.
- The prod DB admin password to hand (passed as `PG_ADMIN_PASSWORD`).
- `pg_dump` / `pg_restore` v16 locally (or run from a container).
- A maintenance window for the final cutover step.
- Confirm the current prod image SHAs to deploy (defaults in `prod.bicepparam`
  are the SHAs prod runs today — update if prod has moved on):
  ```bash
  az containerapp show -n slomsapi-prod -g sloms-prod \
    --query "properties.template.containers[0].image" -o tsv
  az containerapp show -n slomsweb-prod -g sloms-prod \
    --query "properties.template.containers[0].image" -o tsv
  ```

> Naming clash: the template's default names (`slomsapi-prod`, `sloms-prod-env`,
> `sloms-postgres-prod`, …) are the **same** as the live resources. To run
> side-by-side in one RG, deploy the new stack with a distinct
> `environmentName` (e.g. `prod2`) first, then rename/repoint at the end — or
> deploy into a fresh RG. Steps below use `environmentName=prod2`.

---

## 1. Provision the hardened stack (no traffic yet)

```bash
PG_ADMIN_PASSWORD='<prod-db-password>' \
  az deployment group create -g sloms-prod \
  -f main.bicep -p prod.bicepparam \
  -p environmentName=prod2
```

This creates: VNet, zone-redundant env, GP + zone-redundant HA + geo-backup
Postgres (`sloms-postgres-prod2`), both Container Apps (`slomsapi-prod2`,
`slomsweb-prod2`), the managed identity, and its ACR/Key Vault grants.

Verify before proceeding:

```bash
az postgres flexible-server show -n sloms-postgres-prod2 -g sloms-prod \
  --query "{tier:sku.tier, ha:highAvailability.mode, haState:highAvailability.state, geo:backup.geoRedundantBackup}" -o yaml
az containerapp env show -n sloms-prod2-env -g sloms-prod \
  --query "properties.zoneRedundant" -o tsv     # expect: true
```

The new backend will fail health checks until the DB has data — that's expected;
it gets data in step 3.

---

## 2. Pre-sync the database (bulk copy, app still live on old stack)

Copy the bulk of the data while the **old** prod keeps serving, to shrink the
final-cutover window.

```bash
# Dump from current prod
pg_dump "host=sloms-postgres-prod.postgres.database.azure.com port=5432 \
  user=slomsadmin dbname=slomsdb sslmode=require" -Fc -f sloms-prod.dump

# Restore into the new server
pg_restore --no-owner --no-privileges \
  -d "host=sloms-postgres-prod2.postgres.database.azure.com port=5432 \
      user=slomsadmin dbname=slomsdb sslmode=require" sloms-prod.dump
```

If `slomsdb` doesn't exist on the new server yet, create it first
(`az postgres flexible-server db create -g sloms-prod -s sloms-postgres-prod2 -d slomsdb`),
or let the backend's startup migrations create the schema and restore data-only.

---

## 3. Cutover (maintenance window)

1. **Freeze writes** to old prod — stop the old apps so no new rows land:
   ```bash
   az containerapp update -n slomsapi-prod -g sloms-prod --min-replicas 0 --max-replicas 0
   ```
2. **Final delta sync** — re-run the dump/restore (or a delta) to capture writes
   since step 2.
3. **Point secrets at the new DB** — update `database-url` in `sloms-kv-prod` to
   the `sloms-postgres-prod2` host, then restart the new backend so it picks up
   the secret:
   ```bash
   az keyvault secret set --vault-name sloms-kv-prod --name database-url \
     --value 'postgresql://slomsadmin:<pwd>@sloms-postgres-prod2.postgres.database.azure.com:5432/slomsdb?sslmode=require'
   az containerapp revision restart -n slomsapi-prod2 -g sloms-prod \
     --revision "$(az containerapp show -n slomsapi-prod2 -g sloms-prod --query properties.latestRevisionName -o tsv)"
   ```
4. **Smoke test** the new stack via its own FQDNs (login, a couple of reads, a
   write). Get them from:
   ```bash
   az containerapp show -n slomsapi-prod2 -g sloms-prod --query properties.configuration.ingress.fqdn -o tsv
   az containerapp show -n slomsweb-prod2 -g sloms-prod --query properties.configuration.ingress.fqdn -o tsv
   ```
5. **Switch the public entry point.** Whatever users hit (custom domain / DNS):
   - Custom domain: bind it + cert to `slomsweb-prod2` and remove from the old
     web app.
   - The FE's `API_BASE_URL` already points at the new backend FQDN (the template
     wires `https://<slomsapi-prod2 fqdn>`), so the web app needs no change.
   - Also add the prod2 backend FQDN to any allowed-origins / CORS config.

---

## 4. Verify availability posture

```bash
# HA is actually healthy (not just configured)
az postgres flexible-server show -n sloms-postgres-prod2 -g sloms-prod \
  --query "highAvailability" -o yaml          # state: Healthy

# Apps are warm (min replicas honoured)
az containerapp replica list -n slomsapi-prod2 -g sloms-prod --query "length(@)"
az containerapp replica list -n slomsweb-prod2 -g sloms-prod --query "length(@)"
```

Update the GitHub Actions deploy workflows so CD targets the new app names
(`STAGE_*` / `PROD_CONTAINERAPP` in `.github/workflows/deploy-*.yml`) if the
names changed.

---

## 5. Decommission the old stack (after a soak period)

Once you're confident (keep old prod stopped but intact for a rollback window):

```bash
az containerapp delete -n slomsapi-prod -g sloms-prod --yes
az containerapp delete -n slomsweb-prod -g sloms-prod --yes
az containerapp env delete -n sloms-prod-env -g sloms-prod --yes
az postgres flexible-server delete -n sloms-postgres-prod -g sloms-prod --yes
```

Then, if you want the canonical names back, you can re-run the template with the
default `environmentName=prod` against a clean slate — or simply keep `prod2` and
standardise on it.

---

## Rollback

Until step 5, rollback is fast: re-point `database-url` in `sloms-kv-prod` to the
old server, scale the old apps back up (`--min-replicas 1`), and revert the
domain binding. Because the old stack is untouched (just scaled to zero), this is
a few CLI calls.

## Stage

Stage uses the **same** `main.bicep` via `stage.bicepparam` (Burstable, no HA, no
geo-backup, scale-to-zero, non-zone-redundant). The same side-by-side approach
applies but stage rarely needs zero-downtime — you can deploy with
`environmentName=stage` into a clean `sloms-stage` and migrate at leisure.
