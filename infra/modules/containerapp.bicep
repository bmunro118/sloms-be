// =============================================================================
// Reusable Container App (backend or frontend).
//
//  - User-assigned managed identity for ACR pull + Key Vault secret refs
//  - KV-backed secrets resolved at runtime (no secrets stored in the app)
//  - minReplicas >= 1 (kept warm; no scale-to-zero cold starts)
//
// `secrets`  : [{ name, keyVaultUrl }]            -> Key Vault references
// `envVars`  : [{ name, value } | { name, secretRef }]
// =============================================================================

param location string
param tags object
param name string
param environmentId string
param image string
param targetPort int
param cpu string
param memory string
param minReplicas int
param maxReplicas int
param uamiId string
param acrLoginServer string
param secrets array
param envVars array

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uamiId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: [
        for s in secrets: {
          name: s.name
          keyVaultUrl: s.keyVaultUrl
          identity: uamiId
        }
      ]
      registries: [
        {
          server: acrLoginServer
          identity: uamiId
        }
      ]
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'Auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: envVars
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output appId string = app.id
