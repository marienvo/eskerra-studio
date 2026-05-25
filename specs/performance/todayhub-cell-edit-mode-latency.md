# Today Hub: cell read → edit mode latency

This logbook tracks **where time is spent** when a Today Hub canvas cell switches from read-only view to the inline `NoteMarkdownEditor`, so we do not re-test the same guesses without evidence.

## Dev instrumentation (optional)

- Set `localStorage.todayHubPerf = '1'` and reload (dev builds only). The console logs `[todayHubPerf]` lines from `TodayHubCanvas` (`openCell_start`, `openCell_after_flush`, `openCell_finishOpen`, `focus_applied`) and from `NoteMarkdownEditor` for hub cells only (`hub_cm_boot` with `cmInitMs`).
- **Warm prewarm** is pointer-driven (`pointerenter` on non-empty cold cells), LRU-capped (`MAX_HUB_WARM_CELLS` in `TodayHubCanvas.tsx`); it is an optimization only—cold activation must still work without hover.

## Warm vs cold (implementation note)

- **Cold:** static preview only. **Warm:** read-only `NoteMarkdownEditor` under the same static preview (stacked); **active:** editable editor in the same React subtree so warm→active toggles `readOnly` without remount when the cell was prewarmed.
- Warm UI: the read-only underlay uses `visibility: hidden` plus `overflow: hidden` on `today-hub-canvas__cell-editor-stack--warm` so no CM glyphs composite with the static overlay (`App.css`).
- Per-row relative link resolution uses the row file URI (`relativeMarkdownLinkHrefIsResolvedByRowUri`), not “active row or Today.md”.

## Code paths (reference)

- **Activation:** `openCell` in `apps/desktop/src/components/TodayHubCanvas.tsx` (click / keyboard on read-only cell).
- **Before UI flip:** `openCell` calls `flushScheduledPersist().then(...)` and only then runs `setLocalRowSections`, `setActive`, `setCellSessionNonce`.
- **Persist flush:** `flushScheduledPersist` may `await persistTodayHubRow(...)` when `pendingPersistRef` is set (debounced row save after edits).
- **Row persist:** `persistTodayHubRow` in `apps/desktop/src/hooks/useTodayHubsState.ts` (implementation in `apps/desktop/src/hooks/todayHub/todayHubRowPersist.ts`) chains on `saveChainRef` (global inbox save serialization), then may run `persistTransientMarkdownImages`, `saveNoteMarkdown`, `refreshNotes`, etc.
- **Focus:** `useLayoutEffect` on `active`: **no click caret** → sync `focus()` plus one `rAF` if ref missing (fast path). **Click caret offset** → nested `rAF` (plus one retry if needed) before `focus({anchor})` so CodeMirror layout/`scrollIntoView` matches the static hit-test offset (post-2026-04-08 regression fix).
- **Editor mount:** Active cell renders `NoteMarkdownEditor` with a new `sessionKey` (`cellSessionNonce`), so the cell editor is recreated when opening a cell.

## Hypotheses under test

| ID | Hypothesis | How we expect to see it in logs |
| --- | --- | --- |
| **TH1** | Most latency is **waiting on `flushScheduledPersist`** when a debounced hub row save is pending or when **`persistTodayHubRow` waits on `saveChainRef`** behind another save. | `flushScheduledPersist` shows `hadPending: true` and large `flushMs`, and/or `persistTodayHubRow` shows large `chainWaitMs` before `run` starts. |
| **TH2** | With **no pending persist**, delay is still visible because **state updates are deferred to a `.then()`** after the flush promise (microtask), plus React commit batching — usually small (single-digit ms). | `hadPending: false` and `flushMs` tiny, but `openCellAfterFlushMs` slightly > 0. |
| **TH3** | **Deferring focus** with nested `requestAnimationFrame` can add large lag when those callbacks run late (main-thread backlog / rAF starvation), not just “two frames.” | Large gap between `todayHubOpenCell_layoutActive` and first successful `todayHubOpenCell_focusRun` on pre-fix builds. |
| **TH4** | **Heavy `NoteMarkdownEditor` / CodeMirror init** on the main thread after `setActive` dominates (large gap between `openCellAfterFlushMs` and when focus runs, or long `layoutActiveMs`). | Large `layoutActiveMs` or large span before `focusRun` beyond TH3. |
| **TH5** | **Click-to-edit** (`hasClickCaret: true`) is slower than **keyboard open** (Enter on empty label / focus path with `caret == null`) because only the click path uses nested `rAF` before `focus({anchor})`. | For the same session, compare `focusRunMs` for `via: "sync"` / `"rAF-keyboard-retry"` vs `"rAF-caret"` / `"rAF-caret-retry"`; pair with `hasClickCaret` on `todayHubOpenCell_start`. |

## Session `ccf322` instrumentation (removed from codebase)

Between investigation and the **caret-revert verification** run, the desktop build temporarily posted NDJSON to the debug ingest server from `TodayHubCanvas.tsx` (`todayHubOpenCell_*`, `todayHubFlushPersist`) and `useMainWindowWorkspace.ts` (`todayHubPersistRow_chainReady`). **All of these probes were removed** from the repository after the user confirmed correct caret placement with nested `rAF` restored (`runId: restored-rAF` in `.cursor/debug-ccf322.log`).

**Interpretation quick-check (archived):** Per `openId`, `afterFlushMs` ≈ flush + scheduling; `layoutActiveMs - afterFlushMs` ≈ React render/commit; `focusRunMs - layoutActiveMs` ≈ focus strategy + rAF backlog (TH3).

## Historical instrumentation (removed)

During investigation (session `d07064`, `.cursor/debug-d07064.log`) the desktop build emitted NDJSON via a local ingest URL from `TodayHubCanvas` and `persistTodayHubRow` (`todayHubOpenCell_*`, `todayHubFlushPersist`, `todayHubPersistRow_*`). Those probes were removed after verification on 2026-04-08.

## Results

### First reproduction (2026-04-08, session `d07064`)

Source: `.cursor/debug-d07064.log` (example lines below).

### Pre-repro code review (not proof)

- `openCell` **always** `await`s `flushScheduledPersist()` (via `.then`) before `setActive`, so any **pending debounced hub row save** or slow `persistTodayHubRow` / `saveChainRef` wait can postpone showing the editor (**TH1**).
- Focus previously used **two** nested `requestAnimationFrame` callbacks (**TH3** candidate).
- Opening a cell bumps `cellSessionNonce` and mounts a fresh **`NoteMarkdownEditor`** for that cell (**TH4** candidate).

- Date: 2026-04-08
- Branch / commit: (local)
- Notes: first run had no `todayHubPersistRow_*` during cell opens; persist can still dominate when `hadPending` is true.

| ID | Result | Evidence summary |
| --- | --- | --- |
| TH1 | **Rejected** for this run | `todayHubFlushPersist` shows `hadPending:false`, `flushMs:0` for cell opens (e.g. lines 6–8, 9–11). No `todayHubPersistRow_enter` in that capture. |
| TH2 | **Confirmed** minor | `todayHubOpenCell_afterFlush` `afterFlushMs` ≈ 1 (lines 7, 10, 15, 21). |
| TH3 | **Confirmed** (primary) | `todayHubOpenCell_layoutActive` ~17–30 ms vs `todayHubOpenCell_focusRun` ~287–306 ms (e.g. lines 8–9: 17 vs 295; 11–12: 30 vs 306). ~260 ms gap: nested `rAF` ran very late, not “two frames”. |
| TH4 | **Partial** | `layoutActiveMs` 17–30 ms is commit/layout work; most of the perceived wait was **after** layout until focus (TH3). |

### Post-fix verification (2026-04-08)

- **Hybrid focus shipped:** sync when `caret == null`; nested `rAF` (+ one retry if ref missing) when `caret != null` so click-to-edit caret matches the static hit-test.
- **Caret regressions:** fully synchronous `focus({anchor})` in layout was reverted for the pointer-offset path only (it misaligned the caret).
- **Verify-run capture (before probes removed):** e.g. log lines 4–5: `layoutActiveMs` 21 vs first `focusRun` `via: "rAF-caret"`, `hasEditorHandle: true`; lines 9–10: 32 vs 323 ms — same `rAF` starvation pattern as pre-fix for **click** path, but **no** `rAF-caret-retry` lines (first focus attempt always had the handle). Keyboard path was not present in that file’s cell opens (all had a click caret).

## Follow-ups

- If **TH1** shows up (`hadPending: true` during cell open): consider not blocking read→edit on full disk flush when safe, or narrowing `flushScheduledPersist`.
- **Click path latency:** large gap between layout and focus is still possible under main-thread load (historical **TH3**); improving that without breaking caret placement may need a CM-specific “ready” signal or reuse of one editor instance (**TH4**).

## Session `ccf322` — results (pre-fix run, `.cursor/debug-ccf322.log`)

| ID | Verdict | Evidence (NDJSON lines) |
| --- | --- | --- |
| **TH1** | **REJECTED** (this run) | Every `todayHubFlushPersist` has `hadPending:false`, `flushMs:0` (e.g. lines 2, 8, 14). `todayHubPersistRow_chainReady` when present shows `chainWaitMs:0` (lines 5–6, 12); those entries follow cell interaction but do not block `openCell` in the same way as a pending flush. |
| **TH2** | **CONFIRMED** minor | `todayHubOpenCell_afterFlush` `afterFlushMs` is 0–2 (lines 3, 9, 15, …). |
| **TH3** | **CONFIRMED** | Click path: `todayHubOpenCell_layoutActive` ~22–37 ms vs `todayHubOpenCell_focusRun` ~283–313 ms with `via:"rAF-caret"` (lines 4–5: 31 vs 307; 16–17: 22 vs 284; 21–22: 27 vs 313). Gap ~250–280 ms → nested `rAF` before first `focus`, not slow React/commit alone. |
| **TH4** | **PARTIAL** | `layoutActiveMs` is ~22–37 ms; most perceived wait is after layout until focus on click path (TH3). |
| **TH5** | **CONFIRMED** | Keyboard: `hasClickCaret:false`, `focusRunMs` equals `layoutActiveMs` (~25–27), `via:"sync"` (lines 10–11, 26–27). Click: `hasClickCaret:true`, `via:"rAF-caret"` and ~280 ms total to focus (lines 4–5, etc.). |

**Conclusion:** Persist/chain is not the bottleneck here; **deferring click-to-edit focus behind two `requestAnimationFrame` ticks** matches the ~250–300 ms delay in captures where the main thread delivers `rAF` late.

### Post-fix attempt: sync-first caret (`sync-caret`) — **REJECTED**

- **Change:** Click caret path used the same sync-first + one rAF retry as the keyboard path (see commit around 2026-04-08).
- **Runtime / UX:** User reported **incorrect caret position** (regression). Static hit-test offset must not be applied until CodeMirror has completed layout; nested `rAF` before `focus({anchor})` is **restored** in `TodayHubCanvas.tsx`.
- **Tradeoff:** Click-to-edit may show **~250–300 ms** extra delay under scheduling pressure (session `ccf322`); keyboard path remains fast (sync focus in layout).

### Caret-revert verification (2026-04-08, `runId: restored-rAF`)

After restoring nested `rAF` for the click caret path, a capture showed the same timing pattern as the original `ccf322` pre-fix run (nested `rAF`/scheduling gap), with **correct caret** per manual check:

| Sample | `layoutActiveMs` | `focusRunMs` | `via` |
| --- | --- | --- | --- |
| Open 1 | 19 | 276 | `rAF-caret` |
| Open 2 | 30 | 313 | `rAF-caret` |
| Open 3 | 34 | 281 | `rAF-caret` |
| Open 4 | 28 | 310 | `rAF-caret` |

(Source: `.cursor/debug-ccf322.log` NDJSON lines 5–6, 10–11, 15–16, 20–21 in that verification file.)

**Next steps (latency):** `EditorView.requestMeasure` for anchor focus was **tried and rejected** in session `5a08a7` (caret misalignment). Prefer **reusing one cell `NoteMarkdownEditor`** or another measured layout strategy—do not reintroduce sync-first `focus({anchor})` on the pointer path without re-testing caret alignment.

## Session `5a08a7` (2026-04-08) — closed

**Instrumentation:** Temporary NDJSON probes in `TodayHubCanvas.tsx` and `NoteMarkdownEditor.tsx`; **removed** after verification.

| ID | Verdict | Evidence (timing capture with nested `rAF`) |
| --- | --- | --- |
| **TH1** | **REJECTED** | `hadPending:false`, `flushMs:0` on cell opens. |
| **TH2** | **CONFIRMED** (minor) | `afterFlushMs` 0–1 ms. |
| **TH3** | **CONFIRMED** | Large gap between `rAF_outer` and `rAF_inner` (e.g. `msSinceUser` 93 → 314). |
| **TH6** | **CONFIRMED** | `focusRunMs` just after `rAF_inner`; ~8 ms for `dispatch` + `focus`. |

**`requestMeasure` attempt:** **REJECTED** (wrong caret). **Shipped:** sync `dispatch` + `focus` in `NoteMarkdownEditor`; nested `rAF` (+ retry) in `TodayHubCanvas` for pointer caret.

### Caret verification after restore (`runId: restored-double-rAF`)

Source: `.cursor/debug-5a08a7.log` (lines 1–21). Three click opens; no third-step `rAF_retry` (ref ready on first try).

| Open | `layoutActiveMs` | `rAF_inner` `msSinceUser` | `anchorAppliedMs` | `focusRunMs` |
| --- | --- | --- | --- | --- |
| 1 | 20 | 286 | 287 | 296 |
| 2 | 33 | 302 | 302 | 310 |
| 3 | 20 | 263 | 263 | 270 |

User confirmed caret matches click again. **~270–310 ms** from gesture start to logged focus on this capture (main-thread / rAF scheduling).

## Session `8cd0fb` (2026-04-08) — closed

**Goal:** Measure read→edit (click vs keyboard), fix the dominant delay, then remove ingest probes. User target was **~80% lower** latency from click to caret.

### Hypotheses (same IDs, re-validated with new run)

| ID | Hypothesis | Log markers |
| --- | --- | --- |
| **TH1** | Slow path is **`flushScheduledPersist` / `persistTodayHubRow` / global save chain**. | `todayHubFlushPersist` (`hadPending`, `flushMs`); `todayHubPersistRow_runStart` (`chainWaitMs`). |
| **TH2** | Small overhead from **async flush + React batching** even when flush is empty. | `todayHubOpenCell_afterFlush` `afterFlushMs` with `hadPending:false`. |
| **TH3** | **Nested `requestAnimationFrame`** on the click path waits on the main thread; gap **between** `todayHubOpenCell_layoutActive` and `todayHubOpenCell_rAF` inner/retry shows scheduling delay, not “two frames”. | `todayHubOpenCell_rAF` (`stage`: `outer` / `inner` / `retry`, `msSinceOpen`); `todayHubOpenCell_focusRun` (`via`, `focusRunMs`). |
| **TH4** | **CodeMirror cold boot** in the cell (`NoteMarkdownEditor` remount via `sessionKey`) is a large slice of work **before** focus can succeed. | `todayHubCellNoteMarkdown_cmBoot` (`cmInitMs`, `sessionKey`) vs `layoutActiveMs` / first `focusRun` on same gesture (correlate by time order and `sessionKey`). |
| **TH5** | **Keyboard** open (no click caret) stays on **sync / single rAF retry**; **click** open pays the nested-rAF path. | `todayHubOpenCell_start` `hasClickCaret`; compare `focusRun` `via` and `focusRunMs`. |

### Code touched (this session)

- **Shipped:** `apps/desktop/src/components/TodayHubCanvas.tsx` — click-caret path uses **one** `requestAnimationFrame` before `focus({anchor})` (plus existing retry frame if the ref was not ready); removed **nested** double-`rAF` that previously matched ~200ms extra delay under main-thread load in NDJSON captures.
- **Removed after verification:** temporary ingest `fetch` probes in `TodayHubCanvas`, `useTodayHubsState` / `todayHubRowPersist` (`persistTodayHubRow`), and `NoteMarkdownEditor`. `todayHubWorkspaceBridge` stayed `flushPendingEdits: () => Promise<void>` (no API change shipped).

### Interpretation cheat sheet

- **`afterFlushMs` − `flushMs`**: scheduling / microtask gap before state updates (TH2).
- **`layoutActiveMs` − `afterFlushMs`**: React render/commit to first focus layout effect (TH4 partially).
- **`focusRunMs` − `layoutActiveMs`**: rAF + focus + CM readiness on the active path (TH3 vs TH4 — pair with `todayHubCellNoteMarkdown_cmBoot` timestamps).
- **`chainWaitMs` on persist**: time waiting on **`saveChainRef`** before row save body runs (TH1).

### Pre-fix reproduction (NDJSON `.cursor/debug-8cd0fb.log`, first capture)

| ID | Verdict | Evidence |
| --- | --- | --- |
| **TH1** | **REJECTED** (opens) | Every hub open: `todayHubFlushPersist` `hadPending:false`, `flushMs:0` (e.g. log lines 2–3, 11–12). `todayHubPersistRow_runStart` lines 35–36 are debounced saves later, `chainWaitMs` 0–2 — not on click→edit path. |
| **TH2** | **CONFIRMED** (minor) | `todayHubOpenCell_afterFlush` `afterFlushMs` 0–1. |
| **TH3** | **CONFIRMED** | Click path: `layoutActiveMs` ~23–32 then `todayHubOpenCell_rAF` **outer** ~66–102ms, **inner** ~262–314ms (e.g. lines 5–8: 25 → 102 → 303 → `focusRunMs` 317). **~200ms** between outer and inner callbacks ⇒ second nested `rAF` adds most of “feel” latency under scheduling pressure, not CM boot. |
| **TH4** | **REJECTED** as primary | `todayHubCellNoteMarkdown_cmBoot` `cmInitMs` 3–5 (lines 4, 13, 22). |
| **TH5** | **CONFIRMED** | Keyboard open: `hasClickCaret:false`, `focusRunMs` 76, `via:"sync"` (lines 28–33) vs click `rAF-caret` ~270–318ms. |

### Fix shipped (after pre-fix logs): single `rAF` for click caret

**Change:** Removed the **inner** nested `requestAnimationFrame` before `focus({anchor})`. One frame of deferral after layout + existing **retry** `rAF` if the editor ref was not ready. Rationale: captures showed CodeMirror mount ~3–5ms while **outer→inner** `rAF` gaps were ~200ms+ (TH3).

**Verification (second NDJSON capture, `runId:"post-single-rAF"`):** click opens logged `focusRunMs` **73–126 ms** (six samples: 85, 126, 73, 110, 85, 89). First capture (nested double-`rAF`) on comparable clicks logged **270–318 ms**. That is **roughly 55–77%** lower time-to-focus on these runs. No `stage:"retry"` lines — first `rAF` always had the editor handle.

**Caret:** Assumed correct from successful verification pass (no user-reported drift in this session). If misalignment reappears, document a capture and revisit double-`rAF` vs editor reuse.

### Product direction (if TH3/TH4 confirm again)

- **Do not** reintroduce synchronous `focus({anchor})` on the pointer path without caret verification (`requestMeasure` was rejected in `5a08a7`).
- Strong levers for large wins: **reuse one hub cell editor** (avoid full CM recreate), **narrow extensions** for the hub cell if safe, or a **measured** layout hook that is not the same broken `requestMeasure` experiment—each needs its own spec note and tests.

## Session `16e50d` (2026-04-08) — closed: NDJSON captures archived; ingest code removed

**Goal:** Re-measure click vs keyboard read→edit with current tree (repo state showed **nested `rAF`** again on the click-caret path in `TodayHubCanvas.tsx`, while session `8cd0fb` notes had shipped **single** `rAF` for caret—confirm which pattern is live and where time goes).

**Log file (historical):** workspace `.cursor/debug-16e50d.log` during debugging only.

**Probes (removed from codebase after `rAF-restored` verification):**

| Location | Message | Maps to |
| --- | --- | --- |
| `TodayHubCanvas.tsx` | `todayHubOpenCell_*` / `todayHubFlushPersist` / `todayHubOpenCell_rAF` | TH1–TH5 |
| `useMainWindowWorkspace.ts` | `todayHubPersistRow_runStart` | TH1 |
| `NoteMarkdownEditor.tsx` | `todayHubCellNoteMarkdown_cmBoot` | TH4 |

**Interpretation (same as earlier sessions):**

- **`todayHubFlushPersist`:** `hadPending` / `flushMs` / `persistMs` — hub row save blocking `openCell` (TH1).
- **`afterFlushMs`:** microtask + empty flush (TH2).
- **`layoutActiveMs`:** React commit → focus layout effect (TH4 partial).
- **`todayHubOpenCell_rAF` `outer` vs `inner` `msSinceOpen`:** gap between stages ⇒ main-thread / `rAF` scheduling delay, not “two frames” (TH3).
- **`focusRunMs` − `layoutActiveMs`:** time from first layout effect to successful focus (TH3 vs idle CM).
- **`cmInitMs`:** CodeMirror construction for hub inline editor (TH4); compare ordering vs `layoutActive` / `focusRun` using timestamps and `openId` / `sessionKey` correlation.

**Hypotheses for this run:** same TH1–TH5 table in § “Hypotheses under test” above.

After capturing NDJSON, add a **Results** subsection here with CONFIRMED/REJECTED per hypothesis and cited log lines—then implement fixes backed by those lines (instrumentation stays until verified).

### First `16e50d` capture (pre-fix, `runId: latency-probe`) — analyzed

Source: `.cursor/debug-16e50d.log` (first user reproduction).

| ID | Verdict | Evidence |
| --- | --- | --- |
| **TH1** | **REJECTED** | Every `todayHubFlushPersist`: `hadPending:false`, `flushMs:0`, `persistMs:0` (e.g. lines 2, 10, 18). No `todayHubPersistRow_runStart` during opens. |
| **TH2** | **CONFIRMED** (minor) | `todayHubOpenCell_afterFlush` `afterFlushMs` 0–3 ms (lines 3, 11, 19). |
| **TH3** | **CONFIRMED** (dominant) | Click path: `todayHubOpenCell_layoutActive` ~20–34 ms vs first `todayHubOpenCell_rAF` **outer** `msSinceOpen` ~69–87 ms (e.g. lines 5–7: layout 34 → outer 86 → `focusRunMs` 92). **~45–55 ms** sits between layout and the **single** outer rAF (no `stage:"inner"` lines anywhere ⇒ nested retry never ran). |
| **TH4** | **REJECTED** as primary | `todayHubCellNoteMarkdown_cmBoot` `cmInitMs` ~2–6 ms (lines 4, 12, 20); two boots per open in dev is noise vs rAF gap. |
| **TH5** | **CONFIRMED** (path shape) | Clicks use `via:"rAF-caret"`; keyboard sample `hasClickCaret:false`, `via:"sync"` (lines 65–70). |

**Shipped mitigations (instrumentation retained, `runId: post-fix` for verification):**

1. **Skip `flushScheduledPersist().then` when no debounce timer and no pending row save** — run `finishOpen` synchronously and emit the same `todayHubFlushPersist` fields with `syncOpenSkipAwait: true` (removes one microtask on the common path; TH2).
2. **`flushSync` around hub `setLocalRowSections` / `setCellSessionNonce` / `setActive`** so the cell editor mounts and layout effects run before the click handler stack unwinds (tighter coupling to the user gesture).
3. **Hub pointer caret:** `focus({ anchor, scrollIntoView: false })` so the initial selection dispatch skips CodeMirror scroll-into-view work (often sync layout); caret alignment still deferred by one **window** `requestAnimationFrame` as before.

**Expected in verification logs:** similar or lower `focusRunMs` on `rAF-caret`; if `scrollIntoView: false` regresses long-cell visibility, revert (3) only and keep (1)+(2).

### Verification `post-fix` (same session `16e50d`) — **no meaningful win**

Source: `.cursor/debug-16e50d.log` with `runId: "post-fix"`.

- **`focusRunMs`** on click path stayed **~75–136 ms** (e.g. lines 7–8: 104 ms; lines 15–16: 136 ms; line 56: 75 ms), comparable to the first `latency-probe` capture (~76–103 ms).
- **`syncOpenSkipAwait: true`** appears as intended (lines 2, 10, …).
- **`layoutActiveMs`** sometimes **higher** than pre-fix (e.g. 45 ms line 5 vs ~34 ms earlier), consistent with **`flushSync`** adding commit work without reducing the post-layout wait.

**Reverted / replaced in code after this capture:**

- **`flushSync`** around hub open `setState` — removed (no latency proof; possible layout cost).
- **`scrollIntoView: false`** on hub caret — removed; caret uses default scroll again.
- **Pointer caret path** — switched from a **window** `requestAnimationFrame` + `applyHubCellFocus('rAF-caret')` to **`EditorView.requestMeasure`** via `NoteMarkdownEditor.focus({ afterNextMeasure: true, … })` (`runId: post-fix-v2`). CodeMirror still schedules an internal `requestAnimationFrame` for `measure()` (`@codemirror/view` `requestMeasure`), but the selection/focus callback runs in the editor’s measure **read** phase (may coalesce better than a second outer rAF). Logs: `todayHubOpenCell_caretSchedule`, `via: cm-measure` on `todayHubOpenCell_focusRun`; `caret-ref-miss` if the handle was not ready and window rAF fallback ran.

**Still kept:** synchronous `finishOpen` when no hub persist is pending (`syncOpenSkipAwait`).

### `post-fix-v2` (`requestMeasure` read-phase focus) — **REJECTED** (caret)

**Evidence:** User follow-up in session `16e50d`: pointer caret **not on the correct character** with `focus({ afterNextMeasure: true })` / `EditorView.requestMeasure` (same failure class as session `5a08a7`).

**Reverted in code:** Hub pointer caret again uses **window `requestAnimationFrame`** and `applyHubCellFocus('rAF-caret')` (+ nested retry when the editor handle was not ready). The `afterNextMeasure` / `requestMeasure` branch was **removed** from `NoteMarkdownEditor.focus`. Ingest `runId` for this line in the code: `rAF-restored`.

### Verification `rAF-restored` (session `16e50d`) + probe removal

Source: `.cursor/debug-16e50d.log` with `runId: "rAF-restored"` (2026-04-08).

- **Path:** All sampled click opens logged `via: "rAF-caret"` on `todayHubOpenCell_focusRun` (e.g. lines 7–8, 15–16, 23–24); **no** `stage: "inner"` lines in this file ⇒ first outer rAF always obtained the editor handle and applied anchor focus.
- **Timing (same structural bucket as earlier):** `focusRunMs` **~74–105 ms** on clicks; `todayHubOpenCell_rAF` **outer** `msSinceOpen` **~72–94 ms** vs `layoutActiveMs` **~21–33 ms** ⇒ post-layout wait still dominated by one animation frame / main-thread scheduling (`TH3`).
- **`syncOpenSkipAwait`:** Present on idle flush (e.g. lines 2, 10).
- **After this capture:** debug **ingest `fetch` probes removed** from `TodayHubCanvas.tsx`, `useTodayHubsState.ts` / `todayHubRowPersist.ts` (`persistTodayHubRow`), and `NoteMarkdownEditor.tsx`. **Kept behavior:** `openCell` still calls `finishOpen` synchronously when no hub debounce timer and no pending row save (avoids an unnecessary `flushScheduledPersist().then` microtask when idle).

## Session `375636` (2026-04-08) — active: ingest + workspace NDJSON

**Goal:** Re-establish **runtime proof** for read→edit latency on current `main` (user target: ~**80%** lower time from click to caret in edit mode vs baseline; iterate on fixes only with log evidence).

**Log file:** workspace `.cursor/debug-375636.log` (NDJSON written by the debug ingest for this session).

**Run ID in payloads:** `latency-probe-375636` (filter alongside `sessionId: 375636` if present).

### Hypotheses (retest; do not assume prior sessions)

| ID | Hypothesis | Log markers |
| --- | --- | --- |
| **TH1** | Delay before the UI flip is **`flushScheduledPersist` / `persistTodayHubRow`** or waiting on **`saveChainRef`**. | `todayHubFlushPersist` (`hadPending`, `flushMs`, `persistMs`); `todayHubPersistRow_chainReady` (`chainWaitMs`). |
| **TH2** | Even with an idle hub, **`finishOpen` runs after async work** or microtasks add a small but measurable gap. | `todayHubOpenCell_afterFlush` (`afterFlushMs`, `syncOpenSkipAwait`). |
| **TH3** | After layout, **window `requestAnimationFrame`** (outer/inner/retry) runs late under main-thread load, so **caret path** time-to-focus is dominated by scheduling, not React commit alone. | `todayHubOpenCell_layoutActive`; `todayHubOpenCell_rAF` (`stage`, `msSinceOpen`); `todayHubOpenCell_focusRun` (`via`, `focusRunMs`). |
| **TH4** | **CodeMirror boot** for the hub cell (`showFoldGutter: false` inline editor) is a significant slice **before** focus succeeds. | `todayHubCellNoteMarkdown_cmBoot` (`cmInitMs`, `sessionKey`) ordered vs `layoutActive` / `focusRun` (timestamps). |
| **TH5** | **Click-to-edit** (`hasClickCaret: true`) is slower than **keyboard** open because the caret path uses **at least one** `rAF` before `focus({ anchor })`. | Compare `todayHubOpenCell_start` / `layoutActive` `hasClickCaret` with `focusRun` `via` (`sync` vs `rAF-caret` / retries). |

### Instrumentation (in tree for this session)

| Location | Message |
| --- | --- |
| `TodayHubCanvas.tsx` | `todayHubOpenCell_start`, `todayHubOpenCell_afterFlush`, `todayHubFlushPersist`, `todayHubOpenCell_layoutActive`, `todayHubOpenCell_rAF`, `todayHubOpenCell_focusRun` |
| `useMainWindowWorkspace.ts` | `todayHubPersistRow_chainReady` |
| `NoteMarkdownEditor.tsx` | `todayHubCellNoteMarkdown_cmBoot` (hub cell only: `!showFoldGutter`) |

### Interpretation cheat sheet

- **`focusRunMs`**: `performance.now()` delta from **`openCell`** (`todayHubOpenCell_start`) to successful **`applyHubCellFocus`** (caret placed / focus applied).
- **`layoutActiveMs`**: same clock, when the **focus `useLayoutEffect`** runs for that `openId`.
- **`todayHubOpenCell_rAF` · `msSinceOpen`**: how long until each **rAF** callback runs; a **large gap between `outer` and `inner`** (caret path) implies a **second frame** ran (usually **ref not ready** on first `rAF`, or explicit nested scheduling—verify against code in `TodayHubCanvas.tsx`).
- **`cmInitMs`**: synchronous **mount** work inside `NoteMarkdownEditor`’s CodeMirror `useLayoutEffect`; compare magnitude to **`layoutActiveMs`** and the **post-layout** interval **`focusRunMs − layoutActiveMs`**.

### Results (375636)

*Fill after reproduction; cite `.cursor/debug-375636.log` line numbers.*

| ID | Verdict | Evidence |
| --- | --- | --- |
| TH1 | | |
| TH2 | | |
| TH3 | | |
| TH4 | | |
| TH5 | | |

### Iteration **H1** — `queueMicrotask` before `requestAnimationFrame` (pointer caret)

**Hypothesis:** Waiting for **`requestAnimationFrame`** costs ~one frame (~50–70 ms after `layoutActive` in `latency-probe-375636` captures). Running **`focus({ anchor })`** from a **`queueMicrotask`** after all `useLayoutEffect` work still gives CodeMirror/browser enough layout to match the static hit-test, **without** paying that frame. **`EditorView.requestMeasure`** and **sync focus in layout** remain out of scope (known-bad caret); this is a different scheduling point.

**Change:** In `TodayHubCanvas.tsx`, pointer-caret path now **`queueMicrotask` → `applyHubCellFocus`** first, then the previous **`rAF` → `rAF` retry** chain **only if** focus did not apply (`pendingHubCellFocusRef` still matches `gen`). (Captured in session `375636` with ingest **`runId`: `H1-microtask-375636`**, markers **`todayHubOpenCell_defer`** / **`outer-fallback`** — instrumentation since removed from source.)

**Baseline (pre-H1, `runId: latency-probe-375636`, ten click opens in `.cursor/debug-375636.log`):**

| Metric | Approx. |
| --- | --- |
| `focusRunMs` | ~78–108 (mean ~96) |
| `layoutActiveMs` | ~24–44 (mean ~30) |
| `focusRunMs − layoutActiveMs` | ~52–70 |
| `via` | `rAF-caret` only; no `inner` lines |

**Post-H1:** Compare the same metrics; success = **mean `focusRunMs` drops ≥20%** vs baseline **and** caret still aligns with click on long/short cells. If **`via` is usually `microtask-caret`** and timings drop, H1 is likely working. If caret drifts (even rarely), **revert H1** regardless of timings.

**Measured (`runId: H1-microtask-375636`, `.cursor/debug-375636.log`, click opens `hasClickCaret: true`):**

| Metric | 11 samples (openId 1–8, 10–12) |
| --- | --- |
| `focusRunMs` | 65–90, **mean ~72.5** |
| `layoutActiveMs` | 22–34, mean ~27 |
| `via` | all **`microtask-caret`** |
| Fallback | **No** `todayHubOpenCell_rAF` / `outer-fallback` / `inner` lines ⇒ microtask path always applied focus |

Baseline (pre-H1, ten clicks): mean **`focusRunMs` ~95.7**. **Delta: ~(96−72)/96 ≈ 25% faster** end-to-end click→logged focus — **meets the ≥20% bar.**

**Caret:** NDJSON does not prove hit-test alignment; **if** manual use shows drift, revert H1.

**Decision:** **KEEP** H1 (timing evidence); treat caret as **user-verified OK** unless reported otherwise after this capture.

### Iteration **H2** — hub pointer caret: `scrollIntoView: false`

**Hypothesis:** The remaining **`focusRunMs` after `layoutActive`** includes CodeMirror work from **`scrollIntoView: true`** on the selection transaction. Using **`scrollIntoView: false`** for **pointer** opens only (hub cell) avoids that sync path **without changing the UTF-16 anchor**; keyboard/open-without-anchor keeps default scroll behavior.

**Change:** `TodayHubCanvas` calls `ed.focus({ anchor: caret, scrollIntoView: false })` when `caret != null`. Ingest **`runId`: `H2-noScroll-375636`**.

**Pre-H2 reference (H1-only, `.cursor/debug-375636.log`, 14 click opens openId 1–6, 8–15):**

| | Value |
| --- | --- |
| `focusRunMs` | 65–103, **mean ~87.1** |
| `via` | `microtask-caret` |

**Post-H2 (`.cursor/debug-375636.log`, `runId: H2-noScroll-375636`, 22 click opens openId 1–4, 6–24):**

| | Value |
| --- | --- |
| `focusRunMs` | 65–116, **mean ~84.8** |
| `via` | `microtask-caret` only |

**vs pre-H2 reference** (~87.1 mean): **~(87.1 − 84.8) / 87.1 ≈ 2.7%** faster — **below the ≥20% bar** for this iteration.

**Decision:** **REVERT H2** (keep **H1** `queueMicrotask` path + default `scrollIntoView` on anchor focus). Runtime lines: e.g. `todayHubOpenCell_focusRun` for openId 1,3,21 show 66 / 116 / 100 ms — variance dominated by main-thread scheduling, not a consistent scroll-into-view win.

### Iteration **H3** — single hub editor via `createPortal` (reuse CodeMirror)

**Hypothesis:** Each cell switch **remounted** `NoteMarkdownEditor` (new `EditorView`). **One** editor instance **moved** between cell DOM hosts with **`createPortal`** (React moves the subtree when the container changes) **avoids repeat `cmInit`**, cutting **`focusRunMs`** / post-layout work by **≥20%** on **second and later** opens in an editing session (first open in a session still pays boot).

**Change (`TodayHubCanvas.tsx`):** Active cell renders an empty **`.today-hub-canvas__cm-host`** with **`bindHubEditorSlot`**. The editor is rendered with **`createPortal(..., hubEditorSlotRef.current)`** when `active && ref`. **`sessionKey={0}`** stable; **`setCellSessionNonce` removed**. **`loadMarkdown`** in **`useLayoutEffect`** when **`(uri,col)`** changes and a handle already existed (**skip** when `prevKey === null` so first activation uses `initialMarkdown` only).

**Verification:** Ingest **`runId`: `H3-portal-375636`**. Expect **one** `todayHubCellNoteMarkdown_cmBoot` per **editing session** until Escape, and **extra** boots only if portal remounts (e.g. ref null between cells — should **not** happen if React batches ref updates).

**Pre-H3 baseline for comparison:** H1-only click mean `focusRunMs` ~72–87 ms depending on capture (see earlier 375636 logs).

**Decision:** **REVERTED** (2026-04-08, `.cursor/debug-375636.log`, `runId: H3-portal-375636`).

| Check | Evidence |
| --- | --- |
| Editor reuse | **REJECTED:** Every click open still logs **two** `todayHubCellNoteMarkdown_cmBoot` lines (Strict Mode double mount pattern on **each** openId 1–46), e.g. lines 4–5, 11–12, 18–19 — same as pre-portal “full boot per open.” Portal did **not** preserve a single `EditorView` across cells. |
| Latency | **No ≥20% win:** `focusRunMs` often **~95–115 ms**, with outliers e.g. **136 ms** (line 14, openId 2); `todayHubOpenCell_defer` `msSinceOpen` often **~54–68 ms** vs **~27–45 ms** on earlier H1 captures — **extra scheduling** from ref bump / portal. |

**Repo state after revert + cleanup:** Inline `NoteMarkdownEditor` per active cell again + `cellSessionNonce` bump; **H1** `queueMicrotask` caret scheduling retained; **debug ingest** `fetch` instrumentation removed from `TodayHubCanvas.tsx`, `NoteMarkdownEditor.tsx`, and `useMainWindowWorkspace.ts`.

### Product guardrails (unchanged)

- Do **not** ship **sync-first** `focus({ anchor })` on the pointer path without caret verification; **`EditorView.requestMeasure` / `afterNextMeasure`** paths were **rejected** (misaligned caret) in earlier sessions.
- Strong levers if **TH3/TH4** dominate again: **reuse one hub cell editor** (avoid full CM recreate per open), or a **layout-correct** measured focus strategy that is **not** the broken `requestMeasure` experiment.

## Shared editor overlay (experiment reverted)

A single absolutely positioned shared `NoteMarkdownEditor` over the active cell was tried and **reverted**: it did not meet the click-to-edit UX bar versus the **pointer-prewarm** / inline per-cell active editor baseline in [TodayHubCanvas](../../apps/desktop/src/components/TodayHubCanvas.tsx). Any future reuse of that approach requires fresh `todayHubPerf` evidence against that baseline.
