## ADDED Requirements

### Requirement: Batch execution via NDJSON stream (`runBatch`)
The system SHALL implement a `runBatch()` function in `app.js` that:
1. Validates proxy mode is active; if not, displays an error and returns.
2. POSTs `{ items: ShotItem[] }` to the proxy's `POST /batch` endpoint.
3. Reads the response body as a text stream, splitting on newlines.
4. For each non-empty line, parses it as JSON and calls `renderShotCard(result)`.
5. Appends each rendered shot card to the results panel in document order.
6. Updates the progress bar fraction and "N / total" counter after each item.
7. On stream end, sets the progress label to "Complete — N of total processed".

#### Scenario: Successful batch run populates shot cards
- **WHEN** `runBatch()` is called with 3 valid shot items in proxy mode
- **THEN** 3 shot cards appear in the results panel, one per NDJSON line received,
  in the order they were streamed from the server

#### Scenario: Progress bar advances per item
- **WHEN** the NDJSON stream delivers its second of five items
- **THEN** the progress bar shows 40% and the label reads "2 / 5"

#### Scenario: Batch requires proxy mode
- **WHEN** the web demo is in direct mode and the user clicks **Run Batch**
- **THEN** an error message is displayed ("Batch requires proxy mode") and no request is sent

#### Scenario: Partial failure does not abort remaining shots
- **WHEN** the second of three shots returns `status: "error"` in the NDJSON stream
- **THEN** the first and third shot cards render successfully; the second shows an error badge
- **AND** the progress label reaches "Complete — 3 of 3 processed"

---

### Requirement: Shot card rendering (`renderShotCard`)
The system SHALL implement a `renderShotCard(result)` function that produces a DOM element
containing: shot name, status badge (✓ for `"ok"`, ✗ for `"error"`), prompt text, an inline
`<video>` element with play/pause controls for video modality results, and an individual
**⬇ Download** link for video results. For error results, the error message is shown in place
of the video player.

#### Scenario: Successful video shot card
- **WHEN** `renderShotCard({ status: "ok", name: "Intro", modality: "video", result: {data:"data:video/mp4;base64,…"} })` is called
- **THEN** the returned element contains a `<video>` element with the data URI as `src`,
  a ✓ badge, and a download link

#### Scenario: Error shot card
- **WHEN** `renderShotCard({ status: "error", name: "Outro", error: "Timeout" })` is called
- **THEN** the returned element contains a ✗ badge and the error text "Timeout"; no `<video>`
  element is present

