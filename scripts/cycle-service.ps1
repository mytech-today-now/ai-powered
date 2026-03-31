#Requires -Version 5.1
<#
.SYNOPSIS
    Stop and restart the ai-powered proxy server and the Vite dev server.

.DESCRIPTION
    1. Kills any process listening on port 3001 (proxy) and 5173 (Vite).
    2. Optionally rebuilds the TypeScript sources (--Build / -b).
    3. Starts both services as background processes.
    4. Health-checks the proxy and reports status.

.PARAMETER Port
    Proxy port. Default: 3001

.PARAMETER VitePort
    Vite dev-server port. Default: 5173

.PARAMETER Mock
    Start the proxy in mock mode (no real API calls). Default: $true

.PARAMETER Build
    Run 'npm run build' before restarting. Useful after code changes.

.PARAMETER LogDir
    Directory where stdout/stderr logs are written. Default: logs\

.EXAMPLE
    # Quick restart (mock mode, no rebuild)
    .\scripts\cycle-service.ps1

.EXAMPLE
    # Rebuild TypeScript then restart in mock mode
    .\scripts\cycle-service.ps1 -Build

.EXAMPLE
    # Restart in live mode (real providers) on custom port
    .\scripts\cycle-service.ps1 -Mock:$false -Port 4001
#>
[CmdletBinding()]
param(
    [int]    $Port     = 3001,
    [int]    $VitePort = 5173,
    [switch] $Mock     = $true,
    [switch] $Build,
    [string] $LogDir   = "logs"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..   # always run from repo root

$Sep = "-" * 60

function Write-Step([string]$msg) { Write-Host "`n$Sep`n  $msg`n$Sep" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "  [!!]  $msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# 1. Kill existing listeners on the two ports
# ---------------------------------------------------------------------------
Write-Step "Stopping services on ports $Port and $VitePort ..."

foreach ($p in @($Port, $VitePort)) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            try {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
                Write-Ok "Killed PID $($c.OwningProcess) on :$p"
            } catch {
                Write-Err "Could not kill PID $($c.OwningProcess) on :$p - $_"
            }
        }
    } else {
        Write-Host "  --  No process found on :$p" -ForegroundColor DarkGray
    }
}

Start-Sleep -Milliseconds 800   # let sockets release

# ---------------------------------------------------------------------------
# 2. Optional rebuild
# ---------------------------------------------------------------------------
if ($Build) {
    Write-Step "Building TypeScript (npm run build) ..."
    $buildResult = & npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build failed - aborting restart."
        $buildResult | Write-Host
        exit 1
    }
    Write-Ok "Build succeeded."
}

# ---------------------------------------------------------------------------
# 3. Ensure log directory exists
# ---------------------------------------------------------------------------
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$proxyStdout = Join-Path $LogDir "server-stdout.log"
$proxyStderr = Join-Path $LogDir "server-stderr.log"
$viteLog     = Join-Path $LogDir "vite.log"

# ---------------------------------------------------------------------------
# 4. Start proxy server
# ---------------------------------------------------------------------------
Write-Step "Starting proxy server on :$Port ..."

$proxyArgs = @("dist\ai-powered\cli\index.js", "serve", "--port", $Port)
if ($Mock) { $proxyArgs += "--mock" }

# Use -WindowStyle Hidden (not -NoNewWindow) so the child process gets its own
# console and is NOT killed when this script's console session ends.
$proxy = Start-Process `
    -FilePath "node" `
    -ArgumentList $proxyArgs `
    -RedirectStandardOutput $proxyStdout `
    -RedirectStandardError  $proxyStderr `
    -PassThru -WindowStyle Hidden

Write-Ok "Proxy started (PID $($proxy.Id)) - logs: $proxyStdout"

# ---------------------------------------------------------------------------
# 5. Start Vite dev server
# ---------------------------------------------------------------------------
Write-Step "Starting Vite dev server on :$VitePort ..."

$vite = Start-Process `
    -FilePath "cmd" `
    -ArgumentList "/c", "npm run dev:web > `"$viteLog`" 2>&1" `
    -PassThru -WindowStyle Hidden

Write-Ok "Vite started (PID $($vite.Id)) - logs: $viteLog"

# ---------------------------------------------------------------------------
# 6. Health check the proxy (TCP port probe - reliable across PS versions)
# ---------------------------------------------------------------------------
Write-Step "Waiting for proxy health check ..."

$ok      = $false
$retries = 15
for ($i = 1; $i -le $retries; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        $ok = $true
        break
    } catch { <# still starting #> }
}

if ($ok) {
    Write-Ok "Proxy is up at http://localhost:$Port"
    Write-Ok "Vite dev UI at http://localhost:$VitePort"
    Write-Ok "Logs: $proxyStdout / $proxyStderr"
} else {
    Write-Err "Proxy did not open port :$Port after $retries s - check $proxyStderr"
    exit 1
}

Write-Host ""

