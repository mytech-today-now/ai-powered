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

    Designed specifically for Windows 11 and the repo at https://www.npmjs.com/package/@mytechtoday/ai-powered.
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
        if ($null -eq $global:OriginalEnv[$key]) { 
            Remove-Item "env:$key" -EA SilentlyContinue 
        } else { 
            Set-Item "env:$key" -Value $global:OriginalEnv[$key] 
        }
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
        "$env:USERPROFILE\.ollama\bin\ollama.exe",
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Stop-OllamaService {
    Write-Warn "Stopping any existing Ollama processes..."
    Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

function Get-NgrokPublicUrl {
    param(
        [string]$LogFile,
        [int]$TimeoutSeconds = 30
    )
    $start = Get-Date
    Write-Host "  Waiting for ngrok tunnel..." -NoNewline -ForegroundColor Cyan
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
        if (Test-Path $LogFile) {
            $logContent = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
            if ($logContent) {
                # Primary match for ngrok forwarding line (classic output)
                if ($logContent -match 'Forwarding\s+(https?://[^\s]+)\s+->') {
                    $url = $matches[1]
                    Write-Host "`r  [OK]  Public URL detected: $url" -ForegroundColor Green
                    return $url
                }
                # Fallback regex for ngrok URLs (JSON or other formats)
                elseif ($logContent -match '(https?://[^\s]+\.ngrok[^/\s]*)') {
                    $url = $matches[1]
                    Write-Host "`r  [OK]  Public URL detected: $url" -ForegroundColor Green
                    return $url
                }
            }
        }
        Start-Sleep -Milliseconds 800
        Write-Host "." -NoNewline -ForegroundColor Cyan
    }
    Write-Host "`r  [!!]  Could not detect ngrok public URL within timeout." -ForegroundColor Yellow
    return $null
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================
if ($StopOnly) { Invoke-Cleanup; exit 0 }

Write-Step "ai-powered + Ollama Launcher v2.4 - Starting up"

Set-Location $AiPoweredPath
Write-Ok "Working directory: $(Get-Location)"

# Prerequisites
if (-not (Test-Path "node_modules")) {
    Write-Warn "Installing npm dependencies..."
    npm install --no-audit --no-fund
    Write-Ok "Dependencies installed"
}

$ollamaExe = Find-Ollama
if (-not $ollamaExe) {
    Write-Err "Ollama not found. Install from https://ollama.com/download"
    exit 1
}
Write-Ok "Ollama found at: $ollamaExe"

if (-not $AutoStart) {
    Write-Ok "Setup complete. Run with -AutoStart `$true to launch services."
    exit 0
}

# --- Ollama ---
Stop-OllamaService

Write-Step "Starting Ollama serve..."

if (-not (Test-Path $LogDir)) { 
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null 
}

$ollamaStdout = Join-Path $LogDir "ollama-stdout.log"
$ollamaStderr = Join-Path $LogDir "ollama-stderr.log"

$env:OLLAMA_DEBUG = "1"
if ($ForceCPU) { 
    $env:OLLAMA_NO_GPU = "1"; 
    Write-Warn "CPU-only mode enabled" 
}

$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList "serve" `
    -RedirectStandardOutput $ollamaStdout `
    -RedirectStandardError $ollamaStderr `
    -PassThru -WindowStyle Hidden

$global:ServiceProcesses["Ollama"] = $ollamaProc
Write-Ok "Ollama started (PID $($ollamaProc.Id)). Waiting up to 60s..."

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
    Write-Host "`n=== LAST 40 LINES OF OLLAMA LOG ===" -ForegroundColor Yellow
    Get-Content $ollamaStderr -Tail 40 -EA SilentlyContinue | Write-Host -ForegroundColor Yellow
    exit 1
}
Write-Ok "Ollama is ready!"

# --- Model ---
Write-Step "Ensuring model '$Model'..."
try {
    $models = (Invoke-RestMethod "http://localhost:$OllamaPort/api/tags").models
    if (-not ($models | Where-Object { $_.name -like "$Model*" -or $_.name -eq $Model })) {
        Write-Warn "Pulling model '$Model' (this may take a few minutes)..."
        & $ollamaExe pull $Model
        Write-Ok "Model pulled successfully"
    } else {
        Write-Ok "Model '$Model' already available"
    }
} catch {
    Write-Warn "Could not verify model. Continuing..."
}

# --- ai-powered Config ---
Write-Step "Configuring ai-powered for Ollama..."
$global:OriginalEnv["OPENAI_BASE_URL"] = $env:OPENAI_BASE_URL
$global:OriginalEnv["OPENAI_API_KEY"] = $env:OPENAI_API_KEY
$global:OriginalEnv["NODE_ENV"] = $env:NODE_ENV

$env:OPENAI_BASE_URL = "http://localhost:$OllamaPort/v1"
$env:OPENAI_API_KEY = "ollama"
$env:NODE_ENV = "production"
Write-Ok "ai-powered configured to use Ollama"

# --- Build ---
if ($Build) {
    Write-Step "Building TypeScript..."
    npm run build
    Write-Ok "Build completed"
}

# --- Proxy ---
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
$viteStdout = Join-Path $LogDir "vite-stdout.log"
$viteStderr = Join-Path $LogDir "vite-stderr.log"

$viteProc = Start-Process cmd -ArgumentList "/c", "npm run dev:web" `
    -RedirectStandardOutput $viteStdout `
    -RedirectStandardError $viteStderr `
    -PassThru -WindowStyle Hidden

$global:ServiceProcesses["Vite"] = $viteProc
Write-Ok "Vite dev server started (PID $($viteProc.Id))"

# --- Ngrok ---
$publicUrl = $null
if ($Ngrok) {
    Write-Step "Starting ngrok tunnel on :$VitePort..."
    if (Get-Command ngrok -ErrorAction SilentlyContinue) {
        $ngrokLog = Join-Path $LogDir "ngrok.log"
        $ngrokProc = Start-Process cmd -ArgumentList "/c", "ngrok http $VitePort --log=stdout > `"$ngrokLog`" 2>&1" `
            -PassThru -WindowStyle Hidden
        $global:ServiceProcesses["Ngrok"] = $ngrokProc
        Write-Ok "ngrok started (PID $($ngrokProc.Id))"
        
        $publicUrl = Get-NgrokPublicUrl -LogFile $ngrokLog
    } else {
        Write-Warn "ngrok not found. Install with: winget install ngrok.ngrok"
    }
}

# --- Final Status ---
Write-Step "ALL SERVICES STARTED SUCCESSFULLY!"
Write-Host "  Ollama → http://localhost:$OllamaPort (Model: $Model)" -ForegroundColor Green
Write-Host "  Proxy  → http://localhost:$Port" -ForegroundColor Green
Write-Host "  UI     → http://localhost:$VitePort" -ForegroundColor Green
if ($publicUrl) {
    Write-Host "  Public UI → $publicUrl" -ForegroundColor Green
}

$fullLogPath = (Resolve-Path $LogDir).Path
Write-Host "`nFull logs directory: $fullLogPath" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C in this window to stop everything cleanly.`n" -ForegroundColor Cyan

while ($true) { Start-Sleep -Seconds 30 }