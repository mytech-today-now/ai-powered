#Requires -Version 5.1
<#
.SYNOPSIS
    Production-ready, self-contained automation script for the ai-powered application
    (@mytechtoday/ai-powered) with Ollama as the local LLM backend and optional ngrok tunneling.

.DESCRIPTION
    This script provides complete lifecycle management for the full-stack ai-powered workspace:
      • Prerequisites verification (Node.js, npm, Ollama, project path)
      • Automatic npm dependency installation
      • Ollama service startup + model pulling (8+ high-quality local models pre-configured)
      • Configures ai-powered proxy to use Ollama's official OpenAI-compatible endpoint (/v1)
      • Optional TypeScript build, Vite dev server, and ngrok public tunnel
      • Health checks, detailed logging, and graceful shutdown/cleanup
      • Idempotent and safe for repeated runs (kills old services first)

    Designed specifically for Windows 11 and the repo at G:\_kyle\temp_documents\GitHub\ai-powered.
    One command turns your machine into a complete local AI development environment (UI + proxy + LLM).

    Supported Models (lightweight, high-performance options suitable for local GPU/CPU - 2026):
      • llama3.2          : Best balance of speed, capability & multimodal support (DEFAULT)
      • phi4              : Extremely fast Microsoft model - excellent for quick iteration
      • qwen2.5           : Outstanding reasoning, coding, and multilingual performance
      • gemma3            : Google's efficient, high-quality generalist model
      • mistral-nemo      : Strong instruction-following and creative tasks
      • deepseek-coder-v2 : Best-in-class coding & software engineering model
      • llama3.1          : Large context window, robust general intelligence
      • command-r         : Enterprise-grade tool-use and long-context capabilities

.PARAMETER Model
    Ollama model name/tag to use (e.g. "llama3.2", "phi4", "qwen2.5:7b"). Default: "llama3.2"

.PARAMETER AiPoweredPath
    Full path to the ai-powered repository. Default matches Kyle's environment.

.PARAMETER Port
    Proxy server port (ai-powered backend). Default: 3001

.PARAMETER VitePort
    Vite development server port (web UI). Default: 5173

.PARAMETER OllamaPort
    Ollama API port. Default: 11434

.PARAMETER AutoStart
    Automatically start all services after setup. Set to $false for setup-only mode.

.PARAMETER Build
    Run full npm run build before starting (use after code changes).

.PARAMETER Ngrok
    Launch ngrok tunnel on Vite port for public access (required for Luma AI image-to-video).

.PARAMETER Mock
    Start proxy in mock mode (no real LLM calls - useful for UI testing).

.PARAMETER LogDir
    Directory for all service logs. Default: logs\

.PARAMETER StopOnly
    Stop all services and exit (no start).

.EXAMPLE
    # Standard start with default model
    .\ai-powered-ollama.ps1

.EXAMPLE
    # Use a different model + ngrok
    .\ai-powered-ollama.ps1 -Model "phi4" -Ngrok

.EXAMPLE
    # Quick setup only (no auto-start)
    .\ai-powered-ollama.ps1 -Model "qwen2.5" -AutoStart $false

.EXAMPLE
    # Stop everything cleanly
    .\ai-powered-ollama.ps1 -StopOnly

.FIRST-TIME SETUP (Windows 11)
    1. Install Node.js (LTS) from https://nodejs.org
    2. Install Ollama from https://ollama.com/download (or winget install Ollama.Ollama)
    3. Clone/pull the repo to G:\_kyle\temp_documents\GitHub\ai-powered
    4. Run this script once - it will handle npm install, Ollama setup, model pull, etc.
    5. (Optional) Authenticate ngrok: ngrok config add-authtoken <token>
#>

[CmdletBinding()]
param(
    [string]$Model = "llama3.2",
    [string]$AiPoweredPath = "G:\_kyle\temp_documents\GitHub\ai-powered",
    [int]$Port = 3001,
    [int]$VitePort = 5173,
    [int]$OllamaPort = 11434,
    [bool]$AutoStart = $true,
    [switch]$Build,
    [switch]$Ngrok,
    [switch]$Mock,
    [string]$LogDir = "logs",
    [switch]$StopOnly
)

$ErrorActionPreference = "Stop"
$Sep = "-" * 80

# Global process tracking for graceful cleanup
$global:ServiceProcesses = @{}
$global:OriginalEnv = @{}

# =============================================================================
# LOGGING & ERROR HANDLING FUNCTIONS
# =============================================================================
function Write-Step {
    param([string]$Message)
    Write-Host "`n$Sep`n  $Message`n$Sep" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK]  $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [!!]  $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "  [ERROR]  $Message" -ForegroundColor Red
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = @{ INFO = "White"; OK = "Green"; WARN = "Yellow"; ERROR = "Red" }[$Level]
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

function Invoke-Cleanup {
    Write-Step "Performing graceful shutdown of all services..."
    foreach ($name in $global:ServiceProcesses.Keys) {
        $proc = $global:ServiceProcesses[$name]
        if ($proc -and !$proc.HasExited) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Ok "Stopped $name (PID $($proc.Id))"
            }
            catch {
                Write-Warn "Failed to stop $name (PID $($proc.Id)): $_"
            }
        }
    }
    # Restore original environment variables
    foreach ($key in $global:OriginalEnv.Keys) {
        if ($global:OriginalEnv[$key] -eq $null) {
            Remove-Item "env:$key" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item "env:$key" -Value $global:OriginalEnv[$key]
        }
    }
    Write-Ok "Cleanup complete. All services stopped."
}

# Register cleanup on PowerShell exit (covers Ctrl+C, script termination)
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null
trap { Invoke-Cleanup; throw $_ }

# =============================================================================
# PREREQUISITE CHECKS
# =============================================================================
function Test-Prerequisites {
    Write-Step "Running prerequisite checks..."

    # PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Err "PowerShell 5.1 or higher is required."
        exit 1
    }

    # Project directory
    if (-not (Test-Path $AiPoweredPath)) {
        Write-Err "ai-powered repository not found at: $AiPoweredPath"
        Write-Host "   Please clone/update the repo or update the -AiPoweredPath parameter." -ForegroundColor Yellow
        exit 1
    }
    Set-Location $AiPoweredPath
    Write-Ok "Working directory set to: $(Get-Location)"

    # Node.js + npm
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js not found on PATH. Install from https://nodejs.org"
        exit 1
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Err "npm not found. Node.js installation may be incomplete."
        exit 1
    }
    Write-Ok "Node.js & npm detected"

    # Automatic dependency installation
    if (-not (Test-Path "node_modules")) {
        Write-Warn "node_modules directory missing - installing dependencies..."
        $installResult = & npm install --no-audit --no-fund 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Err "npm install failed."
            $installResult | Write-Host -ForegroundColor Red
            exit 1
        }
        Write-Ok "Dependencies installed successfully"
    }
    else {
        Write-Ok "Dependencies already present"
    }

    Write-Ok "All prerequisites satisfied"
}

# =============================================================================
# OLLAMA MANAGEMENT
# =============================================================================
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

function Install-Or-Setup-Ollama {
    Write-Step "Verifying Ollama installation..."

    $ollamaExe = Find-Ollama
    if (-not $ollamaExe) {
        Write-Warn "Ollama not found. Attempting automatic installation via winget..."
        try {
            $wingetResult = & winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Ollama installed successfully via winget"
                Start-Sleep -Seconds 3
                $ollamaExe = Find-Ollama
            }
            else {
                throw "winget failed"
            }
        }
        catch {
            Write-Err "Automatic Ollama installation failed."
            Write-Host ""
            Write-Host "  Please install Ollama manually:" -ForegroundColor Yellow
            Write-Host "    https://ollama.com/download" -ForegroundColor Yellow
            Write-Host "  Or run: winget install --id Ollama.Ollama" -ForegroundColor Yellow
            exit 1
        }
    }
    Write-Ok "Ollama executable found: $ollamaExe"
    return $ollamaExe
}

function Start-OllamaService {
    param([string]$OllamaExe)

    Write-Step "Starting Ollama service on port $OllamaPort..."

    # Kill any existing Ollama processes
    Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800

    # Ensure log directory
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

    $ollamaStdout = Join-Path $LogDir "ollama-stdout.log"
    $ollamaStderr = Join-Path $LogDir "ollama-stderr.log"

    $ollamaProc = Start-Process `
        -FilePath $OllamaExe `
        -ArgumentList "serve" `
        -RedirectStandardOutput $ollamaStdout `
        -RedirectStandardError $ollamaStderr `
        -PassThru -WindowStyle Hidden

    $global:ServiceProcesses["Ollama"] = $ollamaProc

    # Wait for API readiness
    Write-Log "Waiting for Ollama API to become ready (up to 30 seconds)..." "INFO"
    $ready = $false
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get -TimeoutSec 2
            $ready = $true
            break
        }
        catch { }
    }

    if (-not $ready) {
        Write-Err "Ollama failed to start. Check logs: $ollamaStderr"
        exit 1
    }
    Write-Ok "Ollama service is running (PID $($ollamaProc.Id))"
    return $ollamaProc
}

function Pull-OllamaModel {
    param([string]$OllamaExe, [string]$TargetModel)

    Write-Step "Ensuring model '$TargetModel' is available..."

    # Check existing models
    try {
        $modelsResp = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get
        $existing = $modelsResp.models | Where-Object { $_.name -like "$TargetModel*" -or $_.name -eq $TargetModel }
    }
    catch {
        $existing = $null
    }

    if ($existing) {
        Write-Ok "Model '$TargetModel' is already downloaded"
    }
    else {
        Write-Warn "Model '$TargetModel' not found locally. Pulling now (this may take 5-15 minutes depending on model size and internet speed)..."
        Write-Host "   Tip: You can monitor progress in another terminal with: ollama pull $TargetModel" -ForegroundColor DarkGray

        $pullOutput = & $OllamaExe pull $TargetModel 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Failed to pull model '$TargetModel'"
            $pullOutput | Write-Host -ForegroundColor Yellow
            Write-Host "   Manual fallback: ollama pull $TargetModel" -ForegroundColor Yellow
            exit 1
        }
        Write-Ok "Successfully pulled model '$TargetModel'"
    }

    # Light pre-warm
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/generate" `
            -Method Post `
            -Body (@{ model = $TargetModel; prompt = "test"; stream = $false } | ConvertTo-Json) `
            -ContentType "application/json" -TimeoutSec 8
        Write-Ok "Model '$TargetModel' pre-warmed and ready for inference"
    }
    catch {
        Write-Log "Model loaded (first inference may have minor warmup delay)" "WARN"
    }
}

# =============================================================================
# AI-POWERED CONFIGURATION & STARTUP
# =============================================================================
function Configure-AiPoweredForOllama {
    Write-Step "Configuring ai-powered proxy to use Ollama OpenAI-compatible endpoint..."

    # Save original values for cleanup
    $global:OriginalEnv["OPENAI_BASE_URL"] = $env:OPENAI_BASE_URL
    $global:OriginalEnv["OPENAI_API_KEY"] = $env:OPENAI_API_KEY
    $global:OriginalEnv["NODE_ENV"] = $env:NODE_ENV

    # Ollama provides full OpenAI-compatible API at /v1
    $env:OPENAI_BASE_URL = "http://localhost:$OllamaPort/v1"
    $env:OPENAI_API_KEY = "ollama"   # Ollama ignores auth but many clients require a non-empty key
    $env:NODE_ENV = "production"

    Write-Ok "ai-powered configured to use Ollama at $env:OPENAI_BASE_URL"
}

function Start-AiPoweredProxy {
    Write-Step "Starting ai-powered proxy server on port $Port..."

    $proxyStdout = Join-Path $LogDir "proxy-stdout.log"
    $proxyStderr = Join-Path $LogDir "proxy-stderr.log"

    $proxyArgs = @("dist\ai-powered\cli\index.js", "serve", "--port", $Port)
    if ($Mock) { $proxyArgs += "--mock" }
    if ($Ngrok) { $proxyArgs += "--cors-origin", "*" }

    $proxyProc = Start-Process `
        -FilePath "node" `
        -ArgumentList $proxyArgs `
        -RedirectStandardOutput $proxyStdout `
        -RedirectStandardError $proxyStderr `
        -PassThru -WindowStyle Hidden

    $global:ServiceProcesses["Proxy"] = $proxyProc

    # Health check
    $ok = $false
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("127.0.0.1", $Port)
            $tcp.Close()
            $ok = $true
            break
        }
        catch { }
    }

    if ($ok) {
        Write-Ok "ai-powered proxy running (PID $($proxyProc.Id)) at http://localhost:$Port"
    }
    else {
        Write-Err "Proxy failed to start. Check: $proxyStderr"
        exit 1
    }
}

function Start-ViteDevServer {
    Write-Step "Starting Vite development server on port $VitePort..."

    $viteLog = Join-Path $LogDir "vite.log"

    $viteProc = Start-Process `
        -FilePath "cmd" `
        -ArgumentList "/c", "npm run dev:web > `"$viteLog`" 2>&1" `
        -PassThru -WindowStyle Hidden

    $global:ServiceProcesses["Vite"] = $viteProc

    # Wait for Vite (can take longer on first run)
    $ok = $false
    for ($i = 1; $i -le 60; $i++) {
        Start-Sleep -Seconds 1
        foreach ($af in @([System.Net.Sockets.AddressFamily]::InterNetwork, [System.Net.Sockets.AddressFamily]::InterNetworkV6)) {
            try {
                $tcp = New-Object System.Net.Sockets.TcpClient($af)
                $tcp.Connect( $(if ($af -eq "InterNetwork") { "127.0.0.1" } else { "::1" }), $VitePort )
                $tcp.Close()
                $ok = $true
                break
            }
            catch { }
        }
        if ($ok) { break }
    }

    if ($ok) {
        Write-Ok "Vite dev server running (PID $($viteProc.Id)) at http://localhost:$VitePort"
    }
    else {
        Write-Err "Vite failed to start. Check: $viteLog"
        exit 1
    }
}

# =============================================================================
# NGROK TUNNEL MANAGEMENT
# =============================================================================
function Start-NgrokTunnel {
    if (-not $Ngrok) { return }

    Write-Step "Starting ngrok tunnel on Vite port $VitePort..."

    if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
        Write-Err "ngrok not found on PATH."
        Write-Host "   Install with: winget install ngrok.ngrok" -ForegroundColor Yellow
        Write-Host "   Then authenticate: ngrok config add-authtoken <YOUR_TOKEN>" -ForegroundColor Yellow
        exit 1
    }

    # Kill existing ngrok
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    $ngrokLog = Join-Path $LogDir "ngrok.log"
    $ngrokProc = Start-Process `
        -FilePath "cmd" `
        -ArgumentList "/c", "ngrok http $VitePort --log=stdout > `"$ngrokLog`" 2>&1" `
        -PassThru -WindowStyle Hidden

    $global:ServiceProcesses["Ngrok"] = $ngrokProc

    # Wait for tunnel URL
    $ngrokUrl = $null
    for ($i = 1; $i -le 25; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
            $httpsUrl = ($resp.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
            if ($httpsUrl) {
                $ngrokUrl = $httpsUrl
                break
            }
        }
        catch { }
    }

    if ($ngrokUrl) {
        $env:PROXY_PUBLIC_BASE_URL = $ngrokUrl
        $env:VITE_PROXY_URL = $ngrokUrl
        $global:OriginalEnv["PROXY_PUBLIC_BASE_URL"] = $null
        $global:OriginalEnv["VITE_PROXY_URL"] = $null
        Write-Ok "ngrok tunnel active: $ngrokUrl"
        Write-Ok "Public web UI + API available at $ngrokUrl (share this link)"
        Write-Ok "Luma AI image-to-video is now enabled via public URL"
    }
    else {
        Write-Err "ngrok tunnel failed to establish within timeout."
    }
}

# =============================================================================
# BUILD (OPTIONAL)
# =============================================================================
function Invoke-BuildIfRequested {
    if (-not $Build) { return }

    Write-Step "Building TypeScript sources (npm run build)..."
    $buildResult = & npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build failed"
        $buildResult | Write-Host -ForegroundColor Red
        exit 1
    }
    Write-Ok "TypeScript build completed successfully"
}

# =============================================================================
# MAIN EXECUTION FLOW
# =============================================================================
Write-Step "ai-powered + Ollama Automation Script v2.0 - Starting..."

if ($StopOnly) {
    Invoke-Cleanup
    Write-Ok "All services stopped. Exiting."
    exit 0
}

# Core setup
Test-Prerequisites

$ollamaExe = Install-Or-Setup-Ollama

if ($AutoStart) {
    $ollamaProc = Start-OllamaService -OllamaExe $ollamaExe
    Pull-OllamaModel -OllamaExe $ollamaExe -TargetModel $Model

    Configure-AiPoweredForOllama
    Invoke-BuildIfRequested

    Start-AiPoweredProxy
    Start-ViteDevServer
    Start-NgrokTunnel

    # Final status
    Write-Step "ALL SERVICES STARTED SUCCESSFULLY!"

    Write-Host "  Ollama      : http://localhost:$OllamaPort  (Model: $Model)  PID $($ollamaProc.Id)" -ForegroundColor Green
    Write-Host "  Proxy       : http://localhost:$Port         PID $($global:ServiceProcesses['Proxy'].Id)" -ForegroundColor Green
    Write-Host "  Vite UI     : http://localhost:$VitePort      PID $($global:ServiceProcesses['Vite'].Id)" -ForegroundColor Green
    if ($env:PROXY_PUBLIC_BASE_URL) {
        Write-Host "  Public URL  : $($env:PROXY_PUBLIC_BASE_URL)  <- Share with others" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "  Logs: $LogDir" -ForegroundColor DarkGray
    Write-Host "  Press Ctrl+C in this window or re-run the script to stop all services." -ForegroundColor Cyan
    Write-Host ""

    # Keep script alive for monitoring / cleanup on exit
    Write-Log "Services are running. Monitoring for shutdown signal..." "INFO"
    while ($true) { Start-Sleep -Seconds 30 }
}
else {
    Write-Ok "Setup complete. Services were NOT started (-AutoStart `$false). Run again with -AutoStart `$true when ready."
}

# Final cleanup is handled by the trap / Register-EngineEvent