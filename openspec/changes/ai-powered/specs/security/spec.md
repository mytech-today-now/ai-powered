## ADDED Requirements

### Requirement: Consistent API key masking
The system SHALL implement a single `maskApiKey(key: string): string` utility in
`src/ai-powered/utils.ts` used everywhere keys appear in logs, status output, error messages,
and wizard confirmations. Masking rules SHALL be: OpenAI → `sk-****`, Anthropic → `sk-ant-****`,
xAI/Grok → `xai-****`, Venice.ai → `ven-****`, unknown/custom → `[REDACTED]`.

#### Scenario: OpenAI key masked in log
- **WHEN** a request is logged and the OpenAI API key `sk-abc123...` appears in context
- **THEN** the log entry shows `sk-****` and not the raw key value

#### Scenario: Unknown key falls back to REDACTED
- **WHEN** a custom provider key with an unrecognized prefix is present
- **THEN** `maskApiKey` returns `[REDACTED]`

#### Scenario: maskApiKey used in error messages
- **WHEN** a `ProviderError` is thrown and formatted for display
- **THEN** no raw API key appears in the error message string

---

### Requirement: .gitignore auto-management
The system SHALL automatically append the following entries to `.gitignore` in any repo
where `ai-powered --init` is run (if not already present): `.env`, `.env.local`,
`.ai-powered/config.json`, `ai-powered.jsonl`, `ai-powered-audit.jsonl`,
`~/.ai-powered/`, `dist-web/`, `logs/`. The system SHALL NEVER overwrite or corrupt
existing `.gitignore` content.

#### Scenario: --init adds entries to .gitignore
- **WHEN** `ai-powered --init` is run in a repo with an existing `.gitignore`
- **THEN** all required entries are appended if not already present; existing lines are untouched

#### Scenario: Duplicate entries not added
- **WHEN** `ai-powered --init` is run twice
- **THEN** the second run detects existing entries and adds no duplicates

---

### Requirement: Pre-commit secret scanning via Husky
The system SHALL include a Husky pre-commit hook that scans staged files for patterns
matching known API key prefixes (`sk-`, `sk-ant-`, `xai-`, `ven-`). If a potential key
is found, the commit SHALL be aborted with a clear error message naming the file and line.

#### Scenario: Pre-commit hook blocks commit with key
- **WHEN** a developer stages a file containing `OPENAI_API_KEY=sk-abc123`
- **THEN** the pre-commit hook aborts the commit and prints the file name and line number

---

### Requirement: Vite browser bundle secret scanning
The system SHALL include a Vite plugin (or post-build step) that scans `dist-web/` output
for any occurrence of known key prefixes (`sk-`, `sk-ant-`, `xai-`, `ven-`). If any are
found, `npm run build:web` SHALL fail with a non-zero exit code and a descriptive error.
`dist-web/` SHALL be listed in `.gitignore`.

#### Scenario: Build fails if key found in bundle
- **WHEN** a developer accidentally imports a config file with a real API key and builds
- **THEN** `npm run build:web` exits with code 1 naming the key prefix and file location

#### Scenario: dist-web/ excluded from git
- **WHEN** `git status` is run after a successful `npm run build:web`
- **THEN** `dist-web/` does not appear as an untracked or modified path

---

### Requirement: Runtime git-tracked credential warning
The system SHALL check at startup (and during `health-check`) whether any credential file
(`.env`, `.ai-powered/config.json`) is tracked by git. If so, it SHALL emit a WARNING
log and (in non-quiet mode) print a user-facing alert suggesting they add the file to `.gitignore`.

#### Scenario: Warning emitted for git-tracked .env
- **WHEN** `.env` is tracked in git and `ai-powered` starts
- **THEN** a WARNING is logged: "Credential file '.env' is tracked by git. Add to .gitignore immediately."

---

### Requirement: Browser direct-mode security warning
The web module in direct mode SHALL render a visible on-screen warning banner in the DOM
(red background, fixed position) in addition to `console.warn`. This banner SHALL NOT be
suppressible programmatically. The SECURITY.md and README SHALL document that proxy mode
is the ONLY production-safe browser deployment pattern.

#### Scenario: Direct mode shows on-screen banner
- **WHEN** `createWebClient({ mode: 'direct', ... })` is called in a browser
- **THEN** a visible red warning banner is injected into the DOM reading "WARNING: Direct
  mode exposes your API key. Use proxy mode in production."

