// =============================================================================
// SLOMS production stack — orchestrator
// =============================================================================
// Provisions a prod-hardened copy of the SLOMS stack in resource group
// `sloms-prod` (UK South):
//
//   - VNet + subnets (zone-redundant Container Apps env; a private-endpoint
//     subnet + private DNS zone pre-provisioned for going private later)
//   - Postgres Flexible Server: General Purpose, zone-redundant HA, geo-backup
//   - Container Apps managed environment: ZONE REDUNDANT
//   - Backend (slomsapi) + Frontend (slomsweb) Container Apps, minReplicas >= 1
//   - One user-assigned managed identity, granted AcrPull on the shared registry
//     and get/list on the prod Key Vault secrets
//
// NETWORKING / LEGACY ACCESS FE
// -----------------------------
// Postgres uses the PRIVATE ENDPOINT (Private Link) model, NOT VNet injection.
// The server is always created with public access available; `postgresPublicAccess`
// then toggles between:
//   true  -> public endpoint + firewall allowlist (the legacy MS-Access tool on a
//            Windows host connects directly over the internet).
//   false -> public network access DISABLED + a private endpoint in the VNet.
//
// Crucially, because this is a private *endpoint* (not VNet injection), switching
// from public to private later is a NON-DESTRUCTIVE update to the SAME server —
// no new server and no data migration. (Flip it only once the Access FE is
// retired, or give that host a VPN path into the VNet.)
//
// Deploy:
//   az deployment group create -g sloms-prod -f main.bicep -p prod.bicepparam
// =============================================================================

targetScope = 'resourceGroup'

// ---------- Parameters ----------
@description('Azure region. Must match the existing prod resources.')
param location string = 'uksouth'

@description('Environment short name, used in resource names and tags (e.g. prod, stage).')
param environmentName string = 'prod'

@description('Tags applied to every resource created by this template.')
param tags object = {
  app: 'sloms'
  env: environmentName
  managedBy: 'bicep'
}

// Resource names — default to the `<thing>-<environmentName>` convention.
@description('Name of the user-assigned managed identity.')
param managedIdentityName string = 'id-sloms-${environmentName}'
@description('Name of the VNet.')
param vnetName string = 'vnet-sloms-${environmentName}'
@description('Name of the private DNS zone for the Postgres private endpoint. Must be privatelink.postgres.database.azure.com for Private Link to resolve.')
param postgresPrivateDnsZoneName string = 'privatelink.postgres.database.azure.com'
@description('Name of the Container Apps managed environment.')
param containerAppEnvName string = 'sloms-${environmentName}-env'
@description('Name of the backend (API) Container App.')
param backendAppName string = 'slomsapi-${environmentName}'
@description('Name of the frontend (web) Container App.')
param frontendAppName string = 'slomsweb-${environmentName}'

// Networking
@description('Address space for the prod VNet.')
param vnetAddressPrefix string = '10.20.0.0/16'
@description('Subnet for the Container Apps environment infrastructure (>= /23, delegated to Microsoft.App/environments).')
param acaSubnetPrefix string = '10.20.0.0/23'
@description('Subnet that holds the Postgres private endpoint NIC (used when postgresPublicAccess = false).')
param privateEndpointSubnetPrefix string = '10.20.4.0/28'

// Postgres
@description('Postgres server name.')
param postgresServerName string = 'sloms-postgres-${environmentName}'
@description('Postgres compute SKU. General Purpose (Dxds) is required for zone-redundant HA.')
param postgresSkuName string = 'Standard_D2ds_v5'
@description('Postgres SKU tier. Burstable does not support zone-redundant HA.')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'GeneralPurpose'
@description('Postgres storage in GB.')
param postgresStorageGb int = 128
@description('Postgres major version.')
param postgresVersion string = '16'
@description('Admin login for Postgres.')
param postgresAdminLogin string = 'slomsadmin'
@description('Admin password for Postgres. Supply at deploy time / via pipeline secret.')
@secure()
param postgresAdminPassword string
@description('High-availability mode. ZoneRedundant requires General Purpose or higher; use Disabled for Burstable/stage.')
@allowed(['ZoneRedundant', 'SameZone', 'Disabled'])
param postgresHaMode string = 'ZoneRedundant'
@description('Geo-redundant backups. Enable for prod DR; disable to save cost on stage.')
@allowed(['Enabled', 'Disabled'])
param postgresGeoRedundantBackup string = 'Enabled'
@description('Backup retention in days (7-35).')
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 35
@description('Primary availability zone for the Postgres server.')
param postgresPrimaryZone string = '1'
@description('Standby availability zone for zone-redundant HA (must differ from primary).')
param postgresStandbyZone string = '2'
@description('true = public endpoint + firewall (legacy Access FE connects directly). false = public access disabled + a private endpoint in the VNet. Switchable in place — same server, no data migration.')
param postgresPublicAccess bool = true
@description('Client IP ranges allowed through the Postgres firewall when public (e.g. the Access FE host). startIp == endIp for a single address.')
param allowedClientIps array = [
  {
    name: 'access-fe-host'
    startIp: '86.26.184.153'
    endIp: '86.26.184.153'
  }
]

// Shared registry / key vault (already exist)
@description('Name of the shared Azure Container Registry.')
param acrName string = 'slomsacregistry2026'
@description('Resource group of the shared ACR.')
param acrResourceGroup string = 'sloms'
@description('Name of the existing Key Vault holding the app secrets.')
param keyVaultName string = 'sloms-kv-${environmentName}'

// Container Apps
@description('Container image for the backend API (CD overrides this per-commit after provisioning).')
param backendImage string = 'slomsacregistry2026.azurecr.io/slomsapi:961fbb1cd412ad6dae6adc52d58bb457b48c7884'
@description('Container image for the frontend web app.')
param frontendImage string = 'slomsacregistry2026.azurecr.io/slomsweb:2490f6f2ef5ac579c10f9724f8617e0794de4416'
@description('CPU cores per replica.')
param containerCpu string = '0.5'
@description('Memory per replica.')
param containerMemory string = '1Gi'
@description('Minimum replicas. >= 1 keeps prod warm (no scale-to-zero cold starts); 0 is fine for stage.')
@minValue(0)
param minReplicas int = 1
@description('Make the Container Apps environment zone redundant (prod). Requires the infra subnet.')
param environmentZoneRedundant bool = true
@description('Maximum replicas.')
param maxReplicas int = 10
@description('JWT expiry for the backend.')
param jwtExpiresIn string = '8h'
@description('Whether the backend enforces 2FA.')
param twofaEnforce string = 'false'

// ---------- Existing resources ----------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroup)
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// ---------- User-assigned managed identity (shared by both apps) ----------
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
  tags: tags
}

// AcrPull on the shared registry (cross-RG → deployed at the ACR's scope)
module acrPull 'modules/acr-role.bicep' = {
  name: 'acrPull-assignment'
  scope: resourceGroup(acrResourceGroup)
  params: {
    acrName: acrName
    principalId: uami.properties.principalId
  }
}

// Key Vault uses ACCESS POLICIES (not RBAC), so grant get/list via a
// non-destructive `add` rather than a role assignment.
resource kvAccess 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  name: 'add'
  parent: keyVault
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: uami.properties.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

// ---------- Network ----------
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    tags: tags
    vnetName: vnetName
    privateDnsZoneName: postgresPrivateDnsZoneName
    vnetAddressPrefix: vnetAddressPrefix
    acaSubnetPrefix: acaSubnetPrefix
    privateEndpointSubnetPrefix: privateEndpointSubnetPrefix
  }
}

// ---------- Postgres ----------
module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    tags: tags
    serverName: postgresServerName
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageGb: postgresStorageGb
    version: postgresVersion
    adminLogin: postgresAdminLogin
    adminPassword: postgresAdminPassword
    backupRetentionDays: postgresBackupRetentionDays
    haMode: postgresHaMode
    geoRedundantBackup: postgresGeoRedundantBackup
    primaryZone: postgresPrimaryZone
    standbyZone: postgresStandbyZone
    publicAccess: postgresPublicAccess
    allowedClientIps: allowedClientIps
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    privateDnsZoneId: network.outputs.postgresPrivateDnsZoneId
  }
}

// ---------- Container Apps environment (zone redundant) ----------
module environment 'modules/environment.bicep' = {
  name: 'aca-environment'
  params: {
    location: location
    tags: tags
    name: containerAppEnvName
    zoneRedundant: environmentZoneRedundant
    infrastructureSubnetId: network.outputs.acaSubnetId
  }
}

// ---------- Backend (slomsapi) ----------
module backend 'modules/containerapp.bicep' = {
  name: 'backend'
  params: {
    location: location
    tags: tags
    name: backendAppName
    environmentId: environment.outputs.environmentId
    image: backendImage
    targetPort: 3000
    cpu: containerCpu
    memory: containerMemory
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    uamiId: uami.id
    acrLoginServer: acr.properties.loginServer
    secrets: [
      { name: 'database-url', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/database-url' }
      { name: 'jwt-secret', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/jwt-secret' }
      { name: 'acs-connection-string', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/acs-connection-string' }
      { name: 'acs-sender-address', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/acs-sender-address' }
      { name: 'totp-enc-key', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/totp-enc-key' }
    ]
    envVars: [
      { name: 'NODE_ENV', value: 'production' }
      { name: 'DATABASE_URL', secretRef: 'database-url' }
      { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
      { name: 'JWT_EXPIRES_IN', value: jwtExpiresIn }
      { name: 'PGHOST', value: postgres.outputs.fqdn }
      { name: 'PGPORT', value: '5432' }
      { name: 'PGUSER', value: postgresAdminLogin }
      { name: 'ACS_CONNECTION_STRING', secretRef: 'acs-connection-string' }
      { name: 'ACS_SENDER_ADDRESS', secretRef: 'acs-sender-address' }
      { name: 'TOTP_ENC_KEY', secretRef: 'totp-enc-key' }
      { name: 'TWOFA_ENFORCE', value: twofaEnforce }
    ]
  }
  dependsOn: [
    acrPull
    kvAccess
  ]
}

// ---------- Frontend (slomsweb) ----------
module frontend 'modules/containerapp.bicep' = {
  name: 'frontend'
  params: {
    location: location
    tags: tags
    name: frontendAppName
    environmentId: environment.outputs.environmentId
    image: frontendImage
    targetPort: 80
    cpu: containerCpu
    memory: containerMemory
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    uamiId: uami.id
    acrLoginServer: acr.properties.loginServer
    secrets: []
    envVars: [
      { name: 'API_BASE_URL', value: 'https://${backend.outputs.fqdn}' }
    ]
  }
  dependsOn: [
    acrPull
  ]
}

// ---------- Outputs ----------
output backendFqdn string = backend.outputs.fqdn
output frontendFqdn string = frontend.outputs.fqdn
output postgresFqdn string = postgres.outputs.fqdn
output environmentId string = environment.outputs.environmentId
output managedIdentityPrincipalId string = uami.properties.principalId
