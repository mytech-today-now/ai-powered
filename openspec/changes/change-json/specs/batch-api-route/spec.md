## ADDED Requirements

### Requirement: `POST /batch` NDJSON streaming route
The system SHALL add a `POST /batch` route to `src/ai-powered/server/routes.ts`. The route
SHALL validate the request body using Zod (`BatchBodySchema`) and return `400` with a
structured error for invalid bodies. For valid requests, the route SHALL set
`Content-Type: application/x-ndjson`, process items sequentially, and write one JSON line per
item as soon as that item completes. The route SHALL NOT buffer all results before responding.

Request body schema (`BatchBodySchema`):
```
{
  items: Array<{
    modality: "text" | "image" | "video" | "structured",  // default: "video"
    name?: string,
    prompt: string,
    model?: string,
    provider?: string,
    template?: string,
    vars?: Record<string, string>
  }>,
  model?: string,    // body-level default, overridden per item
  provider?: string  // body-level default, overridden per item
}
```

Response line schema (one per item):
```
{ index: number, name: string, modality: string, prompt: string,
  status: "ok" | "error", result?: object, error?: string }
```

#### Scenario: Valid batch returns NDJSON stream
- **WHEN** `POST /batch` receives `{ items: [{ prompt: "A sunrise", modality: "video" }] }`
- **THEN** the response status is `200`, `Content-Type` is `application/x-ndjson`,
  and exactly one NDJSON line is written with `status: "ok"` and a non-empty `result`

#### Scenario: Invalid body returns 400
- **WHEN** `POST /batch` receives a body with `items` missing the required `prompt` field
- **THEN** the response status is `400` and the body contains a Zod validation error

#### Scenario: Empty items array returns 400
- **WHEN** `POST /batch` receives `{ items: [] }`
- **THEN** the response status is `400`

#### Scenario: Per-item error does not abort stream
- **WHEN** the second of three items fails (e.g. provider throws a non-fatal error)
- **THEN** the stream continues; an `"error"` line is written for item 2; items 1 and 3
  produce their normal result lines

#### Scenario: BudgetExceededError ends stream early
- **WHEN** processing an item causes cumulative cost to exceed the configured budget
- **THEN** the stream writes a final line with `status: "error"` and `error: "BudgetExceeded"`,
  then closes; subsequent items are not processed

#### Scenario: AllProvidersExhaustedError ends stream early
- **WHEN** all configured providers are exhausted during item processing
- **THEN** the stream writes a final line with `status: "error"` and `error: "AllProvidersExhausted"`,
  then closes

---

### Requirement: Zod schema validation (`BatchItemSchema`, `BatchBodySchema`)
The system SHALL define `BatchItemSchema` as a Zod object schema matching the item fields
above. `modality` SHALL default to `"video"`. `BatchBodySchema` SHALL require `items` to be
a non-empty array of `BatchItemSchema`.

#### Scenario: Missing modality defaults to video
- **WHEN** an item in the batch body omits `modality`
- **THEN** Zod parses the item with `modality: "video"` (no 400 error)

#### Scenario: Unknown modality value rejected
- **WHEN** an item has `modality: "hologram"` (not in the enum)
- **THEN** Zod returns a validation error and the route returns `400`

