<#
.SYNOPSIS  voice2text bead task creation script.
.USAGE     . .\scripts\beads-helpers.ps1; .\scripts\create-voice2text-beads.ps1
#>
Set-StrictMode -Off

function New-Bead {
    param([string]$Title,[string]$Description,[int]$Priority,[string]$Type="task")
    $raw = (bd create $Title -Description $Description -Priority $Priority -Type $Type) 6>&1 | Out-String
    if ($raw -match 'Created:\s*(bd-[a-z0-9]+)') { return $Matches[1] }
    throw "bd create did not return a bead ID. Raw output: $raw"
}

# ── Descriptions (single-quoted here-strings: zero PS interpolation) ──────────

$dStory = @'
voice2text (feat/voice2text). 13 SP, HIGH priority. 3 new capabilities: mic-button-ui, vibevoice-provider, provider-aware-audio-routes. 40 tasks, 20 ACs, 15 new tests (10 unit + 5 route). SCOPE: (1) Add mic button (🎤) to all 5 prompt textareas (Text, Image, Video, Structured, TTS); MediaRecorder proxy mode, SpeechRecognition direct mode; red pulse + M:SS timer + inline error messages auto-dismissed 5 s. (2) VibevoiceProvider class + vibevoice.json (3 models all costPerUnit:0) + PROVIDER_META entry + factory case. (3) Extend POST /audio/transcribe and POST /audio/speak with optional provider field — fully backward-compatible. FILES MOD: index.html, styles.css, app.js, routes.ts, providers/index.ts, .env.example. FILES NEW: providers/vibevoice.ts, providers/configs/vibevoice.json, tests/providers/vibevoice.test.ts. Spec: openspec/changes/voice2text/ (README.md, proposal.md, design.md, deltas.md, tasks.md, specs/, examples/, tests/, implementation.md, summary.md, cache.json).
'@

$dT001 = @'
FILE: integrations/web-example/index.html. ACTION: Wrap existing <textarea id="text-prompt"> in a new <div class="input-with-mic">. Add sibling <button class="btn-mic" data-target="text-prompt" title="Click to start voice input" aria-label="Start voice input for text prompt" type="button"> containing microphone SVG (paths and lines per examples/mic-button-usage.js HTML Pattern block) and <span class="mic-timer" aria-live="polite"></span>. The .input-with-mic div sits between .input-group and <textarea> per implementation.md note. Spec: specs/mic-button-ui/spec.md requirement "Mic button present on all prompt textareas", deltas.md mic-button-ui ADDED row 1, examples/mic-button-usage.js. ACCEPTANCE: .btn-mic[data-target="text-prompt"] exists; data-target matches textarea id exactly; type="button" present.
'@

$dT002 = @'
FILE: integrations/web-example/index.html. ACTION: Same .input-with-mic wrapper + .btn-mic pattern as T-001 applied to <textarea id="image-prompt">. Attributes: data-target="image-prompt", aria-label="Start voice input for image prompt", title="Click to start voice input", type="button". Same microphone SVG + .mic-timer span. Spec: tasks.md 1.2, specs/mic-button-ui/spec.md. ACCEPTANCE: .btn-mic[data-target="image-prompt"] present; pattern mirrors T-001 exactly.
'@

$dT003 = @'
FILE: integrations/web-example/index.html. ACTION: .input-with-mic wrapper + .btn-mic for <textarea id="video-prompt">. Attributes: data-target="video-prompt", aria-label="Start voice input for video prompt", title="Click to start voice input", type="button". Same SVG + .mic-timer span. Spec: tasks.md 1.3. ACCEPTANCE: .btn-mic[data-target="video-prompt"] present; pattern mirrors T-001.
'@

$dT004 = @'
FILE: integrations/web-example/index.html. ACTION: .input-with-mic wrapper + .btn-mic for <textarea id="structured-prompt">. Attributes: data-target="structured-prompt", aria-label="Start voice input for structured prompt", title="Click to start voice input", type="button". Same SVG + .mic-timer span. Spec: tasks.md 1.4. ACCEPTANCE: .btn-mic[data-target="structured-prompt"] present.
'@

$dT005 = @'
FILE: integrations/web-example/index.html. ACTION: .input-with-mic wrapper + .btn-mic for <textarea id="tts-text">. Attributes: data-target="tts-text", aria-label="Start voice input for TTS text", title="Click to start voice input", type="button". Same SVG + .mic-timer span. Spec: tasks.md 1.5. ACCEPTANCE: .btn-mic[data-target="tts-text"] present; five .btn-mic elements total in DOM.
'@

$dT006 = @'
FILE: integrations/web-example/index.html. ACTION: Code review — confirm exactly 5 .btn-mic elements exist (one per textarea panel), each with: (1) data-target matching its textarea id exactly; (2) aria-label matching its panel name; (3) title="Click to start voice input"; (4) type="button"; (5) microphone SVG + .mic-timer[aria-live=polite] span. Spec: specs/mic-button-ui/spec.md scenario "Mic button present on all five tabs", tasks.md 1.6. ACCEPTANCE: document.querySelectorAll(".btn-mic").length === 5 in browser DevTools console; zero buttons missing required attributes.
'@

$dT007 = @'
FILE: integrations/web-example/styles.css. POSITION: append to end — DO NOT modify existing rules (implementation.md "no existing rule modifications — additive only"). ACTION: Add .input-with-mic { position: relative; display: block; } and .input-with-mic textarea { padding-right: 2.6rem; width: 100%; box-sizing: border-box; }. Spec: tasks.md 2.1, deltas.md mic-button-ui ADDED rows. ACCEPTANCE: textarea padding-right 2.6rem visible in DevTools computed styles; mic button contained within wrapper.
'@

$dT008 = @'
FILE: integrations/web-example/styles.css. POSITION: after T-007 rules. ACTION: Add .btn-mic { position: absolute; top: 0.4rem; right: 0.4rem; background: transparent; border: none; cursor: pointer; color: var(--color-text-secondary); padding: 0.2rem; line-height: 1; } and .btn-mic:hover { color: var(--color-text-primary); }. No inline hex colour literals — use CSS vars. Spec: tasks.md 2.2, design.md Non-Goals (no new UI panel). ACCEPTANCE: button appears top-right of textarea; transparent background; hover changes colour via CSS var.
'@

$dT009 = @'
FILE: integrations/web-example/styles.css. POSITION: after T-008 rules. ACTION: Add @keyframes mic-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} } and .btn-mic.recording { color: #ef4444; animation: mic-pulse 1s ease-in-out infinite; }. Spec: tasks.md 2.3, specs/mic-button-ui/spec.md scenario "Button turns red on recording start". ACCEPTANCE: adding .recording class to .btn-mic triggers red pulse animation at #ef4444; animation plays continuously while class is applied.
'@

$dT010 = @'
FILE: integrations/web-example/styles.css. POSITION: after T-009 rules. ACTION: Add .mic-timer { display: none; font-size: 0.7rem; font-variant-numeric: tabular-nums; vertical-align: middle; } and .btn-mic.recording .mic-timer { display: inline; }. Spec: tasks.md 2.4, specs/mic-button-ui/spec.md scenarios "Timer shows elapsed seconds" and "Timer hidden when idle". ACCEPTANCE: timer hidden at rest; visible when .recording; shows M:SS format (e.g. "1:14" for 74 s).
'@

$dT011 = @'
FILE: integrations/web-example/styles.css. POSITION: after T-010 rules. ACTION: Add .mic-error { color: #ef4444; font-size: 0.78rem; margin-top: 0.25rem; }. Spec: tasks.md 2.5, specs/mic-button-ui/spec.md Inline error messages requirement. ACCEPTANCE: .mic-error paragraph renders in red (#ef4444) at 0.78rem with top margin below .input-group; style applies correctly to dynamically injected elements.
'@

$dT012 = @'
FILE: integrations/web-example/app.js. POSITION: before initMicButtons() function. ACTION: function formatMicTime(secs) { const m = Math.floor(secs/60); const s = secs%60; return `${m}:${String(s).padStart(2,"0")}`; }. Examples: formatMicTime(5) → "0:05"; formatMicTime(74) → "1:14"; formatMicTime(3600) → "60:00"; formatMicTime(0) → "0:00". Spec: specs/mic-button-ui/spec.md Timer scenario, examples/mic-button-usage.js. Tested: tests/voice2text.test.ts formatMicTime suite (6 assertions). ACCEPTANCE: all 6 test cases pass; function has no DOM dependency.
'@

$dT013 = @'
FILE: integrations/web-example/app.js. POSITION: after formatMicTime. ACTION: function showMicError(btn, msg) { const group = btn.closest(".input-group"); if (!group) return; group.querySelector(".mic-error")?.remove(); const p = document.createElement("p"); p.className = "mic-error"; p.textContent = msg; group.appendChild(p); setTimeout(() => p.remove(), 5000); }. Clears existing error first so only one error is visible per group. Spec: specs/mic-button-ui/spec.md error requirement + "Error auto-dismissed" scenario, examples/mic-button-usage.js. Tested: tests/voice2text.test.ts showMicError suite (3 tests). ACCEPTANCE: one error per group max; auto-removed after 5 s; orphan button (no .input-group ancestor) does nothing.
'@

$dT014 = @'
FILE: integrations/web-example/app.js. POSITION: after showMicError. ACTION: function appendTranscript(ta, text) { const trimmed = text?.trim(); if (!trimmed) return; ta.value = ta.value ? ta.value+" "+trimmed : trimmed; ta.dispatchEvent(new Event("input",{bubbles:true})); }. Fires input event to trigger char-counter updates (implementation.md). Spec: specs/mic-button-ui/spec.md scenario "Transcribed text appended", examples/mic-button-usage.js. Tested: tests/voice2text.test.ts appendTranscript suite (4 tests). ACCEPTANCE: empty/whitespace text does nothing; existing content gets space separator; input event fires once per call.
'@

$dT015 = @'
FILE: integrations/web-example/app.js. POSITION: after appendTranscript. ACTION: async function transcribeMicBlob(blob) — reads tabState.get("audio") dynamically at call time (design.md D3: not at init time); uses FileReader.readAsDataURL, strips data URI prefix with .split(",")[1]; calls proxyPost("/audio/transcribe", {audioBase64: base64, mimeType: blob.type, provider, model}); returns data.text??"". MUST use proxyPost not raw fetch (implementation.md). tabState.get("audio")?.provider — if undefined, server falls back to AI_PROVIDER. Spec: deltas.md transcribeMicBlob row, examples/mic-button-usage.js transcribeMicBlob function. ACCEPTANCE: POST goes to /audio/transcribe; provider/model forwarded dynamically; undefined provider acceptable.
'@

$dT016 = @'
FILE: integrations/web-example/app.js. POSITION: after transcribeMicBlob. ACTION: function initMicButtons() { document.querySelectorAll(".btn-mic").forEach(btn => { const ta = document.getElementById(btn.dataset.target); if (!ta) return; // silently skip per spec scenario "Invalid data-target silently skipped" let mediaRecorder=null, stream=null, chunks=[], timerInterval=null, elapsedSeconds=0, recognition=null; // per-button isolated closure (design.md D1) const timerEl = btn.querySelector(".mic-timer"); let isRecording = false; btn.addEventListener("click", () => { /* proxy/direct branches added in T-017, T-018 */ }); }); }. Spec: specs/mic-button-ui/spec.md, design.md D1 "One closure per button". ACCEPTANCE: function skeleton exists; invalid data-target silently skipped; each button has isolated closure variables.
'@

$dT017 = @'
FILE: integrations/web-example/app.js. POSITION: inside initMicButtons click handler, !isRecording branch (proxy mode). ACTION: (1) navigator.mediaDevices.getUserMedia({audio:true}) — catch NotFoundError → showMicError "⚠ No microphone found. Connect a microphone and try again."; catch NotAllowedError/SecurityError → showMicError "⚠ Microphone access was denied. Allow microphone in browser settings and try again." (2) Create MediaRecorder preferring audio/webm;codecs=opus → audio/webm → audio/ogg (design.md D2). (3) chunks=[]; ondataavailable → chunks.push(e.data). (4) Start setInterval: increment elapsedSeconds, timerEl.textContent=formatMicTime(elapsedSeconds). (5) Add .recording class to btn. (6) mediaRecorder.onstop: assemble Blob; if blob.size<500 showMicError "Recording too short — please try again." return; else transcribeMicBlob(blob).then(text=>appendTranscript(ta,text)).catch(err=>showMicError(btn,"⚠ Transcription failed: "+err.message)). (7) mediaRecorder.start(); isRecording=true. Second click: mediaRecorder.stop(); stream.getTracks().forEach(t=>t.stop()); clearInterval(timerInterval); reset timer; remove .recording; isRecording=false. Spec: specs/mic-button-ui/spec.md proxy recording scenarios, design.md D2.
'@

$dT018 = @'
FILE: integrations/web-example/app.js. POSITION: inside initMicButtons click handler, else branch (direct mode — no proxy). ACTION: if (!window.SpeechRecognition && !window.webkitSpeechRecognition) { showMicError(btn, "Voice input requires proxy mode or Chrome/Edge."); return; } recognition = new (window.SpeechRecognition||window.webkitSpeechRecognition)(); recognition.continuous=true; recognition.interimResults=true; recognition.onresult = e => { let final="", interim=""; for(let i=e.resultIndex; i<e.results.length; i++) { if(e.results[i].isFinal) final+=e.results[i][0].transcript; else interim+=e.results[i][0].transcript; } if(interim) ta.value = (ta.value?ta.value+" ":"")+interim; }; recognition.onend = () => { if(final) appendTranscript(ta, final); reset recording state; remove .recording; isRecording=false; }; recognition.start(); isRecording=true; add .recording. Second click: recognition.stop(). Spec: specs/mic-button-ui/spec.md direct-mode requirement, design.md D2. ACCEPTANCE: interim text visible during speech in Chrome/Edge; Firefox shows error; final committed on stop.
'@

$dT019 = @'
FILE: integrations/web-example/app.js. POSITION: distributed within T-017 proxy path and T-018 direct path. EDGE CASES to verify are all handled: (1) blob < 500 bytes → showMicError "Recording too short — please try again." — no POST sent (spec scenario "Blob too short rejected"); (2) getUserMedia NotAllowedError → "⚠ Microphone access was denied. Allow microphone in browser settings and try again." (scenario "Permission denied error"); (3) getUserMedia NotFoundError → "⚠ No microphone found. Connect a microphone and try again." (scenario "No microphone found"); (4) proxyPost failure → "⚠ Transcription failed: " + err.message (scenario "Transcription network failure"); (5) SpeechRecognition unavailable → descriptive error about proxy mode or Chrome/Edge (scenario "Browser lacks SpeechRecognition"); (6) multiple buttons — each has own closure state so stopping one does not affect others (design.md D1, spec scenario "Multiple buttons independent"). Spec: specs/mic-button-ui/spec.md all error scenarios. ACCEPTANCE: all 6 edge cases handled; error messages match spec text exactly.
'@

$dT020 = @'
FILE: integrations/web-example/app.js. POSITION: inside DOMContentLoaded IIFE, AFTER all tab listener setup — last call before IIFE closes (tasks.md 3.9). ACTION: Add the line initMicButtons(); immediately before the closing brace of the DOMContentLoaded IIFE, after all tab/button/session listeners are wired. Spec: implementation.md Phase 4 note. ACCEPTANCE: after page load, DevTools shows five .btn-mic elements with click listeners attached; no console errors; all five buttons are interactive.
'@

$dT021 = @'
FILE: src/ai-powered/server/routes.ts. POSITION: inside PROVIDER_META array. ACTION: Add entry { id: "vibevoice", name: "VibeVoice (local)", envKey: "VIBEVOICE_API_URL", modalities: ["audio"], inputModalities: ["audio"], active: (process.env["VIBEVOICE_API_URL"]?.trim() ?? "").length > 0 }. Spec: specs/vibevoice-provider/spec.md "VibeVoice registered in PROVIDER_META", deltas.md "vibevoice entry in PROVIDER_META", tasks.md 4.1. ACCEPTANCE: GET /providers returns vibevoice entry with active:true when VIBEVOICE_API_URL set; active:false when absent.
'@

$dT022 = @'
FILE: src/ai-powered/server/routes.ts. POSITION: active flag calculation in PROVIDER_META entries. ACTION: Update active flag pattern to (process.env[m.envKey]?.trim() ?? "").length > 0 consistently across all PROVIDER_META entries (design.md D4: explicitly documents URL-based provider intent, semantically identical to prior !!trim() pattern but clearer for future provider authors). Spec: design.md D4, deltas.md "active flag calculation updated to use envVal.length > 0", tasks.md 4.2. ACCEPTANCE: behavior unchanged for existing providers; pattern consistent across all entries.
'@

$dT023 = @'
FILE: src/ai-powered/providers/vibevoice.ts (NEW FILE). ACTION: Create file. Define VIBEVOICE_MODELS static const array with three entries: { id: "vibevoice-asr-7b", modalities: ["audio"], description: "VibeVoice ASR 7B — high-accuracy speech recognition", costPerUnit: 0 }, { id: "vibevoice-realtime-0.5b", modalities: ["audio"], description: "VibeVoice Realtime 0.5B — low-latency streaming", costPerUnit: 0 }, { id: "vibevoice-tts-1.5b", modalities: ["audio"], description: "VibeVoice TTS 1.5B — neural text-to-speech", costPerUnit: 0 }. Import BaseProvider and required types. Spec: specs/vibevoice-provider/spec.md, deltas.md "VIBEVOICE_MODELS static registry", tasks.md 5.1. ACCEPTANCE: all three IDs present; all costPerUnit:0 (numeric not null); IDs match vibevoice.json exactly.
'@

$dT024 = @'
FILE: src/ai-powered/providers/vibevoice.ts. ACTION: Implement class VibevoiceProvider extends BaseProvider. Constructor resolves baseUrl priority: config.baseUrl → process.env["VIBEVOICE_API_URL"] → "http://localhost:8080". Strip trailing slash: this.baseUrl = resolvedUrl.replace(/\/$/, ""). Spec: specs/vibevoice-provider/spec.md "VibevoiceProvider baseUrl resolution" requirement, scenarios "Explicit config.baseUrl wins" and "Trailing slash stripped", tasks.md 5.2. ACCEPTANCE: new VibevoiceProvider({baseUrl:"http://custom:9000"}) → baseUrl="http://custom:9000"; new VibevoiceProvider({baseUrl:"http://localhost:8080/"}) → "http://localhost:8080" (no trailing slash); env var fallback works.
'@

$dT025 = @'
FILE: src/ai-powered/providers/vibevoice.ts. ACTION: Implement listModels(modality?: string) — returns VIBEVOICE_MODELS optionally filtered: if modality provided, return VIBEVOICE_MODELS.filter(m => m.modalities.includes(modality)); else return all three. Spec: specs/vibevoice-provider/spec.md listModels scenarios ("returns all three models", "audio filter returns all three"), tasks.md 5.3. ACCEPTANCE: listModels() → 3 models; listModels("audio") → 3 models (all are audio); listModels("text") → 0 models.
'@

$dT026 = @'
FILE: src/ai-powered/providers/vibevoice.ts. ACTION: Implement async transcribeAudio(audio: Blob | Buffer): Promise<string>. Convert to base64: if (audio instanceof Blob) { const b64 = Buffer.from(await audio.arrayBuffer()).toString("base64"); } else { const b64 = audio.toString("base64"); }. POST { audio_base64: b64, model: this.model } to `${this.baseUrl}/transcribe`. If !response.ok → throw new Error(`VibevoiceProvider transcribeAudio failed: ${response.status}`). If data.error → throw new Error(data.error). Return data.text. Spec: specs/vibevoice-provider/spec.md transcribeAudio scenarios, implementation.md "TypeScript — transcribeAudio signature", tasks.md 5.4. ACCEPTANCE: success → returns string; HTTP 503 → throws Error containing "503"; data.error → throws with error text.
'@

$dT027 = @'
FILE: src/ai-powered/providers/vibevoice.ts. ACTION: Implement async synthesizeSpeech(text: string): Promise<Blob>. POST { text, model: this.model } to `${this.baseUrl}/synthesize`. If !response.ok → throw new Error(`VibevoiceProvider synthesizeSpeech failed: ${response.status}`). Else: const arrayBuffer = await response.arrayBuffer(); return new Blob([arrayBuffer], { type: "audio/wav" }). NOTE (implementation.md): route converts returned Blob to base64 JSON — provider does NOT handle that step. Spec: specs/vibevoice-provider/spec.md synthesizeSpeech scenarios, tasks.md 5.5. ACCEPTANCE: success → Blob with type "audio/wav"; HTTP 500 → throws Error containing "500".
'@

$dT028 = @'
FILE: src/ai-powered/providers/vibevoice.ts. ACTION: Implement generateText(_prompt: string): never { throw new Error("VibevoiceProvider does not support text generation"); }. VibeVoice text-generation is explicitly out of scope (design.md Non-Goals). Spec: specs/vibevoice-provider/spec.md scenario "generateText throws", deltas.md "generateText — always throws", tasks.md 5.6. ACCEPTANCE: provider.generateText("hello") throws Error with message exactly "VibevoiceProvider does not support text generation"; covered by vibevoice.test.ts test 8.
'@

$dT029 = @'
FILE: src/ai-powered/providers/configs/vibevoice.json (NEW FILE). ACTION: Create JSON array with three model objects: { "id": "vibevoice-asr-7b", "modalities": ["audio"], "description": "VibeVoice ASR 7B — high-accuracy speech recognition", "costPerUnit": 0 }, { "id": "vibevoice-realtime-0.5b", "modalities": ["audio"], "description": "VibeVoice Realtime 0.5B — low-latency streaming", "costPerUnit": 0 }, { "id": "vibevoice-tts-1.5b", "modalities": ["audio"], "description": "VibeVoice TTS 1.5B — neural text-to-speech", "costPerUnit": 0 }. IDs must exactly match VIBEVOICE_MODELS in vibevoice.ts. costPerUnit must be numeric 0 (not null, not omitted). Spec: specs/vibevoice-provider/spec.md vibevoice.json requirement, deltas.md, tasks.md 6.1. ACCEPTANCE: JSON parses without error; all three models have costPerUnit:0 numeric; IDs match VIBEVOICE_MODELS exactly.
'@

$dT030 = @'
FILE: src/ai-powered/providers/index.ts. ACTION: Add import statement for VibevoiceProvider from "./vibevoice" (check existing import path convention in file — may need "./vibevoice.js"). No other changes at this step. Spec: tasks.md 6.2. ACCEPTANCE: TypeScript compiler resolves import without error; VibevoiceProvider class accessible in provider factory function body.
'@


$dT031 = @'
FILE: src/ai-powered/providers/index.ts. ACTION: Add case "vibevoice": return new VibevoiceProvider(config); to the provider factory switch/map (check existing cases for exact pattern — may be a switch statement or object map). Spec: specs/vibevoice-provider/spec.md scenario "Factory creates VibevoiceProvider", deltas.md "case vibevoice in provider factory (index.ts)", tasks.md 6.3. ACCEPTANCE: createProvider({provider:"vibevoice"}) returns instanceof VibevoiceProvider; unknown provider string still throws descriptive error (existing behavior preserved).
'@

$dT032 = @'
FILE: src/ai-powered/server/routes.ts. POSITION: POST /audio/transcribe handler body. ACTION: Destructure provider from req.body alongside existing fields: const { audioBase64, provider, model } = req.body. Pass to factory: createProvider({ provider: provider ?? process.env["AI_PROVIDER"] ?? "openai", model }). audioBase64 missing still returns 400 (backward compatible). Spec: specs/provider-aware-audio-routes/spec.md POST /audio/transcribe scenarios, deltas.md "provider? field accepted in POST /audio/transcribe", tasks.md 7.1. ACCEPTANCE: provider:"vibevoice" → VibevoiceProvider.transcribeAudio called; no provider → AI_PROVIDER env fallback; missing audioBase64 → 400 {error:"audioBase64 is required."}.
'@

$dT033 = @'
FILE: src/ai-powered/server/routes.ts. POSITION: POST /audio/speak handler body. ACTION: Same pattern as T-032 — destructure provider from req.body: const { text, provider, model } = req.body. Pass to createProvider({ provider: provider ?? process.env["AI_PROVIDER"] ?? "openai", model }). text missing still returns 400. Spec: specs/provider-aware-audio-routes/spec.md POST /audio/speak scenarios, deltas.md "provider? field accepted in POST /audio/speak", tasks.md 7.2. ACCEPTANCE: provider:"vibevoice" → VibevoiceProvider.synthesizeSpeech called; response contains {audio: base64, mimeType:"audio/wav"}; existing clients without provider field work identically.
'@

$dT034 = @'
FILE: .env.example. POSITION: append to end of file. ACTION: Add VIBEVOICE_API_URL documentation block including: env var declaration (VIBEVOICE_API_URL=http://localhost:8080), HuggingFace model links (microsoft/VibeVoice-ASR, microsoft/VibeVoice-Realtime, microsoft/VibeVoice-TTS), pip install command (pip install vibevoice vllm), server start command (python -m vibevoice.server --model microsoft/VibeVoice-ASR --port 8080). Spec: tasks.md 8.1, proposal.md Impact section, README.md Quick Start section. ACCEPTANCE: developer can follow setup from .env.example alone; GET /providers with env var set returns vibevoice active:true.
'@

$dT035 = @'
FILE: tests/providers/vibevoice.test.ts (NEW FILE). ACTION: Write 10 unit tests: (1) listModels() returns 3 models; (2) listModels("audio") returns 3 models; (3) transcribeAudio success → returns text string; (4) transcribeAudio HTTP 503 → throws Error containing "503"; (5) transcribeAudio data.error → throws with error message; (6) synthesizeSpeech success → Blob type "audio/wav"; (7) synthesizeSpeech HTTP 500 → throws Error containing "500"; (8) generateText throws "VibevoiceProvider does not support text generation"; (9) constructor config.baseUrl priority beats env var; (10) trailing slash stripped from baseUrl. Use msw or nock to mock HTTP per existing provider test pattern (implementation.md). Spec: tasks.md 9.1, specs/vibevoice-provider/spec.md. ACCEPTANCE: 10/10 pass with AI_MOCK=true.
'@

$dT036 = @'
FILE: tests/server/routes.test.ts. ACTION: Add 5 new tests: (1) POST /audio/transcribe with provider:"vibevoice" → 200 {text}; (2) POST /audio/transcribe without provider → falls back to AI_PROVIDER, returns 200; (3) POST /audio/transcribe missing audioBase64 → 400 {error:"audioBase64 is required."}; (4) POST /audio/speak with provider:"vibevoice" → 200 {audio, mimeType:"audio/wav"}; (5) POST /audio/speak missing text → 400 {error:"text is required."}. Check AI_MOCK flag pattern in existing route tests (implementation.md). Spec: tasks.md 9.2, specs/provider-aware-audio-routes/spec.md. ACCEPTANCE: 5 new tests pass; all pre-existing route tests unaffected.
'@

$dT037 = @'
COMMAND: $env:AI_MOCK="true"; npm test. PURPOSE: Run all Vitest tests — vibevoice.test.ts (10 tests), voice2text.test.ts (spec-level helpers), routes.test.ts additions (5 tests), plus all pre-existing tests. Spec: tasks.md 9.3, summary.md Verification Checklist. ACCEPTANCE: exit code 0; all new tests pass; zero pre-existing test regressions.
'@

$dT038 = @'
COMMAND: npm run build. PURPOSE: TypeScript compilation — confirms zero type errors in vibevoice.ts, routes.ts, providers/index.ts, and all changed files. Spec: tasks.md 9.4, summary.md Verification Checklist. ACCEPTANCE: exit code 0; zero TypeScript errors; zero ESLint errors.
'@

$dT039 = @'
CODE REVIEW. Verify all 20 ACs (AC-01 through AC-20) using implementation.md AC table: AC-01 → 1.1–1.6 (five buttons); AC-02/03 → 3.5–3.7 (recording flow); AC-04 → 3.3, 3.6 (appendTranscript); AC-05 → 3.7 (direct-mode interim); AC-06–10 → 3.2, 3.8 (errors); AC-11/12/13 → 4.1, 5.1, 6.1 (provider registered); AC-14 → 5.4, 7.1 (transcribeAudio routed); AC-15 → 5.5, 7.2 (synthesizeSpeech routed); AC-16 → 5.1, 6.1 (models); AC-17 → 8.1 (env doc); AC-18 → 9.4 (build); AC-19 → 9.3 (tests); AC-20 → 5.6, 9.1 (generateText throws). Spec: tasks.md section 10, implementation.md AC table, summary.md. ACCEPTANCE: all 20 ACs verified by code inspection or T-037/T-038 results.
'@

$dT040 = @'
MANUAL TEST. SETUP: npm run dev; proxy mode active. STEPS: Open each of the 5 tabs (Text, Image, Video, Structured, TTS). Click mic button on each — verify red pulse animation + M:SS timer starts. Speak a phrase. Click again to stop. Verify transcription text appended to textarea (space separator if text existed). EDGE CASES: deny microphone permission → inline error appears and auto-clears after 5 s; very short recording → "Recording too short" error. Spec: tasks.md 10.2, specs/mic-button-ui/spec.md proxy-mode scenarios. ACCEPTANCE: transcription appended correctly on all 5 panels; all recording indicators work; errors surface inline.
'@

$dT041 = @'
MANUAL TEST. SETUP: VIBEVOICE_API_URL=http://localhost:8080; VibeVoice server running (pip install vibevoice vllm; python -m vibevoice.server --model microsoft/VibeVoice-ASR --port 8080). STEPS: Open Audio tab → select "VibeVoice (local)" provider + "vibevoice-asr-7b" model. Navigate to Text tab. Click mic, speak, stop. Verify request in Network tab shows provider:"vibevoice". Switch provider in Audio tab; verify next mic recording uses new provider without page reload (design.md D3: tabState.get("audio") read at call time). Spec: tasks.md 10.3, design.md D3. ACCEPTANCE: VibeVoice provider used when selected; switching takes effect immediately.
'@

$dT042 = @'
MANUAL TEST. SETUP: Open app in direct mode (no proxy); use Chrome or Edge. STEPS: Click mic button — observe interim transcription text appearing in textarea in real time. Stop recording — confirm final text committed via appendTranscript (space separator if existing content). Then open in Firefox: click mic — confirm inline error appears immediately explaining proxy mode or Chrome/Edge required; no crash or uncaught error. Spec: tasks.md 10.4, specs/mic-button-ui/spec.md direct-mode scenarios. ACCEPTANCE: Chrome/Edge: interim text visible, final committed on stop; Firefox: descriptive error shown, no uncaught exception.
'@

$dT043 = @'
MANUAL TEST. PURPOSE: Confirm all existing tab functionality is unchanged. STEPS: Text tab — send message, verify AI response; Image tab — generate image; Video tab — generate video; Structured tab — structured output; Audio tab — TTS still works. Confirm .input-with-mic wrapper causes no layout regression; char counters update correctly after appendTranscript fires input event; padding-right 2.6rem does not clip existing text. Run npm test (exits 0). Spec: tasks.md 10.5, proposal.md "Breaking Changes: None", summary.md Risk Summary. ACCEPTANCE: all 5 tab functions identical to pre-change; zero new console errors; npm test exits 0.
'@



# ── Bead creation ─────────────────────────────────────────────────────────────

Write-Host "`n=== voice2text — Bead Task Creation ===" -ForegroundColor Cyan

Write-Host "`n[Story]" -ForegroundColor Yellow
$STORY = New-Bead "[voice2text] Mic button on all textareas + VibeVoice provider + provider-aware audio routes" $dStory 1 "story"
Write-Host "  Story : $STORY"

Write-Host "`n[Phase 1 - HTML: Mic Buttons]" -ForegroundColor Yellow
$T001 = New-Bead "[voice2text] T-001: Wrap #text-prompt in .input-with-mic + add .btn-mic button (index.html)" $dT001 1
$T002 = New-Bead "[voice2text] T-002: Wrap #image-prompt in .input-with-mic + add .btn-mic button (index.html)" $dT002 1
$T003 = New-Bead "[voice2text] T-003: Wrap #video-prompt in .input-with-mic + add .btn-mic button (index.html)" $dT003 1
$T004 = New-Bead "[voice2text] T-004: Wrap #structured-prompt in .input-with-mic + add .btn-mic button (index.html)" $dT004 1
$T005 = New-Bead "[voice2text] T-005: Wrap #tts-text in .input-with-mic + add .btn-mic button (index.html)" $dT005 1
$T006 = New-Bead "[voice2text] T-006: Verify all five .btn-mic buttons have correct attributes (index.html)" $dT006 1
Write-Host "  T-001:$T001  T-002:$T002  T-003:$T003"
Write-Host "  T-004:$T004  T-005:$T005  T-006:$T006"

Write-Host "`n[Phase 2 - CSS: Recording Styles]" -ForegroundColor Yellow
$T007 = New-Bead "[voice2text] T-007: Add .input-with-mic layout rules to styles.css" $dT007 1
$T008 = New-Bead "[voice2text] T-008: Add .btn-mic idle and hover styles to styles.css" $dT008 1
$T009 = New-Bead "[voice2text] T-009: Add .btn-mic.recording state + mic-pulse @keyframes to styles.css" $dT009 1
$T010 = New-Bead "[voice2text] T-010: Add .mic-timer style (hidden/visible states) to styles.css" $dT010 1
$T011 = New-Bead "[voice2text] T-011: Add .mic-error paragraph style to styles.css" $dT011 1
Write-Host "  T-007:$T007  T-008:$T008  T-009:$T009  T-010:$T010  T-011:$T011"

Write-Host "`n[Phase 3 - JavaScript: Helpers]" -ForegroundColor Yellow
$T012 = New-Bead "[voice2text] T-012: Implement formatMicTime(secs) helper in app.js" $dT012 1
$T013 = New-Bead "[voice2text] T-013: Implement showMicError(btn, msg) helper in app.js" $dT013 1
$T014 = New-Bead "[voice2text] T-014: Implement appendTranscript(ta, text) helper in app.js" $dT014 1
$T015 = New-Bead "[voice2text] T-015: Implement transcribeMicBlob(blob) async helper in app.js" $dT015 1
Write-Host "  T-012:$T012  T-013:$T013  T-014:$T014  T-015:$T015"

Write-Host "`n[Phase 3 - JavaScript: initMicButtons]" -ForegroundColor Yellow
$T016 = New-Bead "[voice2text] T-016: Implement initMicButtons() skeleton with per-button closure state (app.js)" $dT016 1
$T017 = New-Bead "[voice2text] T-017: Implement proxy-mode MediaRecorder recording path inside initMicButtons (app.js)" $dT017 1
$T018 = New-Bead "[voice2text] T-018: Implement direct-mode SpeechRecognition path inside initMicButtons (app.js)" $dT018 1
$T019 = New-Bead "[voice2text] T-019: Handle all edge cases in initMicButtons (blob size, getUserMedia, errors)" $dT019 1
$T020 = New-Bead "[voice2text] T-020: Call initMicButtons() at end of DOMContentLoaded IIFE (app.js)" $dT020 1
Write-Host "  T-016:$T016  T-017:$T017  T-018:$T018  T-019:$T019  T-020:$T020"

Write-Host "`n[Phase 4 - Provider: PROVIDER_META Registration]" -ForegroundColor Yellow
$T021 = New-Bead "[voice2text] T-021: Add vibevoice entry to PROVIDER_META in routes.ts" $dT021 1
$T022 = New-Bead "[voice2text] T-022: Update active flag to envVal.length > 0 pattern in routes.ts" $dT022 1
Write-Host "  T-021:$T021  T-022:$T022"

Write-Host "`n[Phase 5 - Provider: VibevoiceProvider Class]" -ForegroundColor Yellow
$T023 = New-Bead "[voice2text] T-023: Create vibevoice.ts with VIBEVOICE_MODELS static array (3 models, costPerUnit:0)" $dT023 1
$T024 = New-Bead "[voice2text] T-024: Implement VibevoiceProvider constructor with baseUrl resolution + trailing-slash strip" $dT024 1
$T025 = New-Bead "[voice2text] T-025: Implement VibevoiceProvider.listModels(modality?) with optional filter" $dT025 1
$T026 = New-Bead "[voice2text] T-026: Implement VibevoiceProvider.transcribeAudio(audio: Blob|Buffer)" $dT026 1
$T027 = New-Bead "[voice2text] T-027: Implement VibevoiceProvider.synthesizeSpeech(text) returning Blob audio/wav" $dT027 1
$T028 = New-Bead "[voice2text] T-028: Implement VibevoiceProvider.generateText - always throws" $dT028 1
Write-Host "  T-023:$T023  T-024:$T024  T-025:$T025"
Write-Host "  T-026:$T026  T-027:$T027  T-028:$T028"

Write-Host "`n[Phase 6 - Provider: Config and Factory]" -ForegroundColor Yellow
$T029 = New-Bead "[voice2text] T-029: Create providers/configs/vibevoice.json with three model entries" $dT029 1
$T030 = New-Bead "[voice2text] T-030: Import VibevoiceProvider in providers/index.ts" $dT030 1
$T031 = New-Bead "[voice2text] T-031: Add case vibevoice to provider factory in providers/index.ts" $dT031 1
Write-Host "  T-029:$T029  T-030:$T030  T-031:$T031"

Write-Host "`n[Phase 7 - Proxy Routes: provider field]" -ForegroundColor Yellow
$T032 = New-Bead "[voice2text] T-032: Add optional provider field to POST /audio/transcribe in routes.ts" $dT032 1
$T033 = New-Bead "[voice2text] T-033: Add optional provider field to POST /audio/speak in routes.ts" $dT033 1
Write-Host "  T-032:$T032  T-033:$T033"

Write-Host "`n[Phase 8 - Environment Configuration]" -ForegroundColor Yellow
$T034 = New-Bead "[voice2text] T-034: Document VIBEVOICE_API_URL in .env.example with setup instructions" $dT034 2
Write-Host "  T-034:$T034"

Write-Host "`n[Phase 9 - Tests]" -ForegroundColor Yellow
$T035 = New-Bead "[voice2text] T-035: Create tests/providers/vibevoice.test.ts - 10 unit tests" $dT035 1
$T036 = New-Bead "[voice2text] T-036: Add 5 route tests to tests/server/routes.test.ts" $dT036 1
$T037 = New-Bead "[voice2text] T-037: Run full test suite - all tests pass (AI_MOCK=true npm test)" $dT037 2
$T038 = New-Bead "[voice2text] T-038: Run npm run build - zero TypeScript errors" $dT038 2
Write-Host "  T-035:$T035  T-036:$T036  T-037:$T037  T-038:$T038"

Write-Host "`n[Phase 10 - QA Verification]" -ForegroundColor Yellow
$T039 = New-Bead "[voice2text] T-039: Code review - verify all 20 acceptance criteria (AC-01 through AC-20)" $dT039 2
$T040 = New-Bead "[voice2text] T-040: Manual smoke - proxy-mode mic button on all 5 panels" $dT040 2
$T041 = New-Bead "[voice2text] T-041: Manual smoke - VibeVoice provider selected via Audio tab" $dT041 2
$T042 = New-Bead "[voice2text] T-042: Manual smoke - direct-mode SpeechRecognition (Chrome/Edge + Firefox)" $dT042 2
$T043 = New-Bead "[voice2text] T-043: Manual smoke - confirm no regressions in existing tab functionality" $dT043 2
Write-Host "  T-039:$T039  T-040:$T040  T-041:$T041  T-042:$T042  T-043:$T043"



# ── Dependency wiring ─────────────────────────────────────────────────────────

Write-Host "`n[Wiring dependencies]" -ForegroundColor Yellow

# Phase 1 HTML: T-001..T-005 independent; T-006 needs all five wrappers
bd dep add $T006 $T001; bd dep add $T006 $T002; bd dep add $T006 $T003
bd dep add $T006 $T004; bd dep add $T006 $T005

# Phase 2 CSS: all five rules need HTML structure in place (T-006)
bd dep add $T007 $T006; bd dep add $T008 $T006; bd dep add $T009 $T006
bd dep add $T010 $T006; bd dep add $T011 $T006

# Phase 3 JS helpers: depend on HTML (T-006); transcribeMicBlob needs all helpers
bd dep add $T012 $T006; bd dep add $T013 $T006
bd dep add $T014 $T006
bd dep add $T015 $T012; bd dep add $T015 $T013; bd dep add $T015 $T014

# initMicButtons skeleton needs all helpers
bd dep add $T016 $T015
# proxy path needs skeleton
bd dep add $T017 $T016
# direct-mode path needs skeleton
bd dep add $T018 $T016
# edge cases span both paths
bd dep add $T019 $T017; bd dep add $T019 $T018
# call site needs everything wired
bd dep add $T020 $T019

# Phase 4 PROVIDER_META: independent from HTML/CSS/JS; T-022 refines T-021
bd dep add $T022 $T021

# Phase 5 VibevoiceProvider: needs PROVIDER_META entry (T-022)
bd dep add $T023 $T022
bd dep add $T024 $T023
bd dep add $T025 $T024; bd dep add $T026 $T024
bd dep add $T027 $T024; bd dep add $T028 $T024

# Phase 6 Config + Factory: json needs VIBEVOICE_MODELS (T-023); import + case need full class (T-028)
bd dep add $T029 $T023
bd dep add $T030 $T028; bd dep add $T031 $T030; bd dep add $T031 $T029

# Phase 7 Routes: need factory wired (T-031)
bd dep add $T032 $T031; bd dep add $T033 $T031

# Phase 9 Tests: unit tests need full class; route tests need T-032/T-033; run needs all tests written
bd dep add $T035 $T028
bd dep add $T036 $T033
bd dep add $T037 $T035; bd dep add $T037 $T036; bd dep add $T037 $T020
bd dep add $T038 $T037

# Phase 10 QA: code review needs build pass; manual smokes need code review
bd dep add $T039 $T038
bd dep add $T040 $T039; bd dep add $T041 $T039
bd dep add $T042 $T039; bd dep add $T043 $T039

# Story closes when all QA tasks done
bd dep add $STORY $T040; bd dep add $STORY $T041
bd dep add $STORY $T042; bd dep add $STORY $T043

Write-Host "  Dependencies wired." -ForegroundColor Green

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "  Story : $STORY"
Write-Host "  HTML  : $T001 $T002 $T003 $T004 $T005 $T006"
Write-Host "  CSS   : $T007 $T008 $T009 $T010 $T011"
Write-Host "  JS    : $T012 $T013 $T014 $T015 $T016 $T017 $T018 $T019 $T020"
Write-Host "  Prov  : $T021 $T022 $T023 $T024 $T025 $T026 $T027 $T028"
Write-Host "  Cfg   : $T029 $T030 $T031"
Write-Host "  Routes: $T032 $T033"
Write-Host "  Env   : $T034"
Write-Host "  Tests : $T035 $T036 $T037 $T038"
Write-Host "  QA    : $T039 $T040 $T041 $T042 $T043"
Write-Host ""
bd stats
Write-Host "`n  Start: bd ready" -ForegroundColor DarkGray
