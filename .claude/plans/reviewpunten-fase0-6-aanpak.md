# Aanpak reviewpunten fase 0–6

**Bron:** reviewsectie onderaan `useMainWindowWorkspace-decompositie.md`
**Datum:** 2026-05-16
**Doel:** alle open ⚠/✗-punten uit de reviews van fase 0–6 stap-voor-stap wegwerken, in de juiste volgorde, zodat fase 7–10 op een schone basis kunnen starten.

---

## Overzicht open punten per fase

| Fase | Punt | Ernst |
|---|---|---|
| 0 | ADR mist invarianten-checklist en `__resetForTests()` beleid | ⚠ klein |
| 0 | Smoke-test CWD-vereiste niet gedocumenteerd in ADR | ⚠ klein |
| 1 | `mergeStoredHubWorkspaces` nog aanwezig (r.3120) | ✗ open |
| 1 | `projectWorkspaceRuntimeToModel` + divergentie-checks nog aanwezig (r.2083) | ✗ open |
| 1 | `workspaceHomeHistoryShadowSync` bridges nog aanwezig | ✗ open |
| 1 | `workspaceRuntimeTabsLegacyBridge` 3× aanwezig (main-hook, editorHistory, openMarkdown) | ✗ open + uitgebreid door fase 6 |
| 1 | `workspaceRuntimeActiveLegacyBridge` 2× aanwezig (main-hook, todayHubSwitch) | ✗ open |
| 4 | tree-commands volledig overgeslagen (~600 LOC in hoofdhook) | ✗ niet gestart |
| 6 | op feature-branch; test-dekking dun voor risico-paden | ⚠ merge-blokkade |
| 6 | `workspaceOpenMarkdownCommand.ts` importeert `assignLegacyEditorWorkspaceTabs` | ⚠ bridge-propagatie |

---

## Stappenvolgorde en afhankelijkheden

```
Stap 0  ─────────────────────────────────────────────────────► (parallel, onblokkerend)
Stap 1 ─────────────────────────────────────────────────────► (fase 6 tests op feature-branch)
Stap 3a → Stap 3b → Stap 3c
                            ↓
                     Stap 2 (fase 6 alleen mergen zonder nieuwe bridge-erfenis)
                            ↓
                      Stap 3d → Stap 3e
                                       ↓
                                 Stap 4a → Stap 4b → Stap 4c → Stap 4d
                                                                    ↓
                                                                Stap 5
```

Stap 0 kan parallel aan stap 1 lopen. Stap 3a–3c hoeven niet te wachten op Fase 6-merge; ze verkleinen juist het oppervlak dat Fase 6 moet meedragen. Pas vanaf stap 2 wordt de Fase 6 branch weer onderdeel van de hoofdvolgorde.

---

## Stap 0 — ADR aanvullen (documentatie)

**Reviewpunten:** fase 0 ⚠ (invarianten-checklist), fase 6 cross-phase bevinding 7 (`__resetForTests()`)
**PR:** klein, zelfstandig
**Aanbevolen modellen:** `GPT-5.4-Mini`, `Composer 2`, of `Claude Haiku 4.5` — **low**
**Geblokkeerd door:** niets
**Blokkeert:** niets (documentatie)

### Wat te doen

1. Open `specs/adrs/002-adr-main-window-workspace-decompositie.md`.
2. Voeg een sectie **"Invarianten-checklist per fase"** toe met vier punten die elke PR-beschrijving moet afvinken:
   - Note-body cache invariant (`CLAUDE.md` "Desktop: Note body cache"): `inboxContentByUri`, `lastPersistedRef`, `lastPersistedExternalMutationSeqRef` altijd samen bijgewerkt.
   - Vault disk sync invariant (`CLAUDE.md` "Desktop: Vault disk sync invariants"): watcher-routing, cache-invalidatie, conflict-classificatie.
   - Vitest isolation (`CLAUDE.md` "Desktop Vitest isolation"): `restoreMocks: false`, `isolate: true`, geen Tauri in `vitest.setup.ts`.
   - CodeMirror layout: `padding` in plaats van `margin` op `.cm-line`/decoraties/block-widget-roots.
3. Voeg een sectie **"Test-uitvoering"** toe: smoke-test vereist `apps/desktop` als CWD (`cd apps/desktop && npx vitest run`); vanuit repo-root faalt met "document is not defined" door happy-dom.
4. Voeg een sectie **"`__resetForTests()` beleid"** toe: state-store sub-hooks worden via `renderHook` getest; `__resetForTests()` is alleen vereist voor modules met module-scope mutable state die via `vitest.setup.ts` worden geladen. Huidige sub-hooks (useVaultBootstrap, useDiskConflictState, enz.) vallen in de eerste categorie — geen `__resetForTests()` nodig tenzij ze Tauri aan top-level importeren.

---

## Stap 1 — Fase 6: extra tests op risico-paden

**Reviewpunten:** fase 6 ⚠ test-dekking dun
**Branch:** `extract-useEditorTabsState-workspaceOpenMarkdownCommand.ts` (al open)
**Aanbevolen modellen:** `GPT-5.3 Codex`, `Composer 2`, of `Claude Sonnet 4.6` — **med**
**Geblokkeerd door:** niets (branch is al open)
**Blokkeert:** stap 2

### Wat te doen

Voeg vier tests toe aan `apps/desktop/src/hooks/workspaceOpenMarkdownCommand.test.ts`:

1. **Prefetch + disk-read pad:** `tryPrefetchTargetBody` slaagt → `inboxContentByUri` voor target-URI bijgewerkt vóór `loadOpenedNoteBodyAndApplySelection` wordt aangeroepen. Test dat de cache-update plaatsvindt en dat `lastPersistedRef` correct meegaat.

2. **`snapshotAndPersistCurrentNoteBeforeOpen` met composing-guard:** als `composingNewEntry === true`, mag snapshot/persist niet worden uitgevoerd. Test dat de mock-persist niet wordt aangeroepen bij een open compose-flow.

3. **Placement-varianten:** `insertAtIndex` en `insertAfterActive` leiden tot correcte tabpositie na `applyBackgroundNewTabOpen`. Test beide opties met een mock tab-strip van drie tabs.

4. **Generation-cancel:** als `openMarkdownGenerationRef.current` verhoogd wordt tussen twee aanroepen van `runOpenMarkdownInEditorCommand`, annuleert de eerste aanroep zodra de tweede begint. Test via twee opeenvolgende calls zonder await (race-simulatie met mock promise).

Alle vier tests moeten groen zijn op de feature-branch vóór stap 2.

---

## Stap 2 — Fase 6 afronden zonder nieuwe bridge-erfenis op `main`

**Reviewpunten:** fase 6 ⚠ bridge-propagatie
**Branch:** `extract-useEditorTabsState-workspaceOpenMarkdownCommand.ts`
**Aanbevolen modellen:** `GPT-5.5`, `GPT-5.3 Codex`, `Composer 2`, of `Claude Opus 4.7` — **high**
**Geblokkeerd door:** stap 1 en idealiter stap 3c
**Blokkeert:** stap 3d

### Wat te doen

1. Rebase de feature-branch op de uitkomst van stap 3a–3c, zodat shell-restore en home-history cleanup niet nogmaals op de branch hoeven te worden opgelost.
2. Verwijder de dependency op `assignLegacyEditorWorkspaceTabs` in `workspaceOpenMarkdownCommand.ts` vóór merge. Als dat pas samen met stap 3d schoon kan, merge Fase 6 dan via een korte integratiebranch waarin Fase 6 + stap 3d samen landen.
3. Controleer of smoke-test + alle module-tests groen zijn (run vanuit `apps/desktop/`).
4. Merge pas naar `main` wanneer `workspaceOpenMarkdownCommand.ts` geen nieuwe legacy-bridge-aanroep meer introduceert.

`main` mag na deze stap niet slechter af zijn dan vóór Fase 6. Een TODO-comment op een nieuwe bridge-call is acceptabel als tijdelijke branch-markering, niet als geplande merge-strategie.

---

## Stap 3a — Fase 1.4a: `mergeStoredHubWorkspaces` verwijderen (TDD)

**Reviewpunten:** fase 1 ✗ substap 4 (smalste oppervlak eerst)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.5`, `Claude Opus 4.7`, of `Composer 2` — **high**
**Geblokkeerd door:** niets buiten reguliere branch-beschikbaarheid; kan direct na stap 0 lopen
**Blokkeert:** stap 3b

### Wat te doen

1. **Schrijf eerst een falende test** in `workspaceShellRestoreModel.test.ts` (nieuw bestand als het nog niet bestaat). Test asserteert dat het JSON→model-pad via `serializeWorkspaceModelToPersistence` / `workspaceModel`-reducers correct werkt voor vier scenario's:
   - (a) lege vault, geen hubs
   - (b) één hub met actieve tab
   - (c) meerdere hubs waarvan één inactief met snapshot
   - (d) home-history per hub bewaard na restore
   Laat de test eerst falen door de `mergeStoredHubWorkspaces`-aanroep tijdelijk uit te commentariëren.
2. Maak de test groen door de `mergeStoredHubWorkspaces`-aanroep in `useMainWindowWorkspace.ts:3120` te verwijderen en het model-pad te laten werken.
3. Verwijder vervolgens de `mergeStoredHubWorkspaces`-functie zelf als er geen andere aanroepsites zijn.
4. **On-device verificatie:** vault openen, hubs wisselen, shell-restore via app-restart. Documenteer in PR-body.
5. Bestaande tests in `workspaceInboxShellRestoreBridge.test.ts` moeten blijven slagen.

---

## Stap 3b — Fase 1.4b: `projectWorkspaceRuntimeToModel` + divergentie-checks verwijderen (TDD)

**Reviewpunten:** fase 1 ✗ substap 4
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.5`, `Claude Opus 4.7`, of `Composer 2` — **high**
**Geblokkeerd door:** stap 3a
**Blokkeert:** stap 3c

### Wat te doen

1. **Schrijf eerst een falende test** in `workspaceInboxShellRestoreBridge.test.ts` (of `workspaceShellRestoreModel.test.ts` als dat al bestaat): asserteer `WorkspaceModel`-toestand nà `syncShadowWorkspaceFromShellRestore` voor dezelfde vier scenario's als stap 3a. Laat hem falen door `projectWorkspaceRuntimeToModel` tijdelijk te verwijderen.
2. Verwijder `projectWorkspaceRuntimeToModel` aanroep in `useMainWindowWorkspace.ts:2083` (binnenin `syncShadowWorkspaceFromShellRestore`).
3. Verwijder de nu ongebruikte functies: `projectWorkspaceRuntimeToModel`, `scheduleDevWorkspaceShadowModelDivergenceCheck`, `collectShadowDivergenceDevDiagnostics`, `legacyTodayHubWorkspacesPersistFiltered`. Controleer of er andere aanroepsites zijn vóór verwijdering (`grep -r`).
4. **On-device verificatie:** vault openen, shell-restore via app-restart. Specifiek: meerdere hubs open → sluit app → heropen → hubs en home-history bewaard.
5. Alle bestaande tests blijven slagen.

---

## Stap 3c — Fase 1.5a: `workspaceHomeHistoryShadowSync` bridges verwijderen (TDD)

**Reviewpunten:** fase 1 ✗ substap 5 (home-history-bridge — minst vertakt)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.5`, `Claude Opus 4.7`, of `Composer 2` — **high**
**Geblokkeerd door:** stap 3b
**Blokkeert:** stap 2 en stap 3d

### Wat te doen

1. **Schrijf eerst een falende test** die asserteert dat push/back/forward/remap van home-history uitsluitend via het model gaat: dispatch een hub-navigatie-actie en controleer dat `homeStatesByHub` correct is zonder dat de bridge-functies worden aangeroepen. Stub de bridge-functies als noop en laat de test falen.
2. Verwijder `remapHomeStatesPrefixBridge` en `removeHomeHistoryUrisBridge` aanroepen uit `useMainWindowWorkspace.ts`.
3. Als de functies in `workspaceHomeHistoryShadowSync.ts` nergens anders worden gebruikt, verwijder het bestand.
4. **On-device verificatie:** navigeer in home-history (meerdere hubs), hernoem een map (triggert remap), sluit noten (triggert remove). Documenteer in PR-body.

---

## Stap 3d — Fase 1.5b: `workspaceRuntimeTabsLegacyBridge` verwijderen (TDD, drie aanroepsites)

**Reviewpunten:** fase 1 ✗ substap 5 (tabs-bridge — drie aanroepsites door fase 6)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.5`, `Claude Opus 4.7`, of `Composer 2` — **high**
**Geblokkeerd door:** stap 2 en stap 3c
**Blokkeert:** stap 3e

### Aanroepsites

- `useMainWindowWorkspace.ts` — directe aanroep
- `workspaceEditorHistoryNavigation.ts` — aanroep vanuit history-navigatie
- `workspaceOpenMarkdownCommand.ts:247` — `applyBackgroundNewTabOpen` (alleen als Fase 6 nog niet via integratiebranch met deze cleanup is geland)

### Wat te doen

1. **Schrijf eerst een falende test** die asserteert dat na `dispatchWorkspaceAction` (bijv. `OPEN_MARKDOWN`) de afgeleide `editorWorkspaceTabs` en `activeEditorTabId` correct zijn, zonder dat `assignLegacyEditorWorkspaceTabs` wordt aangeroepen. Vervang de bridge-call tijdelijk door een noop en laat de test rood worden.
2. Verwijder alle drie aanroepen van `assignLegacyEditorWorkspaceTabs`.
3. Verwijder de import van `workspaceRuntimeTabsLegacyBridge` uit alle drie modules.
4. Als het bridge-bestand nergens anders wordt gebruikt, verwijder het.
5. **On-device verificatie:** tab sluiten/reopen, background new-tab open via `applyBackgroundNewTabOpen`, editor-history go-back/forward. Documenteer in PR-body.

---

## Stap 3e — Fase 1.5c: `workspaceRuntimeActiveLegacyBridge` verwijderen (TDD, twee aanroepsites)

**Reviewpunten:** fase 1 ✗ substap 5 (active-bridge — laatste bridge)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.5`, `Claude Opus 4.7`, of `Composer 2` — **high**
**Geblokkeerd door:** stap 3d
**Blokkeert:** stap 4a

### Aanroepsites

- `useMainWindowWorkspace.ts`
- `workspaceTodayHubSwitch.ts`

### Wat te doen

1. **Schrijf eerst een falende test** die asserteert dat na hub-switch de afgeleide `activeTodayHubUri` en active surface tab correct zijn zonder dat `assignLegacyRuntimeActiveHub` of `assignLegacyRuntimeActiveSurfaceTab` worden aangeroepen. Stub als noop, laat rood worden.
2. Verwijder beide bridge-aanroepen uit `useMainWindowWorkspace.ts` en `workspaceTodayHubSwitch.ts`.
3. Verwijder de import van `workspaceRuntimeActiveLegacyBridge` uit beide modules.
4. Als het bridge-bestand nergens anders wordt gebruikt, verwijder het.
5. **On-device verificatie:** hub wisselen, actieve hub persisteert na app-restart, tab-strip per hub klopt. Documenteer in PR-body.

Na stap 3e zijn alle legacy bridges weg. De hoofdhook en alle command-modules zijn vrij van legacy-mirror-API's. Fase 4 kan nu starten zonder bridge-erfenis.

---

## Stap 4a — Fase 4a: delete-commands extraheren

**Reviewpunten:** fase 4 ✗ (delete-cluster)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.3 Codex`, `Composer 2`, of `Claude Sonnet 4.6` — **med**
**Geblokkeerd door:** stap 3e (bridges weg, zodat het context-object geen bridge-imports erft)
**Blokkeert:** stap 4b

### Wat te doen

1. Maak `apps/desktop/src/hooks/workspaceTreeCommands.ts` aan (als het nog niet bestaat) of voeg toe aan bestaand bestand.
2. Definieer een `TreeCommandContext`-type: `{ vaultRoot, fs, subtreeMarkdownCache, notes, inboxContentByUriRef, lastPersistedRef, dispatchWorkspaceAction, setters: {...}, refs: {...} }`. Bouw dit als `useMemo` in de hoofdhook.
3. Verplaats naar `workspaceTreeCommands.ts`:
   - `deleteNote` (r.2245)
   - `deleteFolder` (r.2336)
   - Houd bestaande `workspaceVaultTreeMutations.ts` pruning-helpers bij voorkeur op hun plek en importeer ze vanuit de command module; alleen verplaatsen als dat aantoonbaar ownership of testbaarheid verbetert.
4. In de hoofdhook: één regel per command, bijv. `const deleteNote = useCallback(uri => runDeleteNote(uri, ctx), [ctx])`.
5. Voeg tests toe in `workspaceTreeCommands.test.ts` voor `deleteNote` en `deleteFolder` met mock-setters/refs en mock-fs.
6. Smoke-test groen na wijziging.

---

## Stap 4b — Fase 4b: rename-command extraheren

**Reviewpunten:** fase 4 ✗ (rename-cluster — overlap met rename-maintenance)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.3 Codex`, `Composer 2`, of `Claude Sonnet 4.6` — **med-high**
**Geblokkeerd door:** stap 4a
**Blokkeert:** stap 4c

### Wat te doen

1. Onderzoek vóór verplaatsing de overlap tussen `renameFolder` (r.2441) en `commitRenameMaintenanceResult` / `useWorkspaceRenameMaintenance`. Bepaal welke state-mutaties via maintenance-hook lopen en welke direct via setters.
2. Verplaats `renameFolder` naar `workspaceTreeCommands.ts`. Als er shared setters zijn met de maintenance-hook, voeg die toe aan `TreeCommandContext`.
3. Test in `workspaceTreeCommands.test.ts` voor het rename-pad, inclusief het geval dat `useWorkspaceRenameMaintenance` na rename zijn eigen commit-pad triggert.
4. Smoke-test groen.

---

## Stap 4c — Fase 4c: move-commands extraheren

**Reviewpunten:** fase 4 ✗ (move-cluster)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.3 Codex`, `Composer 2`, of `Claude Sonnet 4.6` — **med**
**Geblokkeerd door:** stap 4b
**Blokkeert:** stap 4d

### Wat te doen

1. Verplaats naar `workspaceTreeCommands.ts`:
   - `commitMovedArticleResult` (r.2540)
   - `commitMovedDirectoryResult` (r.2570)
   - `commitMoveVaultTreeResult` (r.2611)
   - `moveVaultTreeItem` (r.2646)
2. Breid `TreeCommandContext` uit als de move-commands extra setters/refs nodig hebben.
3. Test in `workspaceTreeCommands.test.ts`: verifieer dat na `moveVaultTreeItem` de tab-strip wordt bijgewerkt via dispatched action (niet via legacy setter).
4. Smoke-test groen.

---

## Stap 4d — Fase 4d: bulk-commands extraheren

**Reviewpunten:** fase 4 ✗ (bulk-cluster)
**PR:** eigen PR
**Aanbevolen modellen:** `GPT-5.3 Codex`, `Composer 2`, of `Claude Sonnet 4.6` — **med**
**Geblokkeerd door:** stap 4c
**Blokkeert:** stap 5

### Wat te doen

1. Verplaats naar `workspaceTreeCommands.ts`:
   - `bulkDeleteRemoveVaultEntry` (r.2686)
   - `bulkDeletePruneTabsAndScroll` (r.2718)
   - `bulkDeleteVaultTreeItems` (r.2746)
   - `bulkMoveVaultTreeItems` (r.2810)
2. Test in `workspaceTreeCommands.test.ts`: bulk-delete verwijdert de juiste URI's uit de tab-strip en scroll-map; bulk-move hernoemt de juiste URI's.
3. Smoke-test groen. Meting: `useMainWindowWorkspace.ts` LOC moet na stap 4d ≈ 600 LOC lager zijn dan na fase 6 (van 3369 naar ~2769 of minder).

---

## Stap 5 — ADR finale update na Fase 4

**Reviewpunten:** fase 0 ⚠ modulekaart mist, cross-phase bevinding 4 (smoke-test CWD gedocumenteerd?)
**PR:** klein, zelfstandig na stap 4d
**Aanbevolen modellen:** `GPT-5.4-Mini`, `Composer 2`, of `Claude Haiku 4.5` — **low**
**Geblokkeerd door:** stap 4d
**Blokkeert:** niets

### Wat te doen

1. Werk de modulekaart in de ADR bij met alle modules die na stap 4d bestaan: `useVaultBootstrap`, `useDiskConflictState`, `useMergeViewState`, `useInboxEditorState`, `useEditorTabsState`, `workspaceOpenMarkdownCommand`, `workspaceTreeCommands` + de bestaande `workspaceVaultTreeMutations`.
2. Voeg actuele LOC-meting toe (na stap 4d).
3. Controleer dat stap 0 de invarianten-checklist al heeft toegevoegd; zo niet, doe het hier.
4. Noteer dat fase 7–10 nu op een bridge-vrije basis starten.

---

## Snelle referentie: modelkeuze per complexiteit

| Complexiteit | Aanbevolen modellen | Wanneer |
|---|---|---|
| **low** | `GPT-5.4-Mini`, `Composer 2`, `Claude Haiku 4.5` | Documentatie, ADR-tekst, kleine redactionele wijzigingen |
| **med** | `GPT-5.3 Codex`, `Composer 2`, `Claude Sonnet 4.6` | Scoped code-extractie, tests schrijven voor bekende scenario's, context-object bouwen |
| **med-high** | `GPT-5.3 Codex`, `Composer 2`, `Claude Sonnet 4.6` | Extractie waarbij overlap met andere modules handmatig geanalyseerd moet worden |
| **high** | `GPT-5.5`, `Claude Opus 4.7`, `Composer 2` | TDD-discipline op correctness-kritische verwijderingen, bridge-migraties, architectuurbeslissingen |

---

## Checklist per PR (kopieer naar PR-body)

```
- [ ] Geen gedragsverandering (puur refactor)
- [ ] Falende test vóór verwijdering/verplaatsing (high-risk stappen)
- [ ] Alle bestaande tests groen (smoke-test via `cd apps/desktop && npx vitest run`)
- [ ] Note-body cache invariant gerespecteerd (inboxContentByUri, lastPersistedRef, lastPersistedExternalMutationSeqRef samen bijgewerkt)
- [ ] Vault disk sync invariant niet aangeraakt of volledig gedekt door tests
- [ ] Vitest isolation: geen Tauri in setup, restoreMocks:false, isolate:true
- [ ] On-device verificatie gedaan (vault openen, relevante flow testen)
- [ ] PR-body documenteert welke invariant-checkpunten van toepassing zijn
```
