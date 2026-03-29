#!/usr/bin/env python3
"""
integrations/python-example.py

Demonstrates driving the ai-powered CLI from Python using subprocess.
Covers: text, image (--output), --dry-run, --quiet, --session,
        structured (--schema), --mock, --log, --debug.

Usage:
    AI_MOCK=true python3 integrations/python-example.py
    # or on Windows:
    set AI_MOCK=true && python integrations\\python-example.py
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLI = os.environ.get("CLI", "ai-powered")
MOCK = os.environ.get("AI_MOCK", "").lower() in ("true", "1", "yes")
MOCK_FLAG = ["--mock"] if MOCK else []
ENV = {**os.environ, "AI_MOCK": "true" if MOCK else os.environ.get("AI_MOCK", "")}


def run(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Run the CLI and return the CompletedProcess."""
    cmd = [CLI, *args]
    result = subprocess.run(
        cmd,
        text=True,
        capture_output=capture,
        env=ENV,
        check=False,
    )
    if result.returncode not in (0,) and not capture:
        print(f"[WARN] CLI exited with code {result.returncode}", file=sys.stderr)
    return result


def sep(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print("─" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ai-powered-py-") as tmp:
        tmp_path = Path(tmp)

        # 1. Text generation
        sep("1. Text generation")
        run("text", *MOCK_FLAG, "Explain what a REST API is in one sentence.")

        # 2. Quiet mode
        sep("2. Text generation (--quiet)")
        r = run("text", *MOCK_FLAG, "--quiet", "What is 2 + 2?", capture=True)
        print(f"Raw result: {r.stdout.strip()}")

        # 3. JSON envelope
        sep("3. Text generation (--json)")
        r = run("text", *MOCK_FLAG, "--json", "Summarise TCP/IP in one sentence.", capture=True)
        try:
            obj = json.loads(r.stdout)
            print(json.dumps(obj, indent=2))
        except json.JSONDecodeError:
            print(r.stdout)

        # 4. Dry-run
        sep("4. Dry-run cost estimate")
        r = run("text", *MOCK_FLAG, "--dry-run",
                "Write a 500-word essay on quantum computing.", capture=True)
        try:
            print(json.dumps(json.loads(r.stdout), indent=2))
        except json.JSONDecodeError:
            print(r.stdout)

        # 5. Image generation
        sep("5. Image generation (--output)")
        img_out = tmp_path / "image.png"
        run("image", *MOCK_FLAG, "--output", str(img_out), "A serene mountain lake at sunrise")
        if img_out.exists():
            print(f"Image saved: {img_out}  ({img_out.stat().st_size} bytes)")
        else:
            print("ERROR: image file not created.", file=sys.stderr)
            sys.exit(1)

        # 6. Multi-turn session
        sep("6. Multi-turn session")
        session_id = "py-session-12345"
        run("text", *MOCK_FLAG, "--session", session_id, "My name is Alice.")
        run("text", *MOCK_FLAG, "--session", session_id, "What is my name?")
        run("session", "list")
        run("session", "clear", session_id)

        # 7. Structured output (JSON Schema)
        sep("7. Structured output (--schema)")
        schema_file = tmp_path / "schema.json"
        schema = {
            "type": "object",
            "properties": {
                "name":       {"type": "string"},
                "capital":    {"type": "string"},
                "population": {"type": "number"},
                "in_europe":  {"type": "boolean"},
            },
            "required": ["name", "capital", "population", "in_europe"],
        }
        schema_file.write_text(json.dumps(schema, indent=2))
        run("structured", *MOCK_FLAG, "--schema", str(schema_file),
            "Describe France as a JSON object.")

        # 8. Batch processing
        sep("8. Batch text processing")
        batch_in  = tmp_path / "batch_input.jsonl"
        batch_out = tmp_path / "batch_output.jsonl"
        prompts = [
            {"prompt": "What is the speed of light?"},
            {"prompt": "Who wrote Hamlet?"},
            {"prompt": "What is pi?"},
        ]
        batch_in.write_text("\n".join(json.dumps(p) for p in prompts) + "\n")
        run("batch", "text", *MOCK_FLAG, "--input", str(batch_in), "--output", str(batch_out))
        print("--- Batch output ---")
        print(batch_out.read_text())

        # 9. Debug logging
        sep("9. Debug logging (--debug)")
        run("text", *MOCK_FLAG, "--debug", "Hello world.")

    print("\n✓ python-example.py complete.")


if __name__ == "__main__":
    main()

