# Review fase 7–10 `useMainWindowWorkspace`-decompositie

**Datum:** 2026-05-16
**Scope:** review van fase 7 (`useNotesListing` + `useInboxBodyCache`), fase 8
(`useTodayHubsState`), fase 9 (compose-commands + `useInboxShellRestore`) en
fase 10 (eindopruiming) uit `.claude/plans/useMainWindowWorkspace-decompositie.md`.
Substappen 1.4–1.5 van fase 1 zijn tussendoor gemerged (`dc7a9905`, `973a601d`,
`6ca8cfc5`, `61ce55fb`, `11ced708`, `021d1769`) — de bridge-propagatie die in de
vorige review werd genoemd is dus tussen fase 4 en 7 weggewerkt. Goed.

---

## Cijfermatige stand

| Metric | Baseline (fase 0) | Na fase 0–6 | Na fase 7–10 | Delta vs. baseline |
|---|---:|---:|---:|---:|
| `useMainWindowWorkspace.ts` LOC | 4062 | 3369 | **2043** | −2019 (−50%) |
| `useState` + `useRef` in hoofdhook | ~55 | 12 | 28 (3 state + 25 ref) | −49% |
| `useEffect`/`useLayoutEffect` in hoofdhook | ~30 | 27 | 19 | −37% |
| Geëxtraheerde modules met eigen state/command | 0 | 6 | **11** | +11 |

**Plan-eindstand:** 600–800 LOC, uitsluitend orchestratie. **Werkelijk:** 2043
LOC. Het hoofddoel is **niet** gehaald — 2.5× over budget.

Geëxtraheerde modules (LOC, exclusief tests):
- fase 7: `useNotesListing` 67, `useInboxBodyCache` 76
- fase 8: `useTodayHubsState` **901**
- fase 9: `workspaceComposeCommands` 205, `useInboxShellRestore` 323

Totaal nieuw in fase 7–10: **1572 LOC**. Hoofdhook kromp **1326 LOC** in dezelfde
periode. Het verschil van ~246 LOC is wiring + nieuwe ref-mirror-effecten.

---

## Per fase

### Fase 7 — `useNotesListing` + `useInboxBodyCache`

**Schoon:**
- `useNotesListing` (67 LOC, 71 LOC test, 2 tests) — kort, één verantwoordelijkheid,
  generation-counter goed beschermd. Vier subnonces (`fsRefreshNonce`,
  `podcastFsNonce`, `vaultTreeSelectionClearNonce`) zitten erbij omdat ze
  conceptueel met "iets in de vault is veranderd" te maken hebben — dat klopt.
- `hasLastPersistedCacheMismatch` helper toegevoegd — voldoet aan plan-eis
  "voeg een cache-consistentie-test toe die `lastPersistedRef` mismatches
  detecteert".

**Kritiek — invariant niet centralised:**

Het plan was duidelijk:

> `useInboxBodyCache`: … Houdt de invariant uit `CLAUDE.md` "Desktop: Note body
> cache" expliciet in één plek; **alle mutaties gaan door deze hook (set/remove/heal).**

`useInboxBodyCache` exporteert nu `setLastPersistedSnapshot` en
`clearLastPersistedSnapshot` als API om dat af te dwingen. **Geen enkele
call-site in `useMainWindowWorkspace.ts` gebruikt deze API.** Tellingen:

- Directe `lastPersistedRef.current = …` toewijzingen in de hoofdhook: 7
  (regels 666, 889, 1108, 1177, 1308, 1321, 1419).
- Directe `lastPersistedExternalMutationSeqRef.current += 1` bumps in de
  hoofdhook: 7 (regels 667, 890, 1109, 1178, 1309, 1322, 1420).
- In `workspaceComposeCommands.ts` `runStartNewEntry` (regels 109–110): nog een
  paar direct mutations.
- `hasLastPersistedCacheMismatch` wordt nergens in productiecode aangeroepen
  (alleen in zijn eigen test). Dead helper.
- `setLastPersistedSnapshot` / `clearLastPersistedSnapshot` worden nergens
  aangeroepen behalve in `useInboxBodyCache.test.ts`. Dead API.

CLAUDE.md regel 198 zegt nu:
> Primary ownership now lives in: `apps/desktop/src/hooks/useInboxBodyCache.ts`
> (state + refs)

Dat is misleidend: de **state** zit er, de **mutatie-discipline** niet. Iemand
die op die regel afgaat denkt dat de invariant nu lokaal handhaafbaar is, terwijl
elke regressie nog steeds in `useMainWindowWorkspace.ts` ontstaat.

**Verwachte LOC-winst plan:** ~150. **Werkelijk:** ~63 LOC uit hoofdhook gehaald
(3369 → 3306 over commit `92c94a9a`).

**Aanbeveling (TDD-volgorde):**
1. Schrijf een test in `useInboxBodyCache.test.ts` die asserteert dat
   `setLastPersistedSnapshot({uri, markdown})` consistent
   `lastPersistedRef.current` + de seq-bump doet. Bestaat al.
2. Vervang de 7 directe mutaties in `useMainWindowWorkspace.ts` één-voor-één
   door `setLastPersistedSnapshot` / `clearLastPersistedSnapshot`. Eén commit
   per call-site, met focus-test op de gedragspath.
3. Doe hetzelfde voor `workspaceComposeCommands.ts:109-110`.
4. Voeg een lint-regel of fitness-functie toe die rauwe `lastPersistedRef.current =`
   buiten `useInboxBodyCache.ts` blokkeert. Anders kruipt dit weer terug.
5. Als dat klaar is, update CLAUDE.md regel 198 om te zeggen dat **mutaties
   uitsluitend via** `setLastPersistedSnapshot`/`clearLastPersistedSnapshot` gaan,
   en update ADR 002.

---

### Fase 8 — `useTodayHubsState`

**Schoon:**
- Grote verplaatsing: in commit `78c40823` ging de hoofdhook van 3306 → 2547
  (−760 LOC) terwijl `useTodayHubsState` 901 LOC binnenkreeg. Hub-switch,
  prehydrate-rows, persist-row, clean-row-blocking, selector-derivaties en
  home-history operaties zijn nu in één plek.
- Smoke-test + nieuwe tests groen. Geen geconstateerde regressie tijdens deze
  fase.

**Kritiek — de "state-store" is een nieuw god-module geworden:**

Het plan beschreef `useTodayHubsState` als een **state-store**: een hook die
"een coherent stukje state + zijn refs + zijn primaire setters bezit". Bedoeld
als concept tegen het probleem "helpers zijn pure functies die setters + refs
als argumenten krijgen. Iedere helper-aanroep is daardoor bijna even groot als
de helper zelf."

In de praktijk:

- `UseTodayHubsStateArgs` heeft **70+ properties** (regels 99–167 van
  `useTodayHubsState.ts`) — alle vault-state, alle editor-refs, alle dispatchers,
  alle setters, plus alle bridge-callbacks.
- Het module-LOC-budget (901) is groter dan elke andere geëxtraheerde module
  inclusief de vorige god-module (`workspaceOpenMarkdownCommand` was 374). Dit
  is de grootste *single file* in `apps/desktop/src/hooks/` na de hoofdhook.
- Testdekking: **2 tests** (`pushHomeHistoryForHub` mirror + clean-row-blocked
  voor disk-conflict-URI). Hub-switch, prehydrate-rows, persist-row,
  shell-restore-model-sync, `syncHubWorkspacesToVaultTodayRefsAction`
  watcher-effect — niet apart getest.

Dit valideert de regel uit fase 1: "blinde verplaatsing zonder vooraf-tests
levert follow-up fixes op precies de risico-paden". Hier is nog niets
gerapporteerd, maar het oppervlak is groot en de test-vangnet smal. Het feit
dat geen follow-up-commits nodig waren kan ook betekenen dat issues nog niet
gevonden zijn — niet dat ze er niet zijn.

**Aanbeveling:**
1. Splits `useTodayHubsState` in twee modules:
   - `useTodayHubsState.ts` — pure state-store: `activeTodayHubUri`,
     `homeStatesByHub`, hun refs, en mutators (`setHomeStateForHub`,
     `pushHomeHistoryForHub`, `replaceHomeStatesByHub`,
     `remapHomeStatesPrefix`, `removeHomeHistoryUris`,
     `projectHomeStatesFromModel`).
   - `useTodayHubsOrchestration.ts` (of houd `workspaceTodayHubSwitch.ts` als
     hub-switch-eigenaar) — alles wat met persistence, prehydrate,
     vault-refs-sync, hub-switch en derived selectors te maken heeft, geroepen
     vanuit de hoofdhook.
2. Voeg per command een focus-test toe:
   - `prehydrateTodayHubRows`: rij ontbreekt op disk → maakt aan; rij bestaat
     met inhoud → blijft staan.
   - `persistTodayHubRow`: schrijft genormaliseerd, werkt
     `todayHubRowLastPersistedRef` bij, faalt graceful op exception.
   - `switchTodayHubWorkspace`: actieve hub flush, model-dispatch, tabs +
     home-state mirror.
   - `syncHubWorkspacesToVaultTodayRefsAction` watcher-effect: niet prunen vóór
     `vaultMarkdownRefsReady` (volgt uit eerdere bug).
3. Documenteer in CLAUDE.md (regel 208 — vault disk sync invariants) dat
   `useTodayHubsState.ts` ook eigenaar is van Today-row-disk-cache
   (`todayHubRowLastPersistedRef`); nu staat het bestand er wel, maar zonder uitleg.

---

### Fase 9 — Compose-commands + `useInboxShellRestore`

**Schoon:**
- `workspaceComposeCommands.ts` (205 LOC, 103 LOC test, 3 tests): netjes
  context-pattern, vier publieke `run*`-functies. Goed.
- `useInboxShellRestore.ts` (323 LOC): de grote restore-`useEffect` is netjes
  geïsoleerd, plus drie callback-wrappers naar de bestaande bridges. Eén
  duidelijke verantwoordelijkheid. Goed.

**Kritiek 1 — bridge-propagatie herhaald:**

`workspaceComposeCommands.ts` regel 109–110 doet:

```ts
ctx.refs.lastPersistedRef.current = null;
ctx.refs.lastPersistedExternalMutationSeqRef.current += 1;
```

Dit is precies hetzelfde patroon dat de vorige review in fase 6 als
"bridge-propagatie"-overtreding markeerde: een nieuwe module die de
te-consolideren API omzeilt en de oude rauwe ref-mutatie kopieert. Het werd
toen voorspeld dat dit zou herhalen als fase 7 niet eerst de centrale API
verplicht maakt. Fase 7 maakte de API beschikbaar maar niet verplicht; fase 9
omzeilt 'm vrolijk.

**Kritiek 2 — overgeslagen plan-onderdelen:**

Plan, fase 9:
> Editor-history (`activeTabHistory`, `activeHomeState`, `canGoBack`/`Forward`,
> `editorHistoryGoBack`/`GoForward`, `openCurrentHomeAfterComposing`,
> `moveHomeHistory`): zit dichter bij tabs, daar laten of een dunne
> `useEditorHistory` ernaast.

Resultaat: gelaten in de hoofdhook (regels 1769–1898, ~130 LOC). Geen
`useEditorHistory`-extractie. De plan-zin liet de keuze open, dus dit is geen
overtreding, maar wel een gemiste kans om verder af te slanken.

Plan-eindstand (fase 10): "Verwijder onnodige state↔ref-mirror-effects waar de
refs door state-stores zelf onderhouden worden." De hoofdhook heeft nog 19
useEffect/useLayoutEffect-blokken (regels 391, 415, 419, 432, 470, 517, 784,
825, 847, 1182, 1186, 1250, 1279, 1337, 1355, 1379, 1406, 1680, 1704). Een
inventarisatie laat zien dat ongeveer de helft hiervan callback-refs sync voor
hydrate/merge/open-flows (legitiem — refs bewust gebruikt om cycli te breken)
en de andere helft data-effecten zijn (vaultMarkdownRefs scan, editor restore,
backlinks debounce, disk-read). Niets onnodig. Plan-doel haalbaar gemaakt, maar
de hoofdhook blijft de wiring-laag — daar is een budget van 600–800 LOC voor te
weinig.

**Kritiek 3 — tab-commands niet geëxtraheerd in welke fase dan ook:**

`closeEditorTab` (54 LOC), `closeOtherEditorTabs` (62 LOC), `closeAllEditorTabs`
(58 LOC), `reorderEditorWorkspaceTabs` (35 LOC), `reopenLastClosedEditorTab`
(20 LOC), `activateOpenTab` (18 LOC), `selectNote` (33 LOC),
`selectNoteInNewActiveTab` (16 LOC), `refocusAfterClosingActiveTab` (39 LOC),
`refocusAfterActiveTabRemoved` (23 LOC) — samen ~358 LOC. Geen enkele fase had
deze in scope, terwijl ze qua structuur identiek zijn aan de tree-commands
(fase 4) en de open-markdown-command (fase 6): grote multi-step callbacks die
zes tot tien refs/setters/dispatchers consumeren. Ze passen één-op-één in een
`workspaceTabCommands.ts` met `TabCommandContext`.

Dit is veruit de grootste LOC-bron die over is. Een afgeleide fase 11
(`workspaceTabCommands.ts`) zou de hoofdhook naar verwachting naar ~1650 LOC
brengen. Geen extra fasen erna en het plan-budget blijft buiten bereik.

**Kritiek 4 — duplicatie:**

`replaceRuntimeActiveHub` en `replaceRuntimeActiveSurfaceTab` zijn nu
gedupliceerd in `useMainWindowWorkspace.ts` (regels 158–174) en
`useInboxShellRestore.ts` (regels 40–47). Klein, maar een signaal dat hub-state
ownership niet helemaal landde in `useTodayHubsState`. Suggestie: laat
`useTodayHubsState` deze setters exposeren, importeer ze daar.

---

### Fase 10 — Eindopruiming

**Schoon:**
- `CLAUDE.md` regel 198 bijgewerkt met `useInboxBodyCache.ts`.
- Header-comment van `useMainWindowWorkspace.ts` bijgewerkt (regels 1–11)
  met de juiste module-eigenaarslijst.
- `scripts/module-budget-baseline.json` bijgewerkt.
- Ref-mirror-effecten zijn van 27 naar 19 gegaan; de overgebleven 19 zijn
  inhoudelijk gerechtvaardigd (zie boven).

**Kritiek — ADR 002 is niet bijgewerkt:**

`specs/adrs/002-adr-main-window-workspace-decompositie.md`:
- Sectie heet nog **"Post–Phase 4 snapshot (2026-05-16)"** met LOC-tabel
  4062 → 2866. Dat is een verouderde snapshot.
- "Orchestration module map" (regels 38–47) bevat 7 modules — mist
  `useNotesListing`, `useInboxBodyCache`, `useTodayHubsState`,
  `useInboxShellRestore`, `workspaceComposeCommands` (5 nieuwe modules).
- Sectie "Forward work (Phases 7–10)" (regels 53–55) leest als nog-te-doen
  werk, terwijl die fases gemerged zijn.

Plan, fase 10:
> Werk de header-comment van `useMainWindowWorkspace.ts` bij. Update CLAUDE.md
> "Desktop: Note body cache" en "Vault disk sync invariants" met de nieuwe
> bestandspaden waar de invariant gehandhaafd wordt.

Hoofdhook-header en CLAUDE.md zijn gedaan; ADR is over het hoofd gezien. Het
project gebruikt de ADR als authoritative snapshot — dit is een
maintenance-gat.

**Aanbeveling:**
1. Vervang sectie "Post–Phase 4 snapshot" door **"Post–Phase 10 snapshot
   (2026-05-16)"** met LOC-tabel:
   - `useMainWindowWorkspace.ts` 2043
   - `useNotesListing.ts` 67 / test 71
   - `useInboxBodyCache.ts` 76 / test 83
   - `useTodayHubsState.ts` 901 / test 133
   - `useInboxShellRestore.ts` 323
   - `workspaceComposeCommands.ts` 205 / test 103
2. Voeg de 5 nieuwe modules toe aan de "Orchestration module map".
3. Hernoem "Forward work (Phases 7–10)" naar "Forward work (Phase 11+: tab
   commands, lastPersisted invariant consolidation, useTodayHubsState split)"
   met de openstaande punten uit deze review.
4. Voeg een regel toe aan de "Per-phase invariants checklist" (regel 84+) die
   zegt: "mutaties van `lastPersistedRef` / `lastPersistedExternalMutationSeqRef`
   gaan uitsluitend via `setLastPersistedSnapshot` /
   `clearLastPersistedSnapshot` van `useInboxBodyCache`". Pas dit pas toe nadat
   de call-sites zijn gemigreerd (anders is de regel direct geschonden).

---

## Cross-phase observaties

### TDD-discipline ongelijk verdeeld (bekend probleem, herhaald)

Vorige review noteerde dit als regel: "blinde verplaatsing zonder vooraf-tests
levert follow-up fixes op precies de risico-paden". Resultaat in fase 7–10:

| Fase | Module | LOC | Tests | Test-LOC | Bug-fix-commits |
|---|---|---:|---:|---:|---:|
| 7 | `useNotesListing` | 67 | 2 | 71 | 0 |
| 7 | `useInboxBodyCache` | 76 | 3 | 83 | 0 |
| 8 | `useTodayHubsState` | 901 | 2 | 133 | 0 |
| 9 | `workspaceComposeCommands` | 205 | 3 | 103 | 0 |
| 9 | `useInboxShellRestore` | 323 | 0 | 0 | 0 |

Geen follow-up fixes — superficieel goed nieuws. Maar de test/LOC-ratio's voor
fase 8 (133/901 = 15%) en fase 9 shell-restore (0/323) zijn dunste van de hele
decompositie. Combineer dat met "geen on-device verificatie van hub-switch /
shell-restore gerapporteerd in commits" en de werkelijke risicodichtheid is
onbekend. Aanbeveling: voer voor fase 8 en fase 9 alsnog focus-tests in op de
risico-paden zoals hierboven beschreven (hub-switch, prehydrate-rows,
restore-bridge), idealiter vóór de fase 11 tab-commands gestart wordt.

### "State-store"-patroon is verschoven

Het oorspronkelijke plan onderscheidde scherp:
- **State-stores** (sub-hooks die state + refs + lokale setters bezitten).
- **Command-modules** (pure async functies met expliciete context).

Vanaf fase 6 (`workspaceOpenMarkdownCommand` met 51-property context) tot
fase 8 (`useTodayHubsState` met 70+ args) is dat onderscheid verwaterd. Een
"state-store" met 70 args is functioneel een command-module — alleen
verkleed als een hook. Het probleem dat het plan beschreef — "iedere
helper-aanroep is bijna even groot als de helper zelf" — is niet opgelost;
het is verplaatst van per-callback in de hoofdhook naar per-hook-aanroep
in de hoofdhook.

Voor een echte vermindering moet een state-store ofwel **veel meer state lokaal
maken** (gebeurde wel met `useDiskConflictState`, `useMergeViewState`,
`useInboxEditorState` — vandaar de schone fase 3 en 5), ofwel **veel meer
state extern halen** (zoals het shadow-model dat fase 1 deed). Het tussenmodel
"alle refs als argumenten" geeft een grote module, een grote args-list, en
geen netto-vereenvoudiging.

---

## Open punten — aanbevolen vervolg

Geordend op kosten-baten:

1. **Consolideer `lastPersisted*`-mutaties (fase 7 afmaken).** Klein,
   correctness-kritiek, ~7 call-sites in hoofdhook + 1 in
   `workspaceComposeCommands.ts`. TDD-volgorde uit fase 7-review boven.
   Verwachte LOC-winst: <50 in hoofdhook; **belangrijkste winst is
   invariant-handhaving**.
2. **Extracteer tab-commands naar `workspaceTabCommands.ts` (fase 11).**
   Grootste resterende LOC-bron in hoofdhook (~358 LOC). Volg patronen van
   fase 4 en 6: één `TabCommandContext` useMemo, één regel per command in de
   hoofdhook. Verwachte LOC-winst hoofdhook: ~300 (na wiring-overhead).
   Hoofdhook → ~1700–1750 LOC.
3. **Update ADR 002 (fase 10 afmaken).** Halve dag werk, voorkomt
   plan-rot. Beschreven onder fase 10 hierboven.
4. **Voeg risico-pad-tests toe voor fase 8 en 9.** Hub-switch,
   prehydrate-rows, persist-row, shell-restore-bridge. Niet blokkerend
   voor verdere extractie maar wel verstandig vóór fase 11 op deze
   structuur bouwt.
5. **(Optioneel) Splits `useTodayHubsState` in state-store + orchestratie.**
   Plan-conformant; verlaagt cognitieve last per file maar voegt geen
   LOC-winst toe aan de hoofdhook.
6. **(Optioneel) `useEditorHistory` extraheren.** ~130 LOC uit de hoofdhook
   naar een dunne hook. Plan stond dit als "of-of" toe.

Het 600–800 LOC-eindstand-doel is realistisch alleen als 1+2+5+6 samen gebeuren.
Met alleen 1+2 zit de hoofdhook rond 1700 LOC. Dat is een eerlijker target voor
"hoofdorchestrator met expliciete wiring naar gedecomposeerde state-stores en
commands" gegeven het werkelijke aantal verantwoordelijkheden dat het
oorspronkelijke plan opsomde.

---

## Conclusie

Fase 7–10 hebben de hoofdhook van 3369 naar 2043 LOC gebracht — 39% reductie,
50% reductie t.o.v. baseline. Vijf nieuwe modules geëxtraheerd, smoke-test +
nieuwe tests groen, geen geconstateerde regressies, geen follow-up bug-fixes.
Dit is een degelijk uitvoeringsresultaat per fase.

Het **plan-eindstand-doel** (600–800 LOC, plus invariant-consolidatie) is niet
gehaald. Drie concrete oorzaken:

1. **Fase 7 leverde een API maar geen migratie.** Het belangrijkste
   correctness-doel van fase 7 — alle `lastPersistedRef`-mutaties door één hook
   laten lopen — is bouwwerk zonder bewoners. De API staat klaar, niemand
   gebruikt 'm, CLAUDE.md suggereert dat het wel zo werkt.
2. **Fase 8 maakte een god-module van 901 LOC met 70+ args.** Plan-conform qua
   verplaatsing maar niet qua "state-store"-doel. Testdekking is dun voor het
   oppervlak.
3. **Tab-commands zijn nooit gepland.** Dit is een gat in het oorspronkelijke
   plan (fase 6 noemde `useEditorTabsState` als "dunne facade" maar liet de
   commands zelf in de hoofdhook). ~358 LOC blijft daardoor in de orchestrator.

**Aanbeveling voor afhandeling van het oude plan-bestand:** `useMainWindowWorkspace-decompositie.md`
kan weg zodra ADR 002 is bijgewerkt met de post-fase-10 snapshot en
openstaande punten 1–4 hierboven in een issue of nieuwe plan-stub zijn geland.
Op dit moment is het oude plan-bestand de enige plek waar de fase 11-context
en de invariant-consolidatie-volgorde voor `lastPersisted` zijn vastgelegd —
weggooien zonder die info te verplaatsen verliest context.
