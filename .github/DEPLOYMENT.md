# CI/CD setup

Branch-driven environments with a build-once / promote-the-artifact model.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PRs + pushes to any branch except `main` | lint, unit tests, build; plus an e2e job (Postgres service → migrate → seed → `test:e2e`) |
| `deploy-dev.yml` | push to `integration` (or manual) | builds the image, pushes `:<sha>` + `:latest` to ACR, deploys to **stage** (`slomsapi-stage` / rg `sloms-stage`) |
| `deploy-prod.yml` | push to `main` (or manual) | **no rebuild** — promotes the image stage is currently running to **prod** (`slomsapi-prod` / rg `sloms-prod`) |
| `deploy-infra.yml` | PRs touching `infra/**`; manual dispatch | compiles Bicep + `what-if` on PRs (stage); on dispatch, `what-if` then deploys the chosen env. See `infra/README.md` / `infra/CUTOVER.md` |

Flow: feature branch → PR → **`integration`** (auto-deploys to stage) → validate → merge **`integration` → `main`** (promotes the validated image to prod). A manual `deploy-prod` run can override the image via the `image` input.

Tests and the production build also run *inside* `backend/Dockerfile`, so stage can't deploy an image whose tests fail; prod only ever runs an image that already passed through stage.

## Environments & OIDC

GitHub authenticates to Azure with short-lived OIDC tokens (no stored credential). Auth is federated on **GitHub Environments**, so each deploy job declares `environment: stage` / `environment: prod` and the OIDC subject is `repo:<repo>:environment:<env>`.

Provisioned:
- App registration `sloms-be-github-actions` (clientId `30f54ec7-…`), federated creds for `environment:stage` and `environment:prod`.
- Roles: `AcrPush` on the shared registry `slomsacregistry2026`; `Contributor` on both `sloms-stage` and `sloms-prod`.
- Repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- GitHub Environments `stage` and `prod` (add required reviewers on `prod` if you want manual approval before prod promotes).

### Extra setup for `deploy-infra.yml`

The infra workflow provisions more than the image-only deploys, so it needs:
- **Per-environment secret `PG_ADMIN_PASSWORD`** on the `stage` and `prod` GitHub
  Environments (the Postgres admin password; consumed by the Bicep param files).
- **`Role Based Access Control Administrator`** (or Owner) for
  `sloms-be-github-actions` on the registry `slomsacregistry2026`, plus read on
  rg `sloms` — the template creates an `AcrPull` role assignment there, which
  `Contributor` cannot do. Without this the deploy fails at the role assignment.

## Topology

| | stage | prod |
| --- | --- | --- |
| Resource group | `sloms-stage` | `sloms-prod` |
| Container App | `slomsapi-stage` | `slomsapi-prod` |
| Postgres | `sloms-postgres-stage` | `sloms-postgres-prod` |
| Key Vault | `sloms-kv-stage` | `sloms-kv-prod` |
| Registry | `slomsacregistry2026` (shared, in rg `sloms`) | ← same |

Each Container App pulls the image and reads its secrets (`database-url`, `jwt-secret`) from its own Key Vault via its system-assigned managed identity — no stored registry password or app secrets.

## Backups

`sloms-postgres-prod`/`-stage` keep automatic PITR backups (`az postgres
flexible-server backup list -g sloms-<env> -n sloms-postgres-<env>`), but those
only restore into a *new* server — they're not a portable local file.

Before any operation that could drop or reset data (e.g. a migration squash
like the one that reset stage on 2026-07-01, or promoting `integration → main`
while prod is still pre-go-live), take a local dump first:

```bash
./infra/scripts/backup-prod-db.sh        # prod (default)
./infra/scripts/backup-prod-db.sh stage  # stage
```

Requires `az login` (with read access to the target Key Vault) and `pg_dump`
on PATH. Writes a timestamped `.dump` file under `backups/` (gitignored).
Restore with `pg_restore -d <target-database-url> --clean --if-exists <file>`.

## Recommended

- Protect `main` (require PRs / passing CI) so prod only updates via an `integration → main` merge.
- Before real go-live, replace the seeded sample data in prod and rotate the seed login credentials.
