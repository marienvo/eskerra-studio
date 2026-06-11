# Android R2 and vault settings (rebuild spec)

## name

Android R2 and vault settings — behavioral spec for rebuilding the current mobile app’s vault settings and Cloudflare R2 integration in a new Android app.

## overview

This document captures **everything the current Android app (`apps/mobile`) implements today** for:

1. **Vault-scoped settings** stored under `.eskerra/` in the user-selected vault directory.
2. **Cloudflare R2 configuration** in shared settings and the **runtime behavior** that depends on it (playlist sync over S3-compatible R2).

It is written so a **different Android app** can reproduce the same on-disk contract, validation rules, UI flows, and playback sync semantics **as tightly as possible**. The target app is **dark mode only** (no light theme requirement).

**Canonical types and parsers** live in `@eskerra/core` (`packages/eskerra-core/`). A rebuild should either depend on that package or copy the same logic verbatim (tests in core are the acceptance oracle).

> **Kotlin note:** A native Android app **cannot** depend on `@eskerra/core` (TypeScript). It must **reimplement** the parse/serialize/merge/HTTP logic in Kotlin and port the core tests as the parity oracle. The sections [S3 request contract](#s3-request-contract-language-independent), [Playlist merge contract](#playlist-merge-contract-pure-functions), and [ETag poller invariants](#etag-poller-invariants) below are written to be self-contained for that purpose — do not rely on reading the TS at build time.

**Cross-reference:** vault-wide contract summary in [`specs/architecture/desktop-mobile-parity.md`](../architecture/desktop-mobile-parity.md). Security stance for R2 keys in vault JSON: [`specs/architecture/known-risks.md`](../architecture/known-risks.md) §9.

## non-goals

- Desktop-only settings (`themePreference` UI, frontmatter Properties, link-snippet blocklist UI, keyboard shortcuts, layout persistence). Mobile **does not expose** these; see [Shared settings fields mobile does not edit](#shared-settings-fields-mobile-does-not-edit).
- iOS or multi-mobile portability.
- Server-mediated R2 auth (future direction only; today credentials are vault-stored plain JSON).
- Changing the vault contract for playlist or settings filenames without a spec update.

## platform assumptions

| Concern | Current Android behavior |
| --- | --- |
| Vault root | User-selected directory via Android **Storage Access Framework** (SAF) **tree URI** |
| Tree URI persistence | `AsyncStorage` key `notesDirectoryUri` (see `apps/mobile/src/core/storage/keys.ts`) |
| File I/O | `react-native-saf-x` implementing `VaultFilesystem` (`safVaultFilesystem`) |
| Note URI shape | `<treeUri>/<relative-path>` (direct suffix, not `…/document/<docId>`) — see AGENTS.md |
| Theme | Product is **dark mode only** on mobile; settings UI in the reference app uses some light chip colors — the rebuild should use dark-appropriate surfaces (see [Settings UI (dark mode)](#settings-ui-dark-mode)) |

## vault layout (settings-relevant paths)

All paths are relative to the **vault root** the user selected.

| Path | Purpose |
| --- | --- |
| `.eskerra/settings-shared.json` | Vault-synced shared settings (`EskerraSettings`) |
| `.eskerra/settings-local.json` | Per-device local settings (`EskerraLocalSettings`) |
| `.eskerra/settings.json` | **Legacy** shared settings; read once for migration |
| `.eskerra/playlist.json` | Legacy local playlist file; **not read** by current mobile when R2 is absent; **deleted** on `clearPlaylist` when present |
| `.notebox/` | Legacy hidden directory; renamed to `.eskerra/` when `.eskerra` is absent |

Constants: `packages/eskerra-core/src/vaultLayout.ts`.

### First-time vault initialization

`initEskerraVault` (`@eskerra/core`) — invoked from mobile as `initEskerra`:

1. Migrate `.notebox` → `.eskerra` if needed (`migrateLegacyVaultHiddenDirectoryIfNeeded`).
2. Create `.eskerra/` if missing.
3. If **neither** `settings-shared.json` **nor** legacy `settings.json` exists, write **default shared settings** containing a **mock R2 block** (placeholders only — not production secrets):

```json
{
  "r2": {
    "endpoint": "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
    "bucket": "mock-bucket",
    "accessKeyId": "mock_access_key_id",
    "secretAccessKey": "mock_secret_access_key"
  }
}
```

4. If `settings-local.json` is missing, write defaults with a **new** `deviceInstanceId` (`newDeviceInstanceId()`).

Mobile entry points: `SetupScreen` (after directory pick), `prepareVaultSession` fallback path.

## settings schemas

### `EskerraSettings` (`.eskerra/settings-shared.json`)

Type: `packages/eskerra-core/src/eskerraSettings.ts`.

| Field | Type | Mobile UI | Notes |
| --- | --- | --- | --- |
| `r2` | optional object | **Yes** — full form | See [R2 configuration](#r2-configuration) |
| `r2.endpoint` | string | Yes | Normalized on save (trim, trailing slashes) |
| `r2.bucket` | string | Yes | |
| `r2.accessKeyId` | string | Yes | `secureTextEntry` in UI |
| `r2.secretAccessKey` | string | Yes | `secureTextEntry` in UI |
| `r2.jurisdiction` | `'default' \| 'eu' \| 'fedramp'` | Yes — chip selector | Omitted from disk when `default` |
| `themePreference` | object | **No UI** | Desktop / future; must be **preserved** on shared save |
| `frontmatterProperties` | object | **No UI** | Desktop Properties; preserve on save |
| `linkSnippetBlockedDomains` | string[] | **No UI** | Desktop editor; preserve on save |

Serialization: `JSON.stringify(settings, null, 2)` + **trailing newline** (`serializeEskerraSettings`).

Parse errors throw: `settings-shared.json has an invalid structure.` (or theme-specific message for bad `themePreference`).

Legacy `displayName` in shared JSON is **ignored by parser** and migrated to local on read (see [Migration](#migration)).

### `EskerraLocalSettings` (`.eskerra/settings-local.json`)

Type: `packages/eskerra-core/src/eskerraLocalSettings.ts`.

| Field | Type | Mobile UI | Editable in settings screen |
| --- | --- | --- | --- |
| `displayName` | string | Yes | Yes — trimmed on save |
| `deviceName` | string | Yes | Yes — `trimEnd()` on save (leading spaces kept) |
| `deviceInstanceId` | string | **Hidden** | **Never** user-editable; auto-assigned |
| `playlistKnownUpdatedAtMs` | `number \| null` | Hidden | Preserved across settings save; updated by playlist I/O |
| `playlistKnownControlRevision` | `number \| null` | Hidden | Same |

Defaults: empty strings for names, `deviceInstanceId: ''` until ensured, playlist watermarks `null`.

`ensureDeviceInstanceId`: after every read, if `deviceInstanceId` is empty, assign `crypto.randomUUID()` (or fallback `nb-<timestamp>-<random>`) and persist. **Kotlin:** use `java.util.UUID.randomUUID().toString()`; the exact format is not part of the contract (it is opaque metadata), only that it is stable per install and persisted on first ensure.

**`deviceInstanceId` usage:** written into `playlist.json` → `playbackOwnerId` on **control** writes (`buildPlaylistEntryForWrite`). Metadata only; does **not** block other devices from writing.

### “R2 fully configured”

`isVaultR2PlaylistConfigured(settings)` (`packages/eskerra-core/src/r2Settings.ts`): all four `r2` string fields are non-empty after trim. Jurisdiction does not affect this gate.

## read and write behavior

### Reading shared settings

Flow (`readVaultSharedSettingsRaw` + mobile `readSettings`):

1. Migrate `.notebox` → `.eskerra` if needed.
2. If `settings-shared.json` exists → read it.
3. Else if legacy `settings.json` exists → read raw, write normalized shared file, return **original raw** for migration side effects.
4. Else throw: `settings-shared.json was not found and no legacy settings.json exists.`

Then `parseEskerraSettings`, then `migrateLegacySharedDisplayNameIfNeeded` (mobile): if loose JSON still contains `displayName`, copy to local when local `displayName` is empty, rewrite shared without that key.

### Writing shared settings

Mobile `writeSettings`: SAF `writeFile` on `getSharedSettingsUri(baseUri)` with `serializeEskerraSettings`.

### Writing local settings

Mobile `writeLocalSettings`: ensure `.eskerra/` exists, write `settings-local.json`.

### Session load

`prepareVaultSession` (`apps/mobile/src/core/vault/applyVaultSession.ts`):

1. Prefer native `tryPrepareEskerraSessionNative` (Kotlin `VaultListingModule`) for settings JSON + inbox prefetch.
2. On failure: `initEskerra` + `readSettings`.
3. `readLocalSettings` + `ensureDeviceInstanceId` (persist if changed).
4. Expose `settings` and `localSettings` on `VaultContext`.

App bootstrap (`App.tsx`): when a saved vault URI exists, `prepareVaultSession` runs in parallel with `readPlaylistCoalesced` (R2 prime) and podcast phase-1 load.

## R2 configuration

### Form validation (`buildEskerraSettingsFromForm`)

| Rule | Message |
| --- | --- |
| All four R2 fields empty | Valid — produces `{}` (no `r2` key) |
| Some but not all non-empty after trim | Invalid — `Complete all Cloudflare R2 fields or clear them all.` |
| All four non-empty | Valid — includes `r2` block |
| `jurisdiction === 'default'` | Omit `jurisdiction` from serialized JSON |
| `previousShared` passed (desktop pattern) | Copy `themePreference`, `frontmatterProperties`, `linkSnippetBlockedDomains` into result |

**Rebuild requirement:** pass `previousShared` when saving R2 from settings (match desktop `SettingsContent.tsx`). The **current** mobile `SettingsScreen` does **not** pass `previousShared`, which can **strip** desktop-only shared fields on save — do not replicate that bug in a greenfield rebuild.

### Endpoint normalization

- `effectiveR2Endpoint(config)`: for `jurisdiction: 'eu'`, rewrite `https://<account>.r2.cloudflarestorage.com` → `https://<account>.eu.r2.cloudflarestorage.com` (and analog for `fedramp`). Already-correct hostnames are unchanged.
- `r2S3AccountBaseUrl(config)`: strips a trailing `/<bucket>` segment from the endpoint URL if the user pasted Cloudflare’s “S3 API URL including bucket” form. Object URLs are built as `{accountBase}/{bucket}/{objectKey}`.

### S3 signing and HTTP

Reference implementation: `packages/eskerra-core/src/r2PlaylistObject.ts` + `r2PlaylistConditional.ts` using `aws4fetch` (`AwsClient`). The Kotlin rebuild reimplements the same SigV4 path (e.g. AWS SDK v2 `S3Presigner` / `Aws4Signer`, or a hand-rolled SigV4 presigner).

| Constant | Value |
| --- | --- |
| SigV4 region | `auto` |
| Service | `s3` |
| Signing mode | **Presigned query** (`aws: { signQuery: true }`) — credentials go in the query string, **not** the `Authorization` header. Required because some runtimes (RN `fetch`, Tauri/WebView) drop/alter that header → `SignatureDoesNotMatch`. The Kotlin client should likewise presign (query-string auth) rather than send an `Authorization` header. |

R2 object key for playlist: **`playlist.json`** at bucket root (`PLAYLIST_FILE_NAME` in `vaultLayout.ts`). **One vault per bucket.**

### S3 request contract (language-independent)

**Object URL** (`buildR2ObjectUrl`):

```
base   = stripTrailingSlashes(r2S3AccountBaseUrl(config))   // see Endpoint normalization
key    = encodeURIComponent(objectKey).replace(/%2F/g, '/') // playlist.json has no '/'
url    = `${base}/${config.bucket}/${key}`
```

Note `r2S3AccountBaseUrl` returns the **origin** (no `/bucket`) when the pasted endpoint already ends in `/<bucket>`; the bucket is then appended exactly once here.

**Per-verb behavior:**

| Verb | Request | Success handling | Not-found | Body parse |
| --- | --- | --- | --- | --- |
| GET (`getR2PlaylistObject`) | presigned GET | parse body | **404 → `null`** | empty/whitespace body → `null`; else `JSON.parse` → `normalizePlaylistEntryForSync`; null result → throw `R2 playlist.json has an invalid structure.` |
| PUT (`putR2PlaylistObject`) | presigned PUT, header `Content-Type: application/json`, body = `serializePlaylistEntry(entry)` (pretty JSON **+ trailing `\n`**) | none (void) | — | — |
| DELETE (`deleteR2PlaylistObject`) | presigned DELETE | none (void) | **404 → treat as success** | — |
| Conditional GET (`fetchR2PlaylistConditional`) | presigned GET, header `If-None-Match: <etag>` when a prior etag exists | **304 → `{not_modified}`**; else read `etag` response header → `{updated, entry, etag}` | **404 → `{missing}`** | empty body → `{missing}`; invalid JSON → throw `R2 playlist.json is not valid JSON.`; bad shape → throw `R2 playlist.json has an invalid structure.` |

**Error message format** (non-OK, non-404/304): read response body as text, extract the S3 XML `<Code>...</Code>` via a simple tag scan, then throw:

```
R2 <VERB> playlist.json failed: HTTP <status>[ (<Code>)][. <hint>]
```

`<hint>` is appended only when `<Code> === 'AccessDenied'`:

| Verb | Hint |
| --- | --- |
| read (GET / conditional) | `Grant Object Read on the R2 S3 API token for this bucket (Cloudflare: R2 → Manage R2 API Tokens).` + EU note |
| write (PUT) | `Grant Object Write on the R2 S3 API token for this bucket.` + EU note |
| delete | `Grant Object Delete on the R2 S3 API token for this bucket.` + EU note |

EU note (suffix): ` EU data location buckets need jurisdiction "EU" in settings (or the .eu.r2.cloudflarestorage.com endpoint).`

## R2 playlist sync (mobile runtime)

Mobile ties **all playlist persistence** to R2 when `isVaultR2PlaylistConfigured` is true. Behavior is implemented in `apps/mobile/src/core/storage/eskerraStorage.ts` + `usePlayer` + `usePlaylistR2ActivePolling`.

### `PlaylistEntry` shape

`packages/eskerra-core/src/playlist.ts`:

```ts
{
  episodeId: string;
  mp3Url: string;
  positionMs: number;
  durationMs: number | null;
  updatedAt: number;           // Unix ms
  playbackOwnerId: string;     // deviceInstanceId on control writes
  controlRevision: number;     // monotonic on control writes
}
```

### Read path (`readPlaylist`)

| Condition | Behavior |
| --- | --- |
| R2 **not** configured | Return `null`; set local watermarks to `null`; **does not** read `.eskerra/playlist.json` |
| R2 configured | `GET` R2 `playlist.json`; on success update `playlistKnownUpdatedAtMs` / `playlistKnownControlRevision`; on error return `null` and clear watermarks |

`readPlaylistCoalesced` deduplicates concurrent reads per vault URI (in-memory map); settled promise is reused for bootstrap + player.

### Write path (`writePlaylist`)

| Step | Behavior |
| --- | --- |
| No R2 | Return `{ kind: 'skipped' }` — in-memory playback only |
| R2 | Ensure `deviceInstanceId`; read remote; if `isRemotePlaylistNewerThanKnown(remote, knownUpdated, knownRev)` → `{ kind: 'superseded', entry: remote }` and update watermarks |
| Else | `PUT` merged entry; `updatedAt = max(now, remote?.updatedAt, knownUpdated, entry.updatedAt)`; update watermarks; `{ kind: 'saved', entry }` |

Merge comparison (`pickNewerPlaylistEntry`): higher `controlRevision` wins; tie → higher `updatedAt`; full tie → remote wins.

### Playlist merge contract (pure functions)

These must be reproduced exactly; they are the conflict-resolution heart of cross-device sync (`packages/eskerra-core/src/playlist.ts`).

| Function | Rule |
| --- | --- |
| `normalizePlaylistEntryForSync(json)` | Require `episodeId: string`, `mp3Url: string`, `positionMs: number`, `durationMs: number \| null`. Optional/legacy fields default: `updatedAt` → finite number or **`0`**; `playbackOwnerId` → string or **`''`**; `controlRevision` → finite number or **`0`**. Invalid core shape → `null`. |
| `pickNewerPlaylistEntry(a, b)` | null-safe; higher `controlRevision` wins; tie → higher `updatedAt`; full tie → **`b` (remote)**. |
| `isRemotePlaylistNewerThanKnown(remote, knownUpdated, knownRev)` | `remote.controlRevision > knownRev` → true; `<` → false; **equal** → `remote.updatedAt > knownUpdated`. (Revision dominates `updatedAt`.) |
| `buildPlaylistEntryForWrite(base, patch, deviceInstanceId, nowMs)` | merge `base`+`patch`; then `controlRevision = base.controlRevision + 1`, `playbackOwnerId = deviceInstanceId`, `updatedAt = max(nowMs, merged.updatedAt)`. |
| `serializePlaylistEntry(entry)` | `JSON.stringify(entry, null, 2)` **+ trailing `\n`**. |
| `isPlaylistR2PollEchoFromOwnDevice(entry, id)` | true only when both `id` and `entry.playbackOwnerId` are non-empty and equal (after trim). Self-echo guard for polls. |

### Clear path (`clearPlaylist`)

When R2 configured: `DELETE` R2 object; clear watermarks; **unlink** local `.eskerra/playlist.json` if it exists. When R2 not configured: still clears watermarks and removes local file if present.

### Player integration (`usePlayer`)

- `hasR2` dep: `isVaultR2PlaylistConfigured(settings)`.
- `persist` / `clearRemotePlaylist` → `writePlaylist` / `clearPlaylist`.
- Cold restore: one restore per vault URI; `readPlaylistCoalesced` → hydrate XState machine if episode still in catalog and not listened.
- `playlistSyncGeneration` bump (from vault refresh or R2 poll): re-read playlist; if native state is `playing` or user playback depth &gt; 0, skip sync; else merge remote into UI.
- Control writes use `buildPlaylistEntryForWrite` with `deviceInstanceId` from `localSettings`.
- `MIN_PROGRESS_MS` (10_000): below this threshold on pause, playlist may be cleared (core player machine).
- Near-end (mark listened + clear R2 once): `NEAR_END_WINDOW_MS` (10_000) is the trailing zone treated as "finished"; gated by `NEAR_END_MIN_DURATION_MS` (= `2 × NEAR_END_WINDOW_MS` = 20_000) so very short episodes don't flip immediately. Reproduce both constants in the Kotlin player machine.

### ETag polling (`usePlaylistR2ActivePolling`)

- Host: `PlaylistR2PollingHost` under main tabs + `PlayerProvider`.
- Interval: **1000 ms** while active.
- Active when: vault open, R2 configured, app foreground (`AppState === 'active'`), `allowPolling === true`.
- **Paused while audio playing** (`playbackState === 'playing'`).
- Uses `createPlaylistEtagPoller` + `fetchR2PlaylistConditional` (`If-None-Match`).
- On `updated` or remote cleared → `notifyPlaylistSyncAfterVaultRefresh` → invalidates playlist read cache + bumps `playlistSyncGeneration`.

`isPlaylistR2PollEchoFromOwnDevice` exists in core for ignoring self-echo polls; wire if player re-merge stomp is observed.

#### ETag poller invariants

The poller (`packages/eskerra-core/src/playlistEtagPoller.ts`) is a single-timer state machine. Reproduce these invariants exactly — they prevent request pile-up and false "cleared" events:

- **No overlapping requests:** a tick that fires while one is `inFlight` is skipped (not queued).
- **Immediate tick on activate:** `setActive(true)` runs one tick **now**, then schedules the interval. `setActive(false)` clears the timer **and aborts the in-flight request**.
- **ETag carry:** the last `etag` from an `updated` response is sent as `If-None-Match` next tick; reset to `null` on a `missing` result.
- **`haveRemote` latch:** `onRemotePlaylistCleared` fires **only** on a present→absent transition (`updated` was seen, then `missing`). A `missing` on first boot (never saw content) does **not** fire it.
- **Abort handling:** `AbortError` (and any error after `signal.aborted`) is swallowed silently; other errors go to `onTransientError`.
- **Silent transient errors today:** the mobile hook (`usePlaylistR2ActivePolling`) does **not** pass `onTransientError`, so poll failures (network, auth) are dropped with no UI signal. A rebuild may keep this behavior or surface a subtle indicator, but must not let a failed poll throw or stop the timer.
- **Interval is reschedulable** (`setIntervalMs`) without an extra immediate tick; mobile uses a fixed 1000 ms.

### Divergence from desktop-mobile-parity doc

The parity doc states `.eskerra/playlist.json` is authoritative when R2 is off. **Current mobile does not implement local playlist read/write** when R2 is absent (`readPlaylist` → `null`, `writePlaylist` → `skipped`). A rebuild targeting **strict current mobile behavior** should match that. A rebuild targeting **full vault contract** would add local fallback — out of scope unless explicitly requested.

## settings UI and navigation

### Entry points

| Flow | Behavior |
| --- | --- |
| First launch | `SetupScreen` → SAF directory picker → `saveUri` → `initEskerra` → `setSessionUri` → `MainTabs` |
| Settings screen | `SettingsTab` stack (hidden from bottom tab bar); opened from **Inbox** header gear (`InboxScreen` → `navigate('SettingsTab')`) |
| Change vault | Settings → **Change** link → `clearUri` + `setSessionUri(null)` → navigate `Setup` |

### Screen structure (`SettingsScreen`)

Single scrollable form (`ScrollView`), sections in order:

1. **Selected directory** — label + last path segment of SAF tree (see `getDirectoryLabel`) + **Change** link.
2. **Vault (synced)** — section title; hint: stored in `.eskerra/settings-shared.json`.
3. **Cloudflare R2 (optional)** — subsection; hint (`testID: settings-r2-hint`): values come from vault JSON; leave all empty to clear R2.
4. R2 fields (labels, hints, inputs) — see table below.
5. **This device** — section title; hint: `.eskerra/settings-local.json`, not synced with Git by default.
6. Display name, Device name inputs.
7. **Security note** — plain JSON credentials in vault; acceptable for private vaults; future server-side auth possible.
8. **Save changes** button (`testID: settings-save-button`); status text below.

### R2 form fields

| Label | Control | Placeholder / hint |
| --- | --- | --- |
| Endpoint URL | single-line, `autoCapitalize: none`, `autoCorrect: false` | Placeholder: `https://accountid.r2.cloudflarestorage.com`; hint: may paste full S3 API URL including `/bucket`; app normalizes |
| Data location (R2) | three chips: **Default**, **EU**, **FedRAMP** | Hint: EU buckets need EU S3 API host |
| Bucket | single-line | `Bucket name` |
| Access key ID | single-line, `secureTextEntry` | `Access key ID` |
| Secret access key | single-line, `secureTextEntry` | `Secret access key` |

### Local form fields

| Label | Control | Save transform |
| --- | --- | --- |
| Display name | single-line (`testID: settings-display-name`) | `trim()` |
| Device name | single-line | `trimEnd()` |

### Save sequence (`handleSave`)

1. `buildEskerraSettingsFromForm(r2Fields, previousShared)` — rebuild **must** pass `previousShared`.
2. On validation error → show message inline; do not persist.
3. `saveSettings(shared)` then `saveLocalSettings({ ...local, displayName, deviceName, preserve deviceInstanceId + playlist watermarks })`.
4. Normalize form from saved shared R2 (or clear R2 fields if removed).
5. Success message: `Settings saved.`

`useSettings` hook: wraps `VaultContext` + `writeSettings` / `writeLocalSettings` / `clearDirectory`; sets `isSaving` during async work.

### Settings UI (dark mode)

The reference `SettingsScreen` uses hardcoded StyleSheet colors (some light chip styling). The **rebuild** is dark-only. Use the same **semantic** structure with dark surfaces:

| Role | Suggested dark value (match mobile markdown/read patterns) |
| --- | --- |
| Primary text | `#f5f5f5` |
| Muted / hint / security note | `#cfcfcf` or `#737373` on elevated surface |
| Link / accent | `#3b82f6` |
| Input surface | dark fill + subtle border (`rgba(255,255,255,0.12)`) |
| Selected jurisdiction chip | accent border `#3b82f6`; fill `rgba(59,130,246,0.15)` |
| Unselected chip | border `rgba(255,255,255,0.12)` |

Section titles: 17px/700 and 15px/600 as in reference; labels `fontWeight: '600'`. Horizontal padding 24; bottom padding 32.

## shared settings fields mobile does not edit

The shared JSON schema includes fields used by **desktop** only. Mobile does not show UI for them but **must not destroy** them when rewriting `settings-shared.json`.

| Field | Desktop usage | Mobile read | Mobile write today |
| --- | --- | --- | --- |
| `themePreference` | Themes tab; R2 `theme-preference.json` | Parsed if present; ignored at runtime | **Risk:** stripped on save (no `previousShared`) |
| `frontmatterProperties` | Properties tab | Parsed if present; ignored | **Risk:** stripped on save |
| `linkSnippetBlockedDomains` | Editor link previews | Parsed if present; ignored | **Risk:** stripped on save |

**Rebuild rule:** always merge via `buildEskerraSettingsFromForm(fields, previousShared)` or equivalent unknown-key preservation.

## migration

| Trigger | Action |
| --- | --- |
| `.notebox/` exists, `.eskerra/` absent | Rename directory to `.eskerra/` |
| Only `settings.json` exists | Read legacy → write `settings-shared.json` (normalized) |
| Shared JSON contains `displayName` | Copy to `settings-local.json` if local empty → rewrite shared without key |
| Missing `deviceInstanceId` on session | Generate UUID → persist local settings |

Native prepare path (`VaultListingModule`) seeds the same default shared JSON string as `defaultEskerraSettings` when creating a fresh vault.

## security and copy

- R2 credentials are **plain JSON** in the synced vault folder.
- Settings UI must show an explicit security note (same meaning as current copy in `SettingsScreen`).
- Do not commit real secrets; mock placeholders only in defaults and dev fixtures.

## acceptance criteria (rebuild checklist)

### Vault I/O

- [ ] SAF tree URI persisted under `notesDirectoryUri`.
- [ ] `initEskerraVault` creates `.eskerra/`, default shared + local files when missing.
- [ ] Legacy `.notebox` and `settings.json` migrations match `@eskerra/core` tests.
- [ ] `readSettings` / `writeSettings` / `readLocalSettings` / `writeLocalSettings` round-trip matches `apps/mobile/__tests__/eskerraStorage.test.ts`.

### Settings UI

- [ ] All form fields and hints listed above present.
- [ ] R2 partial fill rejected with exact validation message.
- [ ] Clearing all R2 fields writes `{}` or shared object without `r2`.
- [ ] EU / FedRAMP jurisdiction persists and affects `effectiveR2Endpoint` (core tests).
- [ ] Save preserves `deviceInstanceId` and playlist watermarks.
- [ ] Save preserves `themePreference` / `frontmatterProperties` / `linkSnippetBlockedDomains` when present.
- [ ] Change directory clears AsyncStorage URI and returns to setup.
- [ ] Dark mode styling applied (no light-gray chip selected state as default).

### R2 playlist

- [ ] `isVaultR2PlaylistConfigured` gates read/write.
- [ ] Without R2: `readPlaylist` → `null`, `writePlaylist` → `skipped`.
- [ ] With R2: signed GET/PUT/DELETE to `playlist.json` (presigned query).
- [ ] Supersede path when remote newer than local watermarks.
- [ ] Watermarks updated after successful R2 read/write.
- [ ] ETag poll ~1s in foreground, paused while playing.
- [ ] Poller: no overlapping requests; immediate tick on activate; abort in-flight on deactivate.
- [ ] Poller: `onRemotePlaylistCleared` fires only on present→absent, never first-boot missing.
- [ ] Conditional GET maps 304→not_modified, 404/empty→missing, else updated+etag.
- [ ] Merge functions match core tests (`normalizePlaylistEntryForSync`, `pickNewerPlaylistEntry`, `isRemotePlaylistNewerThanKnown`, `buildPlaylistEntryForWrite`).
- [ ] `playlistSyncGeneration` triggers player re-sync when not playing.
- [ ] `clearPlaylist` deletes R2 object and local legacy file.
- [ ] Serialized playlist + settings JSON are pretty-printed (2-space) with a trailing newline.

### Tests to port or re-run

| Area | Reference tests |
| --- | --- |
| Settings parse/serialize | `packages/eskerra-core/src/eskerraSettings.test.ts` |
| Local settings | `packages/eskerra-core/src/eskerraLocalSettings.test.ts` |
| R2 playlist object/conditional | `packages/eskerra-core/src/r2PlaylistObject.test.ts`, `r2PlaylistConditional.test.ts` |
| Mobile storage | `apps/mobile/__tests__/eskerraStorage.test.ts` |
| Settings screen | `apps/mobile/__tests__/HomeScreen.test.tsx` (SettingsScreen cases) |
| R2 polling hook | `apps/mobile/__tests__/usePlaylistR2ActivePolling.test.tsx` |
| Player + playlist sync | `apps/mobile/__tests__/usePlayer.test.ts` |

## reference implementation map

| Concern | Primary files |
| --- | --- |
| Types / parse / R2 URL helpers | `packages/eskerra-core/src/eskerraSettings.ts`, `eskerraLocalSettings.ts`, `r2Settings.ts` |
| R2 HTTP | `packages/eskerra-core/src/r2PlaylistObject.ts`, `r2PlaylistConditional.ts` |
| Playlist merge / write builder | `packages/eskerra-core/src/playlist.ts` |
| ETag poller | `packages/eskerra-core/src/playlistEtagPoller.ts` |
| Vault init / shared read | `packages/eskerra-core/src/initEskerraVault.ts`, `readVaultSharedSettings.ts` |
| Mobile SAF storage | `apps/mobile/src/core/storage/eskerraStorage.ts` |
| Settings UI | `apps/mobile/src/features/settings/screens/SettingsScreen.tsx` |
| Settings hook | `apps/mobile/src/features/settings/hooks/useSettings.ts` |
| Session bootstrap | `apps/mobile/src/core/vault/applyVaultSession.ts`, `apps/mobile/App.tsx` |
| Player + R2 | `apps/mobile/src/features/podcasts/hooks/usePlayer.ts` |
| R2 polling | `apps/mobile/src/features/podcasts/hooks/usePlaylistR2ActivePolling.ts`, `PlaylistR2PollingHost.tsx` |
| Setup / vault pick | `apps/mobile/src/features/setup/screens/SetupScreen.tsx` |
| URI persistence | `apps/mobile/src/core/storage/appStorage.ts` |
| Desktop save parity (previousShared) | `apps/desktop/src/components/SettingsContent.tsx` |

## future notes (not in current mobile)

- Desktop [`specs/plans/desktop-settings-workspace.md`](desktop-settings-workspace.md) may move more settings into R2 `app-settings.json` with vault mirror fallback. A future Android app sharing vaults with desktop should track that plan before assuming `settings-shared.json` shape stops at R2 + legacy keys.
- Server-mediated R2 credentials (known-risks §9 future direction).
