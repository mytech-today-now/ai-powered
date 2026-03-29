#Requires -Version 5.1
<#
.SYNOPSIS
    Demonstrates the ai-powered CLI from PowerShell.
.DESCRIPTION
    Covers: text, image (--output), --dry-run, --quiet, --session,
            structured (--schema), --mock, --log, --debug.
.EXAMPLE
    $env:AI_MOCK = "true"
    .\integrations\powershell-example.ps1
.NOTES
    Set $env:OPENAI_API_KEY (or configure ~/.ai-powered/config.json) for live calls.
    Pass -Mock to force mock mode regardless of the environment variable.
#>
[CmdletBinding()]
param(
    [string] $Cli  = "ai-powered",  # override: "node dist/ai-powered/cli/index.js"
    [switch] $Mock                   # force mock mode
)

$ErrorActionPreference = "Stop"

$MockFlag = if ($Mock -or $env:AI_MOCK -eq "true") { "--mock" } else { "" }
$TmpDir   = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "ai-powered-ps-$(Get-Random)")
New-Item -ItemType Directory -Path $TmpDir | Out-Null

function Write-Sep { Write-Host ("`n" + ("─" * 60)) }

try {
    # -------------------------------------------------------------------------
    # 1. Text generation (basic)
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "1. Text generation"
    & $Cli text $MockFlag "Explain what a REST API is in one sentence."

    # -------------------------------------------------------------------------
    # 2. Text generation — quiet mode
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "2. Text generation (--quiet)"
    $result = & $Cli text $MockFlag --quiet "What is 2 + 2?"
    Write-Host "Raw result: $result"

    # -------------------------------------------------------------------------
    # 3. Text generation — JSON envelope
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "3. Text generation (--json)"
    $json = & $Cli text $MockFlag --json "Summarise TCP/IP in one sentence."
    $json | ConvertFrom-Json | ConvertTo-Json -Depth 5

    # -------------------------------------------------------------------------
    # 4. Dry-run — cost estimate only
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "4. Dry-run cost estimate"
    $dryRun = & $Cli text $MockFlag --dry-run "Write a 500-word essay on quantum computing."
    $dryRun | ConvertFrom-Json | ConvertTo-Json -Depth 3

    # -------------------------------------------------------------------------
    # 5. Image generation (--output saves to file)
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "5. Image generation (saved to file)"
    $imgOut = Join-Path $TmpDir "image.png"
    & $Cli image $MockFlag --output $imgOut "A serene mountain lake at sunrise"
    Get-Item $imgOut | Select-Object Name, Length

    # -------------------------------------------------------------------------
    # 6. Multi-turn session
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "6. Multi-turn session"
    $sessionId = "ps-session-$(Get-Date -Format 'yyyyMMddHHmmss')"
    & $Cli text $MockFlag --session $sessionId "My name is Alice."
    & $Cli text $MockFlag --session $sessionId "What is my name?"
    & $Cli session list
    & $Cli session clear $sessionId

    # -------------------------------------------------------------------------
    # 7. Structured output (JSON Schema file)
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "7. Structured output (--schema)"
    $schemaFile = Join-Path $TmpDir "schema.json"
    @{
        type       = "object"
        properties = @{
            name       = @{ type = "string"  }
            capital    = @{ type = "string"  }
            population = @{ type = "number"  }
            in_europe  = @{ type = "boolean" }
        }
        required   = @("name", "capital", "population", "in_europe")
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $schemaFile -Encoding UTF8
    & $Cli structured $MockFlag --schema $schemaFile "Describe France as a JSON object."

    # -------------------------------------------------------------------------
    # 8. Batch processing (JSONL input → JSONL output)
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "8. Batch text processing"
    $batchIn  = Join-Path $TmpDir "batch_input.jsonl"
    $batchOut = Join-Path $TmpDir "batch_output.jsonl"
    @(
        '{"prompt":"What is the speed of light?"}',
        '{"prompt":"Who wrote Hamlet?"}',
        '{"prompt":"What is pi?"}'
    ) | Set-Content -Path $batchIn -Encoding UTF8
    & $Cli batch text $MockFlag --input $batchIn --output $batchOut
    Write-Host "--- Batch output ---"
    Get-Content $batchOut

    # -------------------------------------------------------------------------
    # 9. Debug logging (output captured to variable; stderr shown separately)
    # -------------------------------------------------------------------------
    Write-Sep
    Write-Host "9. Debug logging (--debug)"
    & $Cli text $MockFlag --debug "Hello world." 2>&1 | Select-Object -First 5

    Write-Host "`n✓ powershell-example.ps1 complete."
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

