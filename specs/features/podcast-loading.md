# Podcast Loading Trace

## Scope

This spec defines how the Podcasts screen loads data, when the small initial spinner can disappear, and how cache layers are used to keep warm-start rendering fast.

## Goals

- Render episode rows as soon as legacy podcast markdown files are parsed.
- Keep spinner-blocking work limited to data required for first paint.
- Move RSS and artwork enrichment to background work.
- Persist artwork URI cache across app restarts.
- Persist RSS feed URL mappings per series so phase 1 can resolve artwork keys without waiting for `📻` markdown reads.

## Components And Responsibilities

- `usePodcasts`: orchestrates file reads, parse flow, section state, and spinner timing.
- `runPodcastPhase1` ([`podcastPhase1.ts`](../../src/features/podcasts/services/podcastPhase1.ts)): shared phase-1 vault work (caches, index, listing, legacy markdown parse). The app bootstrap calls it in parallel with vault preload when the route is `MainTabs` and a saved vault URI exists; results are stored in [`podcastBootstrapCache.ts`](../../src/features/podcasts/services/podcastBootstrapCache.ts) and consumed once on the first `usePodcasts` refresh so `PlayerProvider` can mount with episodes already in memory. Background reconcile (full `General/` listing after snapshot) and RSS markdown phase 2 remain driven by the hook after mount.
- `usePlayer`: restores playlist state once per vault session and matches to episodes as they arrive.
- `podcastImageCache`: resolves artwork URI through memory cache, persistent caches (`AsyncStorage`), optional network fallback, and app-internal image files (not vault / SAF).
- `rssFeedUrlCache`: holds RSS feed URL maps per vault and persists them to `AsyncStorage`.
- `generalPodcastMarkdownIndexCache`: persists a **small** snapshot of podcast-relevant files under `General` (legacy `*- podcasts.md` and `📻 … .md` only) so cold starts avoid `listFiles` over tens of thousands of unrelated markdown files.
- **Android:** `listGeneralMarkdownFiles` (and Inbox `listNotes`) may call `EskerraVaultListing` so **SAF directory listing and markdown filtering run off the JS thread** when `DocumentFile` accepts the same directory URIs as `react-native-saf-x`. If native fails, returns empty while SAF says the folder exists, or is skipped, listing uses the existing JS path (`exists`, `listFiles`, filters in [`eskerraStorage.ts`](../../src/core/storage/eskerraStorage.ts)). **Rationale:** reduce cold-start jank from large `listFiles` results being processed on the single JS thread alongside podcast load; see [architecture / known-risks](../architecture/known-risks.md) section 7.

## Native RSS vault sync (Android)

Optional **user-triggered** job (not on the startup path): Kotlin module `EskerraPodcastRssSync` batch-reads and writes `General/` via SAF on a background thread. Pull-to-refresh on the **Podcasts** tab runs this when supported (Android, real SAF vault, native module linked); Inbox / vault listing refresh does **not** invoke it. The TypeScript entry `runSerializedPodcastVaultRefresh` in [`podcastRssVaultSync.ts`](../../src/features/podcasts/services/podcastRssVaultSync.ts) **serializes** the full chain (optional native sync, cache clear, `refreshPodcasts`) so overlapping pull refreshes or a future scheduled job share one in-flight run instead of stacking parallel work. **Primary pull-to-refresh feedback** is a thin progress strip fixed under the Podcasts **tab** header (not inside the list), driven by shared UI state on `PlayerContext` (`podcastsVaultRefreshVisible` / `podcastsVaultRefreshPercent`) for the whole serialized run; native sync forwards `onProgress` percent when available, otherwise the strip stays indeterminate. The strip fill uses the app **accent** color (`#4FAFE6`; see [accent colors](../design/accent-colors.md)). The list `RefreshControl` uses **default** platform styling during the pull gesture (same family as Inbox). While the serialized vault refresh runs, `refreshing` stays **false** on the control so there is no second, list-attached spinner; the header strip is the ongoing cue.

- **Discovery:** For each `YYYY Section - podcasts.md` matching `isPodcastFile` for the current or next calendar year, the companion hub is `YYYY Section.md` in the same folder.
- **Checkbox semantics (do not conflate):**
  - **Companion hub (`YYYY Section.md`):** On task lines `- [ ] [[…]]` / `- [x] [[…]]`, the checkbox means **include** vs **exclude** that linked `📻 … .md` from native RSS refresh and from the set of feeds merged into the matching `YYYY Section - podcasts.md`. Unchecked (`[ ]`) = included; checked (`[x]`) = excluded.
  - **`YYYY Section - podcasts.md` (aggregate stub):** On episode bullet lines, `[ ]` / `[x]` mean **not played** / **played** for that episode. This is separate from hub subscription checkboxes and is handled when parsing and merging stub content ([`PodcastsMdMerge.kt`](../../apps/mobile/android/app/src/main/java/com/eskerra/podcast/rss/PodcastsMdMerge.kt), TypeScript played-marking, etc.).
- **📻 refresh:** From the hub, every unchecked task line `- [ ] [[…]]` that resolves to an existing `📻 … .md` file triggers an RSS refresh for that file. Frontmatter may list multiple `rssFeedUrl` values (scalar or YAML list); feeds are merged and sorted by publication time into day sections. Body content older than `daysAgo` (default 7, local calendar) is omitted. Only frontmatter field updated by the sync is `rssFetchedAt` (ISO-8601 UTC with `Z`).
- **Aggregate `*- podcasts.md`:** For each hub, the same **unchecked** task-linked `📻 … .md` files as for 📻 refresh are read and merged into the section’s `*- podcasts.md` using date and **stub** played-state rules (today/yesterday vs older-than-yesterday vs seven-day cutoff) documented in code ([`PodcastsMdMerge.kt`](../../apps/mobile/android/app/src/main/java/com/eskerra/podcast/rss/PodcastsMdMerge.kt)). Task lines marked `[x]` on the hub do not contribute new merge input for that run. Rows are deduplicated by **calendar date plus visible episode title** after normalizing the title to lowercase ASCII letters and digits only (spaces, punctuation, and other characters are ignored for the key), not by MP3 URL. **Collision risk:** two different episodes on the **same** day whose titles normalize the same can collapse to one row. Episode lines and per-show RSS markdown use **literal `&`** in link URLs (not `&amp;`); shared sanitizer: [`PodcastMarkdownLinks.kt`](../../apps/mobile/android/app/src/main/java/com/eskerra/podcast/rss/PodcastMarkdownLinks.kt).
- **Progress:** Native emits `EskerraPodcastRssSyncProgress` on the RN device event bus with `{ jobId, percent, phase, detail? }`. Percent reaches 99 after the last 📻 file in the deduped refresh set, then 100 with `phase: "complete"` after aggregation.
- **TypeScript:** [`androidPodcastRssSync.ts`](../../src/core/storage/androidPodcastRssSync.ts) wraps the native call and listener; [`podcastRssVaultSync.ts`](../../src/features/podcasts/services/podcastRssVaultSync.ts) clears [`clearPodcastMarkdownFileContentCache`](../../src/features/podcasts/services/podcastPhase1.ts) and runs `refreshPodcasts({ forceFullScan: true })` afterward. Not available for the dev mock vault (no SAF).

## Cache Layers

### Persistent podcast markdown index (General)

- Location: `AsyncStorage`.
- Key: `eskerra:generalPodcastMarkdownIndex:${baseUri}`.
- Value: JSON `{ v: 1, snapshottedAt, entries: RootMarkdownFile[] }` where `entries` is only files matching `isPodcastFile` or the RSS emoji filename pattern (not the full `General` listing).
- **Fast path:** `refresh()` loads this snapshot first; if present, it **does not** call `listGeneralMarkdownFiles` on the critical path before showing episodes (still reads each podcast markdown body via SAF as today).
- **Background reconcile:** A full `listGeneralMarkdownFiles` runs asynchronously; if the derived podcast-relevant set differs from what was shown, state is rebuilt and the snapshot is updated.
- **First run / no cache:** Same as before — full `listGeneralMarkdownFiles`, then save snapshot.
- **Pull-to-refresh:** Pass `{ forceFullScan: true }` to `refreshPodcasts` to always run a full listing immediately (picks up new podcast files without waiting for background reconcile).

### Episode File Content Cache

- Location: module-level `fileContentCache` in [`podcastPhase1.ts`](../../src/features/podcasts/services/podcastPhase1.ts) (shared by bootstrap phase-1 and `usePodcasts` after mount).
- Key: markdown file URI.
- Value: `{ lastModified, content }`.
- Lifetime: JS runtime session.
- Invalidation: file `lastModified` mismatch or app restart.
- Clear: `clearPodcastMarkdownFileContentCache()` after native RSS vault sync so refreshed markdown is re-read.

### RSS Feed URL Caches

- Location: module-level maps in `rssFeedUrlCache`.
- Keys: `baseUri::seriesName` and `baseUri::normalizedSeriesName`.
- Value: RSS feed URL.
- Lifetime: JS runtime session, hydrated from persistent storage on each `refresh()` before vault file listing.
- Purpose: enrich episodes and sections without waiting for RSS markdown file reads in the same session; after an app restart, persisted entries restore URLs before phase 2 runs.
- Episode enrichment tries **both** `seriesName` (line parentheses) and `sectionTitle` (filename section) when resolving a cached RSS URL, because persisted keys from `📻` files often match the section title rather than the per-line series name.

### Persistent RSS Feed URL Cache

- Location: `AsyncStorage`.
- Key: `eskerra:rssFeedUrlBySeries:${baseUri}`.
- Value: JSON `{ v: 1, bySeries, byNormalized }` with series display names and normalized keys (without the `baseUri::` prefix inside each record).
- Lifetime: across app restarts for the same app install.
- Write-through: `persistRssFeedUrl` schedules a chained `setItem` (same pattern as artwork URI persistence).
- Hydration: `loadPersistentRssFeedUrlCache` fills only map keys that are not already present (in-memory wins over stale storage).

### Artwork URI Memory Cache

- Location: module-level `artworkUriMemoryCache` in `podcastImageCache`.
- Key: `baseUri::rss-hash`.
- Value: renderable URI (`content://.../document/...`, `file://`, or remote fallback URL). **Null is not a durable negative cache:** misses do not store `null` in a way that blocks later hydration from disk or `AsyncStorage`.
- Lifetime: JS runtime session.
- Purpose: avoid repeated artwork resolution work during row renders.
- `peekCachedPodcastArtworkUriFromMemory` allows list rows to show a known URI on the **first paint** when the in-memory map was warmed by `loadPersistentArtworkUriCache` or earlier resolution (see `usePodcastArtwork`).
- During the session, `getCachedPodcastArtworkUri` **trusts** memory hits without re-running `fileUriExists` / SAF checks per row (stale `file://` entries are dropped on the next `loadPersistentArtworkUriCache`, metadata refresh, or full `getPodcastArtworkUri` path).

### Persistent Artwork URI Cache

- Location: `AsyncStorage`.
- Key: `eskerra:artworkUriCache:${baseUri}`.
- Value: serialized map of non-empty artwork URIs keyed by memory cache key.
- Lifetime: across app restarts for the same app install.
- Purpose: hydrate memory cache early so warm restarts can render artwork without reading vault artwork files.
- **Local file validation:** Cached `content://` document URIs (legacy installs) are checked with `safUriExists`. Cached `file://` internal artwork URIs are checked with `EskerraPodcastArtworkCache.fileUriExists`. Stale pointers are removed from memory and this map rewritten on load when validation fails.

### Podcast image metadata (app-internal)

- Location: `AsyncStorage`.
- Key: `eskerra:podcastImageMeta:${baseUri}` (dev mock uses `@eskerra_dev:podcastImageMeta:${baseUri}`).
- Value: JSON `{ v: 1, byKey: Record<cacheKey, PodcastImageCacheEntry> }` (TTL, remote URL, optional `localImageUri`, `mimeType`).
- Image bytes: Android `context.filesDir/podcast-artwork-files/{sha256(baseUri)}/{cacheKey}.{ext}` via native `writeArtworkFile` (see [`podcastArtworkInternalStorage.ts`](../../src/core/storage/podcastArtworkInternalStorage.ts)). Not written under `.eskerra/` in the vault.

## Loading Phases

### Phase 1 (Spinner-Blocking)

`refresh()` performs rendering-critical work. It begins with `AsyncStorage` hydration (no `listFiles` on `General` yet; artwork hydration may validate persisted URIs: SAF `exists` per legacy `content://` artwork URI, native `fileUriExists` per `file://` internal artwork URI, no artwork network):

1. `await Promise.all([loadPersistentArtworkUriCache(baseUri), loadPersistentRssFeedUrlCache(baseUri)])`.
2. Resolve podcast-relevant file list: either `loadPersistedPodcastMarkdownIndex(baseUri)` when not forcing a full scan, or `listGeneralMarkdownFiles(baseUri)` when there is no snapshot or `forceFullScan` is true; then `filterPodcastRelevantGeneralMarkdownFiles` and persist the snapshot when a full listing ran.
3. Split into legacy podcast files and `📻` RSS files via `splitPodcastAndRssMarkdownFiles`.
4. Read and parse legacy podcast markdown bodies (SAF `readFile` per file).
5. Enrich episodes with RSS URLs from `rssFeedUrlCache` (including entries restored from persistent storage), using `seriesName` then `sectionTitle` as lookup keys.
6. Build sections and commit state.
7. Fire-and-forget `primeArtworkCacheFromDisk` for every RSS URL found on episodes or sections (so `AsyncStorage` metadata can populate memory **without** waiting on `📻` reads when those run after first paint).
8. Set `isLoading=false` in `finally`.

Spinner target: disappears after steps 1–6 complete (step 7 does not block the spinner). When a persisted podcast markdown index exists, step 2 avoids a full `listFiles` on `General` on the critical path; a full listing may still run afterward in the background.

### Background (after fast path index)

When phase 1 used a persisted snapshot (no full listing in the `try` block), `refresh()` schedules a full `listGeneralMarkdownFiles`, recomputes the podcast-relevant subset, updates `AsyncStorage`, and refreshes React state if the index changed.

### Phase 2 (Background)

After phase 1 state is rendered:

1. Read RSS markdown files (`📻 ... .md`) when not already read on the critical path (see `usePodcasts` `runRssEnrichment`).
2. Extract RSS feed URL + section title.
3. Persist RSS URL mappings via `persistRssFeedUrl` (memory + `AsyncStorage` write-through).
4. Re-enrich episodes and sections if new URLs changed visible data.
5. Prime artwork cache via `primeArtworkCacheFromDisk(baseUri, rssFeedUrls)`.

`primeArtworkCacheFromDisk` only performs cached metadata lookups via `getCachedPodcastArtworkUri`. It does not trigger network fetches.

### Player Restore (Concurrent With Podcast Load)

- `usePlayer` effect 1 runs on `[baseUri, player]` and reads `playlist.json` once per vault session.
- effect 2 matches the saved playlist entry against `episodesById` as episode maps update.
- This decouples playlist read timing from phase 2 enrichment.

## UI: Episode rows

- `EpisodeRow` resolves artwork using `episode.rssFeedUrl` and falls back to `section.rssFeedUrl` when the episode has no URL after enrichment (belt-and-suspenders with the dual-key enrich step).

### Artwork display (Android ANR mitigation)

- New artwork resolves to **`file://`** URIs under app-internal storage; **`http(s)`** pass through unchanged. Legacy vault artwork may still appear as SAF **`content://…/document/…`** until TTL refresh re-downloads.
- **Do not pass vault `content://` URIs directly to React Native `Image`.** Fresco can trigger synchronous `ContentResolver` work on the UI thread during layout, which risks **ANRs** on some devices.
- `PodcastArtworkImage` uses `usePodcastArtworkDisplayUri`: internal **`file://`** and remote URLs are used as-is on first paint. For legacy **`content://`** artwork only, it calls **`EskerraPodcastArtworkCache.ensureLocalArtworkFile`** to copy bytes to **`context.cacheDir/podcast-artwork/`** on a background thread and passes the resulting **`file://`** URI to `Image`.
- In-memory deduplication for that legacy copy path lives in [`androidPodcastArtworkCache.ts`](../../src/core/storage/androidPodcastArtworkCache.ts).

## Artwork Resolution Rules

Given `baseUri` and `rssFeedUrl`:

1. Check artwork memory cache (including synchronous peek for first paint in `usePodcastArtwork`).
2. If miss, check persistent metadata entry (`readPodcastImageCacheEntry` in [`podcastArtworkInternalStorage.ts`](../../src/core/storage/podcastArtworkInternalStorage.ts)) for fresh cached URI.
3. If stale or missing and caller allows full resolution (`getPodcastArtworkUri`), fetch RSS artwork URL and attempt download.
4. On successful local download, write image bytes via native `writeArtworkFile`, update metadata blob, and update memory cache.
5. On download failure, store remote URL fallback metadata and cache fallback URI.
6. Every memory-cache update schedules AsyncStorage write-through for that `baseUri`.

## Warm Vs Cold Behavior

### Cold Start (No Persistent Caches Yet)

- Phase 1 still renders quickly from podcast markdown files.
- Without persisted RSS URLs, `rssFeedUrl` may stay empty until phase 2 reads `📻` markdown; artwork then follows.
- Priming and row-level fetches progressively populate memory + persistent artwork and RSS caches.

### Warm Restart (Persistent Artwork and/or RSS Cache Present)

- Phase 1 hydrates artwork memory cache and RSS maps from `AsyncStorage` before listing vault files.
- Episode rows can resolve `rssFeedUrl` and artwork immediately when both persistent layers hit.
- Phase 2 still runs to reconcile `📻` markdown changes and to `primeArtworkCacheFromDisk` for metadata refresh.

## SAF Call Budget (Warm Restart, Cached Content)

Expected call profile after this design:

- `AsyncStorage.getItem` for artwork + RSS caches: 2 reads at phase 1 start (app-internal, not SAF).
- `listGeneralMarkdownFiles`: typically **0 on the critical path** when a warm podcast index snapshot exists; **1+ in background** reconcile, or **1 in try** on cold start / `forceFullScan`. Each call still does `exists` + `listFiles` on `General`.
- podcast markdown reads: typically 0 SAF reads when `fileContentCache` is warm in-session.
- `readPlaylist`: 2 calls, concurrent with podcast loading.
- phase 2 RSS reads: often 0 when `fileContentCache` is warm in-session.
- phase 2 artwork priming: 0 when memory cache is already hydrated from `AsyncStorage`.
- row artwork resolution: 0 when memory cache hits.

Total target on warm path: roughly 4 SAF calls plus any required validation misses.

## Playback buffering UX (Android)

- **Native-led state:** After `play()` / `resume()`, `usePlayer` syncs React playback state from `getState()` instead of forcing `playing`, so `State.Loading` / `State.Buffering` from react-native-track-player can surface as `loading` while the network buffers (e.g. resume mid-episode after cold start).
- **`playbackTransportBusy`:** `isLoading || state === 'loading'`. Exposed on `PlayerContext` for UI that should treat transport as busy (mini player spinner, episode row lockout) during both user actions and native buffering.
- **Mini player:** When transport is busy and the state is `loading`, the main control shows an `ActivityIndicator` instead of play/pause; optional one-line copy: **Buffering…**, **Resuming…** (when `positionMs` is past a mid-episode threshold), or **Starting…** when paused but an action is still in flight.
- **Episode rows:** Rows use `playbackTransportBusy` so users cannot start another episode while buffering or while a play action is completing.

## Desktop playback chrome (no separate player pane)

- The **Editor Toolbar** (`PlaybackTransport` in `EditorWorkspaceToolbar`, `variant="toolbar"`) is the in-window transport: elapsed, ±10s skip, play/pause or **loading** (spinning **Radix `ReloadIcon`**), duration, then episode + series title on the same row. Radix icons are **15×15** (same as other toolbar chrome). There is no separate docked player panel.
- When `DesktopPlayerLabel` is `loading`, skip buttons are disabled and the center control shows the loading spinner (not a disabled play/pause icon alone).

## Non-Goals

- Persisting negative artwork lookups (`null`) across restarts.
- Blocking first paint on RSS file parsing or artwork priming.
- Forcing network refresh before showing cached artwork.
