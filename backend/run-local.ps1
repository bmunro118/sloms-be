# SLOMS API - Local Docker Build & Run
# Builds the image, starts postgres + app via docker-compose, polls until
# ready, runs health checks, then leaves everything running.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1          # reuse existing DB volume
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1 -Fresh   # wipe DB and start clean

param(
    [string]$containerName = "sloms-app",
    [int]   $startupWait  = 90,
    [int]   $port         = 3000,
    [switch]$Fresh,
    [switch]$Seed          # seed without wiping the volume
)

$baseUrl = "http://localhost:$port"

function Write-Status  { param([string]$m); Write-Host "[INFO]    $m" -ForegroundColor Cyan }
function Write-Success { param([string]$m); Write-Host "[OK]      $m" -ForegroundColor Green }
function Write-Fail    { param([string]$m); Write-Host "[FAIL]    $m" -ForegroundColor Red }
function Write-Section {
    param([string]$m)
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $m" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

# --- 1. Build ---
Write-Section "Building Docker Image"
docker build -t slomsapi:latest .
if ($LASTEXITCODE -ne 0) { Write-Fail "Docker build failed"; exit 1 }
Write-Success "Image built: slomsapi:latest"

# --- 2. Start stack ---
Write-Section "Starting Stack (postgres + app)"

# Check if containers are already running and clean them up first
$existingApp = docker ps --filter "name=$containerName" --format "{{.Names}}" | Select-String "^$containerName$" -Quiet
if ($existingApp) {
    Write-Status "Container '$containerName' is already running, stopping it..."
    docker stop $containerName 2>$null | Out-Null
    docker rm $containerName 2>$null | Out-Null
}

# Check if postgres container exists and clean up
$existingPostgres = docker ps --filter "name=sloms-postgres" --format "{{.Names}}" | Select-String "^sloms-postgres$" -Quiet
if ($existingPostgres) {
    Write-Status "Container 'sloms-postgres' is already running, stopping it..."
    docker stop sloms-postgres 2>$null | Out-Null
    docker rm sloms-postgres 2>$null | Out-Null
}

if ($Fresh) {
    Write-Status "Fresh flag set - removing existing volumes (database will be recreated)..."
    docker-compose down --volumes --remove-orphans 2>$null | Out-Null
    Write-Success "Volumes removed"
} else {
    docker-compose down --remove-orphans 2>$null | Out-Null
}
docker-compose up -d
if ($LASTEXITCODE -ne 0) { Write-Fail "docker-compose up failed"; exit 1 }
Write-Success "Stack started"

# --- 3. Poll until ready ---
Write-Section "Waiting for Application"
$ready   = $false
$elapsed = 0
Write-Status "Polling $baseUrl/api/docs (up to $startupWait s)..."
while (-not $ready -and $elapsed -lt $startupWait) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl/api/docs" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true }
    } catch { }
    if (-not $ready) { Write-Status "  not ready ($elapsed s)..." }
}
if ($ready) {
    Write-Success "Application ready after $elapsed s"
} else {
    Write-Fail "Application did not become ready within $startupWait s"
    Write-Host ""
    Write-Status "App logs:"
    docker logs --tail 30 $containerName
    exit 1
}

# --- 4. Seed ---
if ($Fresh -or $Seed) {
    Write-Section "Seeding Database"
    $seedFile = Join-Path $PSScriptRoot "prisma\seed.sql"
    if (-not (Test-Path $seedFile)) {
        Write-Fail "Seed file not found: $seedFile"
    } else {
        Get-Content $seedFile -Raw | docker exec -i sloms-postgres psql -U postgres -d slomsdb
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Seed failed"
        } else {
            Write-Success "Database seeded from prisma/seed.sql"
        }
    }
}

# --- 5. Health checks ---
Write-Section "Health Checks"
$allPassed = $true

function Test-Endpoint {
    param([string]$method, [string]$path, [int]$expectedCode, [string]$body = $null)
    $url = "$baseUrl$path"
    try {
        $p = @{ Method = $method; Uri = $url; TimeoutSec = 10; UseBasicParsing = $true; ErrorAction = "Stop" }
        if ($body) { $p.Body = $body; $p.ContentType = "application/json" }
        $got = (Invoke-WebRequest @p).StatusCode
    } catch {
        # PS5.1 throws on 4xx/5xx — extract the status code from the exception response
        if ($_.Exception.Response) {
            $got = [int]$_.Exception.Response.StatusCode
        } else {
            $got = 0
        }
    }
    if ($got -eq $expectedCode) {
        Write-Success "$method $path => $got"
    } else {
        Write-Fail    "$method $path => $got (expected $expectedCode)"
        $script:allPassed = $false
    }
}

Test-Endpoint "GET"  "/api/docs"       200
Test-Endpoint "GET"  "/api/customers"  401
Test-Endpoint "GET"  "/api/users"      401
Test-Endpoint "POST" "/api/auth/login" 401 '{"username":"nobody","password":"wrong"}'

# --- 6. Log snapshot ---
Write-Section "Recent App Logs"
$containerExists = docker ps --filter "name=$containerName" --format "{{.Names}}" | Select-String "^$containerName$" -Quiet
if ($containerExists) {
    docker logs --tail 15 $containerName
} else {
    Write-Status "Container '$containerName' not found - showing compose logs instead..."
    docker-compose logs --tail 15 app
}

# --- 7. Summary ---
Write-Section "Summary"
$state = docker inspect --format "{{.State.Status}}" $containerName 2>$null
if ($state) {
    Write-Status "Container : $containerName ($state)"
} else {
    Write-Status "Container : $containerName (not found)"
}
Write-Status "Swagger   : $baseUrl/api/docs"
if ($allPassed) {
    Write-Success "All health checks passed - stack is running"
} else {
    Write-Fail "One or more health checks failed"
}
Write-Host ""
Write-Status "To stop: docker-compose down"
