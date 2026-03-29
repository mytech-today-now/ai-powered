## ADDED Requirements

### Requirement: --schema flag for structured output
The system SHALL support a `--schema <file>` flag on the `structured` command (and optionally
`text`) accepting either a path to a JSON Schema file (draft-7 or draft-2020-12), a path to
a Zod schema file (evaluated at runtime), or an inline JSON string. The schema SHALL be
compiled via Zod and passed to the provider's structured-output or function-calling mechanism.

#### Scenario: JSON Schema file accepted
- **WHEN** `ai-powered structured "List 3 colors" --schema ./color-schema.json --mock` is run
- **THEN** the system loads and compiles the JSON Schema without error

#### Scenario: Inline JSON schema string accepted
- **WHEN** `--schema '{"type":"object","properties":{"answer":{"type":"string"}}}'` is passed
- **THEN** the system parses and compiles the inline JSON as a Zod schema

---

### Requirement: Response validation and retry
The system SHALL validate the provider response against the compiled Zod schema before
returning. If validation fails the CLI SHALL retry up to `--max-retries` times (default 2).
After all retries are exhausted the system SHALL throw a `ValidationError` with the validation
failures and the raw response. Exit code SHALL be 2 on `ValidationError`.

#### Scenario: Valid response returned immediately
- **WHEN** the provider returns a response that satisfies the schema
- **THEN** the system returns the validated, typed response without retrying

#### Scenario: Invalid response triggers retry
- **WHEN** the provider returns a response that fails schema validation
- **THEN** the system retries the call up to `--max-retries` times with the schema constraint
  re-sent in the prompt

#### Scenario: Retries exhausted raises ValidationError
- **WHEN** all retries return invalid responses
- **THEN** the system throws `ValidationError` with details of the last validation failure
  and exits with code 2

---

### Requirement: Structured output in library mode
The system SHALL expose a `generateStructured<T>(prompt, schema, options?)` method on
`AiClient` that accepts a Zod schema object and returns a typed `Promise<T>`. This enables
type-safe structured output in TypeScript without command-line usage.

#### Scenario: generateStructured returns typed result
- **WHEN** `client.generateStructured('List colors', z.array(z.string()), { mock: true })` is called
- **THEN** the return value is typed as `string[]` and TypeScript infers the generic type

---

### Requirement: Provider structured-output integration
The system SHALL use each provider's native structured-output mechanism when available:
OpenAI `response_format: { type: 'json_object' }` or function-calling; Anthropic tool-use;
Grok equivalent if available. When a provider lacks native support, the system SHALL fall
back to prompt-based JSON extraction and apply schema validation to the parsed result.

#### Scenario: OpenAI uses native json_object format
- **WHEN** `generateStructured` is called with the OpenAI provider and a JSON schema
- **THEN** the API request includes `response_format: { type: 'json_object' }` in the body

#### Scenario: Fallback provider uses prompt-based extraction
- **WHEN** the active provider does not support native structured output
- **THEN** the system appends JSON-output instructions to the prompt and parses the response
  before schema validation

