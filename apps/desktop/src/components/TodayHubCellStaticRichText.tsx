import {ensureSyntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type ReactElement,
} from 'react';

import {isBrowserOpenableMarkdownHref, wikiLinkInnerBrowserOpenableHref} from '@eskerra/core';

import {isActivatableRelativeMarkdownHref} from '../editor/noteEditor/markdownActivatableRelativeHref';
import {markdownBareBrowserUrlAtPosition} from '../editor/noteEditor/markdownBareUrl';
import {markdownActivatableRelativeMdLinkAtPosition} from '../editor/noteEditor/markdownActivatableRelativeMdLinkAtPosition';
import {wikiLinkPointerActivatableInnerAtDocPosition} from '../editor/noteEditor/wikiLinkInnerAtDocPosition';
import {
  buildTodayHubCellStaticViewModel,
  clipSegmentsToRange,
} from '../lib/todayHub/todayHubCellStaticView';
import {
  cellTextHasDateTokenPill,
  todayHubStaticLineParts,
} from '../lib/todayHub/todayHubCellStaticDateTokenPill';
import {
  dateTokenPillEmoji,
  parseDateTokenSpan,
  type DateTokenValue,
} from '../editor/noteEditor/dateToken/dateToken';
import type {DateTokenPickerOverlayAnchor} from '../editor/noteEditor/dateToken/dateTokenPickerOverlayPosition';
import {
  CM_DATE_TOKEN_PILL_CLASS,
  CM_DATE_TOKEN_PILL_COMPLETED_CLASS,
  CM_DATE_TOKEN_PILL_FUTURE_CLASS,
  CM_DATE_TOKEN_PILL_PAST_CLASS,
} from '../editor/noteEditor/dateToken/dateTokenHighlightCodemirror';
import {parseLoneLinkLine} from '../lib/parseLoneLinkLine';
import {LinkRichPreviewCard} from './LinkRichPreviewCard';
import {
  inboxRelativeMarkdownLinkHrefIsResolved,
  inboxWikiLinkTargetIsResolved,
} from '../lib/inboxWikiLinkNavigation';
import {
  todayHubStaticCellDocOffsetFromPointer,
  todayHubStaticRichTextPointerHitsVisibleLinkToken,
} from '../lib/todayHub/todayHubCellStaticPointer';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';

const HIT_TREE_MS = 200;

const MINUTE_TICK_MS = 60_000;

/**
 * Returns a `now` that advances on aligned minute boundaries while `active`, so read-mode reminder
 * pills relabel (`Today` → `Tomorrow`) and flip past (🔔 → ☑️) on the same cadence as the CodeMirror
 * editor's clock. Stays static when the cell has no pills, so pill-free cells never schedule timers.
 */
function useDateTokenPillMinuteClock(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) {
      setNow(new Date());
    }
  }
  useEffect(() => {
    if (!active) {
      return;
    }
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const msUntilNextMinute = MINUTE_TICK_MS - (Date.now() % MINUTE_TICK_MS);
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), MINUTE_TICK_MS);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [active]);
  return now;
}

function todayHubDateTokenPillClassName(
  past: boolean,
  future: boolean,
  completed: boolean,
): string {
  if (completed) {
    return `${CM_DATE_TOKEN_PILL_CLASS} ${CM_DATE_TOKEN_PILL_COMPLETED_CLASS}`;
  }
  if (past) {
    return `${CM_DATE_TOKEN_PILL_CLASS} ${CM_DATE_TOKEN_PILL_PAST_CLASS}`;
  }
  if (future) {
    return `${CM_DATE_TOKEN_PILL_CLASS} ${CM_DATE_TOKEN_PILL_FUTURE_CLASS}`;
  }
  return CM_DATE_TOKEN_PILL_CLASS;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type TodayHubStaticLinkPointerCtx = {
  cellText: string;
  rowUri: string;
  wikiNavParentRef: MutableRefObject<string | null>;
  hitState: EditorState;
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
};

function handleTodayHubStaticLinkPointer(
  e: PointerEvent<HTMLDivElement>,
  {
    cellText,
    rowUri,
    wikiNavParentRef,
    hitState,
    onWikiLinkActivate,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
  }: TodayHubStaticLinkPointerCtx,
): void {
  const isPrimary = e.button === 0 && !e.shiftKey;
  const isMiddleVault = e.button === 1;
  if (!isPrimary && !isMiddleVault) {
    return;
  }
  const root = e.currentTarget;
  if (
    !todayHubStaticRichTextPointerHitsVisibleLinkToken(
      root,
      e.clientX,
      e.clientY,
    )
  ) {
    return;
  }
  const pos = todayHubStaticCellDocOffsetFromPointer(
    root,
    e.clientX,
    e.clientY,
  );
  if (pos == null) {
    return;
  }
  wikiNavParentRef.current = rowUri;
  ensureSyntaxTree(hitState, cellText.length, HIT_TREE_MS);
  if (
    tryHandleTodayHubWikiAtPos(
      e,
      hitState,
      pos,
      isMiddleVault,
      onWikiLinkActivate,
    )
  ) {
    return;
  }
  if (
    tryHandleTodayHubRelativeMdAtPos(
      e,
      hitState,
      pos,
      isMiddleVault,
      onMarkdownRelativeLinkActivate,
    )
  ) {
    return;
  }
  if (!isPrimary) {
    return;
  }
  if (
    tryHandleTodayHubExternalOrBareAtPos(
      e,
      hitState,
      pos,
      onMarkdownExternalLinkOpen,
    )
  ) {
    return;
  }
}

function tryHandleTodayHubWikiAtPos(
  e: PointerEvent<HTMLDivElement>,
  hitState: EditorState,
  pos: number,
  isMiddleVault: boolean,
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void,
): boolean {
  const inner = wikiLinkPointerActivatableInnerAtDocPosition(
    hitState.doc,
    pos,
  );
  if (inner == null) {
    return false;
  }
  if (
    isMiddleVault
    && wikiLinkInnerBrowserOpenableHref(inner) != null
  ) {
    return true;
  }
  e.preventDefault();
  e.stopPropagation();
  onWikiLinkActivate({
    inner,
    at: pos,
    ...(isMiddleVault ? {openInBackgroundTab: true} : {}),
  });
  return true;
}

function tryHandleTodayHubRelativeMdAtPos(
  e: PointerEvent<HTMLDivElement>,
  hitState: EditorState,
  pos: number,
  isMiddleVault: boolean,
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void,
): boolean {
  const relHit = markdownActivatableRelativeMdLinkAtPosition(
    hitState,
    pos,
    isActivatableRelativeMarkdownHref,
  );
  if (relHit == null) {
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  onMarkdownRelativeLinkActivate({
    href: relHit.href,
    at: relHit.hrefFrom,
    ...(isMiddleVault ? {openInBackgroundTab: true} : {}),
  });
  return true;
}

function tryHandleTodayHubExternalOrBareAtPos(
  e: PointerEvent<HTMLDivElement>,
  hitState: EditorState,
  pos: number,
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void,
): boolean {
  const extHit = markdownActivatableRelativeMdLinkAtPosition(
    hitState,
    pos,
    isBrowserOpenableMarkdownHref,
  );
  if (extHit != null) {
    e.preventDefault();
    e.stopPropagation();
    onMarkdownExternalLinkOpen({
      href: extHit.href,
      at: extHit.hrefFrom,
    });
    return true;
  }
  const bareHit = markdownBareBrowserUrlAtPosition(hitState, pos);
  if (bareHit == null) {
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  onMarkdownExternalLinkOpen({
    href: bareHit.href,
    at: bareHit.hrefFrom,
  });
  return true;
}

export type TodayHubDateTokenPillActivatePayload = {
  readonly uri: string;
  readonly col: number;
  readonly from: number;
  readonly to: number;
  readonly initialValue: DateTokenValue;
  readonly anchorRect: DateTokenPickerOverlayAnchor;
};

export type TodayHubDateTokenPillTogglePayload = {
  readonly uri: string;
  readonly col: number;
  readonly from: number;
  readonly to: number;
  readonly value: DateTokenValue;
};

export type TodayHubCellStaticRichTextProps = {
  cellText: string;
  rowUri: string;
  col: number;
  vaultRoot: string;
  wikiNavParentRef: MutableRefObject<string | null>;
  noteRefs: readonly {name: string; uri: string}[];
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
  onDateTokenPillActivate?: (payload: TodayHubDateTokenPillActivatePayload) => void;
  onDateTokenPillToggle?: (payload: TodayHubDateTokenPillTogglePayload) => void;
  linkSnippetBlockedDomains?: ReadonlyArray<string>;
  onMuteLinkSnippetDomain?: (domain: string) => void;
};

/**
 * Read-only markdown for an inactive hub column: same Lezer segments + `cm-md-*` / link classes as
 * CodeMirror; line-level classes match `markdownBlockLineStyle` for block spacing parity with edit mode.
 */
export function TodayHubCellStaticRichText({
  cellText,
  rowUri,
  vaultRoot,
  wikiNavParentRef,
  noteRefs,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  onDateTokenPillActivate,
  onDateTokenPillToggle,
  col,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
}: TodayHubCellStaticRichTextProps): ReactElement | null {
  const {hitState, lines, segments} = useMemo(
    () =>
      buildTodayHubCellStaticViewModel(cellText, {
        wikiTargetIsResolved: inner =>
          inboxWikiLinkTargetIsResolved(noteRefs, inner, {
            vaultRoot,
            sourceMarkdownUriOrDir: rowUri,
          }),
        relativeMarkdownLinkHrefIsResolved: href =>
          inboxRelativeMarkdownLinkHrefIsResolved(noteRefs, rowUri, vaultRoot, href),
      }),
    [cellText, noteRefs, rowUri, vaultRoot],
  );

  const hasDateTokenPills = useMemo(
    () => cellTextHasDateTokenPill(cellText),
    [cellText],
  );
  const now = useDateTokenPillMinuteClock(hasDateTokenPills);

  if (cellText.length === 0) {
    return null;
  }

  return (
    <div className="note-markdown-editor-host today-hub-canvas__markdown-token-scope">
      <div
        className="today-hub-canvas__cell-static-rich"
        onPointerDown={e =>
          handleTodayHubStaticLinkPointer(e, {
            cellText,
            rowUri,
            wikiNavParentRef,
            hitState,
            onWikiLinkActivate,
            onMarkdownRelativeLinkActivate,
            onMarkdownExternalLinkOpen,
          })}
      >
        {lines.map(line => {
          const loneLinkInfo = parseLoneLinkLine(line.text);
          const isBlocked = loneLinkInfo != null && linkSnippetBlockedDomains != null &&
            linkSnippetBlockedDomains.includes(hostnameOf(loneLinkInfo.url));
          if (loneLinkInfo && !isBlocked) {
            const prefix = line.text.slice(0, loneLinkInfo.urlOffset);
            const hasPrefix = /\S/.test(prefix);
            return (
              <div
                key={line.from}
                className={line.lineClassName}
                data-doc-line-from={line.from}
              >
                {hasPrefix && <span>{prefix}</span>}
                <LinkRichPreviewCard
                  key={loneLinkInfo.url}
                  url={loneLinkInfo.url}
                  at={line.from + loneLinkInfo.urlOffset}
                  inline={hasPrefix}
                  onOpenLink={onMarkdownExternalLinkOpen}
                  onMuteDomain={onMuteLinkSnippetDomain}
                />
              </div>
            );
          }

          const rangeEnd = line.from + line.text.length;
          const lineSegments = clipSegmentsToRange(segments, line.from, rangeEnd);
          const parts = todayHubStaticLineParts(
            line.from,
            line.text,
            lineSegments,
            now,
          );
          return (
            <div
              key={line.from}
              className={line.lineClassName}
              data-doc-line-from={line.from}
            >
              {parts.map((part, pi) =>
                part.kind === 'date-pill' ? (
                  <span
                    key={`pill-${part.from}-${part.to}`}
                    className={todayHubDateTokenPillClassName(
                      part.past,
                      part.future,
                      part.completed,
                    )}
                    data-date-token=""
                    data-doc-from={part.from}
                    data-doc-to={part.to}
                    onPointerDown={e => {
                      if (!onDateTokenPillActivate || e.button !== 0) {
                        return;
                      }
                      const tokenText = cellText.slice(part.from, part.to);
                      const initialValue = parseDateTokenSpan(tokenText);
                      if (!initialValue) {
                        return;
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onDateTokenPillActivate({
                        uri: rowUri,
                        col,
                        from: part.from,
                        to: part.to,
                        initialValue,
                        anchorRect: {
                          left: rect.left,
                          top: rect.top,
                          bottom: rect.bottom,
                        },
                      });
                    }}
                  >
                    <span
                      className="cm-date-token-pill__emoji"
                      data-date-token-toggle=""
                      role="button"
                      aria-label={part.completed ? 'Unmark as done' : 'Mark as done'}
                      onPointerDown={e => {
                        if (e.button !== 0 || !onDateTokenPillToggle) {
                          return;
                        }
                        const tokenText = cellText.slice(part.from, part.to);
                        const value = parseDateTokenSpan(tokenText);
                        if (!value) {
                          return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        onDateTokenPillToggle({
                          uri: rowUri,
                          col,
                          from: part.from,
                          to: part.to,
                          value,
                        });
                      }}
                    >
                      {dateTokenPillEmoji({past: part.past, completed: part.completed})}
                    </span>
                    <span className="cm-date-token-pill__label">
                      {part.label}
                    </span>
                  </span>
                ) : (
                  <Fragment key={`seg-${pi}`}>
                    {part.segments.map((seg, i) => (
                      <span
                        key={`${line.from}-${seg.from}-${seg.to}-${i}-${seg.className}`}
                        className={seg.className || undefined}
                      >
                        {cellText.slice(seg.from, seg.to)}
                      </span>
                    ))}
                  </Fragment>
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
