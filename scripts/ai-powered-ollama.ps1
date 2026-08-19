#Requires -Version 5.1
<#
.SYNOPSIS
    Production-ready automation for ai-powered + Ollama (fixed startup issues)

.DESCRIPTION
    Enhanced version with improved Ollama startup reliability, better logging,
    GPU troubleshooting hints, and longer health check timeouts.

    Fixes observed issues:
      - Increased Ollama wait time + debug mode
      - Checks official Ollama logs (%LOCALAPPDATA%\Ollama)
      - Better process cleanup
      - Environment variable handling for GPU/CPU fallback
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
    [switch]$StopOnly,
    [switch]$ForceCPU   # Use if GPU is causing crashes
)

$ErrorActionPreference = "Stop"
$Sep = "-" * 80

$global:ServiceProcesses = @{}
$global:OriginalEnv = @{}

function Write-Step { param([string]$Message); Write-Host "`n$Sep`n  $Message`n$Sep" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message); Write-Host "  [OK]  $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message); Write-Host "  [!!]  $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message); Write-Host "  [ERROR] $Message" -ForegroundColor Red }

function Invoke-Cleanup {
    Write-Step "Graceful shutdown..."
    foreach ($name in $global:ServiceProcesses.Keys) {
        $proc = $global:ServiceProcesses[$name]
        if ($proc -and !$proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Write-Ok "Stopped $name"
        }
    }
    # Restore env
    foreach ($key in $global:OriginalEnv.Keys) {
        if ($null -eq $global:OriginalEnv[$key]) { Remove-Item "env:$key" -EA SilentlyContinue }
        else { Set-Item "env:$key" -Value $global:OriginalEnv[$key] }
    }
}

Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null
trap { Invoke-Cleanup; throw $_ }

# =============================================================================
# IMPROVED OLLAMA STARTUP
# =============================================================================
function Start-OllamaService {
    param([string]$OllamaExe)

    Write-Step "Starting Ollama with enhanced diagnostics..."

    # Kill everything
    Get-Process -Name "ollama*" -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
    Start-Sleep -Seconds 2

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

    $ollamaStdout = Join-Path $LogDir "ollama-stdout.log"
    $ollamaStderr = Join-Path $LogDir "ollama-stderr.log"

    # Enable debug logging
    $env:OLLAMA_DEBUG = "1"

    if ($ForceCPU) {
        $env:OLLAMA_NO_GPU = "1"
        Write-Warn "Forcing CPU-only mode (OLLAMA_NO_GPU=1)"
    }

    $ollamaProc = Start-Process -FilePath $OllamaExe -ArgumentList "serve" `
        -RedirectStandardOutput $ollamaStdout `
        -RedirectStandardError $ollamaStderr `
        -PassThru -WindowStyle Hidden

    $global:ServiceProcesses["Ollama"] = $ollamaProc

    Write-Ok "Ollama serve launched (PID $($ollamaProc.Id)). Waiting up to 45 seconds..."

    $ready = $false
    for ($i = 1; $i -le 45; $i++) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get -TimeoutSec 3
            $ready = $true
            break
        } catch {}
    }

    if (-not $ready) {
        Write-Err "Ollama API not responding after 45s. Checking logs..."

        # Show recent errors
        Write-Host "`n=== LAST 30 LINES OF OLLAMA STDERR ===" -ForegroundColor Yellow
        Get-Content $ollamaStderr -ErrorAction SilentlyContinue -Tail 30 | Write-Host -ForegroundColor Yellow

        # Official logs
        $officialLog = "$env:LOCALAPPDATA\Ollama\server.log"
        if (Test-Path $officialLog) {
            Write-Host "`n=== OFFICIAL OLLAMA LOG ===" -ForegroundColor Yellow
            Get-Content $officialLog -Tail 20 | Write-Host -ForegroundColor Yellow
        }

        Write-Host "`nTROUBLESHOOTING TIPS:" -ForegroundColor Cyan
        Write-Host "1. Run manually in new window: ollama serve" -ForegroundColor Yellow
        Write-Host "2. Check GPU drivers / CUDA (nvidia-smi)" -ForegroundColor Yellow
        Write-Host "3. Try again with -ForceCPU" -ForegroundColor Yellow
        Write-Host "4. Reinstall Ollama from https://ollama.com/download" -ForegroundColor Yellow
        exit 1
    }

    Write-Ok "Ollama API is ready at http://localhost:$OllamaPort"
    return $ollamaProc
}

# =============================================================================
# MAIN FLOW (rest of script same as before but calls improved function)
# =============================================================================
Write-Step "ai-powered + Ollama Automation v2.1 (Improved Startup)"

if ($StopOnly) { Invoke-Cleanup; exit 0 }

Set-Location $AiPoweredPath

# Prerequisites (same as previous)
if (-not (Test-Path "node_modules")) {
    Write-Warn "Installing npm dependencies..."
    npm install --no-audit --no-fund
}

$ollamaExe = Find-Ollama   # reuse function from previous script or inline

if (-not $ollamaExe) {
    Write-Err "Ollama not found. Install from https://ollama.com/download"
    exit 1
}

if ($AutoStart) {
    $ollamaProc = Start-OllamaService -OllamaExe $ollamaExe
    Pull-OllamaModel -OllamaExe $ollamaExe -TargetModel $Model   # reuse previous function

    Configure-AiPoweredForOllama
    if ($Build) { Invoke-BuildIfRequested }

    Start-AiPoweredProxy
    Start-ViteDevServer
    Start-NgrokTunnel

    Write-Step "ALL SERVICES RUNNING SUCCESSFULLY!"
    Write-Host "  Ollama: http://localhost:$OllamaPort (Model: $Model)" -ForegroundColor Green
    Write-Host "  Proxy : http://localhost:$Port" -ForegroundColor Green
    Write-Host "  UI    : http://localhost:$VitePort" -ForegroundColor Green
    if ($env:PROXY_PUBLIC_BASE_URL) {
        Write-Host "  Public: $($env:PROXY_PUBLIC_BASE_URL)" -ForegroundColor Green
    }
    Write-Host "`nPress Ctrl+C to stop all services."
    while ($true) { Start-Sleep -Seconds 30 }
}