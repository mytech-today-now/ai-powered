## ADDED Requirements

### Requirement: Layered config with clear precedence
The system SHALL load configuration from layered sources in this order (lowest to highest
precedence): global `~/.ai-powered/config.json`, project-local `./.ai-powered/config.json`,
named profile within the active config file, environment variables prefixed `AI_`, and runtime
CLI flags. Each layer SHALL deep-merge with the layers below it.

#### Scenario: CLI flag overrides env var
- **WHEN** `AI_PROVIDER=openai` is set and `--provider anthropic` is passed
- **THEN** the resolved config uses `anthropic` as the provider

#### Scenario: Project-local config overrides global
- **WHEN** global config sets `model: gpt-4o` and project-local config sets `model: claude-3-5-sonnet`
- **THEN** the resolved config uses `claude-3-5-sonnet`

---

### Requirement: Named profiles
The system SHALL support multiple named profiles (`default`, `prod`, `dev`, etc.) within each
config file. The active profile SHALL be selectable via `--profile <name>` or the
`AI_PROFILE` environment variable. Profiles SHALL be stored under a `profiles` key in config.

#### Scenario: Selecting a named profile
- **WHEN** `--profile prod` is passed and a `prod` profile exists in config
- **THEN** the system uses all settings from the `prod` profile as the base layer

#### Scenario: Missing profile
- **WHEN** `--profile nonexistent` is passed but that profile does not exist
- **THEN** the system throws a `ConfigError` naming the missing profile

---

### Requirement: Config sub-commands
The system SHALL expose the following sub-commands under `ai-powered config`:
`get <key>`, `set <key> <value>`, `list`, `delete <key>`, `reset`, `path`, `validate`.
All sub-commands SHALL respect `--profile` and `--json`. API key values SHALL be masked in
all output. `validate` SHALL run the full Zod schema and report all errors.

#### Scenario: Config get masks API key
- **WHEN** `ai-powered config get apiKey` is run
- **THEN** the output displays the masked value (e.g., `sk-****`) not the raw key

#### Scenario: Config validate passes on good config
- **WHEN** `ai-powered config validate` is run against a valid config
- **THEN** the command exits with code 0 and prints "Config is valid"

#### Scenario: Config reset requires confirmation
- **WHEN** `ai-powered config reset` is run interactively
- **THEN** the system prompts for confirmation before overwriting the config file

---

### Requirement: Config migration and backup
The system SHALL detect version mismatches between the stored config and the current package
version. On mismatch the system SHALL automatically back up the old config to
`~/.ai-powered/config.json.bak.<timestamp>` and migrate to the new schema, logging the
migration event.

#### Scenario: Config migration on update
- **WHEN** `ai-powered --update` is run and the config schema has changed
- **THEN** the old config is backed up, migrated to the new schema, and the user is notified

---

### Requirement: Setup wizard
The system SHALL provide `ai-powered wizard` (alias: `ai-powered setup`) as a fully
interactive multi-step wizard using `@inquirer/prompts`. It SHALL guide the user through:
choosing modality, selecting a provider (including Venice.ai with modality availability notes),
entering and validating the API key (via a lightweight live API call), setting model defaults,
saving to `.env` and/or `~/.ai-powered/config.json`, and printing next steps. The wizard SHALL
also support `--template` mode for creating a custom prompt template.

#### Scenario: Wizard validates Venice API key
- **WHEN** the user selects Venice.ai and enters `VENICE_API_KEY`
- **THEN** the wizard makes a `GET /models` call and confirms the key is valid before saving

#### Scenario: Wizard saves to both .env and global config
- **WHEN** the user completes the wizard and selects both save targets
- **THEN** the system writes provider settings to `.env` and `~/.ai-powered/config.json`

---

### Requirement: Lifecycle management flags
The system SHALL support `--install`, `--init`, `--update`, and `--uninstall` as top-level
Commander.js flags. `--init` SHALL detect an existing installation, create missing local
wrapper hooks, update `.gitignore`, run the wizard if no config exists, and print next steps.
`--update` SHALL check npm for newer versions, update the package, and migrate config if needed.
`--uninstall` SHALL remove local hooks and repo-specific files, then instruct the user to run
`npm uninstall ai-powered`.

#### Scenario: --init on fresh install
- **WHEN** `ai-powered --init` is run in a repo with no `.ai-powered/` directory
- **THEN** the system creates `.ai-powered/config.json`, appends to `.gitignore`, and runs
  the wizard interactively

