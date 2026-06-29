# ============================================================================
# SLOMS API Deployment to Azure Container Apps
# ============================================================================
# This script deploys the SLOMS API to Azure Container Apps with proper
# database connection configuration. Secrets are passed securely via the
# Container Apps secrets mechanism.
#
# Run with: powershell -ExecutionPolicy Bypass -File .\deploy-to-aci.ps1
# ============================================================================

param(
    [string]$resourceGroup = "sloms-stage",
    [string]$location = "uksouth",
    [string]$containerName = "slomsapi-stage",
    [string]$acrName = "slomsacregistry2026",
    [string]$environmentName = "slomsapi-stage-env"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "SLOMS API Azure Container Apps Deployment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Helper functions
function Write-Status { param([string]$message); Write-Host "[INFO] $message" -ForegroundColor Cyan }
function Write-Success { param([string]$message); Write-Host "[SUCCESS] $message" -ForegroundColor Green }
function Write-Err { param([string]$message); Write-Host "[ERROR] $message" -ForegroundColor Red; exit 1 }

# Check Azure login
Write-Status "Checking Azure login..."
if (-not (az account show --query "id" -o tsv 2>$null)) {
    Write-Status "Logging in to Azure..."
    az login --use-device-code 2>&1 | Out-Null
}

# Create resource group if needed
Write-Status "Checking resource group: $resourceGroup"
if (-not (az group show --name $resourceGroup -o tsv 2>$null)) {
    Write-Status "Creating resource group..."
    az group create --name $resourceGroup --location $location --output none
}
Write-Success "Resource group ready: $resourceGroup"

# Register required providers
Write-Status "Checking resource providers..."
$providers = @("Microsoft.ContainerRegistry", "Microsoft.App", "Microsoft.OperationalInsights")
foreach ($provider in $providers) {
    $state = az provider show --name $provider --query "registrationState" -o tsv 2>$null
    if ($state -ne "Registered") {
        Write-Status "Registering $provider..."
        az provider register --namespace $provider | Out-Null
        Start-Sleep -Seconds 10
    }
}

# Create ACR if needed
Write-Status "Checking Azure Container Registry: $acrName"
if (-not (az acr show --name $acrName --resource-group $resourceGroup -o tsv 2>$null)) {
    Write-Status "Creating ACR..."
    az acr create --name $acrName --resource-group $resourceGroup --sku Basic --admin-enabled true --output none
}
Write-Success "ACR ready: $acrName"

Start-Sleep -Seconds 5

# Login to ACR
Write-Status "Logging in to ACR..."
az acr login --name $acrName 2>&1 | Out-Null
Write-Success "Logged in to ACR"

# Build Docker image locally
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Building Docker Image" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Use a timestamp tag so Azure always detects a new image and creates a new revision.
# :latest alone causes Azure to skip the revision update when the tag hasn't changed.
$imageTag = (Get-Date -Format "yyyyMMdd-HHmmss")
Write-Status "Image tag: $imageTag"

docker build -t slomsapi:latest -t "slomsapi:$imageTag" .
if ($LASTEXITCODE -ne 0) { Write-Err "Docker build failed!" }
Write-Success "Docker image built successfully"

# Tag and push to ACR
$acrLoginServer = az acr show --name $acrName --query loginServer -o tsv
Write-Status "ACR login server: $acrLoginServer"
if ([string]::IsNullOrEmpty($acrLoginServer)) {
    Write-Err "Failed to get ACR login server!"
}
$aciImageName = "$acrLoginServer/slomsapi:$imageTag"
Write-Status "Full image path: $aciImageName"
docker tag "slomsapi:$imageTag" $aciImageName

Write-Host "[INFO] Pushing image to ACR..." -ForegroundColor Yellow
docker push $aciImageName
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to push image!" }
Write-Success "Image pushed to ACR"

# Verify image exists in ACR
Write-Status "Verifying image in ACR..."
az acr repository show --name $acrName --image "slomsapi:latest" | Out-Null

# Get ACR credentials
$acrUsername = az acr credential show --name $acrName --query username -o tsv
$acrPassword = az acr credential show --name $acrName --query passwords[0].value -o tsv
Write-Status "ACR username: $acrUsername"

# Load production environment variables from .env.prod
Write-Status "Loading production config from .env.prod..."
$envProdPath = Join-Path $PSScriptRoot ".env.prod"
if (-not (Test-Path $envProdPath)) {
    Write-Err ".env.prod not found at $envProdPath - cannot deploy without production config"
}
$envVars = @{}
Get-Content $envProdPath | Where-Object { $_ -match "^\s*[A-Za-z_][A-Za-z0-9_]*=" } | ForEach-Object {
    $parts = $_ -split "=", 2
    $envVars[$parts[0].Trim()] = $parts[1].Trim()
}
$prodDatabaseUrl = $envVars["DATABASE_URL"]
$prodPgHost      = $envVars["PGHOST"]
$prodPgPort      = $envVars["PGPORT"]
$prodPgUser      = $envVars["PGUSER"]
$prodJwtSecret   = $envVars["JWT_SECRET"]
$prodJwtExpires  = $envVars["JWT_EXPIRES_IN"]

if ([string]::IsNullOrEmpty($prodDatabaseUrl)) {
    Write-Err "DATABASE_URL not found in .env.prod"
}
Write-Success "Production config loaded"

# Create Container Apps Environment if needed
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Deploying to Azure Container Apps" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Write-Status "Checking Container Apps environment: $environmentName"
if (-not (az containerapp env show --name $environmentName --resource-group $resourceGroup -o tsv 2>$null)) {
    Write-Status "Creating Container Apps environment..."
    az containerapp env create `
        --name $environmentName `
        --resource-group $resourceGroup `
        --location $location `
        --output none
    Write-Success "Container Apps environment created"
}
Write-Success "Environment ready: $environmentName"

# Get subscription ID and environment resource ID
$subscriptionId = az account show --query "id" -o tsv
$envResourceId = az containerapp env show `
    --name $environmentName `
    --resource-group $resourceGroup `
    --query "id" -o tsv 2>$null
if ([string]::IsNullOrEmpty($envResourceId)) {
    Write-Err "Could not resolve resource ID for environment '$environmentName'"
}

# Build container app definition as a PowerShell object, then ConvertTo-Json.
# This safely handles special characters (@, ?, =) in secret values without
# any shell quoting issues - the az REST API extension sends this as-is.
$appBody = @{
    location   = $location
    properties = @{
        managedEnvironmentId = $envResourceId
        configuration        = @{
            secrets    = @(
                @{ name = "registry-password"; value = $acrPassword }
                @{ name = "jwt-secret";        value = $prodJwtSecret }
                @{ name = "database-url";      value = $prodDatabaseUrl }
            )
            registries = @(
                @{
                    server            = $acrLoginServer
                    username          = $acrUsername
                    passwordSecretRef = "registry-password"
                }
            )
            ingress    = @{
                external    = $true
                targetPort  = 3000
                transport   = "Auto"
            }
        }
        template             = @{
            containers = @(
                @{
                    image     = $aciImageName
                    name      = $containerName
                    resources = @{ cpu = 0.5; memory = "1Gi" }
                    env       = @(
                        @{ name = "NODE_ENV";       value     = "production" }
                        @{ name = "PGHOST";         value     = $prodPgHost }
                        @{ name = "PGPORT";         value     = $prodPgPort }
                        @{ name = "PGUSER";         value     = $prodPgUser }
                        @{ name = "JWT_EXPIRES_IN"; value     = $prodJwtExpires }
                        @{ name = "JWT_SECRET";     secretRef = "jwt-secret" }
                        @{ name = "DATABASE_URL";   secretRef = "database-url" }
                    )
                }
            )
            scale      = @{ minReplicas = 0; maxReplicas = 10 }
        }
    }
}
$appJson = $appBody | ConvertTo-Json -Depth 20 -Compress
$apiUrl = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.App/containerApps/$containerName`?api-version=2026-01-01"

# Write JSON to a temp file - passing JSON inline on Windows strips the quotes
$tempJson = [System.IO.Path]::GetTempPath() + "containerapp-deploy.json"
[System.IO.File]::WriteAllText($tempJson, $appJson, [System.Text.UTF8Encoding]::new($false))

# Deploy or update Container App via az rest (bypasses containerapp extension bugs)
Write-Status "Checking for existing Container App: $containerName"
$existing = az containerapp show --name $containerName --resource-group $resourceGroup --query "name" -o tsv 2>$null

if ($existing) {
    Write-Status "Existing Container App found - updating via REST API..."
} else {
    Write-Status "Creating new Container App via REST API..."
}
try {
    az rest --method PUT --url $apiUrl --body "@$tempJson" --headers "Content-Type=application/json" --output none
} finally {
    Remove-Item -Path $tempJson -Force -ErrorAction SilentlyContinue
}

if ($LASTEXITCODE -eq 0) {
    Write-Success "Deployment initiated!"

    Write-Host ""
    Write-Host "[INFO] Waiting for Container App to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 20

    $fqdn = az containerapp show --name $containerName --resource-group $resourceGroup --query "properties.configuration.ingress.fqdn" -o tsv 2>$null
    $state = az containerapp show --name $containerName --resource-group $resourceGroup --query "properties.runningStatus" -o tsv 2>$null
    Write-Status "Container App state: $state"

    if ($fqdn) {
        Write-Success "Access URL: https://$fqdn"
        Write-Success "Swagger UI: https://$fqdn/api/docs"
    } else {
        Write-Status "FQDN not yet assigned (may take a few more minutes)"
    }
} else {
    Write-Err "Deployment failed!"
}

Write-Success ""
Write-Success "=========================================="
Write-Success "DEPLOYMENT COMPLETE!"
Write-Success "=========================================="
Write-Success ""
Write-Success "Your SLOMS API is now deployed to Azure Container Apps!"
Write-Success ""
Write-Status "Useful Commands:"
Write-Status "  View logs:   az containerapp logs show --name $containerName --resource-group $resourceGroup --follow"
Write-Status "  Restart app: az containerapp revision restart --name $containerName --resource-group $resourceGroup"
Write-Status "  Delete app:  az containerapp delete --name $containerName --resource-group $resourceGroup --yes"

Write-Success ""
Write-Status "Current Status:"
az containerapp show --name $containerName --resource-group $resourceGroup --query "{State:properties.runningStatus, FQDN:properties.configuration.ingress.fqdn}" -o table 2>$null

Write-Success ""
Write-Success "Deployment completed successfully!"
