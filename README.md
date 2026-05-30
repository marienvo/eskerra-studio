> [!WARNING]
> Still in early development.

> [!NOTE]
> Mobile is moving out of this repository. The old React Native mobile app is
> being replaced by the native Kotlin Android app in sibling repo `eskerra-go`;
> this repo is now described as the desktop-focused Eskerra Studio codebase.

<p align="center">
  <img src="./assets/brand/eskerra-logo.png" alt="Eskerra logo" width="120"><br>
</p>

<h1 align="center">Eskerra Studio</h1>

<p align="center">
  Eskerra Studio is a <strong>local-first Markdown desktop editor</strong> for
  focused, keyboard-driven work on a vault you control.
</p>

| App | Location | Stack |
| --- | --- | --- |
| **Desktop** | [`apps/desktop/`](apps/desktop/) | Tauri 2 + Vite + React (Linux-first; Fedora / GNOME is the reference) |
| **Shared logic** | [`packages/eskerra-core/`](packages/eskerra-core/) | TypeScript (vault paths, settings, `VaultFilesystem`, audio types) |
| **Mobile** | sibling repo `eskerra-go` | Kotlin + Jetpack Compose for Android |

Eskerra Studio uses the shared **vault layout** on disk: user-chosen root folder,
then `Inbox/`, `General/`, and `/.eskerra/settings-shared.json` plus per-device
`/.eskerra/settings-local.json`. The Android companion in `eskerra-go` is the
mobile implementation of that contract; historical background still lives in
[`specs/architecture/desktop-mobile-parity.md`](specs/architecture/desktop-mobile-parity.md).

---

## Prerequisites

- **Node.js** `>= 24.0.0` and **npm**
- **Rust** stable, for Tauri's native shell
- Linux system libraries for WebKitGTK and GTK; see [Tauri: Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
- From the **repository root**, run **`npm install`** once; workspaces hoist dependencies

---

## Quick commands

Run from the repo root.

| Command | What it does |
| --- | --- |
| `npm run desktop` | Starts Eskerra Studio with `tauri dev` (Vite + native window) |
| `npm run desktop:build` | Runs the desktop release helper, production web build, and `tauri build` |
| `npm run storybook:desktop` | Starts the desktop design-system Storybook |
| `npm test` | Runs the current repository gate: lint, desktop metainfo validation, workspace unit tests, Storybook static builds, and release helper checks. Requires `appstreamcli` on PATH for metainfo validation. |
| `npm run lint` | Runs ESLint and architecture checks for the current workspaces |
| `npm run ci:all` | Runs `npm test`, then `npm run desktop:build` |

Workspace-scoped desktop script:

```bash
npm run desktop:dev -w @eskerra/desktop
```

---

## Desktop (Tauri)

### Fedora reference setup

Install the dependencies Tauri documents for Fedora, then the **C development**
group:

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

If `cargo` or `tauri dev` fails with **`gdk-sys` / `pango-sys` not found**
(missing `gdk-3.0.pc` / `pango.pc`), install GTK/Pango development packages
explicitly:

```bash
sudo dnf install gtk3-devel pango-devel
```

Then start the app:

```bash
npm run desktop
```

Production-style build:

```bash
npm run desktop:build
```

The desktop app is developed and manually tested primarily on Fedora / GNOME.
The Tauri Linux bundle configuration is RPM-oriented.

---

## Vault layout

The desktop app works directly against a user-selected vault directory.

```text
Vault root/
  Inbox/
  General/
  .eskerra/
    settings-shared.json
    settings-local.json
```

- `Inbox/` stores quick-capture and inbox notes.
- `General/` stores general notes and podcast-related markdown used by the
  current app model.
- `.eskerra/settings-shared.json` is vault-scoped shared settings.
- `.eskerra/settings-local.json` is per-device local state and should not be
  treated as portable account data.

For mobile vault behavior, use the native Android implementation in sibling
repo `eskerra-go`.

---

## Tests and lint

```bash
npm test
npm run lint
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 only**
(**AGPL-3.0-only**). See the [`LICENSE`](LICENSE) file in the repository root for
the full license text.

In practical terms:

- **Sharing copies (binaries, RPMs, etc.):** If you give others a copy of this
  program or a work based on it, AGPL requires that you also give them the
  **corresponding source code** under the same license and preserve
  license/copyright notices, in the ways described in the license.
- **Network / "as-a-service" use:** AGPL adds a specific rule for **modified**
  versions you **run** as a service: if users interact with your modified
  version **remotely through a network**, you must offer them the
  **corresponding source** of your version, in line with section 13 of the
  license.
- **Dependencies:** This repository also uses third-party libraries under their
  own licenses. Your obligations under AGPL apply to **this project's code** and
  how you convey or operate modified versions of it as described above.

This is a short summary, not legal advice. For exact terms, read
[`LICENSE`](LICENSE) and consider consulting a lawyer for your situation.

---

## Known limitations

- **Desktop:** developed and tested primarily on **Linux**; other OS targets are
  best-effort upstream behavior.
- **Packaging:** Fedora/RPM is the product target for desktop builds.
- **Mobile:** see sibling repo `eskerra-go`.
- No sync service or backend is part of Eskerra Studio. Multi-device use depends
  on sharing the same vault folder through another tool, such as Syncthing.

---

## More documentation

- Architecture: [`specs/architecture/`](specs/architecture/)
- Historical desktop/mobile contract: [`specs/architecture/desktop-mobile-parity.md`](specs/architecture/desktop-mobile-parity.md)

---

## Philosophy

I want a Markdown app that is fast, predictable, and works out of the box.
No plugins required for the basics, no waiting, no hidden complexity.

Eskerra Studio is built around that idea.

Openness is part of the product. Tools people rely on should not disappear
behind a company's roadmap, patience, or survival. When software becomes part of
people's notes, habits, and workflows, the value built around it should remain in
people's hands.

| Tool | Core Idea | Strength | Trade-off | Source |
| --- | --- | --- | --- | --- |
| **Eskerra Studio** | Markdown desktop runtime | **Fast, predictable, no setup** | Fewer features | ✅ FOSS, AGPL-3.0 |
| **Obsidian**  | Knowledge system | Flexible, huge plugin ecosystem | Complexity & inconsistency | 🏢 Proprietary    |
| **Joplin**  | Open notebook | Private, cross-platform notes with mature sync | More notebook-oriented than writing-oriented | ✅ FOSS, AGPL-3.0 |
| **Logseq**  | Outliner / graph | Powerful linking & structure | Performance, learning curve | ✅ FOSS, AGPL-3.0 |
| **iA Writer** | Writing tool | Clean, focused experience | Limited features | 🏢 Proprietary    |
| **Zettlr**  | Academic editor | Strong for long-form & research | Heavier, slower UI | ✅ FOSS, GPL-3.0  |

---

<p align="center">
   Apps fade. Markdown remains.<br>
   Like stones in a riverbed.
</p>
