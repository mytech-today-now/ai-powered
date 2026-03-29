## ADDED Requirements

### Requirement: Named prompt templates
The system SHALL support named, reusable prompt templates stored as JSON or YAML files.
Each template SHALL contain: `name`, `description`, `modality`, `provider` (optional),
`model` (optional), `system` (optional system prompt), `userPrompt` (with mustache-style
`{{variable}}` placeholders), and `defaults` (default variable values). Templates SHALL be
validated against a Zod schema on load.

#### Scenario: Template loaded and rendered
- **WHEN** `renderTemplate('summarize', { text: 'Long article...' })` is called
- **THEN** the system returns a string with all `{{variable}}` placeholders replaced by values

#### Scenario: Invalid template rejected
- **WHEN** a template file is missing the required `userPrompt` field
- **THEN** the system throws a `ValidationError` naming the invalid template file on load

---

### Requirement: Template resolution order
The system SHALL resolve templates in this order: (1) built-in `defaults/` directory,
(2) user-defined paths in `config.templateDirs`, (3) file path if the value contains a
path separator. A later resolution step SHALL NOT shadow an earlier built-in template
unless the user explicitly overrides by name.

#### Scenario: User template overrides built-in by name
- **WHEN** a user places a template named `summarize` in a configured `templateDirs` path
- **THEN** `renderTemplate('summarize', ...)` uses the user's version, not the built-in

#### Scenario: Template loaded from file path
- **WHEN** `--template ./my-template.json` is passed with a path separator
- **THEN** the system loads the template directly from the specified file path

---

### Requirement: CLI template usage
The system SHALL support `--template <name>` and `--var <key>=<value>` flags on `text`,
`image`, `audio speak`, and `structured` commands to render a template before dispatching.

#### Scenario: CLI template with variable injection
- **WHEN** `ai-powered text --template summarize --var text="$(cat article.txt)"` is run
- **THEN** the system renders the `summarize` template with the file contents and sends the
  result as the prompt to the configured provider

---

### Requirement: list-templates command
The system SHALL implement `ai-powered list-templates` that prints all available templates
(built-in and user-defined) with `name`, `modality`, and `description`. `--json` SHALL
produce a machine-readable JSON array.

#### Scenario: list-templates lists built-in templates
- **WHEN** `ai-powered list-templates --json` is run
- **THEN** stdout contains a JSON array including at minimum the built-in `summarize`,
  `translate`, and `qa` templates

---

### Requirement: Built-in templates
The system SHALL ship the following built-in templates in `src/ai-powered/templates/defaults/`:
`summarize` (text modality, summarizes input), `translate` (text modality, translates to
target language), `qa` (text modality, answers questions from context). Each SHALL include
a meaningful `description` and sensible `defaults`.

#### Scenario: summarize template default language
- **WHEN** `renderTemplate('summarize', { text: 'Some content' })` is called without a
  `language` variable
- **THEN** the default value from the template is used without error

