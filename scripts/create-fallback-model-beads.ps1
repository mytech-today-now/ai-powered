# create-fallback-model-beads.ps1
# Generates all Beads tasks for the fallback-model OpenSpec change.
# Run from repo root:  . .\scripts\beads-helpers.ps1; .\scripts\create-fallback-model-beads.ps1
#
# Source artifacts: openspec/changes/fallback-model/
#   proposal.md, deltas.md, design.md, implementation.md, tasks.md
#   summary.md, README.md, fallback-model.json, specs/, tests/, examples/

. .\scripts\beads-helpers.ps1

function New-Bead {
    param([string]$Title, [string]$Description, [int]$Priority = 1, [string]$Type = "task")
    $json = bd create $Title -Description $Description -Priority $Priority -Type $Type --json
    return ($json | ConvertFrom-Json).id
}

Write-Host "`n=== Creating fallback-model Beads Tasks ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# EPIC
# ---------------------------------------------------------------------------
$idEpic = New-Bead `
  -Title "[fallback-model] Consolidated Provider + Model Selector per Modality" `
  -Description "EPIC | Change: fallback-model | Priority: High | Estimate: ~16h | 14 tasks across 5 phases. Replace dual-selector architecture (global proxy-provider-select + video-only video-provider-select) with 1 isolated provider+model pair per modality tab. Introduces tabState Map, localStorage persist/restore, stale-model guard, compatible-model filtering, and cheapest-price auto-select. Files: index.html, app.js, styles.css. No backend changes. No new npm deps. REQ-PM-01..06 + REQ-LS-01..06. AC-01..07. Source: openspec/changes/fallback-model/README.md" `
  -Priority 1 -Type "epic"

Write-Host "Epic: $idEpic"

# ---------------------------------------------------------------------------
# Phase 0 -- HTML and CSS
# ---------------------------------------------------------------------------
Write-Host "`nPhase 0 -- HTML and CSS" -ForegroundColor Yellow

$id01 = New-Bead `
  -Title "[fallback-model] TASK-01 (Phase 0): Add per-tab provider select elements to index.html" `
  -Description "PHASE-0 | File: integrations/web-example/index.html | Add text-provider-select, image-provider-select, audio-provider-select, structured-provider-select inside a .tab-settings-bar div placed before each tab-panel model select. The video-provider-select already exists -- confirm its .tab-settings-bar wrapper is present. Each panel must have exactly 1 provider select and 1 model select. AC-01 visual check. REQ-PM-01. Ref: implementation.md s1, specs/modality-provider-model/spec.md" `
  -Priority 1

$id02 = New-Bead `
  -Title "[fallback-model] TASK-02 (Phase 0): Add CSS for .tab-settings-bar and .tab-provider-label" `
  -Description "PHASE-0 | File: integrations/web-example/styles.css | Add .tab-settings-bar (display:flex, align-items:center, gap:.5rem -- mirrors .video-settings-bar) and .tab-provider-label (font-size:.75rem, color:var(--muted)). Confirm visual alignment across all 5 tabs: provider label then provider select then model label then model select. Blocked by TASK-01. Ref: implementation.md s2, design.md" `
  -Priority 1

# ---------------------------------------------------------------------------
# Phase 1 -- Core State and Helpers
# ---------------------------------------------------------------------------
Write-Host "Phase 1 -- Core State and Helpers" -ForegroundColor Yellow

$id03 = New-Bead `
  -Title "[fallback-model] TASK-03 (Phase 1): Add tabState Map and per-tab DOM references" `
  -Description "PHASE-1 | File: integrations/web-example/app.js | Add const tabState = new Map() at module level (Design D1: Map enables uniform iteration vs 10 individual variables). Add DOM refs: textProviderSelect, imageProviderSelect, audioProviderSelect, structuredProviderSelect. Build PROVIDER_SELECTS and MODEL_SELECTS lookup objects keyed by modality string ('text','image','audio','video','structured'). Retain all existing DOM refs. Blocked by TASK-02. Ref: implementation.md s3, design.md D1" `
  -Priority 1

$id04 = New-Bead `
  -Title "[fallback-model] TASK-04 (Phase 1): Implement persistSelection helper" `
  -Description "PHASE-1 | File: integrations/web-example/app.js | Write persistSelection(modality, provider, model): 2 synchronous localStorage.setItem calls using keys ai-powered:provider:MODALITY and ai-powered:model:MODALITY. Both keys written atomically in the same call -- no partial writes permitted. REQ-LS-01. Unit test T-PM-01 must pass. Blocked by TASK-03. Ref: specs/localStorage-persistence/spec.md REQ-LS-01, implementation.md s3" `
  -Priority 1

$id05 = New-Bead `
  -Title "[fallback-model] TASK-05 (Phase 1): Implement restoreSelection helper" `
  -Description "PHASE-1 | File: integrations/web-example/app.js | Write restoreSelection(modality): reads localStorage.getItem for both ai-powered:provider:MODALITY and ai-powered:model:MODALITY; returns {provider, model} object or null if either key is absent. REQ-LS-02. Tests T-PM-02 (valid keys return saved pair), T-PM-03 (absent keys return null) must pass. Blocked by TASK-03. Ref: specs/localStorage-persistence/spec.md REQ-LS-02, implementation.md s3" `
  -Priority 1

$id06 = New-Bead `
  -Title "[fallback-model] TASK-06 (Phase 1): Implement autoSelectCheapest helper" `
  -Description "PHASE-1 | File: integrations/web-example/app.js | Write autoSelectCheapest(modelList): sort a copy of modelList ascending by costPerUnit (null or undefined treated as Infinity per Design D2); return the first entry id or null for empty list. Tests T-PM-04 (correct sort order), T-PM-05 (null costPerUnit sorts last), T-PM-06 (empty list returns null) must pass. REQ-PM-03. Blocked by TASK-03. Ref: implementation.md s3, design.md D2" `
  -Priority 1



# ---------------------------------------------------------------------------
# Phase 2 -- Per-Tab Loading and Event Listeners
# ---------------------------------------------------------------------------
Write-Host "Phase 2 -- Per-Tab Loading and Event Listeners" -ForegroundColor Yellow

$id07 = New-Bead `
  -Title "[fallback-model] TASK-07 (Phase 2): Implement loadTabModels(modality)" `
  -Description "PHASE-2 | File: integrations/web-example/app.js | Write loadTabModels(modality): GET /models?modality=MODALITY&provider=tabState.get(modality).provider; clear and repopulate the tab model select (empty response produces a single disabled option 'No compatible models'); call autoSelectCheapest; set select.value; update tabState and call persistSelection. Must NOT touch sibling tabs or call loadAllModels. REQ-PM-02,03. Blocked by TASK-04, TASK-05, TASK-06. Ref: implementation.md s4, examples/selector-examples.md Example G" `
  -Priority 1

$id08 = New-Bead `
  -Title "[fallback-model] TASK-08 (Phase 2): Replace loadAllModels() call sites with loadTabModels(modality)" `
  -Description "PHASE-2 | File: integrations/web-example/app.js | Audit ALL loadAllModels() call sites including tab-switch event listeners. Replace each with loadTabModels(modality) scoped to the affected tab only. Switching tabs must not trigger model reloads for other tabs (proposal.md Defect 2: cross-tab model pollution). Integration test T-PM-11 (tab switch does not alter sibling tabState) must pass. REQ-PM-05. Blocked by TASK-07. Ref: design.md D5" `
  -Priority 1

$id09 = New-Bead `
  -Title "[fallback-model] TASK-09 (Phase 2): Wire per-tab provider change listeners" `
  -Description "PHASE-2 | File: integrations/web-example/app.js | For each of the 5 provider selects add a change listener: (1) loadTabModels(modality) -- repopulates model select and auto-selects cheapest; (2) tabState.set(modality, {provider, cheapestModel}); (3) persistSelection. Tests T-PM-07 (model list filtered to modality), T-PM-08 (localStorage written), T-PM-12 (prior manual override discarded on provider change) must pass. REQ-PM-02,03,04,06. Blocked by TASK-07. Ref: implementation.md s5" `
  -Priority 1

$id10 = New-Bead `
  -Title "[fallback-model] TASK-10 (Phase 2): Wire per-tab model change listeners" `
  -Description "PHASE-2 | File: integrations/web-example/app.js | For each of the 5 model selects add a change listener: (1) read current provider from tabState.get(modality).provider; (2) tabState.set(modality, {provider, model: newValue}); (3) persistSelection(modality, currentProvider, newValue). Enables manual override after auto-select. Test T-PM-08 covers persist on model change. REQ-PM-06. Blocked by TASK-07. Ref: implementation.md s5, examples/selector-examples.md Example B" `
  -Priority 1

# ---------------------------------------------------------------------------
# Phase 3 -- Page-Load Restore and API Call Sites
# ---------------------------------------------------------------------------
Write-Host "Phase 3 -- Page-Load Restore and API Call Sites" -ForegroundColor Yellow

$id11 = New-Bead `
  -Title "[fallback-model] TASK-11 (Phase 3): Implement initTabSelections() page-load restore loop" `
  -Description "PHASE-3 | File: integrations/web-example/app.js | Write initTabSelections() iterating ['text','image','audio','video','structured']: (1) restoreSelection(m) -- null uses default provider; (2) REQ-LS-03 validate saved provider vs GET /providers -- warn and fallback if absent; (3) REQ-LS-04 stale-model guard -- validate saved model vs GET /models -- warn, autoSelectCheapest, and persistSelection if stale; (4) tabState.set and render selects. Tests T-PM-09 (full restore), T-PM-10 (stale guard). Smoke S-04,S-05. Blocked by TASK-08,09,10. Ref: implementation.md s6, specs/localStorage-persistence/spec.md REQ-LS-03,04" `
  -Priority 1

$id12 = New-Bead `
  -Title "[fallback-model] TASK-12 (Phase 3): Update 6 API call sites to read from tabState" `
  -Description "PHASE-3 | File: integrations/web-example/app.js | Replace all proxyProviderSelect.value reads inside: generateText (text), generateImage (image), handleTranscribe (audio), synthesizeSpeech (audio), generateVideo (video), generateStructured (structured). Each reads const {provider, model} = tabState.get(modality) before building the POST payload. Remove every remaining reference to proxyProviderSelect.value in these 6 functions. Smoke S-09 confirms correct provider and model in Network tab. Blocked by TASK-08,09,10. Ref: implementation.md s7" `
  -Priority 1

# ---------------------------------------------------------------------------
# Phase 4 -- Provider Selects Populated on Init
# ---------------------------------------------------------------------------
Write-Host "Phase 4 -- Provider Selects Populated on Init" -ForegroundColor Yellow

$id13 = New-Bead `
  -Title "[fallback-model] TASK-13 (Phase 4): Populate all 5 provider selects on startup" `
  -Description "PHASE-4 | File: integrations/web-example/app.js | After GET /providers resolves on page load, call populateProviderSelect(selectEl, modality) for each of the 5 per-tab provider selects (text, image, audio, video, structured). Then set selectEl.value = tabState.get(modality).provider -- value resolved by initTabSelections (restore or default). Smoke S-01 (selects present), S-02 (Text filtered to provider models), S-03 (cheapest auto-selected). REQ-PM-01. Blocked by TASK-11, TASK-12. Ref: tasks.md Phase 4" `
  -Priority 1

# ---------------------------------------------------------------------------
# Phase 5 -- Tests, Build, Lint, Verification
# ---------------------------------------------------------------------------
Write-Host "Phase 5 -- Tests, Build, Lint, Verification" -ForegroundColor Yellow

$id14 = New-Bead `
  -Title "[fallback-model] TASK-14 (Phase 5): Tests, build, lint, and smoke verification" `
  -Description "PHASE-5 | Files: tests/unit/fallback-model.test.ts, tests/unit/fallback-model-integration.test.ts | Unit tests T-PM-01..06: persistSelection, restoreSelection, autoSelectCheapest. Integration tests T-PM-07..12: jsdom DOM wiring. Run: npm run build (0 TS errors), npm run lint (0 warnings), AI_MOCK=true npm test (0 regressions vs baseline). Manual smoke S-01..S-10 in browser. AC-01..07 all green. Blocked by TASK-13. Ref: openspec/changes/fallback-model/tests/test-plan.md, summary.md" `
  -Priority 1

# ---------------------------------------------------------------------------
# Dependency wiring
# ---------------------------------------------------------------------------
Write-Host "`n=== Wiring dependencies ===" -ForegroundColor Cyan

bd dep add $id02 $id01; Write-Host "  TASK-02 blocked by TASK-01" -ForegroundColor DarkGray
bd dep add $id03 $id02; Write-Host "  TASK-03 blocked by TASK-02" -ForegroundColor DarkGray
bd dep add $id04 $id03; Write-Host "  TASK-04 blocked by TASK-03" -ForegroundColor DarkGray
bd dep add $id05 $id03; Write-Host "  TASK-05 blocked by TASK-03" -ForegroundColor DarkGray
bd dep add $id06 $id03; Write-Host "  TASK-06 blocked by TASK-03" -ForegroundColor DarkGray
bd dep add $id07 $id04; Write-Host "  TASK-07 blocked by TASK-04" -ForegroundColor DarkGray
bd dep add $id07 $id05; Write-Host "  TASK-07 blocked by TASK-05" -ForegroundColor DarkGray
bd dep add $id07 $id06; Write-Host "  TASK-07 blocked by TASK-06" -ForegroundColor DarkGray
bd dep add $id08 $id07; Write-Host "  TASK-08 blocked by TASK-07" -ForegroundColor DarkGray
bd dep add $id09 $id07; Write-Host "  TASK-09 blocked by TASK-07" -ForegroundColor DarkGray
bd dep add $id10 $id07; Write-Host "  TASK-10 blocked by TASK-07" -ForegroundColor DarkGray
bd dep add $id11 $id08; Write-Host "  TASK-11 blocked by TASK-08" -ForegroundColor DarkGray
bd dep add $id11 $id09; Write-Host "  TASK-11 blocked by TASK-09" -ForegroundColor DarkGray
bd dep add $id11 $id10; Write-Host "  TASK-11 blocked by TASK-10" -ForegroundColor DarkGray
bd dep add $id12 $id08; Write-Host "  TASK-12 blocked by TASK-08" -ForegroundColor DarkGray
bd dep add $id12 $id09; Write-Host "  TASK-12 blocked by TASK-09" -ForegroundColor DarkGray
bd dep add $id12 $id10; Write-Host "  TASK-12 blocked by TASK-10" -ForegroundColor DarkGray
bd dep add $id13 $id11; Write-Host "  TASK-13 blocked by TASK-11" -ForegroundColor DarkGray
bd dep add $id13 $id12; Write-Host "  TASK-13 blocked by TASK-12" -ForegroundColor DarkGray
bd dep add $id14 $id13; Write-Host "  TASK-14 blocked by TASK-13" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host "`n=== fallback-model tasks created ===" -ForegroundColor Green
Write-Host ""
Write-Host "Epic : $idEpic"
Write-Host "T-01 : $id01  T-02 : $id02  T-03 : $id03  T-04 : $id04  T-05 : $id05"
Write-Host "T-06 : $id06  T-07 : $id07  T-08 : $id08  T-09 : $id09  T-10 : $id10"
Write-Host "T-11 : $id11  T-12 : $id12  T-13 : $id13  T-14 : $id14"
Write-Host ""

bd stats
