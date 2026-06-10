# Sentry Android: source maps and symbolicated stack traces

This document explains why JavaScript stack traces in Sentry sometimes show minified bundle locations (`index.android.bundle`, `InternalBytecode.js`) instead of your TypeScript files, and what you need to fix it. It applies to the Eskerra React Native app using Hermes and `@sentry/react-native`.

**Monorepo paths:** Android Gradle and Kotlin live under [`apps/mobile/android/`](apps/mobile/android/). TypeScript sources for the mobile app live under [`apps/mobile/src/`](apps/mobile/src/).

---

## Why stacks stay “minified”

The app sends **events** (errors, messages, breadcrumbs) to Sentry using the **DSN**. That is enough for **logging and grouping issues**.

**Sentry does not fetch your bundle from the device.** Stack frames use virtual URLs such as `app:///index.android.bundle`. In the event payload you may see errors like `js_no_source` / `missing_source` and scraping failures such as `app is not an allowed download scheme`. That is expected: the server cannot download `app://` URLs from the internet.

To turn column/line positions in the bundled file into **file names and lines in your source**, Sentry needs **artifacts uploaded at build time**:

- JavaScript **source maps** for the bundle (and the composed Hermes pipeline output).
- For Hermes, related **debug** metadata (often tied to **Debug IDs** in modern setups) so symbolication works end-to-end.

Those uploads are performed by **`sentry-cli`**, invoked from the **Android Gradle** integration (`sentry.gradle` during `assembleRelease`), not from the running app.

**Rule of thumb:** no matching artifacts for your **`release` + `dist`** in the Sentry project → stacks stay symbolicated as the bundle (or show missing-source warnings).

---

## DSN vs `SENTRY_AUTH_TOKEN`

| Credential | Where it lives | When it is used | Purpose |
|------------|----------------|-----------------|--------|
| **DSN** | Root `.env` as `SENTRY_DSN`, read at bundle time into `src/core/observability/sentryDsn.ts` via `@env` (see `.env.example`) | **Runtime** (device) | Send events to Sentry |
| **`SENTRY_AUTH_TOKEN`** | Same as any shell env: export before Gradle, set in CI secrets, **or** put it in the repo root **`.env`** (gitignored) and run `scripts/build-apk-release.sh`, which sources `.env` for the Gradle process. Alternatively `auth.token` in `android/sentry.properties` (local only; do not commit secrets) | **Build time** (`assembleRelease`, CI) | Authorize `sentry-cli` to **upload** source maps and related debug files |

- The DSN is **not** sufficient for source map upload.
- The auth token must **never** be embedded in the app binary.

For more on when upload runs and how local builds skip it without a token, see [specs/observability/phase-1-slice-implemented.md](../specs/observability/phase-1-slice-implemented.md) (Android release builds and Sentry upload).

---

## `release` and `dist` must match events and uploads

Sentry ties uploaded artifacts to a **`release`** string and usually a **`dist`** (build number). **The values on events from the app must match the values used when source maps were uploaded.**

### What the app sends today

In `apps/mobile/src/core/observability/registerSentry.ts`, the SDK sets:

- `release`: `eskerra@<version>` where `<version>` comes from `apps/mobile/package.json` (for example `eskerra@0.0.1`).

Events may also include **`dist`** (for example `1`) from the native layer, aligned with Android `versionCode` when configured.

### What Gradle uploads by default

The Sentry React Native Gradle script (`node_modules/@sentry/react-native/sentry.gradle`) builds a default release name unless overridden:

- `defaultReleaseName = "${applicationId}@${versionName}+${versionCode}"`

For this project’s `apps/mobile/android/app/build.gradle`, with `applicationId "com.eskerra"`, `versionName "1.0"`, and `versionCode 1`, that is:

- **`com.eskerra@1.0+1`**

You can override upload naming with environment variables such as **`SENTRY_RELEASE`** and **`SENTRY_DIST`** (see Sentry’s React Native / Gradle docs).

### Why this matters

If uploads are stored under **`com.eskerra@1.0+1`** but events are tagged with **`eskerra@0.0.1`**, Sentry will **not** find the right source maps for those events, even when uploads succeed.

**Action:** use **one** convention for `release` (and `dist`) across:

1. JavaScript `Sentry.init` (or native auto-release, if you stop overriding in JS), and  
2. The Gradle upload (or explicit `SENTRY_RELEASE` / `SENTRY_DIST` in CI).

Aligning these is a **follow-up code/CI change** (separate from this doc).

---

## Local release builds without a token

This repository intentionally allows **release builds to succeed** when no Sentry auth is configured: the Gradle logic in `apps/mobile/android/app/build.gradle` skips the Sentry upload task unless `SENTRY_AUTH_TOKEN` or `auth.token` is present.

In that situation:

- The APK builds.
- **No** source maps (or Hermes debug files) are uploaded for that build.
- You should **expect** non-symbolicated or partially symbolicated JS stacks in Sentry for builds produced that way.

To get symbolicated stacks for a given release, run a **release** build **with** upload enabled and a matching `release`/`dist`.

---

## Checklist: symbolicated stacks for Android

1. **Decide** the canonical `release` and `dist` for the app (and align JS init with Gradle / `SENTRY_*` env vars as needed).
2. **Set** `SENTRY_AUTH_TOKEN` in CI (recommended) or use a **local** `auth.token` in `android/sentry.properties` (never commit the token).
3. Run **`./gradlew assembleRelease`** (or your release pipeline) so the Sentry Gradle tasks run and upload artifacts.
4. In the **Sentry** UI, open **Releases** (or source map / debug file views for your project) and confirm artifacts exist for the **same** `release` (and `dist`) as your events.
5. Trigger a test event from a build that uses that release and confirm stack frames map to source files.

---

## Related reading

- [specs/observability/phase-1-slice-implemented.md](../specs/observability/phase-1-slice-implemented.md) — what was implemented for observability, Gradle upload gating, and auth.
- Official docs: Sentry React Native (source maps, Hermes, releases).

---

## Follow-up: align `release` / `dist` (separate change)

Track these in a dedicated PR when you are ready:

1. Make **JavaScript** `Sentry.init` `release` (and `dist` if set) match **Gradle** upload defaults, **or** set `SENTRY_RELEASE` / `SENTRY_DIST` in CI to match `eskerra@…` from `package.json`, consistently everywhere.
2. Re-run a **release** build with **`SENTRY_AUTH_TOKEN`** and verify artifacts in Sentry for the **exact** release string shown on events.

Until then, expect symbolication issues if event `release` and upload `release` differ.
