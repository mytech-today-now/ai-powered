# Hosted proxy authentication

The ai-powered server requires an application credential before provider,
upload, file, and operational work is performed. A provider credential sent in
the request body or provider-specific header is not caller authentication.

Supported application credentials are:

- `Authorization: Bearer <agent JWT>`: verified with the configured JWT
  authentication settings.
- `X-AI-Agent-Key: <agent API key>`: verified through `AIPOWERED_AUTH_ENDPOINT`.
- `X-AI-API-Key: <global API key>`: compared with `AIPOWERED_API_KEY`.

The server returns generic `401` responses for missing or invalid credentials
and `403` when an authenticated principal lacks the route scope. Raw tokens,
API keys, and upstream authentication details are not returned in responses or
request logs. The request principal is attached to the Express request for
rate limiting and structured logging as a non-secret identifier.

`OPTIONS`, `GET /health`, and browser shell/static assets are public. API,
provider, upload, file, and compatibility routes are protected. CORS only
controls browser transport policy and never authorizes a caller.

Agent scopes currently used by the proxy are `generate`, `files:write`,
`files:read`, and `read`; the configured global service key is unrestricted.
Authentication and scope ownership for per-user budgets and stored-file access
remain follow-up integration points where the existing route architecture does
not yet expose resource ownership.

For legacy Vitest fixtures only, the server permits the test runner's explicit
mock bypass. Auth boundary tests set `auth.required: true`, which disables that
bypass. Deployments do not receive this bypass.
