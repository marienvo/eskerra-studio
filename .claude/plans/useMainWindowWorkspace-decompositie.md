# Decompositie-plan `useMainWindowWorkspace.ts`

**Status:** voorstel, niet uitgevoerd.
**Datum:** 2026-05-15
**Doel:** `apps/desktop/src/hooks/useMainWindowWorkspace.ts` van 4062 LOC → < 800 LOC orchestratie, met behoud van alle invarianten uit `CLAUDE.md` en `specs/`.
**Aanpak:** gefaseerd, klein per PR. Elke fase is onafhankelijk leverbaar, tests groen, geen gedragsverandering.

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

### Fase 0 — Baseline & meting (1 PR, klein)

**Geadviseerde LLM:** `GPT-5.4-Mini` — voldoende voor inventarisatie, ADR-tekst en een kleine smoke-test; lage kans op complexe codewijzigingen.

- Snapshot huidige LOC, importgraaf en test-coverage van `useMainWindowWorkspace.ts`.
- Voeg een ADR toe (`specs/adrs/adr-main-window-workspace-decompositie.md`) met deze doelarchitectuur en de invarianten-checklist die elke fase moet respecteren.
- Voeg een lichte "smoke"-test (Vitest) toe die de return-shape van de hook controleert (alle controllers aanwezig, geen `undefined` velden). Dient als regressie-vangnet voor latere fases.

**Acceptatie:** ADR gemerged, smoke-test groen, getallen vastgelegd.

---

### Fase 1 — Shadow-workspace-model migratie afmaken (groot, eigen mini-track)

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

---

### Fase 2 — `useVaultBootstrap` extraheren (1 PR)

**Geadviseerde LLM:** `GPT-5.3 Codex` — geschikt voor scoped extractie met async effecten, mocks en bestaande Vitest-paden.

- Verplaats: `vaultRoot`, `vaultSettings`, `settingsName`, `deviceInstanceId`, `initialVaultHydrateAttemptDone`, `busy`, `err`, `hydrateVault`, plugin-store load/save, first-launch effect, indexer-schedule, observability voor `vault_watch_start_failed`.
- Hook exposeert: `{vaultRoot, vaultSettings, setVaultSettings, settingsName, deviceInstanceId, initialVaultHydrateAttemptDone, busy, err, setErr, hydrateVault}`.
- `hydrateVault` blijft een dik command, maar het is intern aan deze hook; reset-fases (tabs, hub, frontmatter, composing) krijgt het via een `resetWorkspaceState` callback uit de parent.
- Tests: extraheer de bestaande `useMainWindowWorkspace.hydrateVault.test.ts` paths.

**Verwachte LOC-winst:** ~200.

---

### Fase 3 — `useDiskConflictState` + `useMergeViewState` extraheren (1 PR)

**Geadviseerde LLM:** `GPT-5.3 Codex` met hoge reasoning — disk-conflict en merge-flow zijn correctness-kritiek; laat het model expliciet testdekking en invarianten nalopen.

- `useDiskConflictState`: `diskConflict`, `diskConflictSoft`, beide refs, defer-timer ref, `resolveDiskConflictReloadFromDisk`, `resolveDiskConflictKeepLocal`, `elevateDiskConflictSoftToBlocking`, `dismissDiskConflictSoft`, `clearStaleDiskConflictsForOpen`.
- `useMergeViewState`: `mergeView`, `closeMergeView`, `tryEnterBackupMergeView`, `applyFullBackupFromMerge`, `keepMyEditsFromMerge`, `enterDiskConflictMergeView`, `applyMergedBodyFromMerge`.
- Bestaande helpers in `workspaceFsWatchReconcile.ts` blijven; dit verplaatst alleen state-eigendom.

**Verwachte LOC-winst:** ~310.

---

### Fase 4 — `workspaceTreeCommands.ts` (1 PR, evt. opgesplitst)

**Geadviseerde LLM:** `GPT-5.3 Codex` — beste match voor grote codeverplaatsing, expliciete context-objecten en testbare command-functies; splits bij voorkeur per tree-command cluster.

- Verplaats `deleteNote`, `deleteFolder`, `renameFolder`, `commitMovedArticleResult`, `commitMovedDirectoryResult`, `commitMoveVaultTreeResult`, `moveVaultTreeItem`, `bulkDeleteRemoveVaultEntry`, `bulkDeletePruneTabsAndScroll`, `bulkDeleteVaultTreeItems`, `bulkMoveVaultTreeItems` naar `workspaceTreeCommands.ts`.
- Elk command krijgt een expliciete context (`{vaultRoot, fs, refs, setters, dispatchers, subtreeMarkdownCache, ...}`).
- In de hook: één regel per command, bijv. `const deleteNote = useCallback(uri => runDeleteNote(uri, ctx), [...ctxDeps])`.
- Bouw `ctxDeps` uit een memoized "tree command context" zodat `useCallback`-deps niet exploderen.
- Tests: nieuw bestand `workspaceTreeCommands.test.ts` dat de pure command-functies test met mock setters/refs. Bestaande integratie-tests (`useMainWindowWorkspace.integration.*`) blijven het volle pad dekken.

**Verwachte LOC-winst:** ~600.

---

### Fase 5 — `useInboxEditorState` extraheren (1 PR)

**Geadviseerde LLM:** `GPT-5.3 Codex` — scoped React-hook extractie met veel refs en setter-contracten; medium reasoning is meestal genoeg, hoog bij testfalingen.

- Verplaats: `selectedUri`, `editorBody`, `inboxEditorResetNonce`, `composingNewEntry`, frontmatter inner+leading + refs, `suppressEditorOnChangeRef`, `eagerEditorLoadUriRef`, `editorShellScrollByUriRef`, `inboxEditorShellScrollDirectiveRef`, `lastInboxEditorActivityAtRef`, `skipRecencyDeferForUriRef`, `guardedSetEditorBody`, `loadFullMarkdownIntoInboxEditor`, `syncFrontmatterStateFromDisk`, `applyFrontmatterInnerChange`, `resetInboxEditorComposeState`, `clearInboxSelection`.
- Lever zowel state als de paar locale operaties uit één hook.
- Houd `inboxContentByUri` + `lastPersistedRef` apart (Fase 7), die hebben hun eigen invariant.

**Verwachte LOC-winst:** ~250.

---

### Fase 6 — `useEditorTabsState` + `workspaceOpenMarkdownCommand.ts` (1 PR)

**Geadviseerde LLM:** `GPT-5.5` voor ontwerp/risicoanalyse, daarna `GPT-5.3 Codex` voor implementatie — open-flow raakt tabplaatsing, body-load, scroll-restore en foreground/background gedrag.

- `useEditorTabsState`: nu het shadow-model authoritatief is (Fase 1), is dit feitelijk een dunne facade rond model-selectors + setters die `dispatchWorkspaceAction` aanroepen. `closedTabsStack` blijft locaal — die hoort bij tabs maar niet bij persistentie.
- `workspaceOpenMarkdownCommand.ts`: verplaats `prepareInboxScrollDirectiveForOpen`, `snapshotAndPersistCurrentNoteBeforeOpen`, `tryPrefetchTargetBody`, `loadOpenedNoteBodyAndApplySelection`, `applyBackgroundNewTabOpen`, `placeForegroundMarkdownOpen`, `openMarkdownInEditor`. Context-pattern net als Fase 4.

**Verwachte LOC-winst:** ~450.

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

- Wil je dat de state-store sub-hooks (`useInboxEditorState`, etc.) eigen `__resetForTests()` exposeren conform Vitest isolation regels, of testen we ze indirect via de orchestratie-hook?
- Is er een korte termijn waarin Fase 1 niet veilig kan (bv. lopende release-cut)? Dan Fase 2/3/5 eerst, Fase 1 daarna.
- Moet er een specs-update naar `specs/architecture/desktop-editor.md` met de nieuwe modulekaart, of houden we het in een ADR?
