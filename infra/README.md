# SLOMS prod infrastructure (Bicep)

Prod-hardened, reproducible definition of the SLOMS prod stack — closing the
availability gaps found in the resource review (Burstable DB, no HA, no
geo-backup, scale-to-zero, non-zone-redundant environment).

> Scope note: this models the stack for both apps (they share one Container Apps
> environment and one database). It lives in `sloms-be` because the backend owns
> the DB + Key Vault relationship and the topology docs, but it provisions the
> frontend Container App too.

One template, two environments — selected by the param file:

| File | Target RG | Posture |
| --- | --- | --- |
| `prod.bicepparam` | `sloms-prod` | GP + zone-redundant HA + geo-backup, zone-redundant env, min replicas ≥ 1 |
| `stage.bicepparam` | `sloms-stage` | Burstable, no HA, no geo-backup, non-ZR env, scale-to-zero |

Resource names derive from `environmentName` (e.g. `slomsapi-prod` /
`slomsapi-stage`), so the same `main.bicep` serves both. See **CUTOVER.md** for
migrating the existing prod onto this definition.

## What it provisions (resource group `sloms-prod`, UK South)

| Component | Hardening vs. current prod |
| --- | --- |
| VNet + 2 subnets + private DNS zone | New — enables zone redundancy; private-endpoint subnet + `privatelink.postgres…` DNS zone pre-staged for going private later |
| Postgres Flexible Server | **General Purpose** + **zone-redundant HA** + **geo-redundant backup** (was Burstable B1ms, HA off, local backup) |
| Container Apps environment | **Zone redundant** (was not) |
| Backend + Frontend Container Apps | **minReplicas ≥ 1** (was scale-to-zero); user-assigned identity |
| Managed identity | AcrPull on shared `slomsacregistry2026`; get/list on `sloms-kv-prod` |

Unchanged (referenced as existing): the shared ACR (`slomsacregistry2026` in rg
`sloms`) and the prod Key Vault `sloms-kv-prod` with its secrets.

## Legacy Access FE ⇄ Postgres

Postgres uses the **Private Endpoint (Private Link)** model, *not* VNet injection.
The server always supports a public endpoint; `postgresPublicAccess` toggles it:

- `true` (default) — public endpoint + firewall allowlist. The legacy MS-Access
  tool on a Windows host connects directly over the internet.
- `false` — public network access **disabled** + a private endpoint in the VNet.

Because this is a private *endpoint* and not VNet injection, switching from public
to private later is a **non-destructive update to the same server — no new server
and no data migration**. To go private (once the Access FE is retired):

1. Set `postgresPublicAccess = false` and redeploy. Bicep disables public access
   and creates the private endpoint in the pre-staged `snet-privatelink` subnet,
   wired to the `privatelink.postgres.database.azure.com` DNS zone.
2. `DATABASE_URL` keeps the same host FQDN — it now resolves to the private IP
   from inside the VNet, so no secret change is needed.

⚠️ A private-only server is unreachable from a Windows host over the internet, so
flip the switch only after the Access FE is retired (or give that host a
point-to-site VPN into the VNet).

## Deploy

```bash
az bicep build --file main.bicep            # validate locally
az deployment group what-if -g sloms-prod \
  -f main.bicep -p prod.bicepparam          # preview (set PG_ADMIN_PASSWORD first)

PG_ADMIN_PASSWORD='<prod-db-password>' \
  az deployment group create -g sloms-prod \
  -f main.bicep -p prod.bicepparam

# Stage (same template, cheaper params)
PG_ADMIN_PASSWORD='<stage-db-password>' \
  az deployment group create -g sloms-stage \
  -f main.bicep -p stage.bicepparam
```

> Deploying with the default `environmentName` produces names identical to the
> live resources. To stand the new stack up side-by-side for a zero-downtime
> cutover, pass a distinct `environmentName` (e.g. `-p environmentName=prod2`).
> See **CUTOVER.md**.

The admin password is read from `PG_ADMIN_PASSWORD` (via `readEnvironmentVariable`
in `prod.bicepparam`) so it never enters source control. In CI, source it from a
pipeline secret / Key Vault.

## Notes & caveats

- **Existing prod is not zone-redundant / not HA in place.** Zone redundancy
  (environment) and HA tier changes generally require **recreation**, not an
  in-place toggle. Treat this as the definition for a cleanly rebuilt prod and
  plan a cutover (new env + apps, DB restore, DNS/URL switch) rather than
  expecting `what-if` to be a no-op against today's resources.
- **Key Vault auth model.** `sloms-kv-prod` currently uses **access policies**
  (not RBAC), so the module adds a non-destructive `accessPolicies/add` entry for
  the managed identity. If you migrate the vault to RBAC, replace that with a
  `Key Vault Secrets User` role assignment.
- **`TWOFA_ENFORCE` defaults to `false`** to match current prod. Set
  `twofaEnforce = 'true'` before real go-live if 2FA should be mandatory.
- **Container sizing** stays at 0.5 vCPU / 1Gi per replica (param
  `containerCpu` / `containerMemory`); revisit once you have real traffic data.
```
