#!/usr/bin/env bash
# integrations/bash-example.sh
#
# Demonstrates the ai-powered CLI from Bash.
# Covers: text, image (--output), --dry-run, --quiet, --session,
#         structured (--schema), --mock, --log, --debug.
#
# Usage:
#   chmod +x integrations/bash-example.sh
#   AI_MOCK=true ./integrations/bash-example.sh
#
# Set AI_MOCK=true (or pass --mock) to avoid real API calls.
# Set OPENAI_API_KEY (or configure ~/.ai-powered/config.json) for live calls.

set -euo pipefail

CLI="${CLI:-ai-powered}"          # override with: CLI="node dist/ai-powered/cli/index.js"
MOCK="${MOCK_FLAG:---mock}"       # set MOCK_FLAG="" to use a real provider
TMPDIR_EX="$(mktemp -d)"

cleanup() { rm -rf "$TMPDIR_EX"; }
trap cleanup EXIT

separator() { printf '\n%.0s─' {1..60}; printf '\n'; }

# ---------------------------------------------------------------------------
# 1. Text generation (basic)
# ---------------------------------------------------------------------------
separator
echo "1. Text generation"
"$CLI" text $MOCK "Explain what a REST API is in one sentence."

# ---------------------------------------------------------------------------
# 2. Text generation — quiet mode (raw content only)
# ---------------------------------------------------------------------------
separator
echo "2. Text generation (--quiet)"
result=$("$CLI" text $MOCK --quiet "What is 2 + 2?")
echo "Raw result: $result"

# ---------------------------------------------------------------------------
# 3. Text generation — JSON envelope
# ---------------------------------------------------------------------------
separator
echo "3. Text generation (--json)"
"$CLI" text $MOCK --json "Summarise TCP/IP in one sentence." | python3 -m json.tool 2>/dev/null || cat

# ---------------------------------------------------------------------------
# 4. Dry-run — cost estimate only, no API call
# ---------------------------------------------------------------------------
separator
echo "4. Dry-run cost estimate"
"$CLI" text $MOCK --dry-run "Write a 500-word essay on quantum computing." | python3 -m json.tool 2>/dev/null || cat

# ---------------------------------------------------------------------------
# 5. Image generation (--output saves to file)
# ---------------------------------------------------------------------------
separator
echo "5. Image generation (saved to file)"
IMG_OUT="$TMPDIR_EX/image.png"
"$CLI" image $MOCK --output "$IMG_OUT" "A serene mountain lake at sunrise"
ls -lh "$IMG_OUT"

# ---------------------------------------------------------------------------
# 6. Multi-turn session
# ---------------------------------------------------------------------------
separator
echo "6. Multi-turn session"
SESSION_ID="bash-session-$(date +%s)"
"$CLI" text $MOCK --session "$SESSION_ID" "My name is Alice."
"$CLI" text $MOCK --session "$SESSION_ID" "What is my name?"
"$CLI" session list
"$CLI" session clear "$SESSION_ID"

# ---------------------------------------------------------------------------
# 7. Structured output (JSON Schema file)
# ---------------------------------------------------------------------------
separator
echo "7. Structured output (--schema)"
SCHEMA_FILE="$TMPDIR_EX/schema.json"
cat > "$SCHEMA_FILE" <<'EOF'
{
  "type": "object",
  "properties": {
    "name":        { "type": "string"  },
    "capital":     { "type": "string"  },
    "population":  { "type": "number"  },
    "in_europe":   { "type": "boolean" }
  },
  "required": ["name", "capital", "population", "in_europe"]
}
EOF
"$CLI" structured $MOCK --schema "$SCHEMA_FILE" "Describe France as a JSON object."

# ---------------------------------------------------------------------------
# 8. Batch processing (JSONL input → JSONL output)
# ---------------------------------------------------------------------------
separator
echo "8. Batch text processing"
BATCH_IN="$TMPDIR_EX/batch_input.jsonl"
BATCH_OUT="$TMPDIR_EX/batch_output.jsonl"
printf '{"prompt":"What is the speed of light?"}\n{"prompt":"Who wrote Hamlet?"}\n{"prompt":"What is pi?"}\n' > "$BATCH_IN"
"$CLI" batch text $MOCK --input "$BATCH_IN" --output "$BATCH_OUT"
echo "--- Batch output ---"
cat "$BATCH_OUT"

# ---------------------------------------------------------------------------
# 9. Debug logging
# ---------------------------------------------------------------------------
separator
echo "9. Debug logging (--debug redirected to stderr)"
"$CLI" text $MOCK --debug "Hello world." 2>&1 | head -5

echo ""
echo "✓ bash-example.sh complete."

