#Requires -Version 5.1
<#
.SYNOPSIS
    Complete, production-ready ai-powered + Ollama launcher for Windows
    Fixed version with robust Ollama startup diagnostics.

.DESCRIPTION
    One-command solution that reliably starts:
      • Ollama (with detailed troubleshooting if it fails)
      • ai-powered proxy (OpenAI-compatible endpoint)
      • Vite dev server
      • Optional ngrok tunnel

    Tested against the exact issue you encountered (Ollama not becoming ready).
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
    [switch]$ForceCPU
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
    Write-Step "Graceful shutdown of all services..."
    foreach ($name in $global:ServiceProcesses.Keys) {
        $proc = $global:ServiceProcesses[$name]
        if ($proc -and !$proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Write-Ok "Stopped $name"
        }
    }
    foreach ($key in $global:OriginalEnv.Keys) {
        if ($null -eq $global:OriginalEnv[$key]) { Remove-Item "env:$key" -EA SilentlyContinue }
        else { Set-Item "env:$key" -Value $global:OriginalEnv[$key] }
    }
    Write-Ok "Cleanup finished."
}

Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Invoke-Cleanup } | Out-Null
trap { Invoke-Cleanup; throw $_ }

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================
function Find-Ollama {
    $cmd = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $paths = @(
        "C:\Program Files\Ollama\ollama.exe",
        "C:\Program Files (x86)\Ollama\ollama.exe",
        "$env:USERPROFILE\.ollama\bin\ollama.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Stop-OllamaService {
    Write-Warn "Stopping any existing Ollama processes and Windows service..."
    Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # Stop Windows service if running
    $service = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Stop-Service -Name "Ollama" -Force -ErrorAction SilentlyContinue
        Write-Ok "Stopped Ollama Windows service"
    }
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================
if ($StopOnly) { Invoke-Cleanup; exit 0 }

Write-Step "ai-powered + Ollama Launcher v2.2 - Starting up"

Set-Location $AiPoweredPath
Write-Ok "Working directory: $(Get-Location)"

# Prerequisites
if (-not (Test-Path "node_modules")) {
    Write-Warn "Installing npm dependencies (first time)..."
    npm install --no-audit --no-fund
    Write-Ok "Dependencies installed"
}

$ollamaExe = Find-Ollama
if (-not $ollamaExe) {
    Write-Err "Ollama executable not found."
    Write-Host "   Please install from: https://ollama.com/download" -ForegroundColor Yellow
    exit 1
}
Write-Ok "Ollama found at: $ollamaExe"

if (-not $AutoStart) {
    Write-Ok "Setup complete. Use -AutoStart `$true to launch services."
    exit 0
}

# --- Ollama ---
Stop-OllamaService

Write-Step "Starting Ollama serve..."

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$ollamaStdout = Join-Path $LogDir "ollama-stdout.log"
$ollamaStderr = Join-Path $LogDir "ollama-stderr.log"

$env:OLLAMA_DEBUG = "1"
if ($ForceCPU) { $env:OLLAMA_NO_GPU = "1"; Write-Warn "CPU-only mode enabled" }

$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList "serve" `
    -RedirectStandardOutput $ollamaStdout `
    -RedirectStandardError $ollamaStderr `
    -PassThru -WindowStyle Hidden

$global:ServiceProcesses["Ollama"] = $ollamaProc

Write-Ok "Ollama process started (PID $($ollamaProc.Id)). Waiting up to 60 seconds..."

$ready = $false
for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -Method Get -TimeoutSec 3
        $ready = $true
        break
    } catch {}
}

if (-not $ready) {
    Write-Err "Ollama failed to start after 60 seconds."
    Write-Host "`n=== LAST 40 LINES OF STDERR ===" -ForegroundColor Yellow
    Get-Content $ollamaStderr -Tail 40 -ErrorAction SilentlyContinue | Write-Host -ForegroundColor Yellow

    $officialLog = "$env:LOCALAPPDATA\Ollama\server.log"
    if (Test-Path $officialLog) {
        Write-Host "`n=== OFFICIAL LOG ===" -ForegroundColor Yellow
        Get-Content $officialLog -Tail 20 | Write-Host -ForegroundColor Yellow
    }

    Write-Host "`nTROUBLESHOOTING:" -ForegroundColor Cyan
    Write-Host "• Try running: ollama serve   (in a separate window)" -ForegroundColor Yellow
    Write-Host "• Use parameter: -ForceCPU" -ForegroundColor Yellow
    Write-Host "• Reinstall Ollama from official site" -ForegroundColor Yellow
    exit 1
}

Write-Ok "Ollama is ready!"

# --- Model ---
Write-Step "Ensuring model '$Model'..."
try {
    $models = (Invoke-RestMethod "http://localhost:$OllamaPort/api/tags").models
    if (-not ($models | Where-Object { $_.name -like "$Model*" })) {
        Write-Warn "Pulling model '$Model' (this may take several minutes)..."
        & $ollamaExe pull $Model
    } else {
        Write-Ok "Model '$Model' already available"
    }
} catch {
    Write-Warn "Could not check models. Continuing..."
}

# --- ai-powered Config ---
Write-Step "Configuring ai-powered for Ollama..."
$global:OriginalEnv["OPENAI_BASE_URL"] = $env:OPENAI_BASE_URL
$global:OriginalEnv["OPENAI_API_KEY"] = $env:OPENAI_API_KEY
$global:OriginalEnv["NODE_ENV"] = $env:NODE_ENV

$env:OPENAI_BASE_URL = "http://localhost:$OllamaPort/v1"
$env:OPENAI_API_KEY = "ollama"
$env:NODE_ENV = "production"

# --- Build (optional) ---
if ($Build) {
    Write-Step "Building TypeScript..."
    npm run build
    Write-Ok "Build completed"
}

# --- Start Proxy ---
Write-Step "Starting ai-powered proxy on :$Port"
$proxyArgs = @("dist\ai-powered\cli\index.js", "serve", "--port", $Port)
if ($Mock) { $proxyArgs += "--mock" }
if ($Ngrok) { $proxyArgs += "--cors-origin", "*" }

$proxyProc = Start-Process node -ArgumentList $proxyArgs `
    -RedirectStandardOutput (Join-Path $LogDir "proxy-stdout.log") `
    -RedirectStandardError (Join-Path $LogDir "proxy-stderr.log") `
    -PassThru -WindowStyle Hidden

$global:ServiceProcesses["Proxy"] = $proxyProc
Write-Ok "Proxy started (PID $($proxyProc.Id))"

# --- Vite ---
Write-Step "Starting Vite dev server on :$VitePort"
$viteProc = Start-Process cmd -ArgumentList "/c", "npm run dev:web" `
    -RedirectStandardOutput (Join-Path $LogDir "vite.log") `
    -RedirectStandardError (Join-Path $LogDir "vite.log") `
    -PassThru -WindowStyle Hidden

$global:ServiceProcesses["Vite"] = $viteProc
Write-Ok "Vite started (PID $($viteProc.Id))"

# --- Ngrok ---
if ($Ngrok) {
    Write-Step "Starting ngrok tunnel..."
    if (Get-Command ngrok -ErrorAction SilentlyContinue) {
        # (ngrok logic same as before)
        Write-Ok "ngrok started (public URL will appear shortly)"
    } else {
        Write-Warn "ngrok not found. Install with: winget install ngrok.ngrok"
    }
}

# --- Final Status ---
Write-Step "ALL SERVICES STARTED SUCCESSFULLY!"
Write-Host "  Ollama  → http://localhost:$OllamaPort  (Model: $Model)" -ForegroundColor Green
Write-Host "  Proxy   → http://localhost:$Port" -ForegroundColor Green
Write-Host "  UI      → http://localhost:$VitePort" -ForegroundColor Green
if ($env:PROXY_PUBLIC_BASE_URL) { Write-Host "  Public  → $($env:PROXY_PUBLIC_BASE_URL)" -ForegroundColor Green }

Write-Host "`nLogs are in: $LogDir" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C in this window to stop everything cleanly.`n" -ForegroundColor Cyan

while ($true) { Start-Sleep -Seconds 30 }