# ai-powered

> **Unified AI client and CLI** — multi-modal, multi-provider, browser-safe, fully mock-able.

[![CI](https://github.com/mytech-today-now/ai-powered/actions/workflows/ci.yml/badge.svg)](https://github.com/mytech-today-now/ai-powered/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-powered.svg)](https://www.npmjs.com/package/ai-powered)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![ESM only](https://img.shields.io/badge/ESM-only-blue)](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c)

---

## TL;DR

```bash
# Install
npm install -g ai-powered

# Run a quick text generation (uses mock provider — no API key needed)
ai-powered text --mock "Explain REST APIs in one sentence."

# Or as a library (Node.js ≥ 18, ESM only)
import { getAiClient } from "ai-powered";
const client = getAiClient({ mock: true });
const result = await client.generateText("Hello, AI!");
console.log(result.content);
```

**Key features at a glance:**

| Feature | Detail |
|---------|--------|
| **Modalities** | Text · Image · Audio (transcribe + speak) · Video · Structured JSON |
| **Providers** | OpenAI · Anthropic · xAI (Grok) · Venice.ai · Custom/Ollama · Mock |
| **Resilience** | Per-provider circuit breakers · automatic provider fallback · configurable retry |
| **Security** | API key masking in all logs · SHA-256 prompt hashing in audit log · git-tracked credential warnings |
| **Plugin system** | `onRequest` / `onResponse` / `onError` hooks · frozen config sandboxing |
| **Browser** | Vite ESM+UMD bundle · proxy mode (recommended) · direct mode (dev only) |
| **ESM only** | `"type": "module"` throughout — CommonJS is not supported (Design Decision D1) |

---

## Table of Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [CLI Reference](#cli-reference)
5. [Library Usage](#library-usage)
6. [AI Agent / Tool-Calling Usage](#ai-agent--tool-calling-usage)
7. [Browser / Web Usage](#browser--web-usage)
8. [Cross-Language Shell Integration](#cross-language-shell-integration)
9. [Security Best Practices](#security-best-practices)
10. [Architecture Overview](#architecture-overview)
11. [Writing a Plugin](#writing-a-plugin)
12. [Contributing](#contributing)

---

## Requirements

- **Node.js ≥ 18** (ESM native support required)
- **npm ≥ 9** (or pnpm / yarn equivalent)
- An API key for at least one provider — *or* use `--mock` / `AI_MOCK=true` for zero-cost testing

> ⚠️ **ESM only.** This package sets `"type": "module"` in `package.json`. You cannot `require()` it.
> If your project uses CommonJS, use a dynamic `import()` wrapper or migrate to ESM.

---

## Installation

```bash
# Global CLI install
npm install -g ai-powered

# Local library install
npm install ai-powered

# Development (from source)
git clone https://github.com/mytech-today-now/ai-powered.git
cd ai-powered
npm install
npm run build
```

---

## Configuration

### Config file locations

Config is loaded from multiple layers and merged in priority order (lowest → highest):

| Layer | Path | Notes |
|-------|------|-------|
| Schema defaults | — | Zod defaults apply first |
| Global config | `~/.ai-powered/config.json` | Shared across all projects |
| Local config | `./.ai-powered/config.json` | Per-project overrides |
| Named profile | `config.profiles[name]` | Selected by `profile` key or `AI_PROFILE` |
| Environment vars | `AI_*`, `OPENAI_API_KEY`, etc. | See table below |
| CLI flags | `--provider`, `--model`, etc. | Highest precedence |

### Environment variables

| Variable | Config key | Example |
|----------|-----------|---------|
| `OPENAI_API_KEY` | `apiKey` (OpenAI) | `sk-…` |
| `ANTHROPIC_API_KEY` | `apiKey` (Anthropic) | `sk-ant-…` |
| `XAI_API_KEY` | `apiKey` (xAI) | `xai-…` |
| `VENICE_API_KEY` | `apiKey` (Venice) | `ven-…` |
| `AI_CUSTOM_API_KEY` | `apiKey` (custom) | any |
| `AI_PROVIDER` | `provider` | `openai` |
| `AI_MODEL` | `model` | `gpt-4o` |
| `AI_PROFILE` | `profile` | `production` |
| `AI_MOCK` | `mock` | `true` |
| `AI_BUDGET_SESSION` | `budgetSession` | `1.00` |
| `LOG_LEVEL` | `debug` | `debug` |

### Example config file

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "temperature": 0.7,
  "maxTokens": 2048,
  "systemPrompt": "You are a helpful assistant.",
  "stream": false,
  "fallbackProviders": ["anthropic", "mock"],
  "budgetSession": 1.00,
  "warnBudget": 0.8,
  "plugins": ["audit-log"],
  "profiles": {
    "production": {
      "temperature": 0.3,
      "maxTokens": 4096
    },
    "creative": {
      "temperature": 1.2
    }
  }
}
```

### Custom / self-hosted providers

```json
{
  "provider": "custom",
  "baseUrl": "http://localhost:11434/v1",
  "customProviderType": "ollama",
  "model": "llama3",
  "customHeaders": { "X-Internal-Token": "my-token" }
}
```

Supported `customProviderType` values: `"openai-compatible"` · `"ollama"` · `"other"`

---

## CLI Reference

All examples use `--mock` to avoid real API calls. Remove `--mock` and set your API key for live use.

### Global flags

| Flag | Description |
|------|-------------|
| `--provider <name>` | Override provider (`openai`, `anthropic`, `xai`, `venice`, `custom`, `mock`) |
| `--model <id>` | Override model identifier |
| `--profile <name>` | Use named profile from config |
| `--mock` | Force mock provider |
| `--dry-run` | Estimate cost; skip API call |
| `--quiet` | Print raw content only (no decorators) |
| `--json` | Print JSON envelope |
| `--session <id>` | Attach request to a named conversation session |
| `--log <path>` | Write structured JSONL log to file |
| `--debug` | Enable verbose debug logging |
| `--no-color` | Disable ANSI colors (also `NO_COLOR=1`) |

### `text` — Generate text

```bash
# Basic
ai-powered text --mock "Explain quantum entanglement."

# Quiet (raw content only — great for piping)
ai-powered text --mock --quiet "What is 2 + 2?" > answer.txt

# JSON envelope
ai-powered text --mock --json "Summarise TCP/IP in one sentence."

# Dry-run cost estimate
ai-powered text --mock --dry-run "Write a 1000-word essay."

# Multi-turn session
ai-powered text --mock --session my-session "My name is Alice."
ai-powered text --mock --session my-session "What is my name?"

# Streaming
ai-powered text --mock --stream "Tell me a story."

# Built-in template
ai-powered text --mock --template summarize --var text="Long article…"

# Custom system prompt
ai-powered text --mock --system "Reply only in French." "Hello!"
```

### `image` — Generate image

```bash
ai-powered image --mock --output image.png "A serene mountain lake at sunrise"
```

### `audio transcribe` — Transcribe audio

```bash
ai-powered audio transcribe --mock --file recording.mp3
```

### `audio speak` — Text-to-speech

```bash
ai-powered audio speak --mock --output speech.mp3 "Hello, world!"
```

### `video` — Generate video

```bash
ai-powered video --mock "A timelapse of clouds over a city"
```

### `structured` — Generate structured JSON

```bash
# Using an inline JSON schema file
cat > schema.json <<'EOF'
{
  "type": "object",
  "properties": {
    "name":       { "type": "string" },
    "capital":    { "type": "string" },
    "population": { "type": "number" }
  },
  "required": ["name", "capital", "population"]
}
EOF
ai-powered structured --mock --schema schema.json "Describe France."
```

### `batch` — Batch processing (JSONL)

```bash
# Create input file
printf '{"prompt":"Speed of light?"}\n{"prompt":"Who wrote Hamlet?"}\n' > input.jsonl

# Process batch
ai-powered batch text --mock --input input.jsonl --output output.jsonl

# View results
cat output.jsonl
```

### `serve` — Start HTTP proxy server

```bash
ai-powered serve --mock --port 3001
# Exposes: GET /health, GET /config, GET /models, POST /text, POST /stream, POST /image, etc.
```

### `session` — Manage conversation sessions

```bash
ai-powered session list
ai-powered session clear my-session
```

### `config` — Manage configuration

```bash
ai-powered config list                  # show all config values (keys masked)
ai-powered config get provider          # get one key
ai-powered config set temperature 0.5   # set a key
ai-powered config delete model          # remove a key
ai-powered config reset                 # restore defaults
ai-powered config path                  # print config file path
ai-powered config validate              # validate current config
```

### `list-models` — List available models

```bash
ai-powered list-models --provider openai
ai-powered list-models --provider openai --modality image
```

### `list-templates` — List built-in templates

```bash
ai-powered list-templates
```

### `health-check` — Check configuration and connectivity

```bash
ai-powered health-check         # validates config + API key + git credential safety
```

### `wizard` — Interactive setup

```bash
ai-powered wizard               # guided provider/model/API key setup with live validation
```

---

## Library Usage

> **ESM only.** Import from `"ai-powered"` — no `require()`.

### Quick start

```typescript
import { getAiClient } from "ai-powered";

// Use mock provider for testing (no API key required)
const client = getAiClient({ mock: true });

const result = await client.generateText("Hello, AI!");
console.log(result.content);    // string
console.log(result.usage);      // { promptTokens, completionTokens, totalTokens }
console.log(result.cost);       // { totalUsd, isEstimate }
console.log(result.latencyMs);  // number
```

### Text generation

```typescript
import { getAiClient } from "ai-powered";

const client = getAiClient({
  provider: "openai",
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: "You are a helpful assistant.",
});

const result = await client.generateText("Explain WebAssembly.");
```

### Image generation

```typescript
const result = await client.generateImage("A serene mountain lake at sunrise");
console.log(result.url);         // string | undefined
console.log(result.base64);      // string | undefined
```

### Audio transcription

```typescript
import { readFileSync } from "node:fs";

const audio = readFileSync("recording.mp3");
const result = await client.transcribeAudio(audio, "recording.mp3");
console.log(result.transcript);
console.log(result.durationSeconds);
```

### Speech synthesis

```typescript
const result = await client.synthesizeSpeech("Hello, world!");
// result.audioData is a Buffer (Node) or Uint8Array (browser)
```

### Video generation

```typescript
const result = await client.generateVideo("A timelapse of clouds over a city");
console.log(result.url);
```

### Structured JSON output

```typescript
import { z } from "zod";

const CountrySchema = z.object({
  name:       z.string(),
  capital:    z.string(),
  population: z.number(),
  in_europe:  z.boolean(),
});

const result = await client.generateStructured("Describe France.", CountrySchema);
console.log(result.data);   // typed as { name, capital, population, in_europe }
```

### Streaming text

```typescript
const stream = client.streamText("Tell me a long story.");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### Multi-turn conversation sessions

```typescript
import { getAiClient, ConversationSession } from "ai-powered";

const client = getAiClient({ mock: true });
const session = new ConversationSession("system: You are helpful.");

session.addMessage("user", "My name is Alice.");
const r1 = await client.generateText(session.buildPrompt());
session.addMessage("assistant", r1.content);

session.addMessage("user", "What is my name?");
const r2 = await client.generateText(session.buildPrompt());
console.log(r2.content); // "Alice"
```

### Loading config manually

```typescript
import { loadConfig, getAiClient } from "ai-powered";

const config = loadConfig({
  profileOverride: "production",
  flags: { temperature: 0.3 },
});

const client = getAiClient(config);
```

### Provider fallback

```typescript
const client = getAiClient({
  provider: "openai",
  fallbackProviders: ["anthropic", "mock"],
  fallback: true,                   // default: true
  circuitBreakerThreshold: 5,       // open circuit after 5 consecutive failures
  circuitBreakerResetMs: 60_000,    // probe after 60 s
});
```

### Budget enforcement

```typescript
const client = getAiClient({
  budgetSession: 0.50,   // max $0.50 per session
  warnBudget: 0.8,        // warn at 80% ($0.40)
});
// BudgetExceededError thrown before API call if projected cost exceeds limit
```

---


## AI Agent / Tool-Calling Usage

`ai-powered` is designed as a first-class tool for AI agent frameworks (LangChain, AutoGPT, custom orchestrators). The library exposes all five modalities as discrete, idempotent functions that map cleanly to function-calling schemas.

### OpenAI function-calling example

```typescript
import OpenAI from "openai";
import { getAiClient } from "ai-powered";

const openai = new OpenAI();
const aiClient = getAiClient({ mock: true });

// Define tools backed by ai-powered
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "generate_text",
      description: "Generate text from a prompt using the configured AI provider.",
      parameters: {
        type: "object",
        properties: {
          prompt:      { type: "string", description: "The user prompt." },
          temperature: { type: "number", description: "Sampling temperature 0–2." },
          maxTokens:   { type: "integer", description: "Max tokens to generate." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image from a text description.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image description." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_structured",
      description: "Generate structured JSON matching a Zod schema.",
      parameters: {
        type: "object",
        properties: {
          prompt:     { type: "string" },
          schemaName: { type: "string", description: "Schema identifier known to the agent." },
        },
        required: ["prompt", "schemaName"],
      },
    },
  },
];

// Tool dispatch map
async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "generate_text": {
      const result = await aiClient.generateText(args.prompt as string, {
        temperature: args.temperature as number | undefined,
        maxTokens:   args.maxTokens   as number | undefined,
      });
      return result.content;
    }
    case "generate_image": {
      const result = await aiClient.generateImage(args.prompt as string);
      return result.url ?? result.base64 ?? "No image data";
    }
    case "generate_structured": {
      const { z } = await import("zod");
      // Example: resolve a named schema
      const schema = z.object({ answer: z.string() });
      const result = await aiClient.generateStructured(args.prompt as string, schema);
      return JSON.stringify(result.data);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// Agentic loop
async function agentLoop(userMessage: string) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice) break;

    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      console.log("Agent response:", choice.message.content);
      break;
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        const result = await dispatchTool(toolCall.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }
  }
}

await agentLoop("Generate an image of a sunset and then describe it.");
```

### Machine-readable tool schema (JSON)

Agents that use raw JSON schemas (e.g. Anthropic tool_use) can use this schema block directly:

```json
{
  "tools": [
    {
      "name": "generate_text",
      "description": "Generate text using ai-powered. Supports all configured providers.",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt":       { "type": "string"  },
          "provider":     { "type": "string", "enum": ["openai","anthropic","xai","venice","mock"] },
          "model":        { "type": "string"  },
          "temperature":  { "type": "number"  },
          "maxTokens":    { "type": "integer" },
          "systemPrompt": { "type": "string"  }
        },
        "required": ["prompt"]
      }
    },
    {
      "name": "generate_image",
      "description": "Generate an image from a text description.",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt":   { "type": "string" },
          "provider": { "type": "string" },
          "model":    { "type": "string" }
        },
        "required": ["prompt"]
      }
    },
    {
      "name": "transcribe_audio",
      "description": "Transcribe audio file (base64-encoded) to text.",
      "input_schema": {
        "type": "object",
        "properties": {
          "audioBase64": { "type": "string" },
          "filename":    { "type": "string" }
        },
        "required": ["audioBase64"]
      }
    },
    {
      "name": "synthesize_speech",
      "description": "Convert text to speech. Returns base64-encoded audio.",
      "input_schema": {
        "type": "object",
        "properties": {
          "text":  { "type": "string" },
          "model": { "type": "string" }
        },
        "required": ["text"]
      }
    },
    {
      "name": "generate_structured",
      "description": "Generate a structured JSON object validated against a schema.",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt":     { "type": "string" },
          "jsonSchema": { "type": "object", "description": "JSON Schema for the output object." }
        },
        "required": ["prompt", "jsonSchema"]
      }
    }
  ]
}
```

### HTTP proxy tool-calling (serve mode)

When running `ai-powered serve`, all five modalities are available as HTTP endpoints. Agents can call them directly:

```
POST http://localhost:3001/text         { "prompt": "…", "provider": "openai" }
POST http://localhost:3001/image        { "prompt": "…" }
POST http://localhost:3001/structured   { "prompt": "…" }
POST http://localhost:3001/audio/transcribe  { "audioBase64": "…" }
POST http://localhost:3001/audio/speak  { "text": "…" }
POST http://localhost:3001/video        { "prompt": "…" }
GET  http://localhost:3001/health       → { "status": "ok" }
GET  http://localhost:3001/models       → [{ "id": "…", "name": "…" }]
```

All endpoints accept per-request overrides (`provider`, `model`, `temperature`, `profile`).

---

## Browser / Web Usage

The `ai-powered/web` entry point ships a Vite-built ESM+UMD bundle (`dist-web/`) with **no Node.js built-in dependencies**.

### Two modes

| Mode | Use case | API key exposure |
|------|----------|-----------------|
| **proxy** | Production | Key stays on your server — browser never sees it |
| **direct** | Dev / demo only | Key visible in DevTools — non-suppressible DOM banner shown |

### Proxy mode (recommended)

Start the proxy server on your backend:

```bash
ai-powered serve --port 3001
```

Then in your browser app:

```typescript
import { createWebClient } from "ai-powered/web";

const client = createWebClient({
  mode: "proxy",
  proxyUrl: "http://localhost:3001",
});

const result = await client.generateText("Hello from the browser!");
console.log(result.content);
```

### Streaming in proxy mode (SSE)

```typescript
const response = await fetch("http://localhost:3001/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Tell me a story." }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value, { stream: true }).split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") return;
    const { delta } = JSON.parse(payload);
    document.getElementById("output")!.textContent += delta;
  }
}
```

### Direct mode (development only)

```typescript
const client = createWebClient({
  mode: "direct",
  provider: "openai",
  apiKey: "sk-…",   // ⚠️ visible in DevTools — dev/demo only
});

const result = await client.generateText("Hello!");
```

### Browser conversation sessions

```typescript
import { BrowserConversationSession } from "ai-powered/web";

const session = new BrowserConversationSession("chat-1");
// State is persisted to sessionStorage automatically
session.addMessage("user", "Hello!");
const history = session.getMessages();
```

### HTML quick-start

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>ai-powered demo</title></head>
  <body>
    <textarea id="prompt">Explain WebAssembly.</textarea>
    <button id="btn">Generate</button>
    <pre id="output"></pre>

    <script type="module">
      import { createWebClient } from "https://cdn.jsdelivr.net/npm/ai-powered/dist-web/ai-powered.esm.js";

      document.getElementById("btn").addEventListener("click", async () => {
        const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
        const result = await client.generateText(document.getElementById("prompt").value);
        document.getElementById("output").textContent = result.content;
      });
    </script>
  </body>
</html>
```

### Vite / bundler integration

```typescript
// vite.config.ts — resolve ai-powered/web to local source in dev
import { defineConfig } from "vite";
export default defineConfig({
  resolve: {
    alias: { "ai-powered/web": "/src/ai-powered/web/index.ts" },
  },
});
```

---

## Cross-Language Shell Integration

`ai-powered` is callable from any language that can invoke a subprocess. The CLI is the integration point.
All examples set `AI_MOCK=true` to avoid real API calls during development.

### Bash

```bash
# integrations/bash-example.sh
export AI_MOCK=true
result=$(ai-powered text --quiet "What is 2+2?")
echo "Answer: $result"

# Batch processing
printf '{"prompt":"Speed of light?"}\n{"prompt":"Who wrote Hamlet?"}\n' > input.jsonl
ai-powered batch text --input input.jsonl --output output.jsonl
```

### Python

```python
# integrations/python-example.py
import subprocess, os

def ask(prompt: str) -> str:
    result = subprocess.run(
        ["ai-powered", "text", "--mock", "--quiet", prompt],
        capture_output=True, text=True, check=True,
        env={**os.environ, "AI_MOCK": "true"},
    )
    return result.stdout.strip()

print(ask("Explain REST APIs in one sentence."))
```

### PowerShell

```powershell
# integrations/powershell-example.ps1
$env:AI_MOCK = "true"
$result = ai-powered text --mock --quiet "What is quantum computing?"
Write-Host "Answer: $result"
```

### Windows Batch

```bat
REM integrations/batch-example.bat
set AI_MOCK=true
for /f "delims=" %%i in ('ai-powered text --mock --quiet "What is the speed of light?"') do set RESULT=%%i
echo Answer: %RESULT%
```

### Go

```go
// integrations/go-example.go
package main

import (
    "fmt"
    "os"
    "os/exec"
    "strings"
)

func ask(prompt string) (string, error) {
    cmd := exec.Command("ai-powered", "text", "--mock", "--quiet", prompt)
    cmd.Env = append(os.Environ(), "AI_MOCK=true")
    out, err := cmd.Output()
    return strings.TrimSpace(string(out)), err
}

func main() {
    answer, _ := ask("Explain TCP/IP in one sentence.")
    fmt.Println(answer)
}
```

### Java

```java
// integrations/java-example.java
import java.io.*;
import java.util.*;

public class AiPoweredExample {
    public static String ask(String prompt) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("ai-powered", "text", "--mock", "--quiet", prompt);
        pb.environment().put("AI_MOCK", "true");
        pb.redirectErrorStream(true);
        Process process = pb.start();
        return new String(process.getInputStream().readAllBytes()).trim();
    }
    public static void main(String[] args) throws Exception {
        System.out.println(ask("Explain REST APIs in one sentence."));
    }
}
```

### C#

```csharp
// integrations/csharp-example.cs
using System.Diagnostics;

static string Ask(string prompt) {
    var psi = new ProcessStartInfo("ai-powered", $"text --mock --quiet \"{prompt}\"") {
        RedirectStandardOutput = true,
        UseShellExecute = false,
        Environment = { ["AI_MOCK"] = "true" }
    };
    using var p = Process.Start(psi)!;
    return p.StandardOutput.ReadToEnd().Trim();
}

Console.WriteLine(Ask("Explain quantum computing."));
```

### Ruby

```ruby
# integrations/ruby-example.rb
require 'open3'

def ask(prompt)
  stdout, _status = Open3.capture2(
    { 'AI_MOCK' => 'true' },
    'ai-powered', 'text', '--mock', '--quiet', prompt
  )
  stdout.strip
end

puts ask('What is machine learning?')
```

### Rust

```rust
// integrations/rust-example.rs
use std::process::Command;

fn ask(prompt: &str) -> String {
    let output = Command::new("ai-powered")
        .args(["text", "--mock", "--quiet", prompt])
        .env("AI_MOCK", "true")
        .output()
        .expect("Failed to run ai-powered");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn main() {
    println!("{}", ask("Explain REST APIs."));
}
```

### PHP

```php
<?php
// integrations/php-example.php
putenv('AI_MOCK=true');
$prompt = escapeshellarg('Explain REST APIs in one sentence.');
$result = trim(shell_exec("ai-powered text --mock --quiet $prompt"));
echo $result . PHP_EOL;
```

### Perl

```perl
#!/usr/bin/env perl
# integrations/perl-example.pl
$ENV{AI_MOCK} = 'true';
my $result = `ai-powered text --mock --quiet "Explain REST APIs."`;
chomp $result;
print "$result\n";
```

Full integration scripts are available in the [`integrations/`](integrations/) directory.

---

## Security Best Practices

### API key protection

- **Never commit API keys** to version control. Use `~/.ai-powered/config.json` (global) or environment variables.
- The `health-check` command warns if a config file containing an API key is tracked by git.
- All log output passes through `maskApiKey()` which redacts key values:
  - `sk-…` → `sk-...****`
  - `sk-ant-…` → `sk-ant-...****`
  - `xai-…` → `xai-...****`
  - `ven-…` → `ven-...****`
- The pre-commit hook scans staged files for any of these patterns and aborts if found.

### Audit log plugin

Enable the built-in `audit-log` plugin for a tamper-evident, key-safe audit trail:

```json
{ "plugins": ["audit-log"] }
```

Each entry in `ai-powered-audit.jsonl` looks like:

```json
{
  "type": "request",
  "timestamp": "2026-03-28T12:00:00.000Z",
  "modality": "text",
  "provider": "openai",
  "model": "gpt-4o",
  "promptHash": "a3f1…",
  "apiKeyMasked": "sk-...****",
  "options": { "temperature": 0.7, "maxTokens": 1024 }
}
```

Raw prompts are stored as **SHA-256 hashes** — they can be verified but not reversed.

### Browser security

- Always use **proxy mode** in production. The API key never leaves your server.
- **Direct mode** renders a non-suppressible DOM banner warning users the key is in DevTools.
- The Vite build post-process step scans `dist-web/` for leaked key prefixes and aborts if found.

### Prompt injection defense

The built-in `prompt-shield` plugin heuristically detects common injection patterns:

```json
{ "plugins": ["prompt-shield"] }
```

Set `reject: true` in the plugin config to block flagged requests instead of only logging:

```typescript
import { createPromptShieldPlugin } from "ai-powered";
const shield = createPromptShieldPlugin({ reject: true });
```

### Budget limits

Set `budgetSession` in config or via flags to cap spend per session:

```bash
ai-powered text --budget-session 0.10 --mock "Write an essay."
```

A `BudgetExceededError` is thrown _before_ the API call if the projected cost would exceed the limit.

---

## Architecture Overview

`ai-powered` supports **four invocation modes**, each suitable for different contexts:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ai-powered architecture                          │
├─────────────────┬───────────────┬──────────────────┬────────────────────┤
│   Mode 1: CLI   │ Mode 2: Lib   │ Mode 3: Agent    │  Mode 4: Browser   │
│                 │               │  Tool-Calling    │                    │
│ ai-powered text │ getAiClient() │ HTTP POST /text  │ createWebClient()  │
│ ai-powered image│ AiClient.*    │ HTTP POST /image │ proxy or direct    │
│ ai-powered serve│ loadConfig()  │ GET /health      │ BrowserConvSession │
│ ai-powered batch│               │                  │ SSE streaming      │
└────────┬────────┴───────┬───────┴────────┬─────────┴────────────────────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
              ┌─────────────────────┐
              │    AiClient core    │
              │  Plugin pipeline    │
              │  Budget tracking    │
              │  Circuit breakers   │
              │  Retry / fallback   │
              └─────────┬───────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    OpenAiProvider  AnthropicProvider  VeniceProvider
    GrokProvider    CustomProvider     MockProvider
```

### Config layers (lowest → highest precedence)

```
Schema defaults → Global config → Local config → Named profile → Env vars → CLI flags
```

### Plugin pipeline execution order

```
Request:  plugin[0].onRequest → plugin[1].onRequest → … → provider call
Response: … → plugin[1].onResponse → plugin[0].onResponse
Error:    plugin[0].onError → plugin[1].onError → …
```

Plugins receive a **frozen snapshot** of `AiConfig` — mutations throw `TypeError`. An unhandled error in a plugin is caught, wrapped as `PluginError`, logged, and the plugin is bypassed for the remainder of the session.

### ESM-only design (Decision D1)

This package uses `"type": "module"` and ships only ES Modules. This decision was made to:
- Support top-level `await` in CLI entry points
- Enable tree-shaking in Vite browser bundles
- Align with the direction of the Node.js and npm ecosystems
- Avoid dual-package hazards (CJS/ESM singleton state issues)

**Migration path for CJS consumers:** wrap the import in a dynamic `import()` or migrate to `"type": "module"`.

---


## Writing a Plugin

Plugins are the primary extension point for `ai-powered`. A plugin is any ESM module that exports an object conforming to the `AiPlugin` interface. Plugins can observe, modify, or react to every request/response/error cycle without touching core library code.

### The `AiPlugin` interface

```typescript
import type { AiPlugin, RequestContext, ResponseContext, AiPoweredError } from "ai-powered";

export const myPlugin: AiPlugin = {
  /** Required: unique plugin identifier. Used in logs and error messages. */
  name: "my-plugin",

  /** Optional: semver version string. */
  version: "1.0.0",

  /** Optional: human-readable description. */
  description: "A short description of what this plugin does.",

  /**
   * Called before every provider API call.
   * Receives the full request context; must return the (possibly modified) context.
   * Throw PluginError to signal a non-fatal failure — the plugin is bypassed.
   * Throw any other error to abort the request entirely.
   */
  async onRequest(ctx: RequestContext): Promise<RequestContext> {
    // ctx.config      — frozen AiConfig snapshot (mutations throw TypeError)
    // ctx.messages    — mutable message array
    // ctx.modality    — "text" | "image" | "audio" | "video" | "structured"
    return ctx;
  },

  /**
   * Called after every successful provider response.
   * Receives the response context; must return the (possibly modified) context.
   */
  async onResponse(ctx: ResponseContext): Promise<ResponseContext> {
    // ctx.result      — typed result object (TextResult, ImageResult, etc.)
    // ctx.modality    — same modality as the request
    return ctx;
  },

  /**
   * Called for every AiPoweredError (provider errors, budget errors, etc.).
   * Return void; errors thrown here are logged but do not propagate.
   */
  async onError(error: AiPoweredError): Promise<void> {
    // error.code      — machine-readable error code string
    // error.message   — human-readable message
  },
};
```

### Key `RequestContext` fields

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Readonly<AiConfig>` | Frozen config snapshot — mutations throw `TypeError` |
| `messages` | `Array<{role, content}>` | Mutable message list |
| `modality` | `Modality` | Active modality for this request |

### Key `ResponseContext` fields

| Field | Type | Description |
|-------|------|-------------|
| `result` | `TextResult \| ImageResult \| …` | Provider response |
| `modality` | `Modality` | Active modality |

### Full example: rate-limiter plugin

```typescript
// plugins/rate-limiter.ts
import type { AiPlugin, RequestContext, AiPoweredError } from "ai-powered";

export interface RateLimiterOptions {
  /** Max requests per window. Default: 10. */
  maxRequests?: number;
  /** Window duration in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
}

export function createRateLimiterPlugin(opts: RateLimiterOptions = {}): AiPlugin {
  const maxRequests = opts.maxRequests ?? 10;
  const windowMs    = opts.windowMs    ?? 60_000;
  const timestamps: number[] = [];

  return {
    name: "rate-limiter",
    version: "1.0.0",
    description: `Limits to ${maxRequests} requests per ${windowMs / 1000}s window.`,

    async onRequest(ctx: RequestContext): Promise<RequestContext> {
      const now = Date.now();
      // Evict timestamps outside the current window
      while (timestamps.length > 0 && now - timestamps[0]! > windowMs) {
        timestamps.shift();
      }

      if (timestamps.length >= maxRequests) {
        const resetIn = windowMs - (now - timestamps[0]!);
        throw new Error(
          `Rate limit exceeded: ${maxRequests} req/${windowMs}ms. ` +
          `Reset in ${Math.ceil(resetIn / 1000)}s.`
        );
      }

      timestamps.push(now);
      return ctx;
    },

    async onError(error: AiPoweredError): Promise<void> {
      // Optionally log rate limit errors differently
      if (error.message.includes("Rate limit exceeded")) {
        console.warn("[rate-limiter]", error.message);
      }
    },
  };
}
```

### Registering plugins

**Via config file** (string identifiers — built-ins or npm packages):

```json
{
  "plugins": [
    "audit-log",
    "rate-limiter",
    "./plugins/my-plugin.js",
    "@my-scope/ai-powered-plugin"
  ]
}
```

**Via the library API** (plugin objects — for programmatic control):

```typescript
import { getAiClient } from "ai-powered";
import { createRateLimiterPlugin } from "./plugins/rate-limiter.js";

const client = getAiClient({
  mock: true,
  plugins: ["audit-log"],               // string: built-in or npm package
}, [
  createRateLimiterPlugin({ maxRequests: 20, windowMs: 30_000 }),  // object: programmatic
]);
```

### Plugin sandboxing

- **Frozen config:** `ctx.config` is a deep-frozen snapshot of `AiConfig`. Any attempt to mutate it throws a `TypeError`. This ensures plugins cannot alter global configuration.
- **PluginError isolation:** If a plugin's hook throws an error that is *not* intentionally re-thrown by the caller, it is caught, wrapped as a `PluginError`, and logged. The plugin is then bypassed for subsequent hooks in the current request cycle.
- **Bypass behaviour:** A bypassed plugin still receives `onError` callbacks (from a separate try-catch) so audit-style plugins never miss error events.

### Error handling in plugins

```typescript
import { PluginError } from "ai-powered";

async onRequest(ctx: RequestContext): Promise<RequestContext> {
  try {
    await someExternalCall();
  } catch (err) {
    // Throw PluginError for non-fatal plugin failures:
    // the plugin is bypassed but the request continues normally.
    throw new PluginError("my-plugin", "External call failed", { cause: err });
  }
  return ctx;
}
```

### Built-in plugins

| Plugin ID | Factory | Description |
|-----------|---------|-------------|
| `"audit-log"` | `createAuditLogPlugin(opts)` | JSONL audit trail with masked keys and SHA-256 prompt hashes |
| `"rate-limiter"` | `createRateLimiterPlugin(opts)` | Token-bucket rate limiter per sliding window |
| `"prompt-shield"` | `createPromptShieldPlugin(opts)` | Heuristic prompt injection detector |

### Publishing a plugin to npm

1. Create an ESM package with `"type": "module"` in `package.json`.
2. Export your plugin factory as a **named export**:

```typescript
// index.ts
export { createMyPlugin } from "./my-plugin.js";
export type { MyPluginOptions } from "./my-plugin.js";
```

3. Name the package with the `ai-powered-plugin-` prefix by convention:

```json
{
  "name": "ai-powered-plugin-my-feature",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "ai-powered": ">=0.1.0"
  }
}
```

4. Users register it by package name:

```json
{ "plugins": ["ai-powered-plugin-my-feature"] }
```

> `ai-powered` dynamically imports plugin strings via `import(pluginId)`. The default export **or** a named export called `default` or `plugin` is used if the import resolves to a module rather than an `AiPlugin` object directly.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit conventions, PR process, and the full plugin authoring guide.

**Quick summary:**

```bash
# Clone and install
git clone https://github.com/mytech-today-now/ai-powered.git
cd ai-powered
npm install

# Build
npm run build

# Run all tests (mock provider — no API key required)
AI_MOCK=true npm test

# Lint and format
npm run lint && npm run format

# Start the web dev server
npm run dev:web

# Start the proxy server (mock)
npm run serve
```

**Branch naming:** `feat/<slug>` · `fix/<slug>` · `docs/<slug>` · `refactor/<slug>` · `ci/<slug>` · `release/v<semver>`

**Commit format:** `feat(scope): description` following [Conventional Commits](https://www.conventionalcommits.org/).

---

*Made with ❤️ and AI by the ai-powered contributors.*
