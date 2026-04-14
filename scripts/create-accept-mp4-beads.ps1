# create-accept-mp4-beads.ps1
# Creates all Beads tasks for accept-mp4 with full descriptions from OpenSpec artifacts.
# Run from repository root:  pwsh -File .\scripts\create-accept-mp4-beads.ps1
#
# Source artifacts: openspec/changes/accept-mp4/
#   proposal.md · deltas.md · design.md · implementation.md · tasks.md
#   summary.md · README.md · accept-mp4.json · specs/ · tests/ · examples/

. .\scripts\beads-helpers.ps1

function New-Bead {
    param([string]$Title, [string]$Description, [int]$Priority = 1, [string]$Type = "task")
    $json = bd create $Title -Description $Description -Priority $Priority -Type $Type --json
    return ($json | ConvertFrom-Json).id
}

Write-Host "`n=== Creating accept-mp4 Beads Tasks ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# STORY — top-level tracking bead
# ---------------------------------------------------------------------------
$storyId = New-Bead `
  -Title "[accept-mp4] Accept Video Files for Transcription + Batch Combined Video Output" `
  -Description "STORY | Change: accept-mp4 | Priority: High | Estimate: ~12h | 16 tasks across 5 phases | Two independent enhancements: (1) Remove the artificial audio/* transcription restriction so users can submit .mp4, .mkv, .mov, .avi, and .webm video files directly to Whisper. MIME type flows from browser File.type through app.js -> routes.ts -> ProviderCallOptions -> toFile() in OpenAiProvider — no server-side extraction required. (2) After a batch video run completes, ffmpeg.wasm stitches all successful shots into a combined.mp4 surfaced as inline preview, download button, HTML export embed, and ZIP archive entry — running entirely in-browser. COOP/COEP headers added to server/index.ts to enable SharedArrayBuffer. No new npm packages; ffmpeg.wasm loaded from jsDelivr CDN. No breaking changes — mimeType is optional on all schemas. | Source: openspec/changes/accept-mp4/README.md | JSON: openspec/changes/accept-mp4/accept-mp4.json" `
  -Priority 1 -Type story

Write-Host "Story: $storyId"

# ---------------------------------------------------------------------------
# PHASE 0 — Type and Schema Extensions
# ---------------------------------------------------------------------------
$t01 = New-Bead `
  -Title "[accept-mp4] TASK-01: Extend ProviderCallOptions with mimeType field" `
  -Description "PHASE-0 | File: src/ai-powered/types.ts | Add optional field to ProviderCallOptions interface: /** Original MIME type of the media buffer (e.g. 'video/mp4', 'audio/mpeg'). */ mimeType?: string; | Field is optional — no existing call site (TTS, image, text, structured, video) requires modification. Design D1: mimeType typed as string not enum — Whisper's supported formats may change; string avoids maintenance of an allowed-values list; fallback to 'audio/webm' handles empty-string edge case. | Checklist: add field, confirm tsc --noEmit passes, confirm no existing call sites break. | AC-05 | Spec: openspec/changes/accept-mp4/specs/video-transcription/spec.md REQ-VT-03 | Implementation: openspec/changes/accept-mp4/implementation.md §1" `
  -Priority 1

$t02 = New-Bead `
  -Title "[accept-mp4] TASK-02: Extend TranscribeBodySchema with mimeType field" `
  -Description "PHASE-0 | File: src/ai-powered/server/routes.ts | Add mimeType: z.string().optional() to TranscribeBodySchema (alongside existing audioBase64). Update the POST /audio/transcribe route handler to forward body.mimeType to client.transcribeAudio(): const result = await client.transcribeAudio(buffer, { ...(body.mimeType ? { mimeType: body.mimeType } : {}) }); | Confirm tsc --noEmit passes. Confirm existing transcription integration tests still pass (backward-compat: missing mimeType = undefined options). | AC-03 | Spec: REQ-VT-06 | Implementation: openspec/changes/accept-mp4/implementation.md §2 | Deltas: openspec/changes/accept-mp4/deltas.md MODIFIED proxy-server" `
  -Priority 1

# ---------------------------------------------------------------------------
# PHASE 1 — Provider and Backend Changes
# ---------------------------------------------------------------------------
$t03 = New-Bead `
  -Title "[accept-mp4] TASK-03: Update OpenAiProvider.transcribeAudio() to use mimeType" `
  -Description "PHASE-1 | File: src/ai-powered/providers/openai.ts | Replace hardcoded 'audio.webm'/'audio/webm' with mimeType-derived values. Logic: const mimeType = options?.mimeType ?? 'audio/webm'; const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'webm'; const file = await toFile(buffer, \`media.\${ext}\`, { type: mimeType }); | Design D2: extension derived from MIME subtype split — no lookup table needed; handles codec params like audio/webm;codecs=opus automatically (ext = 'webm'). video/x-matroska -> media.x-matroska (Whisper accepts this label). | Regression guard: transcribeAudio(buffer) with no options MUST still produce toFile(buffer, 'media.webm', { type: 'audio/webm' }) — identical to prior behavior (T-VT-03). | Run T-VT-01 through T-VT-05 after implementation. | AC-06, AC-09, AC-10 | Spec: REQ-VT-04 | Impl: §3 | Examples: A, B, C" `
  -Priority 1

$t04 = New-Bead `
  -Title "[accept-mp4] TASK-04: Update fetch-client.ts proxy and direct mode MIME type" `
  -Description "PHASE-1 | File: src/ai-powered/web/fetch-client.ts | Two changes: (1) Proxy mode: add mimeType: audio.type || undefined to POST body alongside audioBase64. (2) Direct mode: derive filename from audio.type instead of hardcoding 'audio.webm': const ext = audio.type.split('/')[1]?.split(';')[0] ?? 'webm'; form.append('file', audio, \`media.\${ext}\`); | Confirm tsc --noEmit passes. | AC-03, AC-04 | Spec: REQ-VT-07, REQ-VT-08 | Implementation: openspec/changes/accept-mp4/implementation.md §4 | Deltas: MODIFIED fetch-client | Example D (direct mode iPhone MOV)" `
  -Priority 1

$t05 = New-Bead `
  -Title "[accept-mp4] TASK-05: Update handleAudioTranscriptions() compat endpoint" `
  -Description "PHASE-1 | File: src/ai-powered/server/compat/openai.ts | Two changes: (1) Forward req.file.mimetype to transcribeAudio(): const result = await client.transcribeAudio(buffer, { mimeType: req.file.mimetype }); (2) Update missing-file error message to: 'No audio or video file provided. Send the file as a '\''file'\'' field in a multipart/form-data request.' (was 'No audio file provided...'). | Run T-VT-08 (POST /v1/audio/transcriptions with MP4 -> 200, mimeType forwarded) and T-VT-09 (missing file -> 400 with new error text) after implementation. | AC-07 | Spec: REQ-VT-09 | Impl: §5 | Deltas: MODIFIED proxy-server | Example E (cURL MP4), F (Python openai client MKV)" `
  -Priority 1

$t06 = New-Bead `
  -Title "[accept-mp4] TASK-06: Add COOP/COEP headers to server/index.ts" `
  -Description "PHASE-1 | File: src/ai-powered/server/index.ts | Add app.use() middleware BEFORE all route handlers: app.use((_req, res, next) => { res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); next(); }); | Design D5: headers on ALL responses — SharedArrayBuffer requires cross-origin isolation on both document and sub-resource responses. Risk: may affect embedding the proxy in non-isolated iframes (no current use case; acceptable trade-off). | Manual verification: headers appear in browser DevTools Network tab on all responses; typeof SharedArrayBuffer !== 'undefined' in browser console after restart. | AC-20 | Spec: REQ-BCV-01 | Impl: §6 | Deltas: MODIFIED proxy-server" `
  -Priority 1

# ---------------------------------------------------------------------------
# PHASE 2 — Web UI: Transcription Changes
# ---------------------------------------------------------------------------
$t07 = New-Bead `
  -Title "[accept-mp4] TASK-07: Update index.html file input accept attribute and label" `
  -Description "PHASE-2 | File: integrations/web-example/index.html | Two changes: (1) Update accept attribute on #audio-file-input to: audio/*,video/mp4,video/x-matroska,video/quicktime,video/x-msvideo,video/webm — explicit video MIME types avoid formats Whisper does not support (e.g. .ogv, video/* wildcard — deviation D3 in deltas.md). (2) Update <label for='audio-file-input'> text from 'Choose audio file' to 'Choose audio or video file'. | Manual test: OS file picker now lists .mp4, .mkv, .mov, .avi, .webm files alongside .mp3, .wav, etc. | Supported containers: video/mp4 (Zoom/Teams), video/x-matroska (OBS), video/quicktime (iPhone), video/x-msvideo (legacy Windows), video/webm (browser recorder). | AC-01, AC-02 | Spec: REQ-VT-01, REQ-VT-02 | Impl: §7" `
  -Priority 1

$t08 = New-Bead `
  -Title "[accept-mp4] TASK-08: Update app.js handleTranscribe() proxy mode body" `
  -Description "PHASE-2 | File: integrations/web-example/app.js | In handleTranscribe(), add mimeType: selectedAudioBlob.type || undefined to the proxyPost('/audio/transcribe', ...) body alongside audioBase64. || undefined ensures empty string (File.type unknown) is omitted from the body, triggering the audio/webm fallback in the provider. | Run T-VT-06 (POST /audio/transcribe with mimeType='video/mp4' -> 200) and T-VT-07 (no mimeType field -> 200, backward compat) after implementation. | AC-03 | Spec: REQ-VT-05 | Impl: §4 (proxy mode section) | Example A (MP4 proxy-mode body: { audioBase64, mimeType: 'video/mp4', model: 'whisper-1' })" `
  -Priority 1


# ---------------------------------------------------------------------------
# PHASE 3 — Web UI: Batch Combined Video
# ---------------------------------------------------------------------------
$t09 = New-Bead `
  -Title "[accept-mp4] TASK-09: Add ffmpeg.wasm CDN imports and DOM elements to index.html" `
  -Description "PHASE-3 | File: integrations/web-example/index.html | Three additions: (1) <script type='module'> block before </body> importing FFmpeg from @ffmpeg/ffmpeg@0.12.10/dist/esm and toBlobURL from @ffmpeg/util@0.12.1/dist/esm (cdn.jsdelivr.net), setting window._FFmpeg and window._toBlobURL. Design D3: CDN not bundled — ffmpeg.wasm+core is ~25 MB; pinned semver prevents silent upstream breakage; consistent with jszip CDN pattern. (2) Inside .results-actions (after #btn-download-zip): <button id='btn-download-combined' class='btn-ghost btn-sm' hidden>⬇ Combined Video</button>. (3) Inside #batch-results (after #batch-shots): #combined-video-section div with .combined-video-header (section-label span + #combined-video-status span aria-live='polite') and #combined-video-player video controls. | Verify: window._FFmpeg and window._toBlobURL defined in browser console. | AC-11, AC-13, AC-20 | Spec: REQ-BCV-02, REQ-BCV-03 | Impl: §7" `
  -Priority 1

$t10 = New-Bead `
  -Title "[accept-mp4] TASK-10: Add combined video CSS classes to styles.css" `
  -Description "PHASE-3 | File: integrations/web-example/styles.css | Add four classes: .combined-video-section { margin-top:1rem; border:1px solid var(--border); border-radius:6px; overflow:hidden; } .combined-video-header { display:flex; align-items:center; justify-content:space-between; padding:.45rem .75rem; background:var(--surface); border-bottom:1px solid var(--border); } .combined-video-status { font-size:.75rem; color:var(--muted); } .combined-video-player { width:100%; max-height:420px; display:block; background:#000; } | Confirm layout: border+radius on section, flex header with status right-aligned, dark player background, full-width responsive player. | Spec: REQ-BCV-04 | Impl: §8" `
  -Priority 2

$t11 = New-Bead `
  -Title "[accept-mp4] TASK-11: Implement stitchVideos() in app.js" `
  -Description "PHASE-3 | File: integrations/web-example/app.js | Add module-level state: let combinedVideoBlob=null; let combinedVideoDataUri=null. Add DOM refs: combinedVideoSection, combinedVideoStatus, combinedVideoPlayer, btnDownloadCombined. Implement async stitchVideos(resultItems) with ordered guards: (1) filter clips (status==='ok'&&modality==='video'&&result?.data) -> null if <2. (2) SharedArrayBuffer undefined -> set status message, null (REQ-BCV-11, AC-21). (3) _FFmpeg||_toBlobURL missing -> set status, null. (4) size guard: reduce(sum+base64len*0.75)>500MB -> set status, null (Design D6: 0.75 estimate ~1% accurate, avoids doubling memory pre-load). Then: new FFmpeg(), ffmpeg.on('progress')->status 'Stitching N%', ffmpeg.load() from @ffmpeg/core@0.12.6/dist/esm via toBlobURL, writeFile clipN.mp4 for each clip, writeFile list.txt concat manifest, exec [-f concat -safe 0 -i list.txt -c copy combined.mp4] (Design D4: -c copy only, no re-encode; mixed-resolution fails and is caught), readFile -> Blob(video/mp4). | Run T-BCV-01..T-BCV-06. | AC-11,12,16,17,18,21 | Spec: REQ-BCV-05 | Impl: §9 | Examples G,H,I,J,K" `
  -Priority 1

$t12 = New-Bead `
  -Title "[accept-mp4] TASK-12: Wire stitchVideos() into runBatch() and clearBatch()" `
  -Description "PHASE-3 | File: integrations/web-example/app.js | runBatch() end (after all renderShotCard calls): reset combinedVideoBlob=null, combinedVideoDataUri=null, hide btnDownloadCombined, hide combinedVideoSection. Count successCount (ok+video+result.data). If successCount>=2: show #combined-video-section, await stitchVideos(batchResultItems). On success: FileReader readAsDataURL(blob)->combinedVideoDataUri, combinedVideoPlayer.src=URL.createObjectURL(blob), status='✓ N shots stitched', show btnDownloadCombined. On failure catch: status='Stitch failed: '+err.message (AC-18). If successCount<2: section+button remain hidden (AC-17). | Add btnDownloadCombined click handler: create object URL from combinedVideoBlob, trigger <a download='combined.mp4'>.click(), URL.revokeObjectURL(url). | clearBatch() additions: null both blobs, btnDownloadCombined.hidden=true, player.src='', section.classList.add('hidden'), status.textContent='' (AC-19). | AC-11,12,13,16,17,18,19 | Spec: REQ-BCV-06,07,10 | Impl: §10" `
  -Priority 1

$t13 = New-Bead `
  -Title "[accept-mp4] TASK-13: Update HTML and ZIP export with combined video" `
  -Description "PHASE-3 | File: integrations/web-example/app.js | Three changes: (1) Rename buildResultsHtml -> buildResultsHtmlAsync (add async keyword). When combinedVideoDataUri is set, prepend a styled <div> containing <video src=combinedVideoDataUri controls> above shot cards. Label: 'Combined Video — all N shots'. Risk from design.md: ALL callers must add await — TypeScript will enforce this at compile. (2) HTML download handler: const html = await buildResultsHtmlAsync(batchResultItems). (3) ZIP handler: if combinedVideoBlob set -> const combinedBytes=new Uint8Array(await combinedVideoBlob.arrayBuffer()); zip.file('combined.mp4', combinedBytes); change results.html line to await buildResultsHtmlAsync(batchResultItems). | Manual: HTML export opens offline, combined video plays at top (AC-14); ZIP includes combined.mp4 (AC-15); Example L: 4-shot batch with 1 failure -> combined.mp4 stitches 3 shots. | AC-14, AC-15 | Spec: REQ-BCV-08, REQ-BCV-09 | Impl: §11" `
  -Priority 1

# ---------------------------------------------------------------------------
# PHASE 4 — Tests and Verification
# ---------------------------------------------------------------------------
$t14 = New-Bead `
  -Title "[accept-mp4] TASK-14: Create transcription unit and integration tests" `
  -Description "PHASE-4 | New files: tests/unit/transcribe-mime.test.ts and tests/integration/transcribe-video.test.ts | Unit tests T-VT-01..T-VT-05: T-VT-01 mimeType='video/mp4'->toFile(buf,'media.mp4',{type:'video/mp4'}). T-VT-02 mimeType='video/x-matroska'->filename 'media.x-matroska'. T-VT-03 no options->toFile(buf,'media.webm',{type:'audio/webm'}) regression guard. T-VT-04 mimeType='audio/webm;codecs=opus'->ext='webm' (semicolon strip). T-VT-05 mimeType=''->fallback audio/webm. | Integration tests T-VT-06..T-VT-09 (AI_MOCK=true): T-VT-06 POST /audio/transcribe {audioBase64,mimeType:'video/mp4'}->200+mimeType forwarded. T-VT-07 no mimeType->200 backward compat. T-VT-08 POST /v1/audio/transcriptions multipart MP4->200+{mimeType:'video/mp4'}. T-VT-09 missing file->400 error contains 'No audio or video file provided'. | Run: $env:AI_MOCK='true'; npm test | AC-09, AC-10 | Spec: test-plan.md Part 1 | All existing tests must pass — zero regressions permitted." `
  -Priority 1

$t15 = New-Bead `
  -Title "[accept-mp4] TASK-15: Create combined video unit tests" `
  -Description "PHASE-4 | New file: tests/unit/stitch-videos.test.ts | Six tests T-BCV-01..T-BCV-06 with mocked ffmpeg.wasm and DOM: T-BCV-01 3 mock clips -> Blob(video/mp4) returned, ffmpeg.exec called with concat args [-f concat -safe 0 -i list.txt -c copy combined.mp4]. T-BCV-02 1 clip -> null immediately, ffmpeg never loaded. T-BCV-03 0 successful clips (all status:'error') -> null immediately. T-BCV-04 size guard: 3 clips each ~200 MB decoded (base64len*0.75>500MB) -> null + size-exceeded message in #combined-video-status. T-BCV-05 SharedArrayBuffer=undefined -> null + cross-origin isolation message, no uncaught exception. T-BCV-06 ffmpeg.exec throws 'Codec parameters are not compatible' -> stitchVideos rejects, caller catches and sets status 'Stitch failed: Codec parameters are not compatible'. | Mock window._FFmpeg, window._toBlobURL, SharedArrayBuffer, DOM #combined-video-status. | Run: $env:AI_MOCK='true'; npm test -- tests/unit/stitch-videos | Spec: test-plan.md Part 2 Unit Tests" `
  -Priority 1

$t16 = New-Bead `
  -Title "[accept-mp4] TASK-16: Build, full test suite, lint, and smoke tests" `
  -Description "PHASE-4 COMPLETION | Commands: (1) npm run build — zero TypeScript errors. (2) npm run build:web — zero browser bundle errors. (3) $env:AI_MOCK='true'; npm test — all existing + new tests pass, zero regressions. (4) npm run lint — zero lint errors. (5) Manual smoke tests S-01..S-12: S-01 file picker shows .mp4; S-02 transcribe MP4 proxy mode; S-03 transcribe MKV proxy mode; S-04 transcribe MP3 regression; S-05 cURL MP4 compat endpoint (200+transcript); S-06 3-shot batch -> combined section visible, player plays, status '✓ 3 shots stitched', button visible; S-07 download combined.mp4 -> plays in VLC; S-08 HTML export -> combined video at top plays offline; S-09 ZIP -> combined.mp4 present alongside shots; S-10 Clear -> section hidden, player blank, button hidden; S-11 1-shot batch -> combined section stays hidden throughout; S-12 ffmpeg load failure -> inline error, shot cards+ZIP button unaffected. | Final: git log --all -p — no API keys or secrets. | AC-01..AC-21 | Spec: test-plan.md S-01..S-12" `
  -Priority 1

Write-Host "`n=== Setting up dependencies ===" -ForegroundColor Cyan

# Phase 0 -> Phase 1
bd dep add $t03 $t01   # TASK-03 blocked by TASK-01 (ProviderCallOptions.mimeType must exist)
bd dep add $t04 $t01   # TASK-04 blocked by TASK-01 (mimeType field must exist before forwarding)
bd dep add $t05 $t02   # TASK-05 blocked by TASK-02 (TranscribeBodySchema must include mimeType)
bd dep add $t05 $t03   # TASK-05 blocked by TASK-03 (transcribeAudio must accept mimeType option)

# Phase 1 -> Phase 2
bd dep add $t07 $t03   # TASK-07 blocked by TASK-03 (provider ready before UI file picker)
bd dep add $t07 $t04   # TASK-07 blocked by TASK-04 (fetch-client ready before UI wiring)
bd dep add $t08 $t07   # TASK-08 blocked by TASK-07 (handleTranscribe reads from file input)
bd dep add $t08 $t05   # TASK-08 blocked by TASK-05 (compat endpoint aligned before proxy body)

# Phase 1 -> Phase 3 (COOP/COEP required for SharedArrayBuffer)
bd dep add $t09 $t06   # TASK-09 blocked by TASK-06 (COOP/COEP headers enable SharedArrayBuffer)
bd dep add $t10 $t09   # TASK-10 blocked by TASK-09 (CSS for DOM elements added in TASK-09)
bd dep add $t11 $t09   # TASK-11 blocked by TASK-09 (DOM refs must exist: combinedVideoStatus etc)
bd dep add $t11 $t10   # TASK-11 blocked by TASK-10 (CSS must exist before wiring JS)
bd dep add $t12 $t11   # TASK-12 blocked by TASK-11 (stitchVideos() must exist before wiring)
bd dep add $t13 $t12   # TASK-13 blocked by TASK-12 (runBatch wiring must exist before export)

# Phase 4 blocked by all implementation tasks
bd dep add $t14 $t03   # transcription tests need provider impl
bd dep add $t14 $t04   # transcription tests need fetch-client impl
bd dep add $t14 $t05   # transcription tests need compat endpoint impl
bd dep add $t14 $t08   # transcription tests need proxy body impl
bd dep add $t15 $t11   # combined video tests need stitchVideos() impl
bd dep add $t15 $t12   # combined video tests need runBatch/clearBatch wiring
bd dep add $t16 $t13   # full build needs HTML/ZIP export complete
bd dep add $t16 $t14   # full build needs transcription tests green
bd dep add $t16 $t15   # full build needs combined video tests green

Write-Host "`n=== accept-mp4 Tasks Created ===" -ForegroundColor Green
Write-Host "Story:  $storyId"
Write-Host "Phase 0:  TASK-01=$t01  TASK-02=$t02"
Write-Host "Phase 1:  TASK-03=$t03  TASK-04=$t04  TASK-05=$t05  TASK-06=$t06"
Write-Host "Phase 2:  TASK-07=$t07  TASK-08=$t08"
Write-Host "Phase 3:  TASK-09=$t09  TASK-10=$t10  TASK-11=$t11  TASK-12=$t12  TASK-13=$t13"
Write-Host "Phase 4:  TASK-14=$t14  TASK-15=$t15  TASK-16=$t16"

bd stats
