## ADDED Requirements

### Requirement: Batch processing command
The system SHALL implement `ai-powered batch <mode> --input <file> --output <file>` that
processes multiple prompts from a JSONL input file (one JSON object per line with a `prompt`
field plus optional per-row overrides for `model`, `temperature`, etc.). Results SHALL be
written to a JSONL output file where each line includes: original prompt, response, usage,
cost, and any error. `--output` SHALL be required for batch mode. Progress SHALL be shown
via a `cli-progress` bar unless `--quiet` is set. Concurrency SHALL be controlled by
`--concurrency <n>` (default 3). Per-row errors SHALL be recorded in the output without
aborting the entire batch.

#### Scenario: Batch processes all rows
- **WHEN** `ai-powered batch text --input prompts.jsonl --output results.jsonl --mock` is run
  with a 5-row input file
- **THEN** `results.jsonl` contains exactly 5 result rows, one per input row

#### Scenario: Row error captured without abort
- **WHEN** one row's prompt causes a provider error during batch processing
- **THEN** that row's result contains an `error` field with the error message, and processing
  of subsequent rows continues normally

#### Scenario: Concurrency respected
- **WHEN** `--concurrency 2` is set and 10 rows are processed
- **THEN** at most 2 provider calls are in-flight simultaneously at any point

#### Scenario: --dry-run in batch mode
- **WHEN** `ai-powered batch text --input prompts.jsonl --output out.jsonl --dry-run` is run
- **THEN** no API calls are made; each output row contains a cost estimate instead of a response

---

### Requirement: Conversation / multi-turn sessions
The system SHALL support `--session <id>` on the `text` command to enable stateful multi-turn
conversation. Session history (full `user`+`assistant` message list) SHALL be persisted to
`~/.ai-powered/sessions/<id>.json`. On each new call with `--session`, prior messages SHALL
be prepended to the request. Session files SHALL be excluded from git via `.gitignore`.

#### Scenario: Session history persists across CLI invocations
- **WHEN** `ai-powered text "Hello" --session my-chat` is called followed by
  `ai-powered text "What did I say?" --session my-chat`
- **THEN** the second call includes the first user message and assistant response in context

#### Scenario: session list shows active sessions
- **WHEN** `ai-powered session list` is run after two sessions have been created
- **THEN** the command lists both session IDs with their creation timestamps

#### Scenario: session clear removes session file
- **WHEN** `ai-powered session clear my-chat` is run
- **THEN** `~/.ai-powered/sessions/my-chat.json` is deleted and the command exits with code 0

---

### Requirement: ConversationSession library class
The system SHALL export a `ConversationSession` class from `src/ai-powered/index.ts` with
methods: `append(role: 'user'|'assistant', content: string)`, `getHistory()`, and `clear()`.
This enables programmatic multi-turn usage from TypeScript/JavaScript code without the CLI.

#### Scenario: ConversationSession append and retrieve
- **WHEN** `session.append('user', 'Hi')` and `session.append('assistant', 'Hello!')` are called
- **THEN** `session.getHistory()` returns `[{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }]`

#### Scenario: ConversationSession clear
- **WHEN** `session.clear()` is called after messages have been appended
- **THEN** `session.getHistory()` returns an empty array

