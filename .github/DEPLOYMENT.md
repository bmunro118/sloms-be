# CI/CD setup

Branch-driven environments with a build-once / promote-the-artifact model.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PRs + pushes to any branch except `main` | lint, unit tests, build; plus an e2e job (Postgres service → migrate → seed → `test:e2e`) |
| `deploy-dev.yml` | push to `integration` (or manual) | builds the image, pushes `:<sha>` + `:latest` to ACR, deploys to **stage** (`slomsapi-stage` / rg `sloms-stage`) |
| `deploy-prod.yml` | push to `main` (or manual) | **no rebuild** — promotes the image stage is currently running to **prod** (`slomsapi-prod` / rg `sloms-prod`) |

Flow: feature branch → PR → **`integration`** (auto-deploys to stage) → validate → merge **`integration` → `main`** (promotes the validated image to prod). A manual `deploy-prod` run can override the image via the `image` input.

Tests and the production build also run *inside* `backend/Dockerfile`, so stage can't deploy an image whose tests fail; prod only ever runs an image that already passed through stage.

## Environments & OIDC

GitHub authenticates to Azure with short-lived OIDC tokens (no stored credential). Auth is federated on **GitHub Environments**, so each deploy job declares `environment: stage` / `environment: prod` and the OIDC subject is `repo:<repo>:environment:<env>`.

Provisioned:
- App registration `sloms-be-github-actions` (clientId `30f54ec7-…`), federated creds for `environment:stage` and `environment:prod`.
- Roles: `AcrPush` on the shared registry `slomsacregistry2026`; `Contributor` on both `sloms-stage` and `sloms-prod`.
- Repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- GitHub Environments `stage` and `prod` (add required reviewers on `prod` if you want manual approval before prod promotes).

## Topology

| | stage | prod |
| --- | --- | --- |
| Resource group | `sloms-stage` | `sloms-prod` |
| Container App | `slomsapi-stage` | `slomsapi-prod` |
| Postgres | `sloms-postgres-stage` | `sloms-postgres-prod` |
| Key Vault | `sloms-kv-stage` | `sloms-kv-prod` |
| Registry | `slomsacregistry2026` (shared, in rg `sloms`) | ← same |

Each Container App pulls the image and reads its secrets (`database-url`, `jwt-secret`) from its own Key Vault via its system-assigned managed identity — no stored registry password or app secrets.

## Recommended

- Protect `main` (require PRs / passing CI) so prod only updates via an `integration → main` merge.
- Before real go-live, replace the seeded sample data in prod and rotate the seed login credentials.
