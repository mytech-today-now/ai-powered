## ADDED Requirements

### Requirement: Batch drop-zone on Video tab
The system SHALL render a drag-and-drop file upload zone on the Video tab of the web demo,
positioned above the existing single-video form and separated from it by an `<hr>` divider.
The drop-zone SHALL accept `.json`, `.jsonl`, and `.md` file extensions via both drag-and-drop
and a click-to-browse file input. The `accept` attribute on the `<input type="file">` SHALL
be set to `.json,.jsonl,.md` to guide the OS file picker.

#### Scenario: Drop-zone accepts supported file types
- **WHEN** the user drags a `.json`, `.jsonl`, or `.md` file onto the drop-zone
- **THEN** the file is accepted, parsed into a shot list, and the pre-flight panel is displayed
- **AND** no browser error is shown

#### Scenario: Drop-zone rejects unsupported file types
- **WHEN** the user drags an unsupported file (e.g. `.csv`, `.mp4`) onto the drop-zone
- **THEN** the file is ignored, the drop-zone shows a user-visible rejection indicator,
  and no pre-flight panel is displayed

#### Scenario: Click-to-browse opens file picker
- **WHEN** the user clicks anywhere on the drop-zone
- **THEN** the browser file picker opens filtered to `.json`, `.jsonl`, and `.md` files

---

### Requirement: Pre-flight shot-list panel
After a file is accepted, the system SHALL display a pre-flight panel listing all parsed shots
with their `name`, `prompt` (truncated at 80 characters if longer), and `modality`. The panel
SHALL include a **Run Batch** button and a **✕ Clear** button. The **Run Batch** button SHALL
be disabled until the shot list contains at least one valid item.

#### Scenario: Pre-flight panel shows parsed shots
- **WHEN** a valid `.jsonl` file containing 3 shot items is dropped
- **THEN** the pre-flight panel shows exactly 3 rows, one per shot, each with name, truncated
  prompt, and modality badge

#### Scenario: Clear button resets state
- **WHEN** the user clicks **✕ Clear** after a file has been loaded
- **THEN** the pre-flight panel is hidden, the drop-zone is reset to its empty state,
  and any previous batch results are removed from the DOM

---

### Requirement: Drop-zone visual feedback
The drop-zone SHALL change visual appearance (e.g. border colour, background tint) when a
file is dragged over it (`dragover` event) and SHALL revert on `dragleave` or `drop`.

#### Scenario: Drag-over visual state
- **WHEN** a file is dragged over the drop-zone
- **THEN** the drop-zone applies a CSS class (e.g. `.drag-over`) that changes its border
  colour or background
- **AND** the class is removed when the drag leaves or the file is dropped

