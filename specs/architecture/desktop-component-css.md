# Desktop L3 component CSS

This document records **product-level (L3) styling conventions** for the desktop app (`apps/desktop/src/`). It complements implementation details that already live in code and in editor-focused specs.

## Policy

- **New** React components in `apps/desktop/src/` should use **CSS Modules**: colocate `ComponentName.module.css`, `import styles from './ComponentName.module.css'`, and apply classes via the `styles` object.
- **No mandatory big-bang migration:** existing plain `import './Foo.css'` files and [`App.css`](../../apps/desktop/src/App.css) stay valid until a change naturally touches them.

## Relation to L2 design system

Desktop primitives live in **`@eskerra/ds-desktop`** (`packages/eskerra-ds-desktop/`), which **already uses CSS Modules** per [`specs/design/design-system-architecture.md`](../design/design-system-architecture.md). L3 feature code composes those primitives; new L3-only layout or chrome can use modules without moving logic into the design system.

## When styles stay global

Some surfaces rely on **stable global class names** or cross-cutting selectors. Do **not** force modules there without a deliberate refactor:

- **CodeMirror** decorations and theme classes (`cm-*`, editor widgets). Authoritative behavior and many selectors are documented in [`desktop-editor.md`](desktop-editor.md); global rules often live in [`App.css`](../../apps/desktop/src/App.css).
- **Typography and smoothing** rules tied to capture chrome, lists, and palettes are cataloged in [`desktop-text-rendering.md`](../design/desktop-text-rendering.md), with references to `App.css` where applicable.

Adding or changing those contracts still belongs in the relevant spec sections when behavior or selectors change.

## Colocation and `App.css`

Agent-facing conventions (same-folder colocation, single importer, **shrinking** `App.css`, when to use plain `.css` vs modules, `:global` guidance) live in **`.cursor/rules/css-colocation.mdc`**. Follow that rule when editing desktop styles.
