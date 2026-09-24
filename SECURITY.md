# Security Policy

## Key-Handling Rules

1. **Never commit API keys.** All key files (`.env`, `.env.local`, `.ai-powered/config.json`)
   are listed in `.gitignore`. The Husky pre-commit hook aborts the commit if any staged file
   contains a recognised key prefix (`sk-`, `sk-ant-`, `xai-`, `VENICE_INFERENCE_KEY_`).

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

### Browser settings credentials

The demo Settings / Configuration page stores provider-scoped credentials in
browser storage for local use. Generation requests never put those values in
JSON bodies, query strings, page text, or application logs. The browser client
uses the `X-AI-Provider-Credentials` header and the proxy decodes it only for
the current request. Multi-field credentials are serialized as an object, not
split across URL parameters.

Credential forwarding is fail-closed for arbitrary cross-origin proxy URLs. It
is enabled for localhost and for a page served by the same origin as the proxy.
Use a same-origin deployment for the ngrok and Render browser workflows.

### CORS origin policy

The proxy uses CORS only to control whether a browser may read a response. It
does not authenticate the caller; protected routes still require the separately
configured application credential. The request-origin decisions are:

| Request condition                                                                | CORS result                                                                                                          | Authentication result                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `Origin` host matches `Host` and its scheme matches the effective request scheme | Same-origin handling bypasses cross-origin CORS headers. `X-Forwarded-Proto` is used for TLS-terminated deployments. | The normal route authentication policy applies. |
| Valid HTTP(S) origin exactly matches `CORS_ORIGIN`                               | `Access-Control-Allow-Origin` reflects that origin.                                                                  | The normal route authentication policy applies. |
| Valid HTTP(S) origin matches a configured one-label `*` pattern                  | `Access-Control-Allow-Origin` reflects that origin.                                                                  | The normal route authentication policy applies. |
| `CORS_ORIGIN=*` is explicitly configured                                         | Any valid HTTP(S) origin is allowed. This is a development-only transport setting, not authentication.               | The normal route authentication policy applies. |
| `Origin: null` (for example, a `file://` or sandboxed document)                  | No CORS permission is granted, so browser script cannot read the response.                                           | The normal route authentication policy applies. |
| Missing or malformed `Origin`, or an untrusted host/scheme                       | No CORS permission is granted. Missing `Origin` remains usable for non-browser HTTP clients.                         | The normal route authentication policy applies. |

Missing `Origin` is never treated as proof of same-origin access. File-based
demos must use a separately authenticated, deliberately configured path; they
must not gain access to provider or file data merely because the browser sends
the literal `null` origin.

### Uploaded file references

Uploaded refs are bound to the authenticated proxy principal at upload time.
`GET /files/:uuid` and `DELETE /files/:uuid` require that same principal and
return a generic not-found response for missing, expired, revoked, or
cross-principal refs. The response keeps MIME and content length while using
`private, no-store`; cache headers are not authorization.

Providers that need a reachable media URL receive a separate
`/files/provider` URL containing a provider-bound HMAC capability. Capabilities
expire after five minutes, are invalidated when the underlying ref is deleted,
and are not accepted by the ordinary download route. Request logging redacts
file paths and capability query strings; upload logs omit file refs and private
filenames.

File refs are bounded per process by aggregate count and byte limits, per-
principal count and byte limits, and a separate decoded-buffer cache ceiling.
The defaults and environment overrides are documented in the README. Rejection
is a recoverable capacity error; it does not bypass ownership or MIME checks.
Refs expire after one hour and are removed eagerly with their decoded buffers.
The store is process-local: a restart loses refs, and multiple instances do
not share them. Deployments requiring restart or cross-instance continuity
must add a shared durable store with equivalent ownership, cleanup, encryption,
and private-cache controls before enabling that topology.

### Browser settings credentials

The demo Settings / Configuration page stores provider-scoped credentials in
browser storage for local use. Generation requests never put those values in
JSON bodies, query strings, page text, or application logs. The browser client
uses the `X-AI-Provider-Credentials` header and the proxy decodes it only for
the current request. Multi-field credentials are serialized as an object, not
split across URL parameters.

Credential forwarding is fail-closed for arbitrary cross-origin proxy URLs. It
is enabled for localhost and for a page served by the same origin as the proxy.
Use a same-origin deployment for the ngrok and Render browser workflows.

### Webhook callback destinations

Single-shot webhook delivery is scheduled only after the request resolves an
authenticated callback owner. The service-level `AIPOWERED_API_KEY` is the
trusted service principal; JWT and agent API-key callbacks remain tied to the
resolved agent identity and are rechecked before asynchronous failure delivery.

Callback destinations must use HTTPS on the default port and resolve only to
public addresses. Loopback, private, link-local, and invalid destinations are
rejected. Redirects are not followed, and callback responses are not read
beyond the bounded response-header policy. Set
`AIPOWERED_WEBHOOK_TEST_MODE=true` only for controlled localhost test fixtures;
it is not a production network policy.

Webhook delivery preserves the signed event body for valid deliveries. Failed
and rejected deliveries log only event metadata, a stable event ID, attempt
count, and a SHA-256 destination hash. Raw callback URLs, filesystem paths,
payload error messages, and signing keys are not written to the failure log.

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
| ------- | --------- |
| 0.1.x   | ✅ Yes    |

Older versions receive security patches only; feature development targets the latest minor.
