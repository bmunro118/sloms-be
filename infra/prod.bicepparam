using './main.bicep'

// Region — must match the existing prod resources.
param location = 'uksouth'

// --- Postgres ---
// Admin password is read from an env var so it never lands in source control:
//   PG_ADMIN_PASSWORD='...'  az deployment group create -g sloms-prod \
//     -f main.bicep -p prod.bicepparam
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')

// Keep Postgres PUBLIC so the legacy Access FE (Windows host) can connect
// directly. Flip to false once the Access FE is retired to disable public access
// and add a private endpoint — same server, no data migration (Private Link).
param postgresPublicAccess = true

// Hosts allowed through the public firewall. Add/replace as needed.
param allowedClientIps = [
  {
    name: 'access-fe-host'
    startIp: '86.26.184.153'
    endIp: '86.26.184.153'
  }
]

// --- Container Apps ---
// First-provision baseline ONLY. On every infra deploy, deploy-infra.yml reads the
// image each app is currently running and passes it as a `backendImage`/`frontendImage`
// override, so an infra deploy never changes the live build — CD (deploy-prod.yml)
// stays the sole authority on what prod runs. These values are used solely when the
// app does not yet exist (initial provision). Do NOT point these at :latest: stage
// and prod share one registry and stage CD pushes :latest on every build (the FE
// :latest is even built with the stage-only Statistics page enabled), so a fresh
// provision from :latest would pull an unvalidated stage image into prod.
param backendImage = 'slomsacregistry2026.azurecr.io/slomsapi:961fbb1cd412ad6dae6adc52d58bb457b48c7884'
param frontendImage = 'slomsacregistry2026.azurecr.io/slomsweb:2490f6f2ef5ac579c10f9724f8617e0794de4416'

// Keep prod warm.
param minReplicas = 1
param maxReplicas = 10

// --- 2FA ---
// Prod enforces mandatory 2FA. Stated explicitly here (it also matches the
// main.bicep default) so the security posture is visible at the env level.
param twofaEnforce = 'true'

// --- ACS Email custom domain (opt-in) ---
// Adopts the shared resources (sloms-acs / sloms-email in rg `sloms`) and can add
// the delegated subdomain `portal.soniclabs.co.uk` so mail goes out as
// noreply@portal.soniclabs.co.uk instead of DoNotReply@<guid>.azurecomm.net.
// Deploy via the "Deploy infra (Bicep)" workflow (PG_ADMIN_PASSWORD is a GitHub
// secret); the CI identity already has the rights (Contributor on `sloms` + `sloms-prod`).
//
// TESTING NOW: leave everything below commented (deployEmail defaults to false).
// Email already works on the managed domain — no infra change needed.
//
// SWITCH LATER (custom domain), in order:
//   PREREQ — owner delegates the subdomain (one-time). Give them the nameservers:
//     az network dns zone show -g sloms-prod -n portal.soniclabs.co.uk --query nameServers -o tsv
//   PHASE 1 — set `deployEmail = true` (keep acsCustomDomainReady = false), deploy,
//     then run ./scripts/setup-email-dns.ps1 until all four records show Verified.
//     (From address stays managed during this phase.)
//   PHASE 2 — set `acsCustomDomainReady = true`, redeploy, then:
//     az containerapp revision restart -g sloms-prod -n slomsapi-prod
//   ROLLBACK — flip acsCustomDomainReady back to false and redeploy; the From
//     address reverts to the managed sender in one step.
//
// param deployEmail = true
// param acsCustomDomainReady = false
