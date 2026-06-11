# Android podcasts rebuild specification

This document captures **all product behavior** of the current Eskerra Android app (`apps/mobile`) for the **Episodes (podcasts) tab**: catalog loading, vault refresh, mark-as-played (“archive”), playback, playlist sync, artwork, and Android-native integration. It is written so a **different Android app** can reproduce the same outcomes against the **same vault on disk**, with **dark mode only**.

**Reference implementation:** `apps/mobile/src/features/podcasts/` + shared logic in `packages/eskerra-core/`.

**Companion specs:**
- Podcast loading phases and caches: [`specs/features/podcast-loading.md`](../features/podcast-loading.md)
- R2 playlist and vault settings: [`specs/plans/android-r2-vault-settings.md`](android-r2-vault-settings.md)
- Shared vault contract: [`specs/architecture/desktop-mobile-parity.md`](../architecture/desktop-mobile-parity.md)
- Accent color (`#4FAFE6`): [`specs/design/accent-colors.md`](../design/accent-colors.md)

**Out of scope for this document:** Inbox notes, Today Hub, vault search, Record tab, Settings UI (except fields playback depends on), iOS, desktop Episodes pane.

---

## 1. Purpose and parity definition

**Parity definition:** Given the same user-selected vault directory (SAF tree URI) and the same on-disk podcast markdown, the rebuild app must produce **equivalent user-visible outcomes** for:

| Area | Parity target |
| ---- | ------------- |
| Episode catalog | Same unplayed episodes, section grouping, sort order, titles, dates, series names |
| Pull-to-refresh | Same native RSS sync (when available), cache invalidation, full rescan |
| Mark as played | Same `- [ ]` → `- [x]` checkbox flip in the correct `*- podcasts.md` file; episode removed from list |
| Playback | Same resume position, near-end auto-mark, natural-end mark, transport UX |
| Playlist sync | Same R2 merge rules, multi-device handoff, polling behavior |
| Artwork | Same RSS-keyed cache, internal `file://` storage, legacy SAF copy path, row/mini-player display |
| Android integration | Same TrackPlayer foreground service, media notification, lock-screen controls |

Platform implementation (React Native vs native UI, Kotlin vs TypeScript listing) may differ; **behavior, on-disk format, and playlist merge rules must not.**

**Terminology:** The UI uses an **archive** icon for “mark as played.” There is no separate archive folder; played episodes are hidden by filtering `isListened === true`.

---

## 2. Platform and vault assumptions

### 2.1 Android only

- Target **Android** with **SAF** (`content://` tree URI) as the vault root.
- **Dark mode only** for the rebuild app (see §14). The reference app still has light-mode branches in some list colors; ignore light palettes when rebuilding.

### 2.2 Vault layout (podcast-relevant paths)

| Path | Role |
| ---- | ---- |
| `General/YYYY Section - podcasts.md` | Aggregate episode list per calendar year + section (legacy “stub” files) |
| `General/📻 [Show title].md` | Per-show RSS cache markdown (frontmatter + day sections) |
| `General/YYYY Section.md` | Companion hub: task lines link to `📻` files; checkboxes control RSS inclusion |
| `.eskerra/settings-shared.json` | R2 credentials for playlist sync (optional) |
| `.eskerra/settings-local.json` | `deviceInstanceId`, `playlistKnownUpdatedAtMs`, `playlistKnownControlRevision` |
| `.eskerra/playlist.json` | Legacy local playlist; **not read** when R2 is absent; deleted on `clearPlaylist` |

Podcast files are **read-only** from the app’s perspective (except mark-as-played checkbox writes and native RSS sync writes).

### 2.3 SAF URI convention

Note and directory URIs use **direct suffix** form:

```
content://…/tree/<vaultRoot>/General/2026 News - podcasts.md
```

See AGENTS.md § “Android SAF URI format.” All path logic in `@eskerra/core` assumes this structure.

### 2.4 Shared TypeScript core

Reuse or reimplement these `@eskerra/core` modules for identical behavior:

| Module | Purpose |
| ------ | ------- |
| `podcasts/podcastFileParser.ts` | Parse `*- podcasts.md` lines, section grouping, year filter |
| `podcasts/playMarkdownLinkScan.ts` | `[▶](url)` / `[▶️](url)` link scan |
| `markPodcastEpisodePlayed.ts` | Flip played checkbox in markdown body |
| `playerMachine.ts` | XState `podcastPlayerMachine` |
| `playlist.ts` | `PlaylistEntry`, merge, near-end constants, `buildPlaylistEntryForWrite` |
| `podcastRssSync.ts` | RSS merge helpers (shared with Kotlin semantics) |
| `rssArtwork.ts` | RSS feed artwork URL extraction |
| `audioPlayerTypes.ts` | `PlayerState`, `AudioTrack`, `PlayerProgress` |

---

## 3. Navigation and shell

### 3.1 Tab placement

| Tab | Stack | Screen |
| --- | ----- | ------ |
| **Episodes** (`PodcastsTab`) | `PodcastsStack` | `PodcastsScreen` |

Tab title: **Episodes**. Header title default: **Episodes**.

### 3.2 Global chrome

- **`PlayerProvider`** wraps the main tab navigator and owns catalog + playback state.
- **`PlaylistR2PollingHost`** renders `null` but runs R2 ETag polling while tabs are mounted.
- **`MiniPlayer`** sits **above** the bottom tab bar on **all tabs** when `activeEpisode != null`.
- **`PodcastsTabHeader`** wraps the default tab header and shows a **vault refresh progress strip** (3px) under the header on the Episodes tab only.

Reference: `apps/mobile/src/navigation/MainTabNavigator.tsx`.

---

## 4. Data models (in-memory)

### 4.1 `PodcastEpisode`

```ts
type PodcastEpisode = {
  articleUrl?: string;
  date: string;           // ISO date-only YYYY-MM-DD
  id: string;             // === mp3Url (stable identity)
  isListened: boolean;    // from `- [x]` checkbox
  mp3Url: string;
  rssFeedUrl?: string;    // enriched from cache or 📻 markdown
  sectionTitle: string;   // from filename stem
  seriesName: string;     // from line parentheses
  sourceFile: string;     // e.g. "2026 News - podcasts.md"
  title: string;
};
```

### 4.2 `PodcastSection`

```ts
type PodcastSection = {
  episodes: PodcastEpisode[];  // unplayed only in UI sections
  rssFeedUrl?: string;
  title: string;               // sectionTitle
};
```

### 4.3 Catalog filtering rules

- **`allEpisodes`:** all parsed episodes (played + unplayed), sorted by `date` descending.
- **`sections`:** `groupPodcastEpisodesBySection` on **unplayed** episodes only (`!isListened`), sections sorted by `title` localeCompare; episodes within section sorted by `date` desc.
- **Dedup:** when multiple stub files contribute the same `id` (mp3 URL), first wins in a `Map`.
- **Year filter:** only stub files for **current calendar year** or **next year** are parsed (`isPodcastEpisodesFile`).

---

## 5. On-disk markdown formats

### 5.1 Stub filename pattern

`YYYY <section title> - podcasts.md` (case-insensitive `podcasts.md` suffix).

Examples: `2026 News - podcasts.md`, `2027 Work - podcasts.md`.

Parser: `parsePodcastFileDetails` in `@eskerra/core`.

### 5.2 Episode line format (stub file body)

Each episode is one markdown task line:

```
- [ ] 2026-03-15; Episode title [▶](https://…/episode.mp3) (Series Name)
- [x] 2026-03-14; …   ← played (hidden from list)
```

Rules (`parsePodcastEpisodeLine`):

1. Prefix: `- [` + checkbox (` ` = unplayed, `x` = played) + `]`.
2. Date: ISO `YYYY-MM-DD` + `;` + remainder.
3. Optional article link: `[🌐](https://…)` before title (sets `articleUrl`).
4. Title: text before the play link.
5. Play link: **`[▶](url)` or `[▶️](url)`** — last such link on the line wins (`scanPlayTriangleMarkdownLinks`).
6. Series: last `(…)` tail after the play link; inner parens in series name invalidate the line.

**Episode id:** `mp3Url` string (not a hash).

### 5.3 Mark as played (on-disk write)

`markEpisodeAsPlayedInContent(content, mp3Url)`:

- Finds the **first** line containing `mp3Url`.
- Replaces leading `- [ ]` with `- [x]` via regex `^(\s*-\s*\[)\s(\]\s+)`.
- If no change, write is skipped (`updated: false`).

Mobile writes via SAF to:

```
{baseUri}/General/{sourceFile without "General/" prefix}
```

### 5.4 RSS emoji markdown (`📻 … .md`)

- Filename starts with `📻`, ends with `.md`.
- Frontmatter key `rssFeedUrl` (scalar or YAML list); first list item used when scalar empty.
- Body holds day-grouped episode bullets (maintained by native RSS sync).
- Section title for RSS URL cache: H1 in body or derived from filename (`extractRssPodcastTitle`).

### 5.5 Companion hub (`YYYY Section.md`)

Task lines `- [ ] [[📻 Show.md]]` / `- [x] [[…]]`:

| Checkbox | Meaning |
| -------- | ------- |
| `- [ ]` | **Include** linked `📻` file in RSS refresh and stub merge |
| `- [x]` | **Exclude** from refresh/merge |

**Do not conflate** with stub episode checkboxes (`[ ]` / `[x]` = unplayed / played).

---

## 6. Catalog loading

Authoritative detail: [`specs/features/podcast-loading.md`](../features/podcast-loading.md).

### 6.1 Orchestration (`usePodcasts`)

On vault open or `refresh()`:

1. **Phase 1** (blocking spinner): `runPodcastPhase1` → set episodes/sections → `catalogReady = true`, `isLoading = false`.
2. `notifyPlaylistSyncAfterVaultRefresh()` (invalidates playlist read cache, bumps sync generation).
3. **Phase 2** (background): `runRssMarkdownEnrichment` if `📻` files exist.
4. **Housekeeping** (background): `runPlaylistHousekeeping` — clear playlist if episode id unknown or episode already listened.

Initial load: `useEffect` calls `refresh()` when `baseUri` changes.

### 6.2 Bootstrap preload (startup path)

When app restores a saved vault URI before first paint (`App.tsx`):

- Parallel: `readPlaylistCoalesced(baseUri)` + `runPodcastPhase1(baseUri)`.
- Result stored in `podcastBootstrapCache`; first `usePodcasts` refresh **consumes** it via `takePodcastBootstrapPayload` (avoids duplicate phase-1 work).

**Performance rule:** Phase 1 must not block first screen render of unrelated tabs; preload runs during vault session prepare, not before vault is known.

### 6.3 Phase 1 steps (`runPodcastPhase1`)

1. `loadPersistentArtworkUriCache` + `loadPersistentRssFeedUrlCache` (AsyncStorage).
2. Resolve podcast-relevant file list:
   - **Fast path:** `loadPersistedPodcastMarkdownIndex` when not `forceFullScan`.
   - **Slow path:** `listGeneralMarkdownFiles` → `filterPodcastRelevantGeneralMarkdownFiles` → save index snapshot.
3. `splitPodcastAndRssMarkdownFiles` → legacy stubs vs `📻` files.
4. Read + parse each stub body (session `fileContentCache` keyed by URI + `lastModified`).
5. `enrichEpisodesWithCachedRss` (lookup `seriesName` then `sectionTitle` in RSS URL cache).
6. Build sections; `primeArtworkForEpisodesAndSections` (fire-and-forget).

`forceFullScan: true` skips persisted index and always lists `General/` (pull-to-refresh).

### 6.4 Background reconcile

When phase 1 used a **persisted index** (no full listing in try):

- Schedule deferred `listGeneralMarkdownFiles`, recompute podcast-relevant subset.
- If signature differs from shown index: rebuild state, update AsyncStorage snapshot.

Delay: `runAfterInteractions` + optional env-tuned delay (`backgroundGeneralReconcileDelayMs`).

### 6.5 Phase 2 (`runRssMarkdownEnrichment`)

1. Read `📻` markdown bodies (session cache).
2. Extract `rssFeedUrl` + section title → `persistRssFeedUrl` (memory + AsyncStorage).
3. Re-enrich episodes if any `rssFeedUrl` changed → update React state.
4. `primeArtworkCacheFromDisk` for discovered feed URLs (no network).

### 6.6 Native General listing (Android)

`listGeneralMarkdownFiles` may delegate to Kotlin `EskerraVaultListing` so SAF listing runs off the JS thread. On failure, falls back to JS `react-native-saf-x` path.

### 6.7 Persistent caches (AsyncStorage)

| Key pattern | Content |
| ----------- | ------- |
| `eskerra:generalPodcastMarkdownIndex:{baseUri}` | `{ v:1, snapshottedAt, entries: RootMarkdownFile[] }` — stub + `📻` files only |
| `eskerra:rssFeedUrlBySeries:{baseUri}` | `{ v:1, bySeries, byNormalized }` |
| `eskerra:artworkUriCache:{baseUri}` | Map of `baseUri::rss-hash` → renderable URI |
| `eskerra:podcastImageMeta:{baseUri}` | TTL metadata + remote URL + optional `localImageUri` |

Session-only: `fileContentCache` in `podcastPhase1.ts` (cleared by `clearPodcastMarkdownFileContentCache` after native RSS sync).

Image bytes: `context.filesDir/podcast-artwork-files/{sha256(baseUri)}/{cacheKey}.{ext}` via native `writeArtworkFile` — **not** in the synced vault.

---

## 7. Vault refresh (pull-to-refresh)

### 7.1 User action

`PodcastsScreen` `RefreshControl` → `runSerializedPodcastVaultRefresh`.

### 7.2 Serialized chain (`podcastRssVaultSync.ts`)

At most **one** in-flight refresh globally (concurrent pulls await the same promise).

```
if native RSS sync supported:
  try: runNativePodcastRssSyncForVault → clear file content cache → refreshPodcasts({ forceFullScan: true })
  catch: refreshPodcasts({ forceFullScan: true }) only
else:
  refreshPodcasts({ forceFullScan: true })
```

Native RSS sync is **not** on app startup; **Episodes pull-to-refresh only** (Inbox refresh does not run it).

### 7.3 Native RSS sync (Kotlin `EskerraPodcastRssSync`)

**Module:** `PodcastRssSyncModule` / `startPodcastRssSync(generalDirectoryUri, jobId)`.

**Thread:** single daemon executor `EskerraPodcastRssSync`.

**Algorithm (summary):**

1. List `General/` children via SAF `DocumentFile`.
2. Find stub files `YYYY Section - podcasts.md` for current/next year.
3. For each stub, read companion hub `YYYY Section.md`; collect **unchecked** `📻` links that exist on disk.
4. **📻 refresh:** for each deduped `📻` file, fetch RSS, merge episodes into markdown (respect `daysAgo` default 7), update `rssFetchedAt` frontmatter only.
5. **Stub merge:** merge refreshed `📻` content into each `*- podcasts.md` (`PodcastsMdMerge.kt`) with day/play-state rules; dedupe by calendar date + normalized title (lowercase alphanumeric only).
6. Emit progress: `EskerraPodcastRssSyncProgress` `{ jobId, percent, phase, detail? }` — percent 0–99 during RSS files, 100 on `phase: "complete"`.

**Unavailable when:** non-Android, dev mock vault, or native module not linked.

### 7.4 Refresh UI feedback

| Element | Behavior |
| ------- | -------- |
| `RefreshControl.refreshing` | Always **`false`** during work (no list-attached spinner after release) |
| Header strip (`PodcastsTabHeader`) | Visible for entire serialized run; accent `#4FAFE6`; determinate fill when native reports `percent`, else indeterminate sweep |
| Initial catalog spinner | `podcastsLoading && sections.length === 0` only |
| Errors | `refreshPullError` status line on screen |

**Strip slot details:** The strip slot (`STRIP_HEIGHT = 3px`) always occupies space below the header — even when not refreshing — so the header height never jumps. When active, the slot has a dim accent background (`rgba(79,175,230,0.12)`) and a hairline accent bottom border (`rgba(79,175,230,0.35)`); when idle the slot is transparent.

**Indeterminate animation:** Uses `react-native-reanimated`. A segment covering 38% of the strip width bounces left-to-right with `withRepeat(withTiming(1, {duration: 1200, easing: Easing.inOut(Easing.ease)}), -1, true)`. Animation cancels immediately when `visible` becomes false or when a determinate `percent` arrives.

---

## 8. Episodes list UI (`PodcastsScreen`)

### 8.1 Layout

- `SectionList` with horizontal inset `LIST_HORIZONTAL_INSET`.
- Section headers: centered uppercase caption (10px, letter-spacing 0.9, color `#6a6a6a`) on hairline divider.
- Empty state (not loading, not pulling): *"No unplayed podcast episodes found in vault root."*

### 8.2 Error lines

Centered status text for: `podcastError`, `playbackError`, `markError`, `refreshPullError`.

### 8.3 Multi-select + mark as played

| Gesture | Result |
| ------- | ------ |
| Tap **artwork** on row | Toggle selection for that episode |
| Tap **row body** | `playEpisode` (unless transport busy) |
| Header **back** (selection mode) | Clear selection |
| Header **archive** icon | Batch mark selected as played |

**Selection header:**

- Title: `N selected` when `N > 0`.
- Archive action runs `markEpisodeAsPlayedInStorage` per id, then `refreshPodcasts` if any updated, clears selection.
- A `markInFlightRef` boolean gate prevents concurrent mark operations (both batch and artwork paths share the same ref). While in progress, the archive button shows a spinner (`Spinner size="small"`) and is disabled.

**Mini-player artwork selection** (see §14): when active, header archive marks **active episode** via `markEpisodeAsPlayed` (optimistic UI path).

Mutual exclusion: selecting rows clears mini-player artwork selection; artwork selection clears row selection.

### 8.4 Episode row (`EpisodeRow`)

| Element | Dark-mode values (rebuild target) |
| ------- | --------------------------------- |
| List background | `#121212` |
| Divider | `LIST_DIVIDER_DARK` |
| Muted meta | `#cfcfcf` |
| Section label | `#6a6a6a` |
| Artwork | 40×40, radius 8; placeholder `#e2e2e2` with music-note icon |
| Title | 16px semibold |
| Meta line | `{seriesName} - {relative date label}` |
| Status line | See table below |

**Status line copy:**

| Condition | Text |
| --------- | ---- |
| Default | `Tap to play` |
| Active + playing | `Playing` |
| Active + loading | `Buffering` |
| Active + other | `Paused` |
| Another episode playing | *(empty)* |

**Row lockout:** `playbackTransportBusy || isBatchMarking` disables artwork tap; play area also disabled when another episode is `playing` or active episode is `loading`.

**Last row:** the bottom divider is suppressed (`borderBottomWidth: 0`) on the last row of the last section, to avoid a double-border with any element below the list.

**Selected row:** artwork blur (`SELECTED_ARTWORK_IMAGE_BLUR_RADIUS`), gray overlay `rgba(174,174,174,0.5)`, black check icon 28px.

**Artwork RSS key:** `episode.rssFeedUrl` ?? `section.rssFeedUrl`.

---

## 9. Mark as played flow

### 9.1 Optimistic UI (`PlayerContext.handleMarkEpisodeAsPlayed`)

1. `prepareMarkEpisodeAsPlayed(baseUri, episode)` — read file, compute `nextContent`. Returns `{ fileUri, nextContent }` if the checkbox would change, or **`null`** if the line was already played or not found (in which case the function returns immediately, no write).
2. `applyOptimisticEpisodePlayed(episodeId)` — sets `isListened: true` in memory, rebuilds sections (episode disappears immediately).
3. If `dismissNowPlaying !== false` (default): `clearNowPlayingIfMatchesEpisode` — RESET machine, `player.stop()`, `clearPlaylist`.
4. `writePreparedMarkEpisodeAsPlayed(fileUri, nextContent)` — SAF write.
5. On write failure: `refreshPodcasts` + `resyncPlaylistFromDisk`, rethrow.

### 9.2 Machine-triggered mark (near-end / ended)

`podcastPlayerMachine` invokes:

- **`nearEndEffects`** (enter last 10s zone): `clearRemotePlaylist` + `markEpisodeListened(id, false)` — marks played **without** dismissing now-playing UI.
- **`endedEffects`:** if not already in near-end zone, `clearRemotePlaylist`; then `markEpisodeListened(id, true)` — marks played **and** dismisses.

Near-end thresholds (`playlist.ts`):

- `NEAR_END_WINDOW_MS = 10_000`
- `NEAR_END_MIN_DURATION_MS = 20_000` (episode must be longer than 2× window)

### 9.3 Near-end UI copy (reference app)

Mini player shows **`Almost done`** when `playbackPhase` is `nearEndPlaying` or `nearEndPaused`.

---

## 10. Playback architecture

### 10.1 Layering

```
UI (MiniPlayer, EpisodeRow)
  → PlayerContext / usePlayer
    → podcastPlayerMachine (XState, @eskerra/core)
    → TrackPlayerAdapter (react-native-track-player)
    → playbackService (remote controls, queue-ended reset)
```

### 10.2 XState machine (`podcastPlayerMachine`)

**Type:** `parallel` — regions `playback` + `persist`.

**Playback states:** `idle` | `primed` | `loading` | `playing` | `paused` | `markingNearEnd` | `nearEndPlaying` | `nearEndPaused` | `ended` | `error`

**Key events:**

| Event | Role |
| ----- | ---- |
| `RESET` | Clear episode, native idle |
| `HYDRATE` | Restore from playlist entry (primed, no native load) |
| `EPISODE_PLAY` | User started new episode → loading |
| `NATIVE` | Mirror TrackPlayer state |
| `PROGRESS` | position/duration; triggers near-end transitions |
| `SEEK_START` / `SEEK_END` | Suppress transport-busy during seek |
| `QUEUE_PERSIST` | Debounced R2 write (500ms) |
| `ERROR` / `CLEAR_ERROR` | Failure surface |

**Persist region:** debounce 500ms → `flushPersist` (skipped when R2 not configured).

**Helpers:**

- `getPlaybackSubstate(snapshot)` → UI phase string
- `isPlaybackTransportBusy` → `native === 'loading' && !seeking`
- `isPersistIdle` → safe to exit after pause persist

Full transition table: `packages/eskerra-core/src/playerMachine.ts` + tests in `playerMachine.test.ts`.

### 10.3 `usePlayer` bridge responsibilities

| Concern | Behavior |
| ------- | -------- |
| Restore once per vault | After `podcastsCatalogReady && !podcastsLoading`, read playlist, HYDRATE if valid unplayed episode |
| Remote sync | On `playlistSyncGeneration` change: if not playing and no user action in flight, re-read playlist and HYDRATE or RESET |
| Episode vanishes | RESET when catalog no longer contains `context.episode.id` |
| `playEpisode` | Early-returns if native state is already `playing` and `loadedEpisodeId === episode.id`. Otherwise: EPISODE_PLAY, persist, `player.play(track, startPositionMs)`, artwork from cache. |
| `togglePlayback` | pause → persist if `positionMs >= MIN_PROGRESS_MS` else clear playlist; if native not loaded for episode, calls `playEpisode` instead of resume; resume path re-persists |
| `seekTo` | SEEK_START/END, native seek, queue persist |
| Near-end resync | On `nearEndResyncNonce` bump (user seeked back out of zone): re-persist position to R2 |
| Start position | Same episode id in playlist → resume `positionMs`; else 0 |

**Constants:**

- `MIN_PROGRESS_MS = 10_000` — below this on pause, playlist cleared instead of saved.

### 10.4 Native player adapter (`TrackPlayerAdapter`)

- `setupPlayer` once; capabilities **and** `notificationCapabilities`: Play, Pause, SeekTo, Stop (both fields set in `updateOptions`).
- `progressUpdateEventInterval: 1` second.
- `play`: `reset` → `add` single track → optional `seekTo` (only when `positionMs > 0`) → `play`.
- `stop()` is implemented as `TrackPlayer.reset()` (tears down the foreground service).
- State map:

| TrackPlayer state | Mapped `PlayerState` |
| ----------------- | -------------------- |
| Loading, Buffering | `'loading'` |
| Playing | `'playing'` |
| Paused, Ready, Stopped | `'paused'` |
| Ended | `'ended'` |
| Error | `'error'` |
| None / default | `'idle'` |

### 10.5 Background service (`playbackService`)

Registered in `index.js` via `TrackPlayer.registerPlaybackService`.

| Remote event | Action |
| ------------ | ------ |
| `RemotePlay` | `TrackPlayer.play()` |
| `RemotePause` | `TrackPlayer.pause()` |
| `RemotePlayPause` | toggle play/pause |
| `RemoteSeek` | `seekTo(position)` |
| `RemoteStop` | `stop()` |
| `PlaybackQueueEnded` | **`reset()`** — tears down foreground service + notification |

Without queue-ended reset, Android keeps MediaSession/notification after natural end.

### 10.6 Transport busy UX

`playbackTransportBusy = isLoading || (native === 'loading' && !seeking)`:

- Mini player: `ActivityIndicator` instead of play/pause when busy.
- Buffering copy: `Buffering…` / `Resuming…` (position ≥ 10s) / `Starting…` (paused but action in flight).
- Episode rows: disabled while busy.

---

## 11. Playlist and R2 sync

Full R2/settings detail: [`specs/plans/android-r2-vault-settings.md`](android-r2-vault-settings.md).

### 11.1 `PlaylistEntry` shape

```ts
{
  episodeId: string;
  mp3Url: string;
  positionMs: number;
  durationMs: number | null;
  updatedAt: number;        // Unix ms
  playbackOwnerId: string;  // deviceInstanceId on control writes
  controlRevision: number;  // increments each control write
}
```

### 11.2 Read path (mobile)

When R2 **not** configured: `readPlaylist` → `null` (in-memory playback only; persist skipped).

When R2 configured: **R2 object is authoritative**; local `.eskerra/playlist.json` is not read for merge. `getR2PlaylistObject` + update `playlistKnown*` in local settings.

`readPlaylistCoalesced` dedupes concurrent reads and retains settled promise for bootstrap reuse.

### 11.3 Write path (`writePlaylist`)

**Caller** (`usePlayer` persist actor) pre-builds the entry via `buildPlaylistEntryForWrite` — this is where `controlRevision` is incremented. `writePlaylist` receives the pre-built entry and does **not** call `buildPlaylistEntryForWrite` again.

1. Ensure `deviceInstanceId` in local settings.
2. If no R2: return `{ kind: 'skipped' }`.
3. Fetch remote; if remote is newer than the locally known baseline, reject the write (caller retries after re-reading). Otherwise PUT the pre-built entry to R2; update known sync metadata.

Machine persist actor only runs when `deps.hasR2()` true.

### 11.4 Clear path (`clearPlaylist`)

Delete R2 object (if configured), delete local `playlist.json` if present, null known sync fields, update coalescer to `null`.

### 11.5 Multi-device polling (`usePlaylistR2ActivePolling`)

- Interval: **1000ms** while app foreground + R2 configured + `allowPolling`.
- `allowPolling = playbackState !== 'playing'` (paused during active playback).
- On ETag change: `notifyPlaylistSyncAfterVaultRefresh` → `usePlayer` remote sync effect.

### 11.6 Housekeeping

After each catalog refresh: if playlist references missing or listened episode → `clearPlaylist`.

---

## 12. Artwork pipeline

### 12.1 Cache key

`getPodcastImageCacheKey(rssFeedUrl)` — djb2-style hash of lowercased trimmed URL → `rss-{hex}`.

Memory key: `{baseUri}::{cacheKey}`.

### 12.2 Resolution order (`getPodcastArtworkUri`)

1. Memory hit (trust in-session after hydration).
2. AsyncStorage metadata entry if fresh:
   - Local file TTL: **30 days** (`PODCAST_IMAGE_CACHE_TTL_MS`)
   - Remote-only fallback TTL: **1 hour** (`PODCAST_IMAGE_REMOTE_FALLBACK_TTL_MS`)
3. Fetch RSS artwork URL (`fetchRssArtworkUrl`).
4. Download (10s timeout) → native `writeArtworkFile` → `file://` under app internal storage.
5. On download fail: store remote URL as fallback metadata.

**Non-goals:** no durable negative cache across restarts.

### 12.3 Display safety (ANR mitigation)

**Never pass vault `content://` tree URIs directly to `Image`.**

`usePodcastArtworkDisplayUri`:

- `file://` and `https?://` → use as-is.
- Legacy `content://…/document/…` → `EskerraPodcastArtworkCache.ensureLocalArtworkFile` copies to `cacheDir/podcast-artwork/` on background thread → `file://`.

`PodcastArtworkImage`: placeholder music-note `#8f8f8f` when no URI.

### 12.4 Row vs mini-player

| Surface | Artwork size | Fetch |
| ------- | ------------ | ----- |
| Episode row | 40×40 | `usePodcastArtwork` with `allowBackgroundFetch: true` |
| Mini player | 64×64 | same |

`peekCachedPodcastArtworkUriFromMemory` enables first paint without async gap when bootstrap hydrated caches.

---

## 13. Mini player (`MiniPlayer`)

Rendered globally above tab bar when `activeEpisode != null`.

### 13.1 Chrome (dark — use as rebuild default)

| Token | Value |
| ----- | ----- |
| Background | `#1d1d1d` |
| Border | `#2d2d2d` |
| Title | `#ffffff` |
| Muted | `rgba(255,255,255,0.72)` |
| Progress track | `#383838` |
| Accent / thumb / selected artwork border | `#4FAFE6` |
| Placeholder bg | `#3a3a3a` |

### 13.2 Layout

- Top: artwork (tap toggles **artwork selection mode**) + title block OR action icons.
- **Normal title block (artwork not selected):** three lines stacked:
  1. Episode `title` — 14px semibold, white, 1 line with tail ellipsis.
  2. `seriesName` — 12px, muted, 1 line.
  3. Date line (11px, muted, 1 line): shows `bufferingSubtitle` when loading/near-end, else `formatRelativeCalendarLabelFromIsoDate(episode.date)`.
  - `bufferingSubtitle` values: `'Almost done'` (near-end), `'Resuming…'` (loading + position ≥ 10s), `'Buffering…'` (loading + position < 10s), `'Starting…'` (paused + transport busy).
- Slider: seek; drag does not persist until `onSlidingComplete`.
- Transport: elapsed | −10s (`replay-10`) | play/pause (52px) | +10s (`forward-10`) | duration.
- Skip disabled when `loading && !seeking`.

### 13.3 Artwork selection mode

Tap artwork → border accent; shows two icon buttons side-by-side:

| Icon | Action |
| ---- | ------ |
| Archive | `markEpisodeAsPlayed(activeEpisode)` |
| Close | `clearNowPlayingIfMatchesEpisode` — stop without marking played |

Each button independently shows an `ActivityIndicator` (not a shared spinner) while its action is in flight; both buttons are disabled until the in-flight action completes. If the action fails, an error message is displayed below the icon row inside the text area (2-line max, muted color). The error clears when artwork selection mode is toggled.

Clears when:
- Row multi-select is activated (any row tapped for selection).
- `activeEpisode` becomes `null` (episode dismissed or no vault).
- The artwork is tapped again (toggle off).

Header on Episodes tab mirrors archive when `miniPlayerArtworkSelected` (title stays "Episodes", archive on right).

---

## 14. Dark mode UI summary

Rebuild app: **dark mode only.** Map reference light branches to dark equivalents:

| Surface | Dark value |
| ------- | ---------- |
| Episodes list bg | `#121212` |
| Tab header wrapper | `#1d1d1d` |
| Mini player | §13.1 |
| Selection header icons | `#ffffff` on dark header |

Episode row placeholder `#e2e2e2` is light gray on dark list — acceptable contrast for empty artwork; rebuild may use `#3a3a3a` if matching mini-player placeholder.

---

## 15. Android native modules (rebuild checklist)

| Module | Purpose |
| ------ | ------- |
| `EskerraPodcastRssSync` | Batch RSS read/write under `General/` via SAF |
| `EskerraPodcastArtworkCache` | `writeArtworkFile`, `fileUriExists`, `ensureLocalArtworkFile` |
| `EskerraVaultListing` | Off-thread `General/` listing (optional perf) |

Kotlin RSS implementation reference: `apps/mobile/android/app/src/main/java/com/eskerra/podcast/rss/`.

TypeScript bridges: `androidPodcastRssSync.ts`, `androidPodcastArtworkCache.ts`.

---

## 16. Test oracle (acceptance)

Reimplementations should pass or mirror tests in:

| Area | Tests |
| ---- | ----- |
| Parser | `packages/eskerra-core` podcast parser tests; `apps/mobile/__tests__/podcastParser.test.ts` |
| Phase 1 | `apps/mobile/__tests__/podcastPhase1.test.ts` |
| Player machine | `packages/eskerra-core/src/playerMachine.test.ts` |
| TrackPlayer map | `apps/mobile/__tests__/trackPlayerAdapter.test.ts` |
| Bootstrap | `apps/mobile/__tests__/usePodcastsBootstrapCache.test.tsx`, `AppBootstrapPreload.test.tsx` |
| Kotlin RSS | `apps/mobile/android/app/src/test/java/com/eskerra/podcast/rss/*` |

---

## 17. Module map (reference app)

| Concern | Primary files |
| ------- | ------------- |
| Catalog hook | `hooks/usePodcasts.ts` |
| Phase 1 / RSS enrich | `services/podcastPhase1.ts` |
| Vault refresh | `services/podcastRssVaultSync.ts` |
| Player hook | `hooks/usePlayer.ts` |
| Context | `context/PlayerContext.tsx` |
| Screen | `screens/PodcastsScreen.tsx` |
| Mini player | `components/MiniPlayer.tsx` |
| Artwork | `services/podcastImageCache.ts`, `hooks/usePodcastArtwork.ts` |
| Mark played | `services/markEpisodeAsPlayed.ts` |
| R2 polling | `hooks/usePlaylistR2ActivePolling.ts`, `components/PlaylistR2PollingHost.tsx` |
| Storage | `core/storage/eskerraStorage.ts` (playlist), `podcastArtworkInternalStorage.ts` |

---

## 18. Explicit non-goals

- Subscribing to new podcasts from the app (hub/`📻` files are vault-authored).
- Editing episode metadata or MP3 URLs in-app.
- Offline MP3 download (stream URL only).
- Playback speed, sleep timer, queue of multiple episodes.
- iOS or non-SAF storage.
- Persisting “not found” artwork lookups across restarts.

---

## 19. Rebuild minimum viable order

Suggested implementation sequence for a new app:

1. SAF vault + `General/` listing + stub parser + section list (unplayed only).
2. Mark as played write + optimistic removal.
3. `TrackPlayerAdapter` + mini player + `playbackService`.
4. Port `podcastPlayerMachine` + `usePlayer` restore/persist semantics.
5. R2 playlist read/write + polling (optional but required for multi-device parity).
6. Artwork caches + native artwork module + display URI copy path.
7. Native RSS sync + pull-to-refresh strip + serialized refresh chain.
8. Bootstrap preload + persistent index caches for warm start.

Each step should be verifiable against §16 tests or manual scenarios in §1 parity table.
