@echo off
:: integrations/batch-example.bat
::
:: Demonstrates the ai-powered CLI from Windows Command Prompt (cmd.exe).
:: Covers: text, image (--output), --dry-run, --quiet, --session,
::         structured (--schema), --mock, --log, --debug.
::
:: Usage:
::   set AI_MOCK=true
::   integrations\batch-example.bat
::
:: Set OPENAI_API_KEY (or configure %USERPROFILE%\.ai-powered\config.json)
:: for live calls. Pass --mock to each command to avoid real API calls.

setlocal enabledelayedexpansion

if "%CLI%"=="" set CLI=ai-powered
if "%AI_MOCK%"=="true" (set MOCK_FLAG=--mock) else (set MOCK_FLAG=)

:: Create a temporary directory for output files
set TMPDIR=%TEMP%\ai-powered-bat-%RANDOM%
mkdir "%TMPDIR%"

echo.
echo ============================================================
echo  1. Text generation
echo ============================================================
%CLI% text %MOCK_FLAG% "Explain what a REST API is in one sentence."

echo.
echo ============================================================
echo  2. Text generation (--quiet)
echo ============================================================
for /f "delims=" %%r in ('%CLI% text %MOCK_FLAG% --quiet "What is 2 + 2?"') do (
    echo Raw result: %%r
)

echo.
echo ============================================================
echo  3. Text generation (--json)
echo ============================================================
%CLI% text %MOCK_FLAG% --json "Summarise TCP/IP in one sentence."

echo.
echo ============================================================
echo  4. Dry-run cost estimate
echo ============================================================
%CLI% text %MOCK_FLAG% --dry-run "Write a 500-word essay on quantum computing."

echo.
echo ============================================================
echo  5. Image generation (--output saves to file)
echo ============================================================
set IMG_OUT=%TMPDIR%\image.png
%CLI% image %MOCK_FLAG% --output "%IMG_OUT%" "A serene mountain lake at sunrise"
if exist "%IMG_OUT%" (
    echo Image saved: %IMG_OUT%
) else (
    echo ERROR: image file not created.
    exit /b 1
)

echo.
echo ============================================================
echo  6. Multi-turn session
echo ============================================================
set SESSION_ID=bat-session-%RANDOM%
%CLI% text %MOCK_FLAG% --session "%SESSION_ID%" "My name is Alice."
%CLI% text %MOCK_FLAG% --session "%SESSION_ID%" "What is my name?"
%CLI% session list
%CLI% session clear "%SESSION_ID%"

echo.
echo ============================================================
echo  7. Structured output (--schema)
echo ============================================================
set SCHEMA_FILE=%TMPDIR%\schema.json
(
  echo {
  echo   "type": "object",
  echo   "properties": {
  echo     "name":       { "type": "string"  },
  echo     "capital":    { "type": "string"  },
  echo     "population": { "type": "number"  },
  echo     "in_europe":  { "type": "boolean" }
  echo   },
  echo   "required": ["name","capital","population","in_europe"]
  echo }
) > "%SCHEMA_FILE%"
%CLI% structured %MOCK_FLAG% --schema "%SCHEMA_FILE%" "Describe France as a JSON object."

echo.
echo ============================================================
echo  8. Batch text processing (JSONL input -> JSONL output)
echo ============================================================
set BATCH_IN=%TMPDIR%\batch_input.jsonl
set BATCH_OUT=%TMPDIR%\batch_output.jsonl
(
  echo {"prompt":"What is the speed of light?"}
  echo {"prompt":"Who wrote Hamlet?"}
  echo {"prompt":"What is pi?"}
) > "%BATCH_IN%"
%CLI% batch text %MOCK_FLAG% --input "%BATCH_IN%" --output "%BATCH_OUT%"
echo --- Batch output ---
type "%BATCH_OUT%"

echo.
echo ============================================================
echo  9. Debug logging (--debug, stderr mixed with stdout)
echo ============================================================
%CLI% text %MOCK_FLAG% --debug "Hello world." 2>&1

:: Cleanup
rmdir /s /q "%TMPDIR%"

echo.
echo [OK] batch-example.bat complete.
endlocal

