> [!WARNING]
> Still in early development

<p align="center">
  <img src="./assets/brand/eskerra-logo.png" alt="Eskerra logo" width="120"><br>
</p>

<h1 align="center">Eskerra</h1>

<p align="center">
  Eskerra is a <strong>notes + podcast</strong> companion with two apps in one repo:
</p>

| App | Location | Stack |
| --- | --- | --- |
| **Mobile** | [`apps/mobile/`](apps/mobile/) | React Native (**Android only**) |
| **Desktop** | [`apps/desktop/`](apps/desktop/) | Tauri 2 + Vite + React (Linux-first; Fedora / GNOME is the reference) |
| **Shared logic** | [`packages/eskerra-core/`](packages/eskerra-core/) | TypeScript (vault paths, settings, `VaultFilesystem`, audio types) |

Both apps use the same **vault layout** on disk: user-chosen root folder, then `Inbox/`, `General/`, and `/.eskerra/settings-shared.json` plus per-device `/.eskerra/settings-local.json` (see [`specs/architecture/desktop-mobile-parity.md`](specs/architecture/desktop-mobile-parity.md)).

---

## Prerequisites (all developers)

- **Node.js** `>= 24.0.0` and **npm**
- From the **repository root**, run **`npm install`** once (workspaces hoist dependencies).

---

## Quick commands (run from repo root)

| Command | What it does |
| --- | --- |
| `npm run mobile` | Start Metro for the Android app |
| `npm run mobile:android` | Build/run the Android app on a device or emulator |
| `npm run desktop` | **Desktop:** `tauri dev` (Vite + native window) |
| `npm run desktop:build` | **Desktop:** release semver bump (same rules as APK) + production web build + `tauri build` |
| `npm test` | `@eskerra/core` (Vitest) + `@eskerra/tokens` + `@eskerra/ds-desktop` + `@eskerra/ds-mobile` + mobile RN-Web Storybook **build** + mobile (Jest) + release helper tests |
| `npm run storybook:desktop -w @eskerra/ds-desktop` | Desktop design system Storybook (web, Vite) |
| `npm run storybook:android -w @eskerra/mobile` | Mobile design system Storybook **on-device** (separate Metro entry) |
| `npm run storybook:web -w @eskerra/ds-mobile` | Mobile DS Storybook **RN-Web** (docs / fast review, port 6007) |
| `npm run test:storybook-web` | Playwright + test-runner against static RN-Web Storybook (downloads Chromium on first run) |
| `npm run lint` | ESLint for mobile + desktop |

Workspace-scoped scripts (same as above, explicit):

```bash
npm run start -w @eskerra/mobile
npm run desktop:dev -w @eskerra/desktop
```

---

## Mobile (Android)

### What the mobile app does

- Select a Notes directory with the Android folder picker (SAF).
- Persist the selected tree URI in AsyncStorage.
- Create/update `/.eskerra/settings-shared.json` (optional R2 fields only on the shared file) and `/.eskerra/settings-local.json` for per-device `deviceName` and `displayName` (both default to empty strings).
- Debug APK build/install scripts live under [`scripts/`](scripts/) and call Gradle in [`apps/mobile/android/`](apps/mobile/android/).

### Extra prerequisites (Android only)

- Java 17
- Android Studio (SDK + emulator tools)
- `adb` on `PATH`, `ANDROID_HOME` set

For installs on a physical device: enable Developer Options and USB debugging.

### Local development (emulator + Fast Refresh)

1. Start an Android emulator (AVD Manager).
2. Terminal 1 — Metro:

   ```bash
   npm run mobile
   ```

3. Terminal 2 — run the app:

   ```bash
   npm run mobile:android
   ```

Press `r` in the Metro terminal for a full reload if Fast Refresh gets stuck.

### Build APK and install on a phone

**Debug** (expects Metro in dev; for quick installs):

```bash
npm run build:apk -w @eskerra/mobile
npm run install:apk -w @eskerra/mobile
# or both:
npm run apk -w @eskerra/mobile
```

APK output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**Release** (JS bundled into the APK; no Metro on the device):

```bash
npm run build:apk-release -w @eskerra/mobile
npm run install:apk-release -w @eskerra/mobile
npm run apk-release -w @eskerra/mobile
```

APK output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

The release flow runs [`scripts/bump-release-version.mjs`](scripts/bump-release-version.mjs) first (see script comments): [`build-apk-release.sh`](scripts/build-apk-release.sh) calls it directly; `npm run desktop:build` runs it via [`scripts/tauri-desktop-build.mjs`](scripts/tauri-desktop-build.mjs). Debug APK builds do **not** bump versions.

Release signing defaults to the **debug keystore** in [`apps/mobile/android/app/build.gradle`](apps/mobile/android/app/build.gradle) — fine for local testing, not for Play Store.

### First-launch check (mobile)

1. Open the app, tap **Choose Notes Directory**, pick a folder.
2. Confirm `/.eskerra/settings-shared.json` (and `settings-local.json`) exist after first init.
3. Change `displayName`, save, force-close and reopen to verify persistence.

If Android revokes SAF access, the app should clear the saved URI and send you back to setup.

---

## Desktop (Tauri)

The desktop app is optional for mobile-only work. To run it you need:

1. **Rust** (e.g. [rustup](https://rustup.rs/) `stable`) — Tauri builds the native shell with Cargo.
2. **Linux system libraries** for WebKitGTK and GTK (Tauri’s webview and GUI stack). Follow the official list: [Tauri: Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

### Fedora (common reference)

Install the dependencies Tauri documents for Fedora, then the **C development** group:

```bash
sudo dnf check-update
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl wget file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel
sudo dnf group install "c-development"
```

If `cargo` / `tauri dev` fails with **`gdk-sys` / `pango-sys` not found** (missing `gdk-3.0.pc` / `pango.pc`), install GTK/Pango development packages explicitly:

```bash
sudo dnf install gtk3-devel pango-devel
```

Then from the **repo root**:

```bash
npm run desktop
```

This runs `desktop:dev` in [`apps/desktop`](apps/desktop/) (`tauri dev`: starts Vite and the native window).

Production-style build:

```bash
npm run desktop:build
```

Vault selection, `.eskerra` settings, inbox notes, MP3 streaming, and Linux **MPRIS** (play/pause from GNOME) are described in [`specs/architecture/desktop-mobile-parity.md`](specs/architecture/desktop-mobile-parity.md).

---

## Tests and lint

```bash
npm test
npm run lint
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 only** (**AGPL-3.0-only**). See the [`LICENSE`](LICENSE) file in the repository root for the full license text.

In practical terms:

- **Sharing copies (binaries, APKs, RPMs, etc.):** If you give others a copy of this program or a work based on it, AGPL requires that you also give them the **corresponding source code** under the same license (and preserve license/copyright notices), in the ways described in the license.
- **Network / “as-a-service” use:** AGPL adds a specific rule for **modified** versions you **run** as a service: if users interact with your modified version **remotely through a network**, you must offer them the **corresponding source** of your version, in line with section 13 of the license. (This is the main difference from GPLv3: it is meant to cover “users get the functionality over the network” the same way GPLv3 covers “users get a binary on their machine.”)
- **Dependencies:** This repository also uses third-party libraries under their own licenses (see each package and lockfile). Your obligations under AGPL apply to **this project’s code** and how you convey or operate modified versions of it as described above.

This is a short summary, not legal advice. For exact terms, read [`LICENSE`](LICENSE) and consider consulting a lawyer for your situation.

---

## Known limitations

- **Mobile:** Android only (see [`specs/architecture/platform-targets.md`](specs/architecture/platform-targets.md)).
- **Desktop:** developed and tested primarily on **Linux**; other OS targets are best-effort upstream behavior.
- No sync service, backend, or multi-device coordination beyond sharing the same folder (for example via Syncthing) and the shared vault files.

---

## More documentation

- Architecture: [`specs/architecture/`](specs/architecture/)
- Desktop vs mobile contract: [`specs/architecture/desktop-mobile-parity.md`](specs/architecture/desktop-mobile-parity.md)

---

## Philosophy

I want a Markdown app that is fast, predictable, and works out of the box. 
No plugins required for the basics, no waiting, no hidden complexity.

This project is built around that idea. 


| Tool | Core Idea | Strength | Trade-off |
|------|----------|----------|-----------|
| **This App**  | Markdown runtime | **Fast, predictable, no setup** | Fewer features |
| **Obsidian**  | Knowledge system | Flexible, huge plugin ecosystem | Complexity & inconsistency |
| **Joplin**  | Open notebook | Fully FOSS, reliable sync | Clunky UX |
| **Logseq**  | Outliner / graph | Powerful linking & structure | Performance, learning curve |
| **iA Writer** ️ | Writing tool | Clean, focused experience | Limited features |
| **Zettlr**  | Academic editor | Strong for long-form & research | Heavy, slower UI |

---

<p align="center">
   Apps fade. Markdown remains.<br> 
   Like stones in a riverbed.
</p>
