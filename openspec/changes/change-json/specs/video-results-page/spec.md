## ADDED Requirements

### Requirement: Downloadable HTML results page (`buildResultsHtml`)
After a batch completes, the system SHALL provide a **⬇ Download HTML** button in the results
panel. Clicking it SHALL call `buildResultsHtml(batchResultItems)`, which produces a
self-contained HTML string where each video result is embedded as a `data:video/mp4;base64,…`
URI in a `<video src="…">` element. The file SHALL be triggered as a browser download named
`batch-results.html`. The HTML page SHALL work offline (no external CDN or server references).

#### Scenario: HTML download triggers file download
- **WHEN** the user clicks **⬇ Download HTML** after a completed batch
- **THEN** the browser initiates a file download named `batch-results.html`
- **AND** the downloaded file is valid HTML that opens in a browser without a server

#### Scenario: Self-contained video embedding
- **WHEN** `buildResultsHtml` is called with a result item that has a base64 data URI
- **THEN** the generated HTML contains a `<video src="data:video/mp4;base64,…">` element
  for that shot (no external URL references)

#### Scenario: Error items appear in HTML without video element
- **WHEN** a result item has `status: "error"`
- **THEN** the HTML shows the shot name and error message; no `<video>` element is generated
  for that shot

---

### Requirement: ZIP download via JSZip (`Download ZIP`)
After a batch completes, the system SHALL provide a **⬇ Download ZIP** button. Clicking it
SHALL use JSZip (loaded via CDN) to create an archive containing:
- One `.mp4` file per successful video result, named after the shot's `name` field
  (sanitised for filesystem safety).
- A `results.html` page listing all shots with inline metadata.
The ZIP file SHALL be triggered as a browser download named `batch-videos.zip`.

#### Scenario: ZIP contains one file per successful shot
- **WHEN** a batch of 3 shots completes with 2 successes and 1 error
- **THEN** the ZIP contains exactly 2 `.mp4` files and 1 `results.html`

#### Scenario: Shot file names are sanitised
- **WHEN** a shot name contains characters invalid on common filesystems (e.g. `/`, `\`, `:`)
- **THEN** those characters are replaced (e.g. with `-`) in the `.mp4` filename inside the ZIP

#### Scenario: JSZip unavailable degrades gracefully
- **WHEN** JSZip fails to load from CDN (network error)
- **THEN** the **⬇ Download ZIP** button is either hidden or shows a user-visible
  "ZIP unavailable" message; the **⬇ Download HTML** button continues to work

---

### Requirement: Individual shot download links
Each shot card in the results panel SHALL include an individual **⬇ Download** link for
successful video shots. Clicking it SHALL trigger a browser download of the single `.mp4`
file for that shot.

#### Scenario: Individual download link present on successful shot card
- **WHEN** a shot card for a successful video result is rendered
- **THEN** a download link is present with `download="<shotname>.mp4"` and a `data:` URI `href`

#### Scenario: Individual download link absent on error shot card
- **WHEN** a shot card for a failed result is rendered
- **THEN** no download link is present for that card

