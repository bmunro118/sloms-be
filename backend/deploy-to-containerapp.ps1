# =========================================
 # Azure Container App Deployment Script
 # =========================================
 # This script builds and deploys your Node.js application to Azure Container Apps
 # It uses an external YAML configuration file for the container app spec

 # ==================== Configuration ====================
 $resourceGroup = "sloms-stage"  # Change this!
 $location = "southuk"     # Can be changed, but must match ACR location
 $containerName = "slomsapi-stage"  # Must be globally unique - change this!
 $acrName = "slomsacregistry2026"  # Must be globally unique - change this!
 $imageName = "slomsapi:latest"
 # ==================== End Configuration ====================

 function Write-Status {
     [CmdletBinding()]
     param([string]$message)
     Write-Host "[INFO] $message" -ForegroundColor Cyan
 }

 function Write-Success {
     [CmdletBinding()]
     param([string]$message)
     Write-Host "[SUCCESS] $message" -ForegroundColor Green
 }

 function Write-Error {
     [CmdletBinding()]
     param([string]$message)
     Write-Host "[ERROR] $message" -ForegroundColor Red
 }

 # Check Azure login status
 Write-Status "Checking Azure login..."
 if (-not (az account show --query id -o tsv 2>$null)) {
     Write-Error "Not logged in to Azure. Please run: az login"
     exit 1
 }
 Write-Success "Logged in to Azure!"

 # Check resource group exists
 Write-Status "Checking resource group: $resourceGroup"
 if (-not (az group show --name $resourceGroup --output json 2>$null)) {
     Write-Status "Creating resource group..."
     az group create `
         --name $resourceGroup `
         --location $location | Out-Null
 }
 Write-Success "Resource group ready: $resourceGroup"

 # Check Container Apps environment exists
 Write-Status "Checking for Container Apps environment..."
 $envName = "${containerName}-env"
 if (-not (az containerapp env show --name $envName --resource-group $resourceGroup --output json 2>$null)) {
     Write-Status "Creating Container Apps environment..."
     az containerapp env create `
         --name $envName `
         --resource-group $resourceGroup `
         --location $location | Out-Null
 }

 $envId = az containerapp env show --name $envName --resource-group $resourceGroup --query "id" --output tsv
 Write-Status "Environment ID: $envId"

 # Check ACR exists
 Write-Status "Checking Azure Container Registry: $acrName"
 if (-not (az acr show --name $acrName --resource-group $resourceGroup --output json 2>$null)) {
     Write-Status "Creating ACR..."
     az acr create `
         --name $acrName `
         --resource-group $resourceGroup `
         --sku Basic | Out-Null
 }
 Write-Success "ACR ready: $acrName"

 # Login to ACR if needed
 Write-Status "Logging in to ACR..."
 az acr login --name $acrName 2>$null
 if ($LASTEXITCODE -eq 0) {
     Write-Success "Logged in to ACR"
 } else {
     Write-Error "Failed to log into ACR!"
     exit 1
 }

 # Build Docker image locally (use local build, not Dockerfile)
 Write-Status "Building Docker image locally..."
 docker build -t $imageName .
 if ($LASTEXITCODE -ne 0) {
     Write-Error "Docker build failed!"
     exit 1
 }
 Write-Success "Docker image built"

 # Tag and push to ACR
 $acrLoginServer = az acr show --name $acrName --query "loginServer" --output tsv
 if ([string]::IsNullOrEmpty($acrLoginServer)) {
     Write-Error "Failed to get ACR login server!"
     exit 1
 }
 $dockerImageTag = "$acrLoginServer/$imageName"

 Write-Status "Full image path: $dockerImageTag"
 docker tag $imageName $dockerImageTag

 Write-Status "Pushing image to ACR..."
 docker push $dockerImageTag
 if ($LASTEXITCODE -ne 0) {
     Write-Error "Failed to push image!"
     exit 1
 }
 Write-Success "Image pushed to ACR"

 # Use external YAML configuration file (NOT embedded in script)
 $yamlPath = Join-Path $PSScriptRoot "src/config/containerapp-config.yaml"

 if (-not (Test-Path $yamlPath)) {
      Write-Status "Creating YAML configuration file..."
      Write-Error "Please create src/config/containerapp-config.yaml manually before running this script."
      exit 1
 } else {
     Write-Success "Using existing YAML configuration: $yamlPath"
 }


 # Deploy using az containerapp create with YAML file
 Write-Status "Deploying container to Azure Container App..."
 Write-Status "Using image: slomsapi:latest"
 Write-Status "Environment variables: DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE"

 az containerapp create `
     --resource-group $resourceGroup `
     --name $containerName `
     --yaml $yamlPath

  if ($LASTEXITCODE -eq 0) {
      Write-Success "Deployment initiated!"

     # Wait for deployment to complete
     Write-Status("Waiting for container app to be ready...")
     Start-Sleep -Seconds 30

     # Show deployment status
     Write-Status("Container app configuration:")
     az containerapp show --name $containerName --resource-group $resourceGroup --query "{state:properties.provisioningState,replicas:properties.rollingUpdate.replicas}" --output table

     # Get ingress endpoint URL
     $fqdn = az containerapp show --name $containerName --resource-group $resourceGroup --query "properties.configuration.fqdn" --output tsv 2>$null
     if ($fqdn) {
         Write-Success("Access URL: http://${fqdn}:3000")
     } else {
         Write-Status("Container App is being provisioned. Check logs for status.")
     }

 } else {
     Write-Error("Deployment failed!")

     # Show deployment events (for debugging)
     Write-Status("Getting container app events...")
     az containerapp show --name $containerName --resource-group $resourceGroup --query properties.provisioningState --output tsv 2>$null

     if ($LASTEXITCODE -ne 0) {
         az containerapp show --name $containerName --resource-group $resourceGroup | Select-Object -ExpandProperty properties | ConvertTo-Json
     }

     # Get logs for debugging
     Write-Status("Getting container logs...")
     az containerapp logs --name $containerName --resource-group $resourceGroup 2>$null

     exit 1
 }
