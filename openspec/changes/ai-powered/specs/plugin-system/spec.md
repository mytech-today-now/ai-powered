## ADDED Requirements

### Requirement: AiPlugin interface
The system SHALL define and export the `AiPlugin` interface from `src/ai-powered/index.ts`:
```ts
interface AiPlugin {
  name: string;
  version: string;
  description?: string;
  onRequest?(ctx: RequestContext): Promise<RequestContext>;
  onResponse?(ctx: ResponseContext): Promise<ResponseContext>;
  onError?(err: AiPowerError): Promise<void>;
}
```
Plugins SHALL be discovered from the `plugins` array in config (file paths or npm package
names), loaded dynamically via `import()`, and composed into an ordered pipeline.

#### Scenario: Plugin loaded from config
- **WHEN** `plugins: ['./my-plugin.js']` is set in config
- **THEN** the system dynamically imports the module and registers it in the pipeline

#### Scenario: Plugin loaded from npm package name
- **WHEN** `plugins: ['ai-powered-audit-plugin']` is set in config
- **THEN** the system resolves and imports the npm package as a plugin

---

### Requirement: Plugin pipeline execution
The system SHALL invoke `onRequest` hooks on every provider call (in registration order)
before dispatching the request, and `onResponse` hooks after receiving the response (in
reverse order). `onError` SHALL be called for every plugin when a `AiPowerError` is thrown.
Plugins SHALL NOT be able to mutate the `AiConfig` object directly.

#### Scenario: onRequest hook transforms context
- **WHEN** a plugin's `onRequest` modifies `ctx.messages` (e.g., prepends a system message)
- **THEN** the provider receives the modified messages in the actual API call

#### Scenario: Failed plugin is bypassed
- **WHEN** a plugin's `onRequest` throws an error
- **THEN** the system wraps it as `PluginError`, logs it, bypasses that plugin for the
  session, and continues processing with the remaining plugins

---

### Requirement: Built-in plugin — audit-log
The system SHALL ship a built-in `audit-log` plugin that appends every request and response
to a JSONL file (path configurable, default `./ai-powered-audit.jsonl`). The plugin SHALL
mask all API keys before writing. It SHALL be activatable via `plugins: ['audit-log']` in config.

#### Scenario: Audit log entry written
- **WHEN** `audit-log` plugin is active and a text generation call completes
- **THEN** a JSON line is appended to the audit file containing timestamp, provider, model,
  prompt hash (not raw prompt), usage, cost, and masked headers

---

### Requirement: Built-in plugin — rate-limiter
The system SHALL ship a built-in `rate-limiter` plugin implementing a client-side token-bucket
algorithm. Max requests per minute SHALL be configurable (default 60). When the bucket is
empty, the plugin SHALL pause the request until capacity is available.

#### Scenario: Rate limiter throttles burst
- **WHEN** 70 requests are made within one minute and the limit is 60
- **THEN** the 61st request is delayed (not rejected) until the next token is available

---

### Requirement: Built-in plugin — prompt-shield
The system SHALL ship a built-in `prompt-shield` plugin that applies heuristic injection-detection
rules to every prompt in `onRequest`. If a potential injection is detected (e.g., "ignore
previous instructions"), the plugin SHALL log a WARNING and optionally reject the request
(configurable: `reject: true | false`, default `false`).

#### Scenario: Injection pattern detected and logged
- **WHEN** a prompt contains "ignore all previous instructions"
- **THEN** the plugin logs a WARNING identifying the suspected injection pattern

#### Scenario: Rejection mode blocks request
- **WHEN** `prompt-shield` is configured with `reject: true` and an injection is detected
- **THEN** the plugin throws `PluginError` and the request is not dispatched to the provider

