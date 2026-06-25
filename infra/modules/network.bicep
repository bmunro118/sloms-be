// =============================================================================
// VNet for the prod Container Apps environment + Postgres private endpoint.
//
// - acaSubnet         : infrastructure subnet for the zone-redundant Container
//                       Apps environment. Must be >= /23 and delegated to
//                       Microsoft.App/environments.
// - privateEndpointSubnet : holds the Postgres private endpoint NIC. NOT
//                       delegated; private-endpoint network policies disabled.
//                       Empty until Postgres is switched to private access.
// - private DNS zone  : privatelink.postgres.database.azure.com, linked to the
//                       VNet so the private endpoint's FQDN resolves to a private
//                       IP from inside the network.
// =============================================================================

param location string
param tags object
param vnetName string
param privateDnsZoneName string
param vnetAddressPrefix string
param acaSubnetPrefix string
param privateEndpointSubnetPrefix string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [vnetAddressPrefix]
    }
    subnets: [
      {
        name: 'snet-aca-infra'
        properties: {
          addressPrefix: acaSubnetPrefix
          delegations: [
            {
              name: 'aca-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-privatelink'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// Private DNS zone for the Postgres private endpoint. Harmless while unused.
resource postgresDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: privateDnsZoneName
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  name: 'link-to-${vnetName}'
  parent: postgresDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

output acaSubnetId string = vnet.properties.subnets[0].id
output privateEndpointSubnetId string = vnet.properties.subnets[1].id
output postgresPrivateDnsZoneId string = postgresDnsZone.id
