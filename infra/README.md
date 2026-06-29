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
| ACS Email custom domain (opt-in) | Adopts shared `sloms-acs` / `sloms-email`, adds a custom sending domain + sender — see [ACS Email](#acs-email--custom-sending-domain-opt-in). Off by default |

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

## ACS Email — custom sending domain (opt-in)

The backend sends mail through **Azure Communication Services** — welcome emails
(`MailService`) and 2FA codes (`EmailOtpService`). Both read `ACS_CONNECTION_STRING`
and put `ACS_SENDER_ADDRESS` in the From field.

The ACS resources already exist in the **shared `sloms` RG** and send today via the
Azure-managed domain (`DoNotReply@<guid>.azurecomm.net`):

| Resource | Name | RG |
| --- | --- | --- |
| Communication Services | `sloms-acs` | `sloms` |
| Email Communication Services | `sloms-email` | `sloms` |

`modules/email.bicep` **adopts** these (references them as `existing`, never
recreates them) and adds the delegated subdomain **`portal.soniclabs.co.uk`** as a
**custom sending domain** + sender, so mail goes out as
`noreply@portal.soniclabs.co.uk`. It runs cross-RG into `sloms`; the
`acs-sender-address` secret it switches lives in `sloms-kv-prod`.

**Off by default** (`deployEmail = false`) — ACS is left exactly as-is. No extra
permissions are needed: the CI identity (`sloms-be-github-actions`) already has
Contributor on both `sloms` (creates the ACS domain/sender, adopts `sloms-acs`)
and `sloms-prod` (writes the `acs-sender-address` secret). Deploy via the
**Deploy infra (Bicep)** workflow — `PG_ADMIN_PASSWORD` is a per-env GitHub secret,
so no password is handled locally.

| Param | Purpose |
| --- | --- |
| `deployEmail` | Master switch (default `false`) |
| `acsCustomDomain` | Sending domain (default `portal.soniclabs.co.uk`) |
| `acsSenderUsername` | Mailbox → `<user>@<domain>` (default `noreply`) |
| `acsSenderDisplayName` | From display name (default `SLOMS`) |
| `acsCustomDomainReady` | Phase-2 switch — set `true` only after DNS is verified |

### Testing now on the managed domain, switching later

You don't need the custom domain (or the owner's DNS delegation) to start. The
managed domain `DoNotReply@<guid>.azurecomm.net` is already linked and is already
the `acs-sender-address` secret value, so **with `deployEmail = false` (default)
email works today** — keep testing on it with zero infra changes.

Whenever the owner's delegation is done, switching is a single param flip:

| State | `deployEmail` | `acsCustomDomainReady` | From address |
| --- | --- | --- | --- |
| Today (default) | `false` | — | managed `DoNotReply@…azurecomm.net` |
| Custom pre-staged | `true` | `false` | still managed (domain created, DNS records readable) |
| Switched | `true` | `true` | `noreply@portal.soniclabs.co.uk` |

When `deployEmail = true`, bicep owns `acs-sender-address` and resolves it from
`acsCustomDomainReady` — so flipping that one bool switches the From address **and
flips back** in a single redeploy. The managed domain stays linked throughout as a
fallback, so a rollback is instant and never breaks sending.

### Delegated subdomain

`portal.soniclabs.co.uk` is an **Azure DNS zone we own** (rg `sloms-prod`), delegated
from the parent `soniclabs.co.uk` (which we don't control). It already serves the
frontend (`A @` + `asuid` Container App verification); the ACS email records
(apex ownership TXT, apex SPF TXT, 2 DKIM CNAMEs) sit alongside without conflict.

**Owner one-time step** — the `soniclabs.co.uk` owner delegates the subdomain by
adding NS records for `portal`. Give them the zone's authoritative nameservers:

```bash
az network dns zone show -g sloms-prod -n portal.soniclabs.co.uk --query nameServers -o tsv
# ns1-02.azure-dns.com / ns2-02.azure-dns.net / ns3-02.azure-dns.org / ns4-02.azure-dns.info
```

Because we own the zone, the verification records are applied **automatically** by
`scripts/setup-email-dns.ps1` — no manual DNS entry.

### Two-phase rollout (a custom domain must be verified before it can be linked)

**Phase 1 — create the domain, then sync + verify DNS:**

```bash
# In prod.bicepparam set deployEmail = true, acsCustomDomainReady = false, commit,
# then run the "Deploy infra (Bicep)" workflow (environment: prod).
# (Local equivalent: PG_ADMIN_PASSWORD='…' az deployment group create -g sloms-prod \
#    -f main.bicep -p prod.bicepparam)

# read the ACS verification records into the zone and trigger verification (idempotent)
./scripts/setup-email-dns.ps1
```

Phase 1 creates the domain + sender under `sloms-email` but links nothing — the
managed domain stays the active sender, so nothing breaks. The script reads the
records ACS generated, upserts the TXT/CNAME record-sets into the zone (additive —
it won't touch the existing `A`/`asuid` records), and triggers verification.
Re-run it until all four records report **Verified**.

**Phase 2 — link it and switch the From address:**

```bash
# set acsCustomDomainReady = true, commit, re-run the "Deploy infra (Bicep)" workflow
az containerapp revision restart -g sloms-prod -n slomsapi-prod   # pick up the new secret
```

Phase 2 links the verified domain to `sloms-acs` (keeping the managed domain
linked) and writes `acs-sender-address = noreply@portal.soniclabs.co.uk`.
`MailService` and `EmailOtpService` then send from it — no app code change.

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
