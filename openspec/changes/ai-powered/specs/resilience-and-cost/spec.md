## ADDED Requirements

### Requirement: Exponential-backoff retries
The system SHALL automatically retry failed provider calls using exponential backoff.
Default retry count SHALL be 3 with jitter. Retries SHALL occur on transient errors
(network timeouts, 429 rate-limit responses, 5xx server errors). Each retry attempt SHALL
be logged at DEBUG level including attempt number, wait duration, and error reason.

#### Scenario: Retry on 429 rate limit
- **WHEN** the provider returns HTTP 429 on the first call
- **THEN** the system waits with exponential backoff and retries up to the configured max
  before surfacing a `ProviderError` to the caller

#### Scenario: Non-retryable error not retried
- **WHEN** the provider returns HTTP 400 (bad request)
- **THEN** the system throws immediately without retrying

---

### Requirement: Circuit breaker
The system SHALL implement a simple per-provider circuit breaker. After a configurable
number of consecutive failures (default 5), the circuit SHALL open and all subsequent
calls to that provider SHALL fail fast with a `CircuitOpenError` until the reset interval
elapses (default 60 seconds).

#### Scenario: Circuit opens after consecutive failures
- **WHEN** a provider fails 5 consecutive times
- **THEN** the circuit opens and the next call immediately throws `CircuitOpenError` with
  provider name and estimated recovery time

#### Scenario: Circuit closes after reset interval
- **WHEN** the reset interval elapses after the circuit opened
- **THEN** the system allows one probe request; on success the circuit closes and normal
  operation resumes

---

### Requirement: Provider fallback / failover
Each modality config SHALL accept an ordered `fallbackProviders` array. When the primary
provider fails (network error, rate limit, quota exhaustion, or open circuit), the core
SHALL automatically retry against each fallback in order, log the switchover event at INFO
level, and surface a final error only if all providers are exhausted. Fallback SHALL be
disabled via `--no-fallback` or `fallback: false` in config.

#### Scenario: Fallback to secondary provider
- **WHEN** the primary provider fails and `fallbackProviders: ['anthropic']` is configured
- **THEN** the system retries the request against Anthropic and returns its response if successful

#### Scenario: All providers exhausted
- **WHEN** the primary and all fallback providers fail
- **THEN** the system throws `AllProvidersExhaustedError` listing all attempted providers
  and their failure reasons

#### Scenario: Fallback disabled
- **WHEN** `--no-fallback` is passed and the primary provider fails
- **THEN** the system throws immediately without attempting any fallback providers

---

### Requirement: Token estimation and cost tracking
The system SHALL estimate token counts before each call and compute actual cost from usage
data returned by the provider. Per-call cost AND cumulative session cost SHALL be tracked
in memory and included in every result object. Cost SHALL be logged at INFO level. Cost
tracking SHALL work in mock mode using plausible fixture values.

#### Scenario: Cost included in TextResult
- **WHEN** `generateText` returns successfully
- **THEN** the `TextResult` contains `usage.promptTokens`, `usage.completionTokens`,
  `usage.totalTokens`, and `cost` (USD float rounded to 6 decimal places)

#### Scenario: Cumulative cost tracked across calls
- **WHEN** three sequential `generateText` calls are made in one process
- **THEN** `client.getCumulativeCost()` returns the sum of all three call costs

---

### Requirement: Budget limits
The system SHALL support `--budget-session <USD>` and `budgetGlobal` in config as spend
ceilings. Before every API call the system SHALL check cumulative cost; if the limit would
be exceeded it SHALL throw `BudgetExceededError` with the current cost and the limit, and
exit with code 1. `--warn-budget <USD>` SHALL emit a WARNING log when crossed without
blocking.

#### Scenario: Budget exceeded before call
- **WHEN** cumulative cost is $0.08 and `--budget-session 0.10` is set and the next call
  would cost $0.05
- **THEN** the system throws `BudgetExceededError` before making the API call

#### Scenario: Warn budget emits warning without blocking
- **WHEN** cumulative cost crosses the `--warn-budget` threshold
- **THEN** the system logs a WARNING message but continues processing normally

