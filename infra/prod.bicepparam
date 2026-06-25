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
// Initial images = whatever prod currently runs. CD (deploy-prod.yml) overrides
// these per-commit via `az containerapp update --image` after provisioning.
param backendImage = 'slomsacregistry2026.azurecr.io/slomsapi:961fbb1cd412ad6dae6adc52d58bb457b48c7884'
param frontendImage = 'slomsacregistry2026.azurecr.io/slomsweb:2490f6f2ef5ac579c10f9724f8617e0794de4416'

// Keep prod warm.
param minReplicas = 1
param maxReplicas = 10
