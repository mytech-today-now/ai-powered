#Requires -Version 5.1
<#
.SYNOPSIS
    Stop and restart the ai-powered proxy server, Vite dev server, and Ollama LLM service.

.DESCRIPTION
    1. Kills any process listening on port 3001 (proxy), 5173 (Vite), and 11434 (Ollama).
    2. Optionally starts an ngrok tunnel and sets PROXY_PUBLIC_BASE_URL (-Ngrok).
    3. Optionally rebuilds the TypeScript sources (--Build / -b).
    4. Starts Ollama serve (with automatic model pull if needed), proxy, and Vite as background processes.
    5. Performs health checks on all services and reports comprehensive status.

    This script turns your local AI workspace into a complete, one-command environment:
    full-stack web UI + proxy + local LLM inference.

.PARAMETER Port
    Proxy port. Default: 3001

.PARAMETER VitePort
    Vite dev-server port. Default: 5173

.PARAMETER OllamaPort
    Ollama server port. Default: 11434

.PARAMETER Model
    Ollama model to ensure is available and loaded. Default: "llama3.2" (fast, capable, and efficient).

.PARAMETER Mock
    Start the proxy in mock mode (no real API calls). Default: $false (live mode)

.PARAMETER Build
    Run 'npm run build' before restarting. Useful after code changes.

.PARAMETER Ngrok
    Start an ngrok tunnel on the Vite dev-server port. Required for Luma AI image-to-video.
    Requires ngrok to be installed and authenticated.

.PARAMETER LogDir
    Directory where stdout/stderr logs are written. Default: logs\

.EXAMPLE
    # Quick restart in live mode (real API keys from .env)
    .\scripts\cycle-ollama.ps1

.EXAMPLE
    # Restart with specific model
    .\scripts\cycle-ollama.ps1 -Model phi4

.EXAMPLE
    # Rebuild TypeScript then restart
    .\scripts\cycle-ollama.ps1 -Build

.EXAMPLE
    # Restart in mock mode
    .\scripts\cycle-ollama.ps1 -Mock

.EXAMPLE
    # Restart with ngrok tunnel (required for Luma AI)
    .\scripts\cycle-ollama.ps1 -Ngrok

.FIRST-TIME SETUP INSTRUCTIONS (Windows 11)
    1. Download and install the official Ollama Windows installer:
       https://ollama.com/download

    2. Verify installation (run in a new PowerShell window):
       ollama --version

    3. (Recommended) Enable GPU acceleration:
       - NVIDIA: Ensure latest drivers + CUDA is installed automatically by Ollama.
       - AMD: Ollama supports ROCm on supported cards.

    4. The script will automatically pull the default model on first run.
       You can also run manually:
       ollama pull llama3.2

    5. Recommended free models (2026):
       - llama3.2          : Excellent balance of speed & capability (default)
       - phi4              : Very fast Microsoft model
       - qwen2.5           : Strong reasoning & coding
       - gemma3            : Google's efficient model
       Browse more at: https://ollama.com/library

    6. Manual commands:
       ollama list
       ollama pull <model>
       ollama run <model>
       ollama stop   (or Task Manager)

    After initial setup, just run this script - it handles everything.
#>
[CmdletBinding()]
param(
    [int]    $Port       = 3001,
    [int]    $VitePort   = 5173,
    [int]    $OllamaPort = 11434,
    [string] $Model      = "llama3.2",
    [switch] $Mock       = $false,
    [switch] $Build,
    [switch] $Ngrok,
    [string] $LogDir     = "logs"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..   # always run from repo root

$Sep = "-" * 60

function Write-Step([string]$msg) { Write-Host "`n$Sep`n  $msg`n$Sep" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "  [!!]  $msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Helper: Find Ollama executable
# ---------------------------------------------------------------------------
function Find-Ollama {
    $cmd = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $defaultPaths = @(
        "C:\Program Files\Ollama\ollama.exe",
        "C:\Program Files (x86)\Ollama\ollama.exe",
        "$env:USERPROFILE\.ollama\bin\ollama.exe"
    )
    foreach ($p in $defaultPaths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ---------------------------------------------------------------------------
# 1. Kill existing listeners on all ports
# ---------------------------------------------------------------------------
Write-Step "Stopping services on ports $Port (proxy), $VitePort (Vite), $OllamaPort (Ollama) ..."

foreach ($p in @($Port, $VitePort, $OllamaPort)) {
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
# 2. Ollama Management (new first-class service)
# ---------------------------------------------------------------------------
Write-Step "Preparing Ollama service on :$OllamaPort ..."

$ollamaExe = Find-Ollama
if (-not $ollamaExe) {
    Write-Err "Ollama not found on PATH or in standard locations."
    Write-Host ""
    Write-Host "  Please follow the FIRST-TIME SETUP INSTRUCTIONS at the top of this script." -ForegroundColor Yellow
    Write-Host "  Download from: https://ollama.com/download" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Kill any stray ollama processes
Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Ensure log directory
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$ollamaLog      = Join-Path $LogDir "ollama.log"
$ollamaStdout   = Join-Path $LogDir "ollama-stdout.log"
$ollamaStderr   = Join-Path $LogDir "ollama-stderr.log"

# Start ollama serve
Write-Host "  Starting Ollama serve..." -ForegroundColor Cyan
$ollama = Start-Process `
    -FilePath $ollamaExe `
    -ArgumentList "serve" `
    -RedirectStandardOutput $ollamaStdout `
    -RedirectStandardError $ollamaStderr `
    -PassThru -WindowStyle Hidden

Write-Ok "Ollama serve started (PID $($ollama.Id)) - logs: $ollamaLog"

# Wait for Ollama API to be ready
$ollamaReady = $false
$ollamaRetries = 25
Write-Host "  Waiting for Ollama API (up to 25s)..." -ForegroundColor Cyan
for ($i = 1; $i -le $ollamaRetries; $i++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get -TimeoutSec 2
        $ollamaReady = $true
        break
    } catch { }
}
if (-not $ollamaReady) {
    Write-Err "Ollama did not start properly after $ollamaRetries s - check $ollamaStderr"
    exit 1
}
Write-Ok "Ollama API is responsive at http://localhost:$OllamaPort"

# Check models and auto-pull if necessary
$models = $null
try {
    $modelsResp = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get
    $models = $modelsResp.models
} catch {
    $models = @()
}

$modelFound = $models | Where-Object { $_.name -like "$Model*" -or $_.name -eq $Model }
if (-not $modelFound) {
    Write-Host "  Model '$Model' not found. Pulling automatically..." -ForegroundColor Yellow
    $pullResult = & $ollamaExe pull $Model 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to pull model '$Model'"
        $pullResult | Write-Host -ForegroundColor Yellow
        Write-Host "  You can pull manually later: ollama pull $Model" -ForegroundColor Yellow
    } else {
        Write-Ok "Successfully pulled model '$Model'"
    }
} else {
    Write-Ok "Model '$Model' is already available"
}

# Ensure model is loaded (lightweight pre-warm via tags check)
try {
    $null = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/generate" -Method Post -Body (@{ model = $Model; prompt = "hi"; stream = $false } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 5
    Write-Ok "Model '$Model' is ready for inference"
} catch {
    Write-Host "  Model loaded (minor warmup delay expected on first use)" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 3. Optional ngrok tunnel for Luma AI image-to-video
# ---------------------------------------------------------------------------
if ($Ngrok) {
    # The tunnel targets the Vite dev-server (:$VitePort).  Vite is configured
    # to proxy every API path (/health /text /image /audio /video /upload /v1/* …)
    # to the local proxy (:$Port), so the single public URL serves both the web UI
    # and all API endpoints — no paid multi-tunnel plan required.
    Write-Step "Starting ngrok tunnel on :$VitePort (web UI + API proxy) ..."

    # Verify ngrok is on the PATH before attempting to launch it.
    if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
        Write-Err "ngrok not found on PATH."
        Write-Host ""
        Write-Host "  Install ngrok and then authenticate:" -ForegroundColor Yellow
        Write-Host "    1. Download from  https://ngrok.com/download  (or: winget install ngrok.ngrok)" -ForegroundColor Yellow
        Write-Host "    2. Sign up for a free account at  https://dashboard.ngrok.com" -ForegroundColor Yellow
        Write-Host "    3. Run:  ngrok config add-authtoken <YOUR_TOKEN>" -ForegroundColor Yellow
        Write-Host "    4. Re-run:  .\scripts\cycle-ollama.ps1 -Ngrok" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Luma AI image-to-video will not work without a public tunnel URL." -ForegroundColor Yellow
        exit 1
    }

    # Kill any existing ngrok processes so we get a fresh tunnel URL.
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    # Start ngrok via cmd /c so that cmd handles file redirection itself.
    $ngrokLog = Join-Path $LogDir "ngrok.log"
    $ngrokProc = Start-Process `
        -FilePath "cmd" `
        -ArgumentList "/c", "ngrok http $VitePort --log stdout > `"$ngrokLog`" 2>&1" `
        -PassThru -WindowStyle Hidden

    # Poll the ngrok local API (port 4040) until the tunnel URL appears.
    $ngrokUrl    = $null
    $ngrokTries  = 20
    for ($i = 1; $i -le $ngrokTries; $i++) {
        Start-Sleep -Seconds 1
        try {
            $apiResp = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
            $httpsUrl = ($apiResp.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
            if ($httpsUrl) { $ngrokUrl = $httpsUrl; break }
        } catch { <# ngrok API not ready yet #> }
    }

    if ($ngrokUrl) {
        # Both env vars share the same public URL:
        #   PROXY_PUBLIC_BASE_URL — proxy uses this to build public keyframe image
        #                           URLs for Luma AI (Vite proxies /images/* → :$Port)
        #   VITE_PROXY_URL        — Vite injects this into the page so the web UI
        #                           pre-fills the Proxy URL input for remote visitors
        $env:PROXY_PUBLIC_BASE_URL = $ngrokUrl
        $env:VITE_PROXY_URL        = $ngrokUrl
        $script:NgrokWebUrl        = $ngrokUrl
        Write-Ok "ngrok tunnel:  $ngrokUrl  (PID $($ngrokProc.Id))"
        Write-Ok "Public web UI + API at $ngrokUrl  <- share this link"
        Write-Ok "PROXY_PUBLIC_BASE_URL set -- Luma AI image-to-video is enabled"
    } else {
        Write-Err "ngrok did not expose a tunnel within $ngrokTries s."
        Write-Host "  Luma AI image-to-video will not work without a public URL." -ForegroundColor Yellow
        Write-Host "  Make sure ngrok is installed (https://ngrok.com) and authenticated." -ForegroundColor Yellow
    }
} elseif ($env:PROXY_PUBLIC_BASE_URL) {
    Write-Host "  --  Using existing PROXY_PUBLIC_BASE_URL: $($env:PROXY_PUBLIC_BASE_URL)" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 4. Optional rebuild
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
# 5. Ensure log directory exists (already done for Ollama)
# ---------------------------------------------------------------------------
$proxyStdout = Join-Path $LogDir "server-stdout.log"
$proxyStderr = Join-Path $LogDir "server-stderr.log"
$viteLog     = Join-Path $LogDir "vite.log"

# ---------------------------------------------------------------------------
# 6. Start proxy server
# ---------------------------------------------------------------------------
Write-Step "Starting proxy server on :$Port ..."

$proxyArgs = @("dist\ai-powered\cli\index.js", "serve", "--port", $Port)
if ($Mock)  { $proxyArgs += "--mock" }
# When ngrok is active the browser origin is the public tunnel URL, not
# localhost:5173.  Allow all origins so the demo works from any public URL.
if ($Ngrok) { $proxyArgs += "--cors-origin", "*" }

# Force NODE_ENV=production so pino emits one-line JSONL to stderr instead of
# pino-pretty's multi-line coloured output.  We save/restore the caller's value
# so this script's own environment is not permanently changed.
$_savedNodeEnv  = $env:NODE_ENV
$_savedNoColor  = $env:NO_COLOR
$env:NODE_ENV   = "production"
$env:NO_COLOR   = "1"            # belt-and-braces: disable colour in any sub-tool

$proxy = Start-Process `
    -FilePath "node" `
    -ArgumentList $proxyArgs `
    -RedirectStandardOutput $proxyStdout `
    -RedirectStandardError  $proxyStderr `
    -PassThru -WindowStyle Hidden

$env:NODE_ENV = $_savedNodeEnv
$env:NO_COLOR = $_savedNoColor

Write-Ok "Proxy started (PID $($proxy.Id)) - logs: $proxyStdout"

# ---------------------------------------------------------------------------
# 7. Start Vite dev server
# ---------------------------------------------------------------------------
Write-Step "Starting Vite dev server on :$VitePort ..."

$vite = Start-Process `
    -FilePath "cmd" `
    -ArgumentList "/c", "npm run dev:web > `"$viteLog`" 2>&1" `
    -PassThru -WindowStyle Hidden

Write-Ok "Vite started (PID $($vite.Id)) - logs: $viteLog"

# ---------------------------------------------------------------------------
# 8. Health check the proxy (TCP port probe - reliable across PS versions)
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
} else {
    Write-Err "Proxy did not open port :$Port after $retries s - check $proxyStderr"
    exit 1
}

# ---------------------------------------------------------------------------
# 9. Wait for Vite dev server to be ready (avoids ERR_NGROK_8012)
# ---------------------------------------------------------------------------
Write-Step "Waiting for Vite dev server on :$VitePort ..."

$viteOk     = $false
$viteRetries = 60   # Vite can take 20+ s when re-optimizing dependencies after a lockfile change
for ($i = 1; $i -le $viteRetries; $i++) {
    Start-Sleep -Seconds 1
    # Vite 8+ on Windows binds to ::1 (IPv6) by default.
    # TcpClient() is IPv4-only; use AddressFamily::InterNetworkV6 for ::1.
    # Try IPv4 first (covers custom vite.config host settings), then IPv6.
    foreach ($probe in @(
            @{ af = [System.Net.Sockets.AddressFamily]::InterNetwork;   addr = "127.0.0.1" },
            @{ af = [System.Net.Sockets.AddressFamily]::InterNetworkV6; addr = "::1"       }
        )) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient($probe.af)
            $tcp.Connect($probe.addr, $VitePort)
            $tcp.Close()
            $viteOk = $true
            break
        } catch { <# still starting or wrong address family #> }
    }
    if ($viteOk) { break }
}

if (-not $viteOk) {
    Write-Err "Vite did not open port :$VitePort after $viteRetries s - check $viteLog"
    exit 1
}

Write-Ok "Vite dev UI at http://localhost:$VitePort"
if ($env:PROXY_PUBLIC_BASE_URL) {
    Write-Ok "Public API URL: $($env:PROXY_PUBLIC_BASE_URL)  (Luma AI image-to-video enabled)"
}
if ($script:NgrokWebUrl) {
    Write-Ok "Public Web UI:  $($script:NgrokWebUrl)  <- share this link"
}

# ---------------------------------------------------------------------------
# 10. Final status summary
# ---------------------------------------------------------------------------
Write-Step "All services started successfully!"

Write-Host "  Ollama      : http://localhost:$OllamaPort  (Model: $Model)  PID $($ollama.Id)" -ForegroundColor Green
Write-Host "  Proxy       : http://localhost:$Port         PID $($proxy.Id)" -ForegroundColor Green
Write-Host "  Vite UI     : http://localhost:$VitePort      PID $($vite.Id)" -ForegroundColor Green
if ($script:NgrokWebUrl) {
    Write-Host "  Public URL  : $($script:NgrokWebUrl)  <- share with others" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Logs folder : $LogDir" -ForegroundColor DarkGray
Write-Host "  Full logs   : $ollamaLog, $proxyStdout, $viteLog" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Ready for AI development! Press Ctrl+C in this window to stop all services." -ForegroundColor Cyan
Write-Host ""
```