# Decompositie-plan `useMainWindowWorkspace.ts`

**Status:** fase 0–5 gemerged naar `main`; fase 6 op feature-branch `extract-useEditorTabsState-workspaceOpenMarkdownCommand.ts` (7 commits voor `origin/main`, nog niet gemerged). Fase 4 overgeslagen.
**Datum oorspronkelijk:** 2026-05-15
**Datum review:** 2026-05-15
**Doel:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` van 4062 LOC → < 800 LOC orchestratie, met behoud van alle invarianten uit `CLAUDE.md` en `specs/`.
**Aanpak:** gefaseerd, klein per PR. Elke fase is onafhankelijk leverbaar, tests groen, geen gedragsverandering.

**Stand na fase 0–6 (zie review onderaan):** hoofdhook 4062 → 3369 LOC (−693, −17%). Verwacht na fase 1–6 mits Fase 4 ook gemerged was: ~−2210 LOC. Het gat van ~1500 LOC komt door (a) Fase 4 overgeslagen, (b) legacy-bridges substappen 4-5 van Fase 1 nog open, (c) wiring/refs voor moduletransport in de hoofdhook.

---

## Probleemanalyse (samenvatting)

Het bestand is een orchestrator-hook met ~55 stukken state op het top-level (≈30 `useState`, ≈25 `useRef`) en 28+ verantwoordelijkheden die door elkaar staan. Er is al fors extractiewerk gedaan (16 `workspace*.ts` helpers, samen 4000+ LOC, ieder met tests). Toch krimpt de hoofdhook niet evenredig, om drie structurele redenen:

1. **State leeft centraal, logica is verspreid.** Helpers zijn pure functies die setters + refs als argumenten krijgen. Iedere helper-aanroep is daardoor bijna even groot als de helper zelf, en elke callback in de hook moet 10+ setters/refs in scope houden.
2. **Shadow-workspace-model migratie is half af.** Er draait een parallelle `WorkspaceModel`-projectie naast de legacy `editorWorkspaceTabs` / `activeTodayHubUri` / `homeStatesByHub` runtime state, met dev-divergentie-checks. Dat is dubbele administratie.
3. **Grote multi-step commands.** `openMarkdownInEditor` (~280 LOC), `hydrateVault` (~115 LOC), `deleteFolder`/`renameFolder`/bulk* (~700 LOC samen) coördineren elk veel state-bronnen.

**Risico-context (uit `CLAUDE.md`):**
- "Desktop: Note body cache" — `inboxContentByUri` en `lastPersistedRef` zijn correctness-kritisch.
- "Desktop: Vault disk sync invariants" — watcher-routing, cache-invalidatie, conflict-classificatie zijn een correctness-surface met verplichte tests.
- "Desktop Vitest isolation" — `restoreMocks: false`, `isolate: true`, geen Tauri in `vitest.setup.ts`.

Iedere fase moet deze invarianten respecteren en, waar de fase hun oppervlak raakt, regressietests toevoegen.

---

## Verantwoordelijkheidskaart (huidig)

| Cluster | Wat zit erin | Geschatte LOC in hook |
|---|---|---|
| Vault bootstrap | vaultRoot, settings (shared+local), deviceInstanceId, `hydrateVault`, first-launch effect, observability, indexer-schedule | ~200 |
| Notes lijst & body-cache | `notes`, `inboxContentByUri`, `refreshNotes`, vaultMarkdownRefs | ~80 |
| Inbox editor state | selectedUri, editorBody, frontmatter inner+leading, composing, reset-nonce, suppress-onChange, scroll-restore directives, refs | ~250 |
| Editor tabs | tabs, activeId, closed-stack, scroll-by-uri map, activate/reorder/close/closeOther/closeAll/reopen | ~450 |
| Today hubs (state + switch) | activeHub, per-hub snapshots, hub-selector, prehydrate/persist row, clean-row blocking, switch-flow | ~350 |
| Workspace home navigatie | homeStatesByHub, push/move/back/forward, home-selector activate | ~200 |
| Shadow workspace model | projectie, mirror callbacks, divergence-diagnostics, model-derived persistence | ~300 |
| Persistence | `useWorkspacePersistence` integratie, `vaultWriteSettled` | ~50 |
| Vault file watch | `useWorkspaceVaultWatchEffects` wiring (~40 props) | ~80 |
| Disk-conflict | hard + soft state, defer-timer, 4 resolvers, clear-stale | ~110 |
| Merge view | backup + disk-conflict, 5 callbacks | ~200 |
| Tree mutaties | deleteNote, deleteFolder, renameFolder, moveItem, bulkDelete, bulkMove | ~700 |
| Rename maintenance | `useWorkspaceRenameMaintenance` integratie + commit-pad | ~150 |
| Link routing | `useWorkspaceLinkRouting` integratie | ~30 |
| Editor history | activeTabHistory, canGoBack/Forward, back/forward, openCurrentHomeAfterComposing | ~120 |
| `openMarkdownInEditor` pipeline | 7 sub-callbacks (prepare/snapshot/prefetch/load/place/foreground/background) | ~280 |
| Inbox shell restore | grote restore-`useEffect` + helpers | ~180 |
| Return-shape assemblage | bouw controllers | ~150 |
| State↔Ref mirror-effects | 15+ `useLayoutEffect` blokken | ~80 |

Totaal komt overeen met ~4000 LOC.

---

## Doelarchitectuur

`useMainWindowWorkspace` wordt een **orchestratie-hook** die:

1. Een paar **state-stores** (sub-hooks) samenstelt die elk een coherent stukje state + zijn refs + zijn primaire setters bezitten.
2. Een paar **command-modules** aanroept (pure async functies die een expliciete context krijgen) voor multi-step operaties.
3. De `WorkspaceModel` als authoritatieve representatie heeft (legacy duals verwijderd).
4. Een platte return-shape assembleert volgens `workspaceReturnShape.ts`.

**Beoogde state-stores** (custom hooks die state + refs + lokale setters bezitten):

- `useVaultBootstrap` — vaultRoot, settings, deviceInstanceId, `hydrateVault`
- `useInboxEditorState` — selectedUri, editorBody, frontmatter inner+leading, composing, reset-nonce, suppress-flag, scroll-directive ref
- `useEditorTabsState` — tabs, activeId, closed-stack, scroll-by-uri map (na shadow-model is dit dun: views op model)
- `useTodayHubsState` — activeHub, homeStatesByHub, switch-flow (na shadow-model: views op model)
- `useDiskConflictState` — hard + soft + defer-timer + resolvers
- `useMergeViewState` — mergeView + 5 callbacks
- `useNotesListing` — notes, inboxContentByUri, refreshNotes

**Beoogde command-modules** (pure, expliciete context):

- `workspaceOpenMarkdownCommand.ts` — `openMarkdownInEditor` + helpers
- `workspaceTreeCommands.ts` — deleteNote, deleteFolder, renameFolder, moveItem, bulkDelete, bulkMove
- `workspaceComposeCommands.ts` — addNote, startNewEntry, cancelNewEntry, submitNewEntry, onCleanNoteInbox
- `workspaceHydrateCommand.ts` — `hydrateVault` body (eigenaar blijft `useVaultBootstrap`)

**Eindstand:** orchestratie-hook < 800 LOC. Verdwenen vanuit de hoofdhook: ~3300 LOC, herverdeeld over ~10 nieuwe of bestaande modules met eigen tests.

---

## Fasering

**Volgorde-principe:** doe eerst dingen die geen aanpassingen aan andere fases blokkeren. Shadow-model migratie eerst, want zolang dat half af is refactoren we op een bewegend doel.

### Fase 0 — Baseline & meting (1 PR, klein) — **STATUS: ✓ klaar, op `main`**

**Geadviseerde LLM:** `GPT-5.4-Mini` — voldoende voor inventarisatie, ADR-tekst en een kleine smoke-test; lage kans op complexe codewijzigingen.

- Snapshot huidige LOC, importgraaf en test-coverage van `useMainWindowWorkspace.ts`.
- Voeg een ADR toe (`specs/adrs/adr-main-window-workspace-decompositie.md`) met deze doelarchitectuur en de invarianten-checklist die elke fase moet respecteren.
- Voeg een lichte "smoke"-test (Vitest) toe die de return-shape van de hook controleert (alle controllers aanwezig, geen `undefined` velden). Dient als regressie-vangnet voor latere fases.

**Acceptatie:** ADR gemerged, smoke-test groen, getallen vastgelegd.

**Review (2026-05-15):**
- ✓ ADR aangemaakt: `specs/adrs/adr-main-window-workspace-decompositie.md` (commits `bcf919bc`, `c87458a2`).
- ✓ Smoke-test aangemaakt: `apps/desktop/src/hooks/useMainWindowWorkspace.smoke.test.ts` (155 LOC, dekt alle 21 top-level keys + alle nested controller keys). Slaagt onder `apps/desktop` vitest-config (let op: gebruikt `happy-dom`; rechtstreeks via root `npx vitest` zonder workspace-context faalt met "document is not defined" — niet kritiek, wel goed om te documenteren in de uitvoeringsinstructie van latere fases).
- ✓ Baseline LOC vastgelegd: 4062 (zie ADR).
- ⚠ De ADR bevat een Phase 1 matrix maar mist de in dit plan beloofde **invarianten-checklist die elke fase moet respecteren** (note-body cache, disk-sync, vitest isolation, CodeMirror layout). Die staat alleen impliciet in dit plan. Aanbeveling: voeg een korte checklist-sectie aan de ADR toe of laat fase 10 de ADR consolideren.

---

### Fase 1 — Shadow-workspace-model migratie afmaken (groot, eigen mini-track) — **STATUS: ⚠ deels af; substappen 4–5 open**

**Geadviseerde LLM:** `GPT-5.5` met hoge reasoning — hoogste risico door state-bronnen, persistence en restore-contracten; gebruik een frontier model voor analyse en substap-ontwerp, eventueel `GPT-5.3 Codex` voor afgebakende codepatches.

**Doel:** verwijder de legacy/projected dual-path zodat `WorkspaceModel` authoritatief is voor activeHub, tabs per hub, home-state per hub.

**Sub-stappen (eigen PR per stap):**

1. Inventariseer alle plekken waar legacy state (`editorWorkspaceTabs`, `activeEditorTabId`, `activeTodayHubUri`, `todayHubWorkspacesForSave`, `homeStatesByHub`) als bron van waarheid wordt gelezen. Maak een matrix in de ADR.
2. Vervang lezers één-voor-één door views op `workspaceShadowModel`. Begin bij read-only consumers (selector-derivaties, persistentie), eindig bij actieve schrijvers (close-tab, hub-switch).
3. Maak `workspaceShadowModel` schrijf-pad authoritatief: actie-dispatchers leven al; legacy `setEditorWorkspaceTabs` etc. worden afgeleid (of, beter, vervangen door selectors over de model-state met `useSyncExternalStore` op `workspaceShadowModelRef`).
4. Verwijder `projectWorkspaceRuntimeToModel`, `scheduleDevWorkspaceShadowModelDivergenceCheck`, `collectShadowDivergenceDevDiagnostics`, `legacyTodayHubWorkspacesPersistFiltered`, `mergeStoredHubWorkspaces` (alleen mergen van JSON, niet "merge twee runtime-bronnen").
5. Wis de "legacy bridges" (`workspaceRuntimeActiveLegacyBridge`, `workspaceRuntimeTabsLegacyBridge`, `workspaceHomeHistoryShadowSync`) — die zijn `bridges` *omdat* er twee bronnen zijn; daarna niet meer nodig.

**Status per 2026-05-15:** substappen 1–3 zijn gemerged (commit `d97d3efd` + follow-up patches). Substappen 4 en 5 zijn **bewust uitgesteld**: `projectWorkspaceRuntimeToModel` (aanroep in `syncShadowWorkspaceFromShellRestore`), `mergeStoredHubWorkspaces` (aanroep in shell-restore-`useEffect`), en de drie bridges (`workspaceRuntimeActiveLegacyBridge`, `workspaceRuntimeTabsLegacyBridge`, `workspaceHomeHistoryShadowSync`) leven nog in `useMainWindowWorkspace.ts`. De ADR is bijgewerkt om te documenteren dat legacy refs/state als mirror blijven bestaan. Pak deze cleanup op vóór Fase 6/8 op de huidige structuur bouwt — anders worden de bridges in nieuwe modules gekopieerd.

**Werkwijze voor de resterende cleanup (substappen 4 en 5) — verplicht TDD:**

De hoofdmigratie liet zien dat blinde verplaatsing zonder vooraf-tests zes follow-up bug-fix commits opleverde op precies de paden die als hoog risico waren gemarkeerd (tabs, hub-switch, mirror callbacks, shell-restore). Voor de resterende verwijdering geldt daarom strikt rood-groen:

1. **Schrijf eerst een falende test** voor het gedrag dat het te verwijderen stuk levert, voordat je het verwijdert. Concreet per artefact:
   - `projectWorkspaceRuntimeToModel`-verwijdering → test in `workspaceInboxShellRestoreBridge.test.ts` (of nieuw `workspaceShellRestoreModel.test.ts`) die de `WorkspaceModel`-toestand asserteert nà shell-restore voor: (a) lege vault zonder hubs, (b) één hub + actieve tab, (c) meerdere hubs met inactieve-hub-snapshots, (d) home-history per hub bewaard. Laat hem eerst falen tegen een tijdelijk uitgeschakelde aanroep.
   - `mergeStoredHubWorkspaces`-verwijdering → test die de JSON→model-pad over `serializeWorkspaceModelToPersistence`/`workspaceModel`-reducers dekt voor exact dezelfde scenario's als hierboven, inclusief filter-gedrag (uri's niet meer in vault).
   - `workspaceRuntimeActiveLegacyBridge` / `workspaceRuntimeTabsLegacyBridge` → test die asserteert dat na elke `dispatchWorkspaceAction` de afgeleide tab-strip + active-tab-id correct zijn, zónder dat de legacy setters worden aangeroepen. Vervang de bridge-call in de test eerst door een noop om hem rood te krijgen.
   - `workspaceHomeHistoryShadowSync` → test op push/back/forward/remap van home-history die alleen via het model loopt.
2. **Pas één artefact per PR aan.** Geen gebundelde "verwijder alle bridges"-PR. Volgorde: eerst `mergeStoredHubWorkspaces` (smalste oppervlak), dan `projectWorkspaceRuntimeToModel`, dan de drie bridges (één per PR, in volgorde: home-history → tabs → active).
3. **Geen gedragsverandering.** Als de rode test impliceert dat het model nieuw gedrag moet leveren dat nu door de bridge wordt opgevangen, stop en herontwerp; merge geen "tijdelijke" fallback.
4. **On-device verificatie verplicht** per PR: vault openen, hub switchen, tab sluiten/reopen, shell-restore via app-restart. Documenteer in de PR-body.
5. **Geen nieuwe `*Bridge`/`*LegacySync` modules.** Als je tijdens de cleanup verleid wordt er één toe te voegen, is dat een signaal dat het model nog niet authoritatief genoeg is — stop en pak eerst dat schrijfpad aan.

**Risico:** correctness-kritiek. Voorwaarden:
- Bestaande tests in `workspaceRuntimeProjection.test.ts`, `workspaceShadowBridge.test.ts`, `workspaceInboxShellRestoreBridge.test.ts` blijven het contract bewaken.
- Voeg per substap regressietests toe voor de schrijfpaden die je migreert (close-tab → model, hub-switch → model, restore → model).
- Test on-device de inbox shell restore — dit is precies het scenario dat de duals nu opvangen.

**Verwachte LOC-winst in hoofdhook:** ~400 LOC (projectie + divergentie-checks + legacy bridges). **Gerealiseerd na substappen 1–3:** ~49 LOC netto (4062 → 4013); de rest komt pas vrij met substappen 4 en 5.

**Review (2026-05-15):**
- ✓ Substappen 1–3 gemerged via PR #76 (`c4f3aee1`). Model is read-authoritatief voor `activeTodayHubUri`, `activeEditorTabId`, `editorWorkspaceTabs`, `homeStatesByHub`, `todayHubWorkspacesForSave`; legacy state blijft als sync-mirror voor command-paden (zie ADR Phase 1 Matrix).
- ✗ Substappen 4 en 5 **NIET** gestart op `main`. Concreet nog aanwezig:
  - `projectWorkspaceRuntimeToModel` aangeroepen in `useMainWindowWorkspace.ts:2083` (binnen `syncShadowWorkspaceFromShellRestore`).
  - `mergeStoredHubWorkspaces` aangeroepen in `useMainWindowWorkspace.ts:3120` (shell-restore `useEffect`).
  - `workspaceRuntimeActiveLegacyBridge` (`assignLegacyRuntimeActiveHub`, `assignLegacyRuntimeActiveSurfaceTab`) gebruikt in `useMainWindowWorkspace.ts` èn in `workspaceTodayHubSwitch.ts`.
  - `workspaceRuntimeTabsLegacyBridge` (`assignLegacyEditorWorkspaceTabs`) gebruikt in `useMainWindowWorkspace.ts`, `workspaceEditorHistoryNavigation.ts` èn — **nieuw** — in `workspaceOpenMarkdownCommand.ts` (Fase 6).
  - `workspaceHomeHistoryShadowSync` (`remapHomeStatesPrefixBridge`, `removeHomeHistoryUrisBridge`) gebruikt in `useMainWindowWorkspace.ts`.
- ⚠ **Plan-overtreding bevestigd:** de regel "Pak deze cleanup op vóór Fase 6/8 op de huidige structuur bouwt — anders worden de bridges in nieuwe modules gekopieerd" is geschonden door Fase 6. `workspaceOpenMarkdownCommand.ts` is een nieuwe module die de legacy-bridge-aanroep importeert en herhaalt (`applyBackgroundNewTabOpen` → `assignLegacyEditorWorkspaceTabs`). Dit creëert een tweede plek waar substappen 4–5 moeten worden teruggedraaid en valideert precies het risico dat de plan-update voorspelde.
- ⚠ **Bug-fix sleep tijdens substappen 1–3:** tussen `d97d3efd` en PR-merge `c4f3aee1` zit ~10 echte fix-commits (o.a. `9406474a Fix tab bug`, `fb1865ef Keep tab controller backed when no Today hub exists`, `49a7ead6 Deferred mirror callbacks ran unconditionally`, `efef555a Prune shadow Today hub workspaces`, `325c25f8 Align workspace hub sync and editor history`, `ca3a5fb2 Defer hub-pruning`, `661b3964 Re-run hub pruning`, `7081a4d6 Keep hydrate flush ref in sync`, `b111030a Clear disk conflict UI before vault hydrate`, `27a9c042 Today hub legacy tabs + markdown-scan gating`). Dit bewijst empirisch dat de TDD-discipline die aan substappen 4–5 is gehangen ook had moeten gelden voor substap 2 (lezers vervangen). Voor substappen 4–5 strikt aanhouden.
- Prioriteit voor vervolg: substappen 4–5 zijn na het mergen van Fase 6 **nog urgenter** geworden, omdat `workspaceOpenMarkdownCommand.ts` nu een derde aanroepsite is van `assignLegacyEditorWorkspaceTabs`. Doe ze vóór Fase 7/8/9.

---

### Fase 2 — `useVaultBootstrap` extraheren (1 PR) — **STATUS: ✓ klaar, op `main` (PR #77)**

**Geadviseerde LLM:** `GPT-5.3 Codex` — geschikt voor scoped extractie met async effecten, mocks en bestaande Vitest-paden.

- Verplaats: `vaultRoot`, `vaultSettings`, `settingsName`, `deviceInstanceId`, `initialVaultHydrateAttemptDone`, `busy`, `err`, `hydrateVault`, plugin-store load/save, first-launch effect, indexer-schedule, observability voor `vault_watch_start_failed`.
- Hook exposeert: `{vaultRoot, vaultSettings, setVaultSettings, settingsName, deviceInstanceId, initialVaultHydrateAttemptDone, busy, err, setErr, hydrateVault}`.
- `hydrateVault` blijft een dik command, maar het is intern aan deze hook; reset-fases (tabs, hub, frontmatter, composing) krijgt het via een `resetWorkspaceState` callback uit de parent.
- Tests: extraheer de bestaande `useMainWindowWorkspace.hydrateVault.test.ts` paths.

**Verwachte LOC-winst:** ~200.

**Review (2026-05-15):**
- ✓ `apps/desktop/src/hooks/useVaultBootstrap.ts` (199 LOC) — return-shape klopt 1-op-1 met plan.
- ✓ Reset-paden lopen via refs (`resetWorkspaceStateRef`, `resetRenameMaintenanceStateRef`, `clearBacklinkDiskBodyCacheRef`, `clearDiskConflictUiForHydrateRef`, `flushInboxSaveRef`); ouder-hook initialiseert deze refs via `useLayoutEffect`-mirrors. Schoon contract, geen impliciete dep-chains.
- ✓ Eigen test: `useVaultBootstrap.test.ts` (115 LOC, 1 test) dekt het belangrijkste scenario "clear disk-conflict UI vóór vault session, ook bij hydrate-falen" (volgt uit fix-commit `b111030a`). Indexer-schedule en watch-start-observability nog niet apart unit-getest; bestaande `useMainWindowWorkspace.hydrateVault*.test.ts` dekken het integratiepad.
- ✓ Smoke-test groen onder de huidige composition.
- Geen openstaande issues. Schone fase.

---

### Fase 3 — `useDiskConflictState` + `useMergeViewState` extraheren (1 PR) — **STATUS: ✓ klaar, op `main` (PR #78)**

**Geadviseerde LLM:** `GPT-5.3 Codex` met hoge reasoning — disk-conflict en merge-flow zijn correctness-kritiek; laat het model expliciet testdekking en invarianten nalopen.

- `useDiskConflictState`: `diskConflict`, `diskConflictSoft`, beide refs, defer-timer ref, `resolveDiskConflictReloadFromDisk`, `resolveDiskConflictKeepLocal`, `elevateDiskConflictSoftToBlocking`, `dismissDiskConflictSoft`, `clearStaleDiskConflictsForOpen`.
- `useMergeViewState`: `mergeView`, `closeMergeView`, `tryEnterBackupMergeView`, `applyFullBackupFromMerge`, `keepMyEditsFromMerge`, `enterDiskConflictMergeView`, `applyMergedBodyFromMerge`.
- Bestaande helpers in `workspaceFsWatchReconcile.ts` blijven; dit verplaatst alleen state-eigendom.

**Verwachte LOC-winst:** ~310.

**Review (2026-05-15):**
- ✓ `useDiskConflictState.ts` (213 LOC, 144 LOC test, 3 tests) — alle 9 callbacks uit het plan zijn opgenomen; ref-writes leven nu binnen de hook (follow-up `07749213 Own disk conflict ref writes`).
- ✓ `useMergeViewState.ts` (314 LOC, 133 LOC test, 3 tests) — alle 6 callbacks aanwezig + `tryEnterBackupMergeView`.
- ✓ Aanvullende callback `clearBlockingDiskConflictForMergedBody` toegevoegd op `useDiskConflictState`: dat is een legitieme uitbreiding (het werd uit `useMergeViewState` aangeroepen na merge-apply). Niet in het oorspronkelijke plan, wel een correcte ownership-grens.
- ✓ Follow-up `1626bfe7 Stabilize cancelAutosave and loadFull for disk conflict hooks` — beide hooks accepteren stabiele referenties voor `cancelAutosave` en `loadFullMarkdownIntoInboxEditor`, om identity-churn in de ouder-hook te neutraliseren. Goed signaal dat callback-stabiliteit nu een expliciet contract is.
- Note-body cache invariant gerespecteerd: `resolveDiskConflictReloadFromDisk` werkt zowel `lastPersistedRef`, `inboxContentByUriRef`, `setInboxContentByUri` als `lastPersistedExternalMutationSeqRef` bij — exact het patroon uit `CLAUDE.md` "Desktop: Note body cache".
- Geen openstaande issues. Schone fase.

---

### Fase 4 — `workspaceTreeCommands.ts` (1 PR, evt. opgesplitst) — **STATUS: ✗ overgeslagen / niet gestart**

**Geadviseerde LLM:** `GPT-5.3 Codex` — beste match voor grote codeverplaatsing, expliciete context-objecten en testbare command-functies; splits bij voorkeur per tree-command cluster.

- Verplaats `deleteNote`, `deleteFolder`, `renameFolder`, `commitMovedArticleResult`, `commitMovedDirectoryResult`, `commitMoveVaultTreeResult`, `moveVaultTreeItem`, `bulkDeleteRemoveVaultEntry`, `bulkDeletePruneTabsAndScroll`, `bulkDeleteVaultTreeItems`, `bulkMoveVaultTreeItems` naar `workspaceTreeCommands.ts`.
- Elk command krijgt een expliciete context (`{vaultRoot, fs, refs, setters, dispatchers, subtreeMarkdownCache, ...}`).
- In de hook: één regel per command, bijv. `const deleteNote = useCallback(uri => runDeleteNote(uri, ctx), [...ctxDeps])`.
- Bouw `ctxDeps` uit een memoized "tree command context" zodat `useCallback`-deps niet exploderen.
- Tests: nieuw bestand `workspaceTreeCommands.test.ts` dat de pure command-functies test met mock setters/refs. Bestaande integratie-tests (`useMainWindowWorkspace.integration.*`) blijven het volle pad dekken.

**Verwachte LOC-winst:** ~600.

**Review (2026-05-15):**
- Tree-commands staan **nog volledig in `useMainWindowWorkspace.ts`** (regels 2245–2851 ≈ 600 LOC): `deleteNote` (2245), `deleteFolder` (2336), `renameFolder` (2441), `commitMovedArticleResult` (2540), `commitMovedDirectoryResult` (2570), `commitMoveVaultTreeResult` (2611), `moveVaultTreeItem` (2646), `bulkDeleteRemoveVaultEntry` (2686), `bulkDeletePruneTabsAndScroll` (2718), `bulkDeleteVaultTreeItems` (2746), `bulkMoveVaultTreeItems` (2810).
- `workspaceVaultTreeMutations.ts` bestaat al maar bevat alleen **pure tab/scroll-pruning-helpers** voor bulk-delete (`pruneEditorTabsAfterBulkTreeDelete`, `bulkDeleteUriRemovalPredicate`, `collectDeletedPathsFromBulkPlan` — 66 LOC). Dat is geen Fase 4: het is bestaand werk uit `00944da2`. Fase 4 zelf is nog niet begonnen.
- Volgorde-afwijking t.o.v. plan: het plan zegt "Fase 1 blokkeert Fase 6, 7, 8. De rest is grotendeels onafhankelijk en kan parallel" — daarmee was Fase 4 vrij om vóór Fase 5/6 te lopen. Praktisch zijn echter Fase 5 (215 LOC module) en Fase 6 (462 LOC module) eerder gedaan omdat de redactionele winst per PR-uur hoger was. Dat is een legitieme keuze, maar betekent wel dat **Fase 4 nu de grootste resterende open LOC-bron is** in de hoofdhook.
- Aanbeveling voor uitvoering nu: doe Fase 4 als volgende fase (na het sluiten van Fase 6-branch), met de volgende splitsing in PRs om risico te beperken:
  1. **PR 4a — delete-commands:** `deleteNote` + `deleteFolder` + bestaande `workspaceVaultTreeMutations.ts` pruning helpers; commando-context met `fs`, `vaultRoot`, `subtreeMarkdownCache`, refs voor tabs/scroll-map/home-history, en dispatchers.
  2. **PR 4b — rename:** `renameFolder` (zit dicht tegen `useWorkspaceRenameMaintenance`; check eerst of er overlap is met `commitRenameMaintenanceResult`).
  3. **PR 4c — move:** `commitMovedArticleResult`, `commitMovedDirectoryResult`, `commitMoveVaultTreeResult`, `moveVaultTreeItem`.
  4. **PR 4d — bulk:** `bulkDeleteRemoveVaultEntry`, `bulkDeletePruneTabsAndScroll`, `bulkDeleteVaultTreeItems`, `bulkMoveVaultTreeItems`.
- Tests: bestaand `workspaceVaultTreeMutations.test.ts` + de bestaande integratie-tests dekken nu het pad; per PR een focus-test toevoegen voor het verplaatste command.

---

### Fase 5 — `useInboxEditorState` extraheren (1 PR) — **STATUS: ✓ klaar, op `main` (PR #79)**

**Geadviseerde LLM:** `GPT-5.3 Codex` — scoped React-hook extractie met veel refs en setter-contracten; medium reasoning is meestal genoeg, hoog bij testfalingen.

- Verplaats: `selectedUri`, `editorBody`, `inboxEditorResetNonce`, `composingNewEntry`, frontmatter inner+leading + refs, `suppressEditorOnChangeRef`, `eagerEditorLoadUriRef`, `editorShellScrollByUriRef`, `inboxEditorShellScrollDirectiveRef`, `lastInboxEditorActivityAtRef`, `skipRecencyDeferForUriRef`, `guardedSetEditorBody`, `loadFullMarkdownIntoInboxEditor`, `syncFrontmatterStateFromDisk`, `applyFrontmatterInnerChange`, `resetInboxEditorComposeState`, `clearInboxSelection`.
- Lever zowel state als de paar locale operaties uit één hook.
- Houd `inboxContentByUri` + `lastPersistedRef` apart (Fase 7), die hebben hun eigen invariant.

**Verwachte LOC-winst:** ~250.

**Review (2026-05-15):**
- ✓ `useInboxEditorState.ts` (215 LOC, 82 LOC test, 3 tests) — alle 18 plan-items aanwezig in de return-shape; `inboxContentByUri` en `lastPersistedRef` blijven correct buiten deze hook (Fase 7-grens gerespecteerd).
- ✓ Follow-up `926e08e2 Keep inbox clear free of persistence refs` — discipline-correctie: `clearInboxSelection` mocht alleen selectie/editor-state aanpakken, niet `lastPersistedRef` en `lastPersistedExternalMutationSeqRef`; die persistence-bumps zijn naar `useMainWindowWorkspace.ts` teruggebracht. Goede ownership-grens, klopt met de Fase 7-belofte.
- ✓ Tests dekken: ref-sync bij state-mutaties, `guardedSetEditorBody` suppress-flag, frontmatter sync vs. composing-guard.
- Note-body cache invariant: `useInboxEditorState` raakt deze niet direct (alleen het editor-DOM laden); de invariant blijft gehandhaafd in `useMainWindowWorkspace.ts` rondom `enqueueInboxPersist` / `openMarkdownInEditor`.
- Geen openstaande issues. Schone fase, met goede tegenspraak in de follow-up.

---

### Fase 6 — `useEditorTabsState` + `workspaceOpenMarkdownCommand.ts` (1 PR) — **STATUS: ⚠ op feature-branch, niet gemerged; bridge-propagatie problemen**

**Geadviseerde LLM:** `GPT-5.5` voor ontwerp/risicoanalyse, daarna `GPT-5.3 Codex` voor implementatie — open-flow raakt tabplaatsing, body-load, scroll-restore en foreground/background gedrag.

- `useEditorTabsState`: nu het shadow-model authoritatief is (Fase 1), is dit feitelijk een dunne facade rond model-selectors + setters die `dispatchWorkspaceAction` aanroepen. `closedTabsStack` blijft locaal — die hoort bij tabs maar niet bij persistentie.
- `workspaceOpenMarkdownCommand.ts`: verplaats `prepareInboxScrollDirectiveForOpen`, `snapshotAndPersistCurrentNoteBeforeOpen`, `tryPrefetchTargetBody`, `loadOpenedNoteBodyAndApplySelection`, `applyBackgroundNewTabOpen`, `placeForegroundMarkdownOpen`, `openMarkdownInEditor`. Context-pattern net als Fase 4.

**Verwachte LOC-winst:** ~450.

**Review (2026-05-15):**
- ✓ `useEditorTabsState.ts` (88 LOC, 48 LOC test, 2 tests) — inderdaad een dunne facade. Levert `editorWorkspaceTabs` + ref-mirror, `activeEditorTabId` + ref-mirror, `editorClosedTabsStackRef` + `bumpEditorClosedStack`, en `canReopenClosedEditorTab` afgeleid van vault+notes.
- ✓ `workspaceOpenMarkdownCommand.ts` (374 LOC, 160 LOC test, 3 tests) — alle 6 sub-callbacks + entry-functie aanwezig: `prepareInboxScrollDirectiveForOpen`, `snapshotAndPersistCurrentNoteBeforeOpen`, `tryPrefetchTargetBody`, `loadOpenedNoteBodyAndApplySelection`, `applyBackgroundNewTabOpen`, `placeForegroundMarkdownOpen`, `runOpenMarkdownInEditorCommand`. Het context-pattern (`OpenMarkdownCommandContext`) is geïmplementeerd; de hoofdhook bouwt `openMarkdownCommandContext` als `useMemo` (regel 1077) en doet `openMarkdownInEditor = useCallback((uri, opts) => runOpenMarkdownInEditorCommand(ctx, uri, opts), [ctx])`. Volgens plan.
- ⚠ **Plan-overtreding (bridge-propagatie):** `workspaceOpenMarkdownCommand.ts` regel 27 importeert `assignLegacyEditorWorkspaceTabs` uit `workspaceRuntimeTabsLegacyBridge`, en `applyBackgroundNewTabOpen` (regel 247) roept die bridge aan. Dit duplicaat is precies wat het plan onder "Werkwijze voor de resterende cleanup" verbood. Het verergert het probleem omdat de bridge nu vanuit een nieuw module-grens wordt aangeroepen — Fase 1 substappen 4–5 moeten dus deze nieuwe call-site óók migreren. Aanbeveling: niet mergen voordat substappen 4–5 deze call-site samen met de hoofdhook hebben opgeruimd, óf accepteer dat Fase 1.4/1.5 nu twee aanroepsites moet aanpakken en documenteer dat in de PR-body.
- ⚠ **`workspaceOpenMarkdownCommand` test-dekking is dun voor de risico-paden:** 3 tests dekken (a) foreground cached body, (b) home-mode push hub-history, (c) dev-warning op tab-strip signature mismatch. Niet getest: prefetch + disk-read pad (`tryPrefetchTargetBody` → cache update), `snapshotAndPersistCurrentNoteBeforeOpen` met composing-guard, `insertAtIndex`/`insertAfterActive` placement-varianten, generation-cancel (`openMarkdownGenerationRef`). Open-flow is **correctness-kritiek** (raakt note-body cache invariant + tab strip + home-history); deze paden zouden vóór merge moeten worden gedekt.
- ⚠ **Follow-up-commits op de open branch** (`7f359f88 Remove editorClosedStackVersion from dependency array`, `f571e6c5 Remove unused ClosedEditorTabRecord import`, `fa87623f Restore dev warning for background new tab tab-strip signature drift`, `db919dae Align editor tab setters with Dispatch`) — kleine kalibraties; geen smoking gun, maar `fa87623f` herstelt een per ongeluk verloren dev-warning, wat een TDD-gap markeert.
- ✓ Smoke-test en alle 15 module-tests groen op de feature-branch.
- Aanbevolen prerequisites voor merge: (1) extra tests op `runOpenMarkdownInEditorCommand` prefetch + generation-cancel + `applyBackgroundNewTabOpen` placement; (2) ofwel substappen 4–5 van Fase 1 erin trekken, ofwel een TODO-block + spec-update opnemen die expliciet zegt dat deze aanroepsite mee moet in de bridge-verwijdering.

---

### Fase 7 — `useNotesListing` + `useInboxBodyCache` (1 PR)

**Geadviseerde LLM:** `GPT-5.3 Codex` met hoge reasoning — de note-body-cache invariant is klein maar hard; focus op ownership, mutation API en mismatch-tests.

- `useNotesListing`: `notes`, `notesRef`, `refreshNotes`, `fsRefreshNonce`, `podcastFsNonce`, `vaultTreeSelectionClearNonce`.
- `useInboxBodyCache`: `inboxContentByUri` + `lastPersistedRef` + `lastPersistedExternalMutationSeqRef`. Houdt de invariant uit `CLAUDE.md` "Desktop: Note body cache" expliciet in één plek; alle mutaties gaan door deze hook (set/remove/heal). Helper `inboxNoteBodyCache.ts` blijft; hier alleen het eigenaarschap.
- Tests: voeg een cache-consistentie-test toe die `lastPersistedRef` mismatches detecteert.

**Verwachte LOC-winst:** ~150.

---

### Fase 8 — `useTodayHubsState` consolideren (1 PR)

**Geadviseerde LLM:** `GPT-5.5` met hoge reasoning — hub-state, persistence rows en home-history hebben veel impliciete ordering; laat het model eerst een migratiematrix maken voordat het code wijzigt.

- Na Fase 1 zijn `activeTodayHubUri`, `todayHubWorkspacesForSave`, `homeStatesByHub` views op het model. Bundel: `prehydrateTodayHubRows`, `persistTodayHubRow`, `todayHubCleanRowBlocked`, `syncWorkspaceModelForIncomingHub`, `syncShadowWorkspaceFromShellRestore`, `todayHubSelectorItems`, plus home-history operaties (`setHomeStateForHub`, `pushHomeHistoryForHub`, `remapHomeStatesPrefix`, `removeHomeHistoryUris`).
- `useWorkspaceTodayHubSwitch` blijft als sub-hook intern aan `useTodayHubsState`.

**Verwachte LOC-winst:** ~350.

---

### Fase 9 — Compose-commands + inbox-shell-restore opruimen (1 PR)

**Geadviseerde LLM:** `GPT-5.3 Codex` met hoge reasoning — compose en shell-restore zijn testbaar te isoleren, maar raken restore-volgorde en editor-history; laat het model expliciet bestaande bridge-tests koppelen aan de verplaatsing.

- `workspaceComposeCommands.ts`: `addNote`, `startNewEntry`, `cancelNewEntry`, `submitNewEntry`, `onCleanNoteInbox`.
- `useInboxShellRestore`: verplaats de grote restore-`useEffect` rond regel 3770 en de drie helper-callbacks naar één sub-hook. `inboxShellRestoreHelpers.ts` + `workspaceInboxShellRestoreBridge.ts` blijven.
- Editor-history (`activeTabHistory`, `activeHomeState`, `canGoBack`/`Forward`, `editorHistoryGoBack`/`GoForward`, `openCurrentHomeAfterComposing`, `moveHomeHistory`): zit dichter bij tabs, daar laten of een dunne `useEditorHistory` ernaast.

**Verwachte LOC-winst:** ~300.

---

### Fase 10 — Eind-opruiming (1 PR, klein)

**Geadviseerde LLM:** `GPT-5.4-Mini` voor documentatie en simpele cleanup, of `GPT-5.3 Codex` als er nog ref-mirror-effecten met subtiele dependency-risico's over zijn.

- Verwijder onnodige state↔ref-mirror-effects waar de refs door state-stores zelf onderhouden worden.
- Check return-shape compositie; verifieer dat de hoofdhook nu wiring + assemblage is.
- Update `CLAUDE.md` "Desktop: Note body cache" en "Vault disk sync invariants" met de nieuwe bestandspaden waar de invariant gehandhaafd wordt.
- Werk de header-comment van `useMainWindowWorkspace.ts` bij.

**Eindstand-verwachting:** ~600–800 LOC; uitsluitend orchestratie.

---

## Per-fase regels (verplicht)

1. **Geen gedragsverandering.** Iedere fase is een refactor; voeg geen features, fixes, of "kleine verbeteringen" toe.
2. **Tests vooraf of in dezelfde PR.** Voor elke verplaatste callback: óf bestaande test dekt het pad (verwijs in PR-body), óf voeg test toe.
3. **Invarianten-checklist** afvinken in PR-beschrijving:
   - Note-body cache invariant (CLAUDE.md "Desktop: Note body cache")
   - Disk-sync invariant (CLAUDE.md "Desktop: Vault disk sync invariants")
   - Vitest isolation regels (CLAUDE.md "Desktop Vitest isolation")
   - CodeMirror layout (waar relevant)
4. **Mid-flight schrijfwerk.** Coördineer met Marien voor mergevolgorde — Fase 1 (shadow-model) blokkeert Fase 6, 7, 8. De rest is grotendeels onafhankelijk en kan parallel.
5. **On-device verificatie** voor fases die restore, hub-switch, of save-pad raken (mobile-eq niet relevant; dit is desktop-only, maar Tauri-dev-run + handmatig openen van een vault is verplicht).

---

## Open vragen

- Wil je dat de state-store sub-hooks (`useInboxEditorState`, etc.) eigen `__resetForTests()` exposeren conform Vitest isolation regels, of testen we ze indirect via de orchestratie-hook? interne __resetForTests()
- Moet er een specs-update naar `specs/architecture/desktop-editor.md` met de nieuwe modulekaart, of houden we het in een ADR? ADR

---

## Review na uitvoering fase 0–6 (2026-05-15)

### Cijfermatige stand

| Metric | Baseline (fase 0) | Nu (na fase 0–6) | Delta |
|---|---|---|---|
| `useMainWindowWorkspace.ts` LOC | 4062 | 3369 | −693 (−17%) |
| `useState`/`useRef` in hoofdhook | ~55 | 12 | −78% |
| `useEffect`/`useLayoutEffect` in hoofdhook | ~30 | 27 | −10% |
| Geëxtraheerde modules (eigenaar van state of command) | 0 | 6 | +6 |
| Tests in nieuwe modules | 0 | 15 (in 6 bestanden) | +15 |
| Tree-commands extern | 0 | 0 (Fase 4 niet gestart) | — |

**Geëxtraheerde modules (LOC, exclusief tests):** `useVaultBootstrap` 199, `useDiskConflictState` 213, `useMergeViewState` 314, `useInboxEditorState` 215, `useEditorTabsState` 88, `workspaceOpenMarkdownCommand` 374 → totaal **1403 LOC** in nieuwe modules. Verschil tussen 1403 en de 693 LOC die uit de hoofdhook is gehaald = ~710 LOC aan wiring/refs/effect-deps in de orchestratie laag. Niet onverwacht, maar wel signaal dat Fase 10 (eindopruiming van ref-mirror-effects en wiring) reëel moet worden uitgevoerd om de 800 LOC-target te halen.

### Doorlooptijd-signaal: bug-fix volume per fase

| Fase | Initial commit | Fix-commits tot merge | Indicatie |
|---|---|---|---|
| 1 (substappen 1–3) | `d97d3efd` | ~10 (`9406474a`, `fb1865ef`, `49a7ead6`, `efef555a`, `325c25f8`, `ca3a5fb2`, `661b3964`, `7081a4d6`, `b111030a`, `27a9c042`) | Hoog. Plan-update werd halverwege toegevoegd met strikte TDD-eis voor substappen 4–5. |
| 2 (`useVaultBootstrap`) | `af9f118f` | 0 echte fixes (alleen rebase/version-bump/budget-update) | Schoon. |
| 3 (`useDiskConflictState` + `useMergeViewState`) | `19523362` | 2 (`1626bfe7`, `07749213`) | Beperkt; beide nodig voor stabiele ref-ownership. |
| 5 (`useInboxEditorState`) | `432d8f3c` | 1 (`926e08e2`, post-merge) | Beperkt; discipline-correctie. |
| 6 (`useEditorTabsState` + `workspaceOpenMarkdownCommand`) | `3fe83ab3` | 4 op de open branch (`7f359f88`, `f571e6c5`, `fa87623f`, `db919dae`) | Klein; merk wel op dat `fa87623f` een verloren dev-warning herstelt — een test had dat moeten vangen. |

### Cross-phase bevindingen

1. **Bridge-propagatie (kritiek):** Fase 6 introduceert een derde aanroepsite van `assignLegacyEditorWorkspaceTabs` in een nieuwe module (`workspaceOpenMarkdownCommand.ts`). Het plan onder Fase 1 verbood dit expliciet ("Geen nieuwe `*Bridge`/`*LegacySync` modules"). Gevolg: substappen 1.4–1.5 moeten nu twee plekken opruimen i.p.v. één, en `workspaceOpenMarkdownCommand` heeft een directe afhankelijkheid op legacy-mirror-API. Aanbeveling: niet mergen tot deze koppeling weg is, óf documenteer in de PR dat substappen 1.4–1.5 dit meenemen.

2. **Fase-volgorde-afwijking:** Fase 4 (tree-commands, ~600 LOC) is overgeslagen ten gunste van Fase 5 en 6. Het plan stond dit qua afhankelijkheden toe (Fase 4 was niet geblokkeerd door Fase 1), maar Fase 4 is nu de grootste resterende LOC-bron in de hoofdhook. Aanbeveling: Fase 4 is na sluiting van Fase 6-branch de logische volgende stap.

3. **TDD-discipline ongelijk verdeeld:** Fase 1 leverde de hoogste bug-density en kreeg daarom strikte TDD-eisen mid-flight. Fase 5 en Fase 6 zijn beide geslaagd, maar Fase 6-tests dekken de risico-paden van `runOpenMarkdownInEditorCommand` nog niet volledig (zie Fase 6 review). De empirische regel die fase 1 leverde — "blinde verplaatsing zonder vooraf-tests levert follow-up fixes op precies de risico-paden" — verdient herbevestiging als regel voor Fase 4 en Fase 6-merge.

4. **Smoke-test contract houdt het:** Het smoke-test bestand (`useMainWindowWorkspace.smoke.test.ts`) is een nuttig vangnet gebleken — geen valse positieven, geen false negatives gevonden. Bevestigd dat de return-shape ongewijzigd is. Let op: vereist `apps/desktop` als CWD voor vitest-config (happy-dom); rechtstreeks vanuit repo-root faalt met "document is not defined". Werk dit kort op in een tooling-note in de ADR of in `apps/desktop/README` als dit vaker terugkomt.

5. **Note-body cache invariant intact:** In de nieuwe modules zijn de mutaties van `lastPersistedRef`, `inboxContentByUriRef`, `lastPersistedExternalMutationSeqRef` en `setInboxContentByUri` consistent samen gehouden:
   - `useDiskConflictState.resolveDiskConflictReloadFromDisk` (alle vier samen)
   - `workspaceOpenMarkdownCommand.loadOpenedNoteBodyAndApplySelection` (alle vier samen, met `prefetchBody`-pad)
   - `useInboxEditorState.clearInboxSelection` raakt deze refs **niet** (gecorrigeerd in `926e08e2`).
   Geen geconstateerde regressies; de invariant uit `CLAUDE.md` "Desktop: Note body cache" is overal gerespecteerd.

6. **`useEditorTabsState`-shape is mager-pragmatisch:** levert tabs, activeId, beider refs, closedStack-ref + bump, plus afgeleide `canReopenClosedEditorTab`. Geen tab-commands (close/reorder/closeOther/closeAll/reopen) — die blijven in de hoofdhook. Dit klopt met "dunne facade" uit het plan; verdere consolidatie hoort thuis in Fase 8 of in een latere clean-up als het shadow-model schrijfpad authoritatief is.

7. **Geen `__resetForTests()` op de nieuwe state-store hooks** (open vraag werd "interne __resetForTests()" beantwoord). Vier van de zes nieuwe modules zijn pure state-stores die in tests via `renderHook` worden geprobeerd; daarvoor is `__resetForTests()` niet strikt nodig. Maar als ze later vanuit `vitest.setup.ts` worden hergebruikt of als hun ref-state lekt tussen tests, voldoet dit niet aan de afspraak. Aanbeveling: voeg een korte sectie aan de ADR toe die zegt "deze hooks zijn intentioneel test-via-renderHook; `__resetForTests()` is alleen vereist voor modulen met module-scope mutable state geïmporteerd uit `vitest.setup.ts`". Of voeg de helpers alsnog toe voor symmetrie.

### Aanbevolen volgende stappen (prioriteit)

1. **Substappen 1.4 + 1.5 afronden vóór Fase 4.** Anders erft Fase 4 dezelfde bridge-aanroepen. Volgorde uit Fase 1 plan blijft: eerst `mergeStoredHubWorkspaces` (smalste oppervlak), dan `projectWorkspaceRuntimeToModel`, dan home-history-bridge, tabs-bridge, active-bridge — elk in eigen PR met falende test eerst.
2. **Fase 6-merge afronden:** ofwel extra tests + bridge-cleanup erbij, ofwel expliciete TODO + scope-note in PR-body.
3. **Fase 4 starten** in 4 sub-PRs (delete, rename, move, bulk) zoals onder Fase 4 review uitgewerkt.
4. **ADR bijwerken** met de invarianten-checklist die in Fase 0 beloofd is en met de nieuwe modulekaart (open vraag was "ADR").
