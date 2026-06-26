// =============================================================================
// Container Apps managed environment — ZONE REDUNDANT.
//
// Zone redundancy requires the environment be deployed into a VNet subnet
// (infrastructureSubnetId). Uses the Consumption workload profile, matching the
// existing apps.
// =============================================================================

param location string
param tags object
param name string
param zoneRedundant bool = true
param infrastructureSubnetId string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    zoneRedundant: zoneRedundant
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

output environmentId string = environment.id
output defaultDomain string = environment.properties.defaultDomain
