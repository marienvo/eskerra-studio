# Desktop and mobile parity

This document states what is shared between the **Android** app (`apps/mobile`) and the **desktop companion** (`apps/desktop`), what differs by platform, and what is intentionally deferred.

## Shared vault contract

The following are **identical on disk** once a vault root is chosen:

- **Vault root** is a single directory the user selects.
- **`Inbox/`** holds user-authored markdown notes (`.md`).
- **`General/`** holds podcast-related markdown.
- **`.eskerra/settings-shared.json`** stores vault-scoped settings synced with the vault: optional Cloudflare **R2** (S3-compatible) fields only. **`displayName`** and **`deviceName`** live in **`.eskerra/settings-local.json`** (per device; default empty strings; typically not committed). **`deviceInstanceId`** is a stable random id for this app install (used as the playback owner id); it is **not** synced across devices. **`playlistKnownUpdatedAtMs`** and **`playlistKnownControlRevision`** (nullable numbers) record the last playlist **`updatedAt`** and **`controlRevision`** this device accepted after a successful R2 or fallback local read/write. Legacy **`settings.json`** is read once for migration into `settings-shared.json`. If legacy **`displayName`** still appears in shared JSON, the app copies it into local settings and rewrites shared without that key. Parsing and defaults are implemented in `@eskerra/core`. **Security:** storing R2 keys in the shared file is an accepted tradeoff for private vaults; see **section 9** in [`known-risks.md`](known-risks.md).
- **Playback playlist (`playlist.json`):** when **R2 is fully configured** in shared settings, the canonical JSON object lives in the R2 bucket as **`playlist.json`** at the bucket root (**one vault per bucket**). It includes position fields, **`updatedAt`** (Unix ms), **`playbackOwnerId`** (metadata: **`deviceInstanceId`** of the device that last performed a **control** action: play, pause, seek, episode change, resume; **not** used to gate writes), and **`controlRevision`** (monotonic; bumped only on control actions, not on passive progress ticks). Devices merge with **`pickNewerPlaylistEntry`**: higher **`controlRevision`** wins; if tied, higher **`updatedAt`** wins; if still tied, remote wins. Before writing, each device compares the remote object to its known baseline (`playlistKnownUpdatedAtMs` / `playlistKnownControlRevision`); if remote is newer, the local write is **superseded**. **Progress** and **control** writes both follow that baseline rule; **`playbackOwnerId`** does not block a device from persisting. **User play** (starting an episode or **resume** after pause) performs a **control** write with the current **`positionMs`** on Android and desktop so R2/disk reflect the resumed/started session, subject to the same merge rules. **Pause** performs a **control** write (position + owner/revision) subject to **`MIN_PLAYLIST_PERSIST_POSITION_MS`** (below which the playlist may be cleared). ETag / playlist polling notifies clients when remote **`playlist.json`** content changes; it does **not** mean “pause because the owner string differs” unless a future feature implements that explicitly. **`.eskerra/playlist.json`** is **not** authoritative while R2 works; it is used for **offline / error fallback** until R2 succeeds again. With **no** R2 configuration, **`.eskerra/playlist.json`** remains the only playlist store (still includes `updatedAt` on new writes).

## Platform-specific bootstrap

| Concern | Android (`apps/mobile`) | Desktop (`apps/desktop`) |
| ------- | ----------------------- | ------------------------- |
| Selected root | SAF **tree URI** persisted in AsyncStorage (`notesDirectoryUri`) | **Absolute POSIX path**; session in Tauri + persisted path in the app store plugin (`eskerra-desktop.json` under the app data dir) |
| File API | `react-native-saf-x` via `safVaultFilesystem` implementing `VaultFilesystem` | Tauri **`vault_*` commands** (Rust `std::fs`) implementing the same `VaultFilesystem` surface for the web UI |
| Indexing / listing | SAF + optional Kotlin `EskerraVaultListing` acceleration | POSIX `read_dir` via `vault_list_dir` (no RSS batch sync in MVP) |
| Full-vault content search | SQLite **FTS5** in Kotlin `EskerraVaultSearch` (lazy index on Vault tab focus); see [`mobile-vault-search.md`](mobile-vault-search.md) | Tantivy + Rust (`vault_search*`) in Tauri; shared types + highlight helpers in `@eskerra/core` |

## Feature matrix (MVP vs deferred)

| Capability | Android | Desktop (current milestone) |
| ---------- | ------- | --------------------------- |
| Choose vault folder | Yes (SAF) | Yes (native folder dialog) |
| Read/write Inbox markdown | Yes | Yes |
| Callout / alert markdown (`> [!type]`) | Yes (vault note detail reader) | Yes (CodeMirror vault editor + hub/table static rich) |
| Edit vault display name (`settings-local.json`) | Yes | Yes |
| Stream MP3 / resume from `playlist.json` | Yes (`react-native-track-player`) | Yes (`HTMLAudioElement`; Linux GNOME/MPRIS via WebKitGTK **`navigator.mediaSession`**) |
| Episodes list from vault `General/` podcast markdown | Yes (sectioned list) | Yes (desktop parses the same `*- podcasts.md` / RSS pie rules via TypeScript under `apps/desktop/src/lib/podcasts/`) |
| OS play/pause (lock screen / shell) | Yes (Track Player service) | Yes on Linux when WebKit exposes **MediaSession**; channel artwork URLs come from TypeScript (`artworkCacheDesktop`) and are set on **`navigator.mediaSession`** as **https** URLs (no Rust artwork IPC) |
| Filesystem-driven vault refresh | Pull-to-refresh / native listing | **notify**-based watch on `Inbox/`, `General/`, `.eskerra/` with debounced UI refresh (plus optional Settings “Refresh from disk”) |
| RSS → vault markdown sync (Kotlin / native) | Yes | **Deferred** — not required for first desktop milestone |
| Native podcast artwork cache module | Yes (`PodcastArtworkCacheModule`) | **No** — desktop uses TypeScript **`artworkCacheDesktop`** (RSS fetch + `localStorage`), not a Rust/Tauri module |

## Media architecture

- **Android:** `AudioPlayer` implementation uses **Track Player**; `AudioPlayer` interface types live in `@eskerra/core`.
- **Desktop:** `HtmlAudioPlayer` implements the same interface using **`<audio>`**; **`desktopMediaSession`** updates **`navigator.mediaSession`** (metadata, playback state, position) so WebKitGTK exposes a **single** MPRIS player on GNOME (no separate Rust MPRIS bridge). Episode/channel artwork is resolved in TypeScript (**`artworkCacheDesktop`**) and passed to **`MediaMetadata`** as remote **https** URLs. The shell registers **MediaSession** **play** / **pause** action handlers that call **`togglePause`** / **`pauseIfPlaying`** on the desktop playback ref.
- **Shared playlist:** both apps use the same **`playlist.json`** payload (vault disk path or R2 object). With R2 enabled, they **re-read on startup** and on **vault/podcast refresh** so another device’s newer `updatedAt` replaces local playback state when applicable.

## Desktop main-window UX

Primary-window flows should **not** use modal backdrops over the shell; use panes or a separate window. See [`specs/design/desktop-shell-patterns.md`](../design/desktop-shell-patterns.md).

## Performance expectations

- **Desktop** uses direct filesystem access; still avoid full vault scans on startup unless the first screen requires it (same product instinct as mobile). Heavy work should stay off the first paint path.
- **Measurement:** when changing startup or indexing behavior on either app, add simple timing logs per `.cursor/rules/performance.mdc`.

## Roadmap

Phased work to reach **feature parity** with the current Android app (inbox, podcasts from vault, RSS refresh, played state, shell polish) lives in [`specs/plans/desktop-feature-parity-phased.md`](../plans/desktop-feature-parity-phased.md). Use it to schedule **layout and QA passes between phases**.

## Testing notes

- **TypeScript:** `npm test` at the repo root runs `@eskerra/core` (Vitest), `apps/mobile` (Jest), and release helper Node tests.
- **Desktop Rust:** `cargo check` / `cargo clippy` / `tauri dev` require Linux **WebKitGTK + GTK** dev packages (see [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)). On Fedora, install the packages listed there plus **`gtk3-devel`** and **`pango-devel`** if Cargo fails with missing `gdk-3.0.pc` / `pango.pc` (`gdk-sys` / `pango-sys`). The [README](../../README.md) documents the exact `dnf` commands and `npm run desktop`.
- **Desktop release bundles:** `npm run desktop:build` (from the repo root) runs [`scripts/tauri-desktop-build.mjs`](../../scripts/tauri-desktop-build.mjs), which first runs [`scripts/bump-release-version.mjs`](../../scripts/bump-release-version.mjs) (same **branch/commit** semver rules as [`build-apk-release.sh`](../../scripts/build-apk-release.sh); **detached HEAD** maps to a stable branch id `detached` so new commits use **patch** bumps, not repeated **minor** bumps), then invokes `tauri build` with a **merged `bundle.linux.rpm.release`** so every build gets a new RPM **NEVRA**. That lets `dnf install ./eskerra-…rpm` or `rpm -Uvh` **upgrade in place** without uninstalling when the previous package is still installed. The app **semver** is canonical in [`apps/mobile/package.json`](../../apps/mobile/package.json): the desktop Vite splash and [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) read that file; [`apps/desktop/package.json`](../../apps/desktop/package.json), [`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml), the root `app` stanza in [`Cargo.lock`](../../apps/desktop/src-tauri/Cargo.lock), and the top `<release>` in [`eskerra.metainfo.xml`](../../apps/desktop/src-tauri/metainfo/eskerra.metainfo.xml) stay aligned with it. The bump script updates mobile, Gradle, and those desktop artifacts together; [`scripts/assert-app-versions-align.mjs`](../../scripts/assert-app-versions-align.mjs) runs in root `npm test` to catch drift. On Linux, [`tauri.linux.conf.json`](../../apps/desktop/src-tauri/tauri.linux.conf.json) sets **`bundle.targets` to `["rpm"]` only** (Fedora-oriented shipping; see [`platform-targets.md`](platform-targets.md)). The built RPM is emitted under `apps/desktop/src-tauri/target/release/bundle/rpm/` as `eskerra-<version>-<release>.<arch>.rpm` (see `productName` in the desktop Tauri config).
- **CI:** Ubuntu runners install GTK/WebKit packages before `cargo check` for `apps/desktop/src-tauri` (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).
