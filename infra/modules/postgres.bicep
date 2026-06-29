// =============================================================================
// Postgres Flexible Server — prod hardened, Private Link ready.
//
//  - General Purpose tier (required for zone-redundant HA)
//  - Zone-redundant high availability (automatic failover to a standby zone)
//  - Geo-redundant backups (cross-region restore target)
//
// The server is NOT VNet-injected; it uses the PRIVATE ENDPOINT model so the
// public<->private switch is non-destructive (same server, no data migration):
//   publicAccess = true  -> public endpoint enabled + firewall allowlist
//   publicAccess = false -> public network access disabled + private endpoint
// =============================================================================

param location string
param tags object
param serverName string
param skuName string
param skuTier string
param storageGb int
param version string
param adminLogin string
@secure()
param adminPassword string
param backupRetentionDays int
@allowed(['ZoneRedundant', 'SameZone', 'Disabled'])
param haMode string
@allowed(['Enabled', 'Disabled'])
param geoRedundantBackup string
param primaryZone string
param standbyZone string
param publicAccess bool
param allowedClientIps array
param privateEndpointSubnetId string
param privateDnsZoneId string

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: version
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    availabilityZone: primaryZone
    storage: {
      storageSizeGB: storageGb
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: haMode == 'ZoneRedundant'
      ? {
          mode: 'ZoneRedundant'
          standbyAvailabilityZone: standbyZone
        }
      : {
          mode: haMode
        }
    network: {
      publicNetworkAccess: publicAccess ? 'Enabled' : 'Disabled'
    }
  }
}

// Firewall rules only apply while the public endpoint is enabled.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (publicAccess) {
  name: 'allow-azure-services'
  parent: postgres
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource clientRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [
  for ip in (publicAccess ? allowedClientIps : []): {
    name: ip.name
    parent: postgres
    properties: {
      startIpAddress: ip.startIp
      endIpAddress: ip.endIp
    }
  }
]

// Private endpoint — created only when going private. Adding/removing this (and
// flipping publicNetworkAccess above) is an in-place update; the server and its
// data are untouched.
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (!publicAccess) {
  name: 'pe-${serverName}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'pe-${serverName}'
        properties: {
          privateLinkServiceId: postgres.id
          groupIds: ['postgresqlServer']
        }
      }
    ]
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (!publicAccess) {
  name: 'default'
  parent: privateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'postgres'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output fqdn string = postgres.properties.fullyQualifiedDomainName
output serverId string = postgres.id
