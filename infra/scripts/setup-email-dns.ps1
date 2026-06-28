#requires -Version 5
<#
.SYNOPSIS
  Apply the ACS custom-domain verification records to the delegated Azure DNS zone
  and trigger verification.

.DESCRIPTION
  Run this AFTER:
    1. the parent-domain owner has delegated the subdomain (NS records), and
    2. the phase-1 bicep deploy has created the ACS custom domain (deployEmail=true,
       acsCustomDomainReady=false).

  It reads the verification records ACS generated for the domain, upserts the
  matching TXT/CNAME record-sets into the Azure DNS zone (additive — it never
  clobbers the existing A / asuid / SOA / NS records), then asks ACS to verify
  each record type. Idempotent: safe to re-run while DNS propagates.

  After it reports Domain/SPF/DKIM/DKIM2 = Verified, run the phase-2 deploy
  (acsCustomDomainReady=true) and restart the backend container app.

.EXAMPLE
  ./setup-email-dns.ps1
#>
param(
  [string]$AcsResourceGroup     = 'sloms',
  [string]$EmailServiceName     = 'sloms-email',
  [string]$Domain               = 'portal.soniclabs.co.uk',
  [string]$DnsZoneResourceGroup = 'sloms-prod',
  [string]$DnsZoneName          = 'portal.soniclabs.co.uk'
)

$ErrorActionPreference = 'Stop'

function Convert-ToRelativeName([string]$fqdn, [string]$zone) {
  $f = $fqdn.TrimEnd('.')
  if ($f -ieq $zone) { return '@' }
  if ($f.ToLower().EndsWith(".$($zone.ToLower())")) {
    return $f.Substring(0, $f.Length - $zone.Length - 1)
  }
  return $f   # already relative
}

Write-Host "Reading ACS verification records for $Domain ..." -ForegroundColor Cyan
$json = az communication email domain show `
  --resource-group $AcsResourceGroup `
  --email-service-name $EmailServiceName `
  --name $Domain `
  --query verificationRecords -o json
if (-not $json) { throw "Could not read verificationRecords. Has the phase-1 deploy created the '$Domain' domain under '$EmailServiceName'?" }
$vr = $json | ConvertFrom-Json

# ACS returns: domain (TXT ownership), spf (TXT), dkim (CNAME), dkim2 (CNAME).
$txt   = @($vr.domain, $vr.spf) | Where-Object { $_ }
$cname = @($vr.dkim, $vr.dkim2) | Where-Object { $_ }

foreach ($r in $txt) {
  $name = Convert-ToRelativeName $r.name $DnsZoneName
  Write-Host "TXT  $name  <= `"$($r.value)`"" -ForegroundColor Yellow
  # Ensure the record-set exists, then add the value only if missing (idempotent).
  az network dns record-set txt create -g $DnsZoneResourceGroup -z $DnsZoneName -n $name --ttl 3600 2>$null | Out-Null
  $existing = az network dns record-set txt show -g $DnsZoneResourceGroup -z $DnsZoneName -n $name `
    --query "txtRecords[].value[]" -o tsv 2>$null
  if ($existing -notcontains $r.value) {
    az network dns record-set txt add-record -g $DnsZoneResourceGroup -z $DnsZoneName -n $name -v $r.value | Out-Null
  }
}

foreach ($r in $cname) {
  $name = Convert-ToRelativeName $r.name $DnsZoneName
  Write-Host "CNAME $name  => $($r.value)" -ForegroundColor Yellow
  az network dns record-set cname set-record -g $DnsZoneResourceGroup -z $DnsZoneName -n $name -c $r.value.TrimEnd('.') | Out-Null
}

Write-Host "`nTriggering ACS verification (DNS may take a few minutes to propagate) ..." -ForegroundColor Cyan
foreach ($type in 'Domain','SPF','DKIM','DKIM2') {
  Write-Host "  verify $type" -ForegroundColor Yellow
  az communication email domain initiate-verification `
    --resource-group $AcsResourceGroup --email-service-name $EmailServiceName `
    --name $Domain --verification-type $type 2>$null | Out-Null
}

Write-Host "`nCurrent verification status:" -ForegroundColor Cyan
az communication email domain show `
  --resource-group $AcsResourceGroup --email-service-name $EmailServiceName `
  --name $Domain --query verificationStates -o jsonc

Write-Host "`nRe-run this script until all four show 'Verified', then deploy phase 2 (acsCustomDomainReady=true)." -ForegroundColor Green
