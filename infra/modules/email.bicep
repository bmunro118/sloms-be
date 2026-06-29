// =============================================================================
// Azure Communication Services — Email (adopts the existing shared resources)
// =============================================================================
// The SLOMS ACS Email resources already exist in the shared `sloms` resource
// group: Communication Services `sloms-acs` and Email service `sloms-email`,
// today linked to the free Azure-managed domain (DoNotReply@<guid>.azurecomm.net).
//
// This module does NOT recreate them — it references them as `existing` and only
// ADDS a custom sending domain + sender, then (phase 2) links the verified domain.
//
// TWO-PHASE because a custom domain must be DNS-verified before it can be linked:
//
//   Phase 1  customDomainReady = false
//     Creates the CustomerManaged domain + sender under `sloms-email`. Azure
//     generates the DNS records immediately — read them from the `verificationRecords`
//     output. Nothing is linked; the managed domain stays the active sender.
//
//   --> add the DNS records at your provider and verify the domain (portal or
//       `az communication email domain initiate-verification`).
//
//   Phase 2  customDomainReady = true
//     Links the now-verified custom domain to `sloms-acs` (keeping the managed
//     domain linked too) and reports the custom From address. The caller then
//     writes that address into Key Vault as acs-sender-address.
//
// This module is deployed at the scope of the `sloms` RG by the caller.
// =============================================================================

@description('Communication Services + Email resources are global.')
param location string = 'global'
param tags object

@description('Existing Communication Services resource name (holds the connection string).')
param communicationServiceName string
@description('Existing Email Communication Services resource name.')
param emailServiceName string
@description('Data-at-rest location of the existing resources (must match — UK).')
param dataLocation string = 'UK'

@description('Custom sending domain to add, e.g. soniclabs.co.uk.')
param customDomain string
@description('Sender mailbox for the custom domain; From becomes <senderUsername>@<customDomain>.')
param senderUsername string = 'noreply'
@description('Display name shown to recipients in the From field.')
param senderDisplayName string = 'SLOMS'
@description('Set true ONLY after the custom domain DNS records are verified. Links the domain to the Communication Service and makes it the active sender.')
param customDomainReady bool = false

// ---------- Existing resources (referenced, never recreated) ----------
resource emailService 'Microsoft.Communication/emailServices@2023-06-01-preview' existing = {
  name: emailServiceName
}

resource managedDomain 'Microsoft.Communication/emailServices/domains@2023-06-01-preview' existing = {
  parent: emailService
  name: 'AzureManagedDomain'
}

// ---------- New: custom sending domain + sender ----------
// Created in both phases so the DNS records exist to read; verification is manual.
resource customManagedDomain 'Microsoft.Communication/emailServices/domains@2023-06-01-preview' = {
  parent: emailService
  name: customDomain
  location: location
  tags: tags
  properties: {
    domainManagement: 'CustomerManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-06-01-preview' = {
  parent: customManagedDomain
  name: senderUsername
  properties: {
    username: senderUsername
    displayName: senderDisplayName
  }
}

// ---------- Phase 2: link the verified custom domain ----------
// Adopts the existing Communication Service to update linkedDomains. Keeps the
// managed domain linked so nothing that used it breaks. Only declared once the
// domain is verified, so phase 1 leaves `sloms-acs` untouched.
resource communicationService 'Microsoft.Communication/communicationServices@2023-06-01-preview' = if (customDomainReady) {
  name: communicationServiceName
  location: location
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      managedDomain.id
      customManagedDomain.id
    ]
  }
}

@description('Address the app should put in the From field. Custom once ready, else the current managed sender.')
output senderAddress string = customDomainReady ? '${senderUsername}@${customDomain}' : 'DoNotReply@${managedDomain.properties.fromSenderDomain}'

@description('DNS records to create + verify for the custom domain (1 ownership TXT, 1 SPF TXT, 2 DKIM CNAMEs).')
output verificationRecords object = customManagedDomain.properties.verificationRecords

@description('The custom domain name.')
output customDomainName string = customDomain
