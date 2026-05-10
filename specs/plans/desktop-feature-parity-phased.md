# Desktop feature parity (phased roadmap)

This document lists **remaining work** for the Linux desktop app (`apps/desktop`) to reach **feature parity with the current Android app** (`apps/mobile`) as implemented in the repository today. It is **phased** so you can insert **layout passes**, **UX polish**, and **bug-fix sprints** between phases without blocking forward progress.

**Companion doc:** high-level shared contract and MVP matrix live in [`specs/architecture/desktop-mobile-parity.md`](../architecture/desktop-mobile-parity.md).

**Parity definition:** “Same vault on disk produces equivalent outcomes for note I/O, settings, podcast episode discovery from markdown, playback resume (`.eskerra/playlist.json`), and user actions that mutate podcast markdown (played state, RSS refresh results).” Platform-specific implementation (SAF vs folder path, Track Player vs HTML audio + MPRIS) is expected to differ; **behavior** should align where the vault format is shared.

---

## How to use the phases

For each phase:

1. **Implement** the deliverables and meet **exit criteria**.
2. **Stabilize:** fix regressions; add or extend tests where cheap and meaningful (Vitest in `@eskerra/core`, desktop UI tests if/when introduced, Rust checks for Tauri commands).
3. **Layout / design pass:** adjust structure and visuals without changing the vault contract.
4. **Short QA checklist:** run manual scenarios listed under **Between-phase focus** before starting the next phase.

Phases are **sequenced** so later work builds on earlier foundations. Some tasks can start earlier as spikes without blocking the phase gate.

---

## Baseline: Android app today (feature inventory)

The mobile app is **Android-only**. Tabs and stacks (from navigation code) map as follows; **tabs marked “placeholder”** have no product behavior yet—parity for those is “no worse than Android until the RN feature lands.”

| Area | Implemented behavior (summary) |
| ---- | ------------------------------ |
| **Setup** | SAF tree selection; initial route resolution; vault context |
| **Settings** | Display name in `.eskerra/settings-shared.json`; change vault directory; navigation back to setup |
| **Vault / “Log”** | Inbox list (`Inbox/`), refresh, **multi-select + delete**, open **NoteDetail**, title-from-H1, relative date labels, tile coloring |
| **Entry / Add note** | Compose flow with markdown body, keyboard handling, save via shared vault compose helpers; integration with notes list refresh |
| **Episodes / Podcasts** | Scan `General/` markdown; build **sectioned episode list**; **pull-to-refresh** triggers **native Kotlin RSS sync** (batch); **play episode** via Track Player; **mini player**; **mark played** / batch mark; optional **artwork** selection for mini player; **seek**; errors and loading states |
| **Playlist tab** | Placeholder UI (“todo”) — **no parity work required** until RN implements it |
| **Record tab** | Placeholder UI (“todo”) — **no parity work required** until RN implements it |

**Native Android-only today:** RSS fetch + markdown rewrite + `*- podcasts.md` merge (`PodcastRssSyncModule` / Kotlin). Desktop must **replicate outcomes** (vault files updated the same way), not necessarily the same language or process model.

---

## Baseline: Desktop app today (snapshot)

| Area | Current milestone |
| ---- | ----------------- |
| **Vault root** | Native folder dialog; path persisted (store + session) |
| **Layout / notes** | Bootstrap vault (`initEskerraVault` via `@eskerra/core`), **list Inbox notes**, **single-column editor**, create note (`window.prompt` title), save markdown |
| **Settings** | Display name editable in header; change folder |
| **Audio** | Manual **MP3 URL** field; **play / pause**; **resume from** `.eskerra/playlist.json`; **MPRIS** on Linux via WebKitGTK **MediaSession** |
| **Podcasts from vault** | **Not present** as a first-class Episodes UI (no scan of `General/` episode lists, no sectioned list, no refresh) |
| **RSS sync** | **Deferred** (documented in parity matrix) |
| **Mark played / batch** | **Not present** |
| **Multi-select delete / NoteDetail shell** | **Not present** (single sidebar list + editor) |

---

## Phase 1 — Vault and notes (inbox parity)

**Objective:** Desktop feel and capabilities for **Inbox** match Android’s vault tab for daily note work, still using the shared `@eskerra/core` + `VaultFilesystem` contract.

**Deliverables**

- **Note list:** sorting and display semantics aligned with Android: **`NotesContext` sorts by `lastModified` descending**; list title uses **first H1** when cached content is available (see `VaultScreen` / `getNoteTitle` patterns).
- **Note lifecycle:** replace ad-hoc `window.prompt` create flow with a **compose / add-note path** comparable to `AddNoteScreen` (title + body, save, return to list).
- **Note detail:** clear **open/edit** model—either split list vs editor routes or a dedicated detail state that matches how Android navigates `NoteDetail`.
- **Delete:** **single and multi-select delete** for inbox notes, with confirmations and error surfacing consistent with mobile intent (audit Android delete rules: trash, irrevocable delete, etc.).
- **Refresh:** explicit refresh after mutations; avoid full vault scan on startup unless the first screen requires it (per performance rules).

**Exit criteria**

- User can **create, edit, delete**, and **re-open** inbox notes against a real vault folder with the same file names/layout rules as Android.

**Between-phase focus**

- **Layout:** sidebar density, empty states, keyboard focus in editor, error banners.
- **QA:** mixed locales in filenames, long note bodies, rapid save/delete.

---

## Phase 2 — Podcast consumption from vault files (no RSS sync)

**Objective:** Desktop shows an **Episodes** experience derived from **existing** vault markdown (`General/`, `*- podcasts.md`, 📻 pies, etc.) and plays episodes with **shared `AudioPlayer` / playlist** behavior—**without** implementing network RSS refresh yet.

**Deliverables**

- **Port or share** the TypeScript-side vault scanning and episode model (`podcastPhase1`, types under `apps/mobile/src/types`, hooks like `usePodcasts`) into a **desktop-consumable module**—prefer **`@eskerra/core` or a small `packages/` slice** if it avoids duplicating parsing rules.
- **UI:** sectioned episode list analogous to `PodcastsScreen` (sections, row actions that exist **without** sync first—play at minimum).
- **Playback:** **play episode** wires `HtmlAudioPlayer` + `playlist.json` updates + **MediaSession / MPRIS metadata** (title/artist/position) matching episode fields where available.
- **Mini-player equivalent:** persistent player strip (play/pause, scrub if supported by `AudioPlayer` interface, show title).
- **Pull-to-refresh:** if shown in UI, either **re-scan disk only** or hide until Phase 3—avoid implying RSS when only rescanning.

**Exit criteria**

- Opening a vault that already has Android-generated podcast markdown shows **the same episode inventory** (same ordering/sections as defined by shared parsing—document any intentional deltas).
- Playing an episode updates **`.eskerra/playlist.json`** so Android can resume and vice versa.

**Between-phase focus**

- **Layout:** list scroll performance, section headers, player chrome on small windows.
- **QA:** vault with many episodes; missing MP3 URL rows; seek/resume edge cases.

---

## Phase 3 — RSS refresh and hub workflow

**Objective:** **Refresh** 📻 markdown and merged `*- podcasts.md` on desktop to **match Android’s batch RSS job** outcomes (file content and merge rules).

**Deliverables**

- **Implementation strategy** (pick one or combine, document the choice in this file or in `desktop-mobile-parity.md`):
  - **TypeScript:** HTTP fetch + port Kotlin logic incrementally (frontmatter, pie body rebuild, hub link discovery, merge)—best alignment with “logic in TS first.”
  - **Rust (Tauri command):** batch job in the backend with progress events to the UI (good for large trees and consistent IO).
  - **Other:** only if clearly justified (e.g. shared native library)—avoid duplicate maintenance.
- **Progress UX:** user-visible progress and cancellation story comparable to Android’s `PodcastRssSyncProgressPayload` (percent/phase/detail).
- **Post-refresh:** invalidate caches and **re-run** Phase 2 scan; surface errors per-feed without corrupting unchanged files (mirror Android “no bump if all fetches fail” behavior where applicable).

**Exit criteria**

- Same **input vault** before/after refresh matches **Android**-refreshed markdown for a defined **golden test set** (add fixture vaults under `packages/` or `tests/` when feasible).

**Between-phase focus**

- **QA:** offline behavior, partial failures, large feeds, timeout frontmatter settings, concurrent refresh vs playback.

---

## Phase 4 — Played state, selection, and artwork

**Objective:** Mutations to episode **checkbox / played state** in markdown match Android (`markEpisodeAsPlayed`, batch flows, selection mode on `PodcastsScreen`).

**Deliverables**

- **Mark played / unplayed** (single episode) writing back to the correct markdown locations.
- **Batch selection** and batch mark operations **if present on Android** at parity time.
- **Artwork / mini-player extras:** implement or **consciously scope down** (`toggleMiniPlayerArtworkSelection`) with a documented rationale (e.g. desktop shows episode title only until artwork cache exists).

**Exit criteria**

- Round-trip: mark on desktop → open Android → state matches, and reverse.

**Between-phase focus**

- **QA:** selection + delete (if any) interactions; merge conflicts with external file edits.

---

## Phase 5 — App shell, settings parity, and cross-cutting polish

**Objective:** Navigation and settings match **mental model** of the Android app; polish gaps that block daily use.

**Deliverables**

- **Shell:** tab-like or sidebar navigation grouping **Episodes | Log | Entry | Settings** (and placeholders for **Playlist | Record** only if you want structural parity with RN **tabs**, not feature parity with empty screens).
- **Settings screen:** dedicated screen or panel mirroring Android: **vault path label**, **change folder**, **display name**, status/error messaging.
- **Theming:** if Android ships light/dark for main lists, align desktop (at least **prefers-color-scheme**).
- **Document platform gaps:** Linux **MediaSession** / MPRIS vs macOS/Windows behavior when relevant.

**Exit criteria**

- New users can complete **setup → episodes → notes → settings** without raw “developer UI” leftovers (ad-hoc prompts where Phase 1 replaced them).

**Between-phase focus**

- Full **acceptance test** walkthrough; compare side-by-side with Android on the **same vault folder** (copy tree or shared mount).

---

## Phase 6 — Follow Android when placeholders ship

**Objective:** Stay aligned when RN **Playlist** or **Record** tabs graduate from placeholders.

**Deliverables**

- Re-audit `apps/mobile` navigation and **update this plan** with concrete tasks.
- Examples: queue management UI, recording pipeline, OS permissions—**only when** the mobile implementation exists.

---

## Cross-cutting backlog (any phase)

Tasks that can start early or span phases:

| Item | Notes |
| ---- | ----- |
| **Share parsing / types in `@eskerra/core`** | Reduces drift between platforms; add tests for markdown edge cases. |
| **Observability** | Optional Sentry or logging parity for desktop (see mobile observability specs)—not required for vault parity but helps beta. |
| **CI** | Keep `cargo check` / desktop build green; add desktop Vitest when business logic moves to shared packages. |
| **Performance** | Instrument startup and heavy scans per `.cursor/rules/performance.mdc` when adding General/ indexing. |

---

## Revision history

- **2026-03-29:** Initial phased roadmap from repo survey (Android navigation + desktop `App.tsx` snapshot).

When a phase completes, update **`desktop-mobile-parity.md`** feature matrix and add a short note under **Revision history** here with the merge date or milestone tag.
