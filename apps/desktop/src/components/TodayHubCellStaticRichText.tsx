import {ensureSyntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import {useMemo, type MutableRefObject, type PointerEvent, type ReactElement} from 'react';

import {isBrowserOpenableMarkdownHref, wikiLinkInnerBrowserOpenableHref} from '@eskerra/core';

import {isActivatableRelativeMarkdownHref} from '../editor/noteEditor/markdownActivatableRelativeHref';
import {markdownBareBrowserUrlAtPosition} from '../editor/noteEditor/markdownBareUrl';
import {markdownActivatableRelativeMdLinkAtPosition} from '../editor/noteEditor/markdownActivatableRelativeMdLinkAtPosition';
import {wikiLinkPointerActivatableInnerAtDocPosition} from '../editor/noteEditor/wikiLinkInnerAtDocPosition';
import {
  buildTodayHubCellStaticViewModel,
  clipSegmentsToRange,
} from '../lib/todayHub/todayHubCellStaticView';
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

export type TodayHubCellStaticRichTextProps = {
  cellText: string;
  rowUri: string;
  vaultRoot: string;
  wikiNavParentRef: MutableRefObject<string | null>;
  noteRefs: readonly {name: string; uri: string}[];
  onWikiLinkActivate: (payload: VaultWikiLinkActivatePayload) => void;
  onMarkdownRelativeLinkActivate: (
    payload: VaultRelativeMarkdownLinkActivatePayload,
  ) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
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
          return (
            <div
              key={line.from}
              className={line.lineClassName}
              data-doc-line-from={line.from}
            >
              {lineSegments.map((seg, i) => (
                <span
                  key={`${line.from}-${seg.from}-${seg.to}-${i}-${seg.className}`}
                  className={seg.className || undefined}
                >
                  {cellText.slice(seg.from, seg.to)}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
