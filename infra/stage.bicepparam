using './main.bicep'

// Stage = the same template as prod, sized down for cost. Deploy into rg
// `sloms-stage`:
//   PG_ADMIN_PASSWORD='...' az deployment group create -g sloms-stage \
//     -f main.bicep -p stage.bicepparam

param environmentName = 'stage'
param location = 'uksouth'

// Derived names resolve to sloms-stage / slomsapi-stage / slomsweb-stage /
// sloms-postgres-stage / sloms-kv-stage automatically from environmentName.

// Distinct address space from prod (in case the VNets are ever peered).
param vnetAddressPrefix = '10.30.0.0/16'
param acaSubnetPrefix = '10.30.0.0/23'
param privateEndpointSubnetPrefix = '10.30.4.0/28'

// --- Postgres: cheap, no HA, no geo-backup (matches current stage) ---
param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresStorageGb = 32
param postgresHaMode = 'Disabled'
param postgresGeoRedundantBackup = 'Disabled'
param postgresBackupRetentionDays = 7
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')

// Public + firewall so the Access FE can point at stage during development.
param postgresPublicAccess = true
param allowedClientIps = [
  {
    name: 'access-fe-host'
    startIp: '86.26.184.153'
    endIp: '86.26.184.153'
  }
]

// --- Container Apps: scale-to-zero is fine for stage; not zone redundant ---
param environmentZoneRedundant = false
param minReplicas = 0
param maxReplicas = 10

// Stage builds its own images; provision from :latest, CD overrides per-commit.
param backendImage = 'slomsacregistry2026.azurecr.io/slomsapi:latest'
param frontendImage = 'slomsacregistry2026.azurecr.io/slomsweb:latest'

// --- ACS Email ---
// The ACS resources (sloms-acs / sloms-email) are SHARED across environments and
// already send via the Azure-managed domain. Leave deployEmail = false here; the
// custom-domain rollout is driven from prod.bicepparam so stage doesn't also try
// to manage the shared domain link. Stage keeps the existing managed sender.
