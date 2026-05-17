import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  buildInboxWikiLinkCompletionCandidates,
  type VaultMarkdownRef,
} from '@eskerra/core';

import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorHandle,
} from '../editor/noteEditor/NoteMarkdownEditor';
import {createNoteInboxAttachmentHost} from '../lib/noteInboxAttachmentHost';
import {
  inboxRelativeMarkdownLinkHrefIsResolved,
  inboxWikiLinkTargetIsResolved,
} from '../lib/inboxWikiLinkNavigation';
import {resolveVaultImagePreviewUrl} from '../lib/resolveVaultImagePreviewUrl';
import {
  cleanNoteMarkdownBody,
  CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH,
} from '../lib/markdown/cleanNote';
import {
  enumerateTodayHubWeekStarts,
  hubCellStableSessionKey,
  hubCellWarmKey,
  mergeTodayHubRowAfterCleaningNonEmptyColumns,
  mergeTodayRowColumns,
  splitTodayRowIntoColumns,
  todayHubColumnCount,
  todayHubRowUri,
  todayHubWeekEndInclusive,
  todayHubWeekProgress,
  touchWarmLru,
  type TodayHubWorkspaceBridge,
  type TodayHubSettings,
} from '../lib/todayHub';
import {INBOX_AUTOSAVE_DEBOUNCE_MS} from '../lib/inboxAutosaveScheduler';
import {todayHubPerfEnabled, todayHubPerfLog} from '../lib/todayHub/todayHubPerf';
import {todayHubStaticCellDocOffsetFromPointer} from '../lib/todayHub/todayHubCellStaticPointer';
import {
  todayHubCanvasCellSurface,
  todayHubCanvasCellWarmOrActive,
} from '../lib/todayHub/todayHubCanvasCellLayout';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';
import {TodayHubCellStaticRichText} from './TodayHubCellStaticRichText';
import {TodayWeekProgressBar} from './TodayWeekProgressBar';

/**
 * Cap simultaneous warm (read-only underlay) hub cells. Too few evictions churn CM mounts (flicker).
 * Two columns × several weeks quickly exceeds a small cap; logs showed ~7 distinct cells touched while max was 4.
 */
const MAX_HUB_WARM_CELLS = 8;

type TodayHubCanvasProps = {
  vaultRoot: string;
  /** Currently open hub note `…/Today.md` (canonical vault URI). */
  todayNoteUri: string;
  hubSettings: TodayHubSettings;
  inboxContentByUri: Record<string, string>;
  vaultMarkdownRefs: VaultMarkdownRef[];
  /** Bridge methods assigned by this component; workspace reads for flush + wiki parent. */
  bridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  wikiNavParentRef: MutableRefObject<string | null>;
  cellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  onEditorError: (message: string) => void;
  onSaveShortcut: () => void;
  prehydrateTodayHubRows: (rowUris: readonly string[]) => Promise<void>;
  persistTodayHubRow: (
    rowUri: string,
    mergedMarkdown: string,
    columnCount: number,
  ) => Promise<void>;
  /** When true for a week row URI, skip cleaning that row (disk conflict). */
  todayHubCleanRowBlocked?: (rowUri: string) => boolean;
  linkSnippetBlockedDomains?: ReadonlyArray<string>;
  onMuteLinkSnippetDomain?: (domain: string) => void;
};

function normUri(u: string): string {
  return u.replace(/\\/g, '/');
}

/** Merge row file body using the latest in-memory column sections when present (avoids stale closures on debounced save). */
function mergedMarkdownForTodayHubRow(
  rowUri: string,
  columnCount: number,
  localSectionsByRow: Record<string, string[]>,
  inboxByUri: Record<string, string>,
): string {
  const key = normUri(rowUri);
  const sections = localSectionsByRow[key];
  if (sections) {
    return mergeTodayRowColumns(sections);
  }
  const raw = inboxByUri[key] ?? '';
  return mergeTodayRowColumns(splitTodayRowIntoColumns(raw, columnCount));
}

type TodayHubReadonlyCellInteractiveProps = {
  role: 'button';
  tabIndex: 0;
  'aria-label': string | undefined;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  onClick: (e: ReactMouseEvent) => void;
};

/**
 * Single stable DOM for hub cells: CodeMirror host + static overlay. Avoids remounting the editor
 * when toggling edit mode; keeps static preview on top until cold-open CM is ready (no white flash).
 */
function TodayHubCanvasNonEmptyCell({
  stackClassName,
  editing,
  isWarm,
  warmOrActive,
  canPrewarm,
  readonlyInteractiveProps,
  staticPreview,
  cmChild,
}: {
  stackClassName: string;
  editing: boolean;
  isWarm: boolean;
  warmOrActive: boolean;
  canPrewarm: boolean;
  readonlyInteractiveProps: TodayHubReadonlyCellInteractiveProps;
  staticPreview: ReactNode;
  cmChild: ReactNode;
}): ReactElement {
  const [coldSurfaceReady, setColdSurfaceReady] = useState(false);

  /** Warm cells already mount a laid-out CM under the static overlay; skip hold→buried on first edit frame. */
  const warmSurfaceInstant = editing && isWarm;
  const cmSurfaceReady = warmSurfaceInstant || (editing && coldSurfaceReady);

  useLayoutEffect(() => {
    if (!editing) {
      queueMicrotask(() => {
        setColdSurfaceReady(false);
      });
      return;
    }
    if (isWarm) {
      // Surface readiness is derived during render; do not schedule cold rAF.
      return;
    }
    queueMicrotask(() => {
      setColdSurfaceReady(false);
    });
    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setColdSurfaceReady(true);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [editing, isWarm, canPrewarm]);

  let cmHostClass = 'today-hub-canvas__cm-host today-hub-canvas__cell-hub-underlay--dormant';
  if (editing) {
    cmHostClass = `today-hub-canvas__cm-host today-hub-canvas__cm-host--editing${
      cmSurfaceReady ? ' today-hub-canvas__cm-host--surface-ready' : ''
    }`;
  } else if (warmOrActive) {
    cmHostClass = 'today-hub-canvas__cm-host today-hub-canvas__cell-warm-underlay';
  }

  const readonlyClassNames = [
    'today-hub-canvas__cell-readonly',
    !editing && isWarm ? 'today-hub-canvas__cell-warm-overlay' : '',
    editing &&
      (cmSurfaceReady
        ? 'today-hub-canvas__cell-readonly--editing-buried'
        : 'today-hub-canvas__cell-readonly--editing-hold'),
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={stackClassName}>
      <div className={cmHostClass}>{cmChild}</div>
      <div
        {...(editing ? {} : readonlyInteractiveProps)}
        className={readonlyClassNames}
        aria-hidden={editing ? true : undefined}
      >
        {staticPreview}
      </div>
    </div>
  );
}

function scheduleHubCellFocusWithPointerCaret(
  apply: () => void,
  pendingGenMatches: () => boolean,
): void {
  queueMicrotask(() => {
    apply();
    if (!pendingGenMatches()) {
      return;
    }
    requestAnimationFrame(() => {
      apply();
      if (!pendingGenMatches()) {
        return;
      }
      requestAnimationFrame(() => {
        apply();
      });
    });
  });
}

function scheduleHubCellFocusKeyboardRaf(apply: () => void, pendingGenMatches: () => boolean): void {
  apply();
  if (pendingGenMatches()) {
    requestAnimationFrame(() => {
      apply();
    });
  }
}

function runHubWarmPointerEnter(
  canPrewarm: boolean,
  warmKey: string,
  warmOrder: readonly string[],
  uri: string,
  ci: number,
  hubWarmDeferGenRef: MutableRefObject<Record<string, number>>,
  touchWarmForCell: (u: string, c: number) => void,
): void {
  if (!canPrewarm) {
    return;
  }
  if (warmOrder.includes(warmKey)) {
    touchWarmForCell(uri, ci);
    return;
  }
  const genMap = hubWarmDeferGenRef.current;
  genMap[warmKey] = (genMap[warmKey] ?? 0) + 1;
  const deferGen = genMap[warmKey]!;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (hubWarmDeferGenRef.current[warmKey] !== deferGen) {
        return;
      }
      touchWarmForCell(uri, ci);
    });
  });
}

export function TodayHubCanvas({
  vaultRoot,
  todayNoteUri,
  hubSettings,
  inboxContentByUri,
  vaultMarkdownRefs,
  bridgeRef,
  wikiNavParentRef,
  cellEditorRef,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  onEditorError,
  onSaveShortcut,
  prehydrateTodayHubRows,
  persistTodayHubRow,
  todayHubCleanRowBlocked,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
}: TodayHubCanvasProps) {
  const hubDirectoryUri = useMemo(
    () => normUri(todayNoteUri).replace(/\/[^/]+$/, ''),
    [todayNoteUri],
  );

  const columnCount = todayHubColumnCount(hubSettings);

  /** Stable "now" for week progress cells so rows do not disagree within one paint. */
  const progressComparisonNow = useMemo(() => new Date(), []);

  const weekStarts = useMemo(
    () => enumerateTodayHubWeekStarts(new Date(), hubSettings.start),
    [hubSettings.start],
  );

  const rowUris = useMemo(
    () => weekStarts.map(d => todayHubRowUri(hubDirectoryUri, d)),
    [weekStarts, hubDirectoryUri],
  );

  const rowUrisRef = useRef(rowUris);
  useLayoutEffect(() => {
    rowUrisRef.current = rowUris;
  }, [rowUris]);

  const visibleWeekStarts = weekStarts;

  const noteRefs = useMemo(
    () => vaultMarkdownRefs.map(r => ({name: r.name, uri: r.uri})),
    [vaultMarkdownRefs],
  );

  const [active, setActive] = useState<{uri: string; col: number} | null>(null);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  /** LRU order of `hubCellWarmKey`; warm is optional — never required for correctness. */
  const [warmOrder, setWarmOrder] = useState<string[]>([]);
  /** Invalidates pending double-rAF warm scheduling when the pointer leaves the cell. */
  const hubWarmDeferGenRef = useRef<Record<string, number>>({});
  const hubOpenPerfT0Ref = useRef(0);

  const wikiLinkCompletionCandidates = useMemo(
    () => buildInboxWikiLinkCompletionCandidates(noteRefs),
    [noteRefs],
  );

  const relativeMarkdownLinkHrefIsResolvedByRowUri = useMemo(() => {
    const m = new Map<string, (href: string) => boolean>();
    for (const ru of rowUris) {
      const k = normUri(ru);
      m.set(k, href =>
        inboxRelativeMarkdownLinkHrefIsResolved(noteRefs, k, vaultRoot, href),
      );
    }
    return m;
  }, [rowUris, noteRefs, vaultRoot]);

  const wikiLinkTargetIsResolvedByRowUri = useMemo(() => {
    const m = new Map<string, (inner: string) => boolean>();
    for (const ru of rowUris) {
      const k = normUri(ru);
      m.set(k, inner =>
        inboxWikiLinkTargetIsResolved(noteRefs, inner, {
          vaultRoot,
          sourceMarkdownUriOrDir: k,
        }),
      );
    }
    return m;
  }, [rowUris, noteRefs, vaultRoot]);

  const inboxAttachmentHost = useMemo(() => createNoteInboxAttachmentHost(), []);
  const [localRowSections, setLocalRowSections] = useState<Record<string, string[]>>(
    {},
  );

  const debounceTimerRef = useRef<number | null>(null);
  const pendingPersistRef = useRef<{uri: string; columnCount: number} | null>(null);
  const inboxContentByUriRef = useRef(inboxContentByUri);
  const localRowSectionsRef = useRef<Record<string, string[]>>({});
  /** Latest hub cell focus request: monotonic gen + optional caret (consumed by focus effect). */
  const hubCellFocusGenerationRef = useRef(0);
  const pendingHubCellFocusRef = useRef<{
    gen: number;
    caret: number | null;
  } | null>(null);

  useLayoutEffect(() => {
    inboxContentByUriRef.current = inboxContentByUri;
  }, [inboxContentByUri]);

  useLayoutEffect(() => {
    localRowSectionsRef.current = localRowSections;
  }, [localRowSections]);

  useEffect(() => {
    void prehydrateTodayHubRows(rowUris);
  }, [prehydrateTodayHubRows, rowUris]);

  const getSections = useCallback(
    (uri: string): string[] => {
      const key = normUri(uri);
      if (localRowSections[key]) {
        return localRowSections[key];
      }
      const raw = inboxContentByUri[key] ?? '';
      return splitTodayRowIntoColumns(raw, columnCount);
    },
    [localRowSections, inboxContentByUri, columnCount],
  );

  const flushScheduledPersist = useCallback(async () => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const pending = pendingPersistRef.current;
    pendingPersistRef.current = null;
    if (pending) {
      const merged = mergedMarkdownForTodayHubRow(
        pending.uri,
        pending.columnCount,
        localRowSectionsRef.current,
        inboxContentByUriRef.current,
      );
      await persistTodayHubRow(pending.uri, merged, pending.columnCount);
    }
  }, [persistTodayHubRow]);

  const schedulePersist = useCallback(
    (uri: string) => {
      pendingPersistRef.current = {uri, columnCount};
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void (async () => {
          const p = pendingPersistRef.current;
          pendingPersistRef.current = null;
          if (!p) {
            return;
          }
          const merged = mergedMarkdownForTodayHubRow(
            p.uri,
            p.columnCount,
            localRowSectionsRef.current,
            inboxContentByUriRef.current,
          );
          await persistTodayHubRow(p.uri, merged, p.columnCount);
        })();
      }, INBOX_AUTOSAVE_DEBOUNCE_MS);
    },
    [columnCount, persistTodayHubRow],
  );

  const cleanHubPageDayColumns = useCallback(async () => {
    const cleanCol = (text: string) =>
      cleanNoteMarkdownBody(text, CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH, {
        insertH1FromFilename: false,
      });
    for (const rawUri of rowUrisRef.current) {
      const rowUri = normUri(rawUri);
      if (todayHubCleanRowBlocked?.(rowUri)) {
        continue;
      }
      const key = rowUri;
      const sections =
        localRowSectionsRef.current[key] !== undefined
          ? [...localRowSectionsRef.current[key]!]
          : splitTodayRowIntoColumns(
              inboxContentByUriRef.current[key] ?? '',
              columnCount,
            );
      const {merged, changed} = mergeTodayHubRowAfterCleaningNonEmptyColumns(
        sections,
        cleanCol,
      );
      if (!changed) {
        continue;
      }
      await persistTodayHubRow(rowUri, merged, columnCount);
      setLocalRowSections(prev => {
        const next = {...prev};
        const a = activeRef.current;
        if (a && normUri(a.uri) === key) {
          next[key] = splitTodayRowIntoColumns(merged, columnCount);
        } else {
          delete next[key];
        }
        localRowSectionsRef.current = next;
        return next;
      });
      const a = activeRef.current;
      if (a && normUri(a.uri) === key) {
        const cols = splitTodayRowIntoColumns(merged, columnCount);
        const col = a.col;
        queueMicrotask(() => {
          const cur = activeRef.current;
          if (cur && normUri(cur.uri) === key && cur.col === col) {
            cellEditorRef.current?.loadMarkdown(cols[col] ?? '', {
              selection: 'preserve',
            });
          }
        });
      }
    }
  }, [cellEditorRef, columnCount, persistTodayHubRow, todayHubCleanRowBlocked]);

  const openCell = useCallback(
    (uri: string, col: number, clickCaret: number | null = null) => {
      const key = normUri(uri);
      const hubFlushWouldAwait =
        debounceTimerRef.current != null || pendingPersistRef.current != null;
      if (todayHubPerfEnabled()) {
        hubOpenPerfT0Ref.current = performance.now();
        todayHubPerfLog('openCell_start', {
          hadFlushAwait: hubFlushWouldAwait,
          clickCaret: clickCaret != null,
        });
      }
      const finishOpen = (): void => {
        const raw = inboxContentByUriRef.current[key] ?? '';
        const initial = splitTodayRowIntoColumns(raw, columnCount);
        const nextGen = hubCellFocusGenerationRef.current + 1;
        hubCellFocusGenerationRef.current = nextGen;
        pendingHubCellFocusRef.current = {
          gen: nextGen,
          caret: clickCaret,
        };
        setLocalRowSections(prev => {
          const next = {...prev, [key]: initial};
          localRowSectionsRef.current = next;
          return next;
        });
        const wk = hubCellWarmKey(key, col);
        const prevActive = activeRef.current;
        setWarmOrder(prev => {
          let next = touchWarmLru(prev, wk, MAX_HUB_WARM_CELLS, wk);
          if (prevActive) {
            const oldWk = hubCellWarmKey(
              normUri(prevActive.uri),
              prevActive.col,
            );
            if (oldWk !== wk) {
              next = touchWarmLru(next, oldWk, MAX_HUB_WARM_CELLS, wk);
            }
          }
          return next;
        });
        setActive({uri: key, col});
        if (todayHubPerfEnabled()) {
          todayHubPerfLog('openCell_finishOpen', {
            msSinceOpen: performance.now() - hubOpenPerfT0Ref.current,
          });
        }
      };
      if (hubFlushWouldAwait) {
        const flushT0 = todayHubPerfEnabled() ? performance.now() : 0;
        flushScheduledPersist().then(() => {
          if (todayHubPerfEnabled()) {
            todayHubPerfLog('openCell_after_flush', {
              flushMs: performance.now() - flushT0,
              totalMs: performance.now() - hubOpenPerfT0Ref.current,
            });
          }
          finishOpen();
        });
      } else {
        finishOpen();
      }
    },
    [columnCount, flushScheduledPersist],
  );

  /**
   * Focus the cell editor after mount: sync when no click offset; one `rAF` when placing the caret
   * from a pointer offset (see `specs/performance/todayhub-cell-edit-mode-latency.md`).
   */
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const pack = pendingHubCellFocusRef.current;
    if (!pack) {
      return;
    }
    const {gen, caret} = pack;

    const applyHubCellFocus = (): void => {
      if (hubCellFocusGenerationRef.current !== gen) {
        return;
      }
      if (pendingHubCellFocusRef.current?.gen !== gen) {
        return;
      }
      const ed = cellEditorRef.current;
      if (!ed) {
        return;
      }
      pendingHubCellFocusRef.current = null;
      if (caret != null) {
        ed.focus({anchor: caret});
      } else {
        ed.focus();
      }
      if (todayHubPerfEnabled()) {
        todayHubPerfLog('focus_applied', {
          msSinceOpen: performance.now() - hubOpenPerfT0Ref.current,
          hadClickCaret: caret != null,
        });
      }
    };

    // Keyboard: sync focus once the ref is live (+ one window rAF retry if the handle was not ready).
    // Pointer caret: sync `focus({anchor})` in this layout pass misaligns vs static rich text (see spec).
    // H1: try `queueMicrotask` first (after all layout effects flush, before paint) to avoid a full
    // frame wait; fall back to the prior rAF chain when the editor ref is not ready.
    const genStillPending = () => pendingHubCellFocusRef.current?.gen === gen;
    if (caret != null) {
      scheduleHubCellFocusWithPointerCaret(applyHubCellFocus, genStillPending);
    } else {
      scheduleHubCellFocusKeyboardRaf(applyHubCellFocus, genStillPending);
    }
  }, [active, cellEditorRef]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void flushScheduledPersist();
        setActive(null);
        wikiNavParentRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, flushScheduledPersist, wikiNavParentRef]);

  useLayoutEffect(() => {
    wikiNavParentRef.current = active?.uri ?? null;
  }, [active, wikiNavParentRef]);

  useLayoutEffect(() => {
    const bridge = bridgeRef.current;
    const flushFn = flushScheduledPersist;
    const cleanFn = cleanHubPageDayColumns;
    bridge.flushPendingEdits = flushFn;
    bridge.hasPendingHubFlush = () =>
      debounceTimerRef.current != null || pendingPersistRef.current != null;
    bridge.getLiveRowUri = () => active?.uri ?? null;
    bridge.getLiveRowMergedMarkdown = () => {
      if (!active) {
        return null;
      }
      return mergedMarkdownForTodayHubRow(
        active.uri,
        columnCount,
        localRowSectionsRef.current,
        inboxContentByUriRef.current,
      );
    };
    bridge.cleanHubPageDayColumns = cleanFn;
    return () => {
      if (bridge.flushPendingEdits === flushFn) {
        bridge.flushPendingEdits = async () => {};
        bridge.hasPendingHubFlush = () => false;
        bridge.getLiveRowUri = () => null;
        bridge.getLiveRowMergedMarkdown = () => null;
      }
      if (bridge.cleanHubPageDayColumns === cleanFn) {
        bridge.cleanHubPageDayColumns = async () => {};
      }
    };
  }, [bridgeRef, active, columnCount, flushScheduledPersist, cleanHubPageDayColumns]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const updateActiveColumnText = useCallback(
    (text: string) => {
      if (!active) {
        return;
      }
      setLocalRowSections(prev => {
        const cur = [...(prev[active.uri] ?? getSections(active.uri))];
        cur[active.col] = text;
        const next = {...prev, [active.uri]: cur};
        localRowSectionsRef.current = next;
        return next;
      });
      schedulePersist(active.uri);
    },
    [active, getSections, schedulePersist],
  );

  const noopMarkdownChange = useCallback(() => {}, []);

  const closeEmptyActiveCellIfStillEmpty = useCallback(
    async (uri: string, col: number) => {
      const a = activeRef.current;
      if (!a || normUri(a.uri) !== normUri(uri) || a.col !== col) {
        return;
      }
      const ed = cellEditorRef.current;
      if (!ed) {
        return;
      }
      if (ed.getMarkdown().trim().length > 0) {
        return;
      }
      const key = normUri(uri);
      const base =
        localRowSectionsRef.current[key] ??
        splitTodayRowIntoColumns(
          inboxContentByUriRef.current[key] ?? '',
          columnCount,
        );
      const cur = [...base];
      cur[col] = '';
      const next = {...localRowSectionsRef.current, [key]: cur};
      localRowSectionsRef.current = next;
      setLocalRowSections(next);
      await flushScheduledPersist();
      setActive(null);
      wikiNavParentRef.current = null;
    },
    [cellEditorRef, columnCount, flushScheduledPersist, wikiNavParentRef],
  );

  const touchWarmForCell = useCallback((uri: string, col: number) => {
    if (MAX_HUB_WARM_CELLS <= 0) {
      return;
    }
    setWarmOrder(prev => {
      const a = activeRef.current;
      const pin = a ? hubCellWarmKey(a.uri, a.col) : null;
      return touchWarmLru(
        prev,
        hubCellWarmKey(normUri(uri), col),
        MAX_HUB_WARM_CELLS,
        pin,
      );
    });
  }, []);

  const columnHeaders = useMemo(() => {
    const h: string[] = [];
    for (let c = 0; c < columnCount; c++) {
      h.push(c === 0 ? '' : hubSettings.columns[c - 1] ?? `Column ${c + 1}`);
    }
    return h;
  }, [columnCount, hubSettings.columns]);

  const formatHubWeekDate = useCallback((d: Date) => {
    const full: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    try {
      return d.toLocaleDateString(undefined, full);
    } catch {
      return String(d.getTime());
    }
  }, []);

  return (
    <div
      className="today-hub-canvas"
      role="region"
      aria-label="Today hub weekly canvas"
      style={
        {
          ['--today-hub-col-count' as string]: String(columnCount),
          ['--today-hub-total-rows' as string]: String(weekStarts.length),
        } as CSSProperties
      }
    >
      <div className="today-hub-canvas__rows">
        {visibleWeekStarts.map((weekStart, ri) => {
          const uri = normUri(rowUris[ri]!);
          const sections = getSections(uri);
          const isActiveRow = active?.uri === uri;
          const weekEnd = todayHubWeekEndInclusive(weekStart);
          return (
            <div
              key={uri}
              className={
                ri === 0
                  ? 'today-hub-canvas__row today-hub-canvas__row--previous-week'
                  : 'today-hub-canvas__row'
              }
            >
              <div className="today-hub-canvas__row-date-bar">
                <div className="today-hub-canvas__row-date-bar-cols">
                  {columnHeaders.map((label, ci) => (
                    <div
                      key={ci}
                      className="today-hub-canvas__row-date-bar-head"
                    >
                      {ci === 0 ? (
                        <span className="today-hub-canvas__row-date">
                          {formatHubWeekDate(weekStart)}
                        </span>
                      ) : (
                        <span className="today-hub-canvas__col-head">
                          {label || '\u00a0'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="today-hub-canvas__row-cells">
                {sections.map(
                  // eslint-disable-next-line sonarjs/cognitive-complexity -- warm/CM/static cell stack; empty vs non-empty split via todayHubCanvasCellLayout + TodayHubCanvasNonEmptyCell
                  (chunk, ci) => {
                  const editing = isActiveRow && active?.col === ci;
                  const warmKey = hubCellWarmKey(uri, ci);
                  const canPrewarm = chunk.trim().length > 0;
                  const isWarm = canPrewarm && warmOrder.includes(warmKey);
                  const surface = todayHubCanvasCellSurface({
                    editing,
                    isWarm,
                    chunkTrimmedLength: chunk.trim().length,
                  });
                  const emptyReadonly = surface === 'empty-readonly';
                  const relResolved =
                    relativeMarkdownLinkHrefIsResolvedByRowUri.get(uri)!;
                  const wikiResolved =
                    wikiLinkTargetIsResolvedByRowUri.get(uri)!;

                  const readonlyInteractiveProps = {
                    role: 'button' as const,
                    tabIndex: 0 as const,
                    'aria-label': chunk.trim() ? undefined : 'Edit cell',
                    onPointerEnter: () => {
                      runHubWarmPointerEnter(
                        canPrewarm,
                        warmKey,
                        warmOrder,
                        uri,
                        ci,
                        hubWarmDeferGenRef,
                        touchWarmForCell,
                      );
                    },
                    onPointerLeave: () => {
                      hubWarmDeferGenRef.current[warmKey] =
                        (hubWarmDeferGenRef.current[warmKey] ?? 0) + 1;
                    },
                    onKeyDown: (e: ReactKeyboardEvent) => {
                      if (e.key !== 'Enter' && e.key !== ' ') {
                        return;
                      }
                      e.preventDefault();
                      openCell(
                        uri,
                        ci,
                        chunk.trim() ? null : 0,
                      );
                    },
                    onClick: (e: ReactMouseEvent) => {
                      const root = e.currentTarget.querySelector(
                        '.today-hub-canvas__cell-static-rich',
                      );
                      const caretFromRich =
                        root instanceof HTMLElement
                          ? todayHubStaticCellDocOffsetFromPointer(
                              root,
                              e.clientX,
                              e.clientY,
                            )
                          : null;
                      const caret =
                        caretFromRich ?? (chunk.trim() ? chunk.length : 0);
                      openCell(uri, ci, caret);
                    },
                  };

                  const staticPreview = (
                    <>
                      {chunk.trim() ? (
                        <TodayHubCellStaticRichText
                          cellText={chunk}
                          rowUri={uri}
                          vaultRoot={vaultRoot}
                          wikiNavParentRef={wikiNavParentRef}
                          noteRefs={noteRefs}
                          onWikiLinkActivate={onWikiLinkActivate}
                          onMarkdownRelativeLinkActivate={
                            onMarkdownRelativeLinkActivate
                          }
                          onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                          linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                          onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
                        />
                      ) : null}
                    </>
                  );

                  const hubCellEditor = (
                    <NoteMarkdownEditor
                      ref={editing ? cellEditorRef : undefined}
                      vaultRoot={vaultRoot}
                      attachmentHost={inboxAttachmentHost}
                      resolveVaultImagePreviewUrl={resolveVaultImagePreviewUrl}
                      activeNotePath={uri}
                      initialMarkdown={chunk}
                      sessionKey={hubCellStableSessionKey(uri, ci)}
                      showFoldGutter={false}
                      readOnly={!editing}
                      onMarkdownChange={
                        editing ? updateActiveColumnText : noopMarkdownChange
                      }
                      onEditorError={onEditorError}
                      onWikiLinkActivate={onWikiLinkActivate}
                      relativeMarkdownLinkHrefIsResolved={relResolved}
                      onMarkdownRelativeLinkActivate={
                        onMarkdownRelativeLinkActivate
                      }
                      onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                      wikiLinkTargetIsResolved={wikiResolved}
                      wikiLinkCompletionCandidates={wikiLinkCompletionCandidates}
                      onSaveShortcut={onSaveShortcut}
                      onEditableBlur={
                        editing && !chunk.trim()
                          ? () => {
                              void closeEmptyActiveCellIfStillEmpty(uri, ci);
                            }
                          : undefined
                      }
                      placeholder="Write markdown…"
                      busy={false}
                      linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                      onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
                    />
                  );

                  const warmOrActive = todayHubCanvasCellWarmOrActive(editing, isWarm);
                  const showCm = warmOrActive;

                  return (
                    <div
                      key={ci}
                      className={
                        emptyReadonly
                          ? 'today-hub-canvas__cell today-hub-canvas__cell--empty-readonly'
                          : 'today-hub-canvas__cell'
                      }
                    >
                      {emptyReadonly ? (
                        <div
                          {...readonlyInteractiveProps}
                          className="today-hub-canvas__cell-readonly"
                        >
                          {staticPreview}
                        </div>
                      ) : (
                        <TodayHubCanvasNonEmptyCell
                          stackClassName={
                            isWarm
                              ? 'today-hub-canvas__cell-editor-stack today-hub-canvas__cell-editor-stack--warm'
                              : 'today-hub-canvas__cell-editor-stack'
                          }
                          editing={editing}
                          isWarm={isWarm}
                          warmOrActive={warmOrActive}
                          canPrewarm={canPrewarm}
                          readonlyInteractiveProps={readonlyInteractiveProps}
                          staticPreview={staticPreview}
                          cmChild={showCm ? hubCellEditor : null}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="today-hub-canvas__row-date-bar today-hub-canvas__row-date-bar--footer">
                <TodayWeekProgressBar
                  comparisonNow={progressComparisonNow}
                  progress={todayHubWeekProgress(weekStart, progressComparisonNow)}
                  weekStart={weekStart}
                />
                <span className="today-hub-canvas__row-date-end">
                  {formatHubWeekDate(weekEnd)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
