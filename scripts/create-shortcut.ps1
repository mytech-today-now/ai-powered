#Requires -Version 5.1
<#
.SYNOPSIS
    Creates a "cycle ai-powered" Windows desktop shortcut that starts all
    services (proxy + Vite + ngrok) from a cold boot — no VS Code required.

.DESCRIPTION
    Run this script ONCE to place the shortcut on your Desktop.
    After that, double-click "cycle ai-powered" at any time to start:
      • The ai-powered proxy server  (port 3001)
      • The Vite dev-server web UI   (port 5173, http://localhost:5173)
      • An ngrok public tunnel       (share the printed URL with anyone)

    The PowerShell window stays open (-NoExit) so you can read the startup
    output and see the ngrok public URL printed at the end.
    All three services run as hidden background processes — closing the
    terminal later does NOT stop them.

.PARAMETER Destination
    Folder where the .lnk file is written.
    Default: your Windows Desktop (works with OneDrive-synced desktops).

.PARAMETER KeepOpen
    When $true (default), the shortcut uses -NoExit so the terminal stays
    visible after startup.  Set -KeepOpen:$false to auto-close it.

.EXAMPLE
    # Create shortcut on Desktop (default)
    .\scripts\create-shortcut.ps1

.EXAMPLE
    # Create shortcut in a custom folder
    .\scripts\create-shortcut.ps1 -Destination "C:\Users\kyle_\Desktop"
#>
[CmdletBinding()]
param(
    [string] $Destination = [System.Environment]::GetFolderPath("Desktop"),
    [switch] $KeepOpen   = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────
$repoRoot  = "G:\_kyle\temp_documents\GitHub\ai-powered"
$psScript  = Join-Path $repoRoot "scripts\cycle-service.ps1"
$lnkPath   = Join-Path $Destination "cycle ai-powered.lnk"

# Prefer PowerShell 7 (pwsh.exe) — faster startup, better error messages.
# Fall back to Windows PowerShell 5.1 which ships with every Windows install.
$pwshExe = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
$target  = if ($pwshExe) {
    $pwshExe.Source   # e.g. C:\Program Files\PowerShell\7\pwsh.exe
} else {
    "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
}

# ── Build the argument string ────────────────────────────────────────────────
#   -NoExit          : keep the terminal open so the user can read the output
#   -ExecutionPolicy Bypass : run without touching the machine policy setting
#   -File            : path to the startup script
#   -Ngrok           : start the ngrok tunnel (pass -Ngrok:$false to skip)
$noExit = if ($KeepOpen) { "-NoExit " } else { "" }
$arguments = "${noExit}-ExecutionPolicy Bypass -File `"$psScript`" -Ngrok"

# ── Validate inputs before writing anything ──────────────────────────────────
if (-not (Test-Path $repoRoot)) {
    Write-Error "Repo root not found: $repoRoot`nUpdate the `$repoRoot variable in this script."
}
if (-not (Test-Path $psScript)) {
    Write-Error "Script not found: $psScript"
}
if (-not (Test-Path $Destination)) {
    Write-Error "Destination folder not found: $Destination"
}

# ── Create the .lnk via WScript.Shell COM ───────────────────────────────────
$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)

$shortcut.TargetPath       = $target
$shortcut.Arguments        = $arguments
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle      = 1          # 1=Normal  3=Maximized  7=Minimized
$shortcut.Description      = "Start ai-powered proxy + Vite dev server + ngrok tunnel"

# Use the PowerShell icon so it's visually distinct on the Desktop / taskbar.
$shortcut.IconLocation     = "$target,0"

$shortcut.Save()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

# ── Report ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Shortcut created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  File   : $lnkPath"             -ForegroundColor Cyan
Write-Host "  Target : $target"              -ForegroundColor DarkGray
Write-Host "  Args   : $arguments"           -ForegroundColor DarkGray
Write-Host "  Start in: $repoRoot"           -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Double-click 'cycle ai-powered' on your Desktop to start all services." -ForegroundColor Yellow
Write-Host "  Then open your browser to http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
