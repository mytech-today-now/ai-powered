# Security Policy

## Key-Handling Rules

1. **Never commit API keys.** All key files (`.env`, `.env.local`, `.ai-powered/config.json`)
   are listed in `.gitignore`. The Husky pre-commit hook aborts the commit if any staged file
   contains a recognised key prefix (`sk-`, `sk-ant-`, `xai-`, `ven-`).

2. **Always use `maskApiKey`.** Every log statement, error message, and CLI output path that
   could contain an API key MUST call `maskApiKey(key)` before including it. This is enforced
   by ESLint rule and verified in `health-check`.

3. **maskApiKey masking standard.** Keys are masked to show the prefix and first 4 characters
   after the prefix, followed by `****`. Examples:
   - `sk-abcdefgh...` → `sk-abcd****`
   - `sk-ant-api03-abc...` → `sk-ant-api03-abc****` (truncated)
   - Unknown format → `****`

4. **Config file permissions.** `~/.ai-powered/config.json` SHOULD have permissions `0600`
   (owner read/write only). The CLI emits a `WARN` if the file is world-readable.

5. **Credential warning.** At startup and in `health-check`, the CLI warns if `.env` or
   any config file is tracked by git (`git ls-files --error-unmatch`).

## Browser / Proxy Mode

**Direct mode (browser only) is NOT safe for production.**

When `createWebClient({ mode: "direct", apiKey: "..." })` is used, the API key is embedded in
the browser bundle and visible to all users. This mode is intended ONLY for local development
and experimentation.

**For any production web deployment, use proxy mode:**

```javascript
const client = createWebClient({
  mode: "proxy",
  proxyUrl: "https://your-server.example.com",
});
```

The proxy server (`ai-powered serve`) holds API keys server-side and is the ONLY approved
production deployment for browser consumers. The Vite build step scans `dist-web/` for known
key prefixes and fails the build if any are found.

A visible DOM warning banner is injected automatically when direct mode is active.

## Vulnerability Reporting

**Please do NOT open public GitHub issues for security vulnerabilities.**

Report vulnerabilities by emailing `security@mytech.today` with:

1. A description of the vulnerability and affected component.
2. Steps to reproduce (proof-of-concept code if available).
3. Potential impact assessment.
4. Your preferred disclosure timeline (we aim for 90 days).

We will acknowledge receipt within 48 hours and provide a fix timeline within 7 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

Older versions receive security patches only; feature development targets the latest minor.

