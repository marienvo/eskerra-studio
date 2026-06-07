import type {EditorView} from '@codemirror/view';
import {
  isBrowserOpenableMarkdownHref,
  isExternalMarkdownHref,
  MARKDOWN_EXTENSION,
  stripMarkdownLinkHrefToPathPart,
  wikiLinkInnerBrowserOpenableHref,
} from '@eskerra/core';

import {markdownActivatableRelativeMdLinkAtPosition} from './markdownActivatableRelativeMdLinkAtPosition';
import {markdownBareBrowserUrlAtPosition} from './markdownBareUrl';
import {
  discardStoredPrimaryPointerDownForLinkClick,
  resolvePrimaryLinkClickContext,
} from './linkClickUseMousedownPosition';
import {markdownActivatableExternalMdLinkAtPosition} from './markdownActivatableExternalMdLinkAtPosition';
import {wikiLinkPointerActivatableInnerAtDocPosition} from './wikiLinkInnerAtDocPosition';
import {openDateTokenPickerAtClickPosition} from './dateToken/dateTokenClick';
import type {DateTokenPickerOpenHandler} from './dateToken/dateTokenTrigger';

export type NoteMarkdownPointerLinkHandlers = {
  onOpenDateTokenPicker?: () => DateTokenPickerOpenHandler | undefined;
  onWikiLinkActivate: (payload: {
    inner: string;
    at: number;
    openInBackgroundTab?: boolean;
  }) => void;
  onMarkdownRelativeLinkActivate: (payload: {
    href: string;
    at: number;
    openInBackgroundTab?: boolean;
  }) => void;
  onMarkdownExternalLinkOpen: (payload: {href: string; at: number}) => void;
};

type LinkActivationEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function isActivatableRelativeMarkdownHref(href: string): boolean {
  const part = stripMarkdownLinkHrefToPathPart(href);
  if (part === '' || isExternalMarkdownHref(part)) {
    return false;
  }
  return part.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase());
}

export function activateNoteMarkdownPrimaryLinkAtPosition(
  view: EditorView,
  pos: number,
  event: LinkActivationEvent,
  handlers: NoteMarkdownPointerLinkHandlers,
  options?: {allowExternalLabelActivation?: boolean},
): boolean {
  const inner = wikiLinkPointerActivatableInnerAtDocPosition(
    view.state.doc,
    pos,
  );
  if (inner) {
    event.preventDefault();
    event.stopPropagation();
    handlers.onWikiLinkActivate({inner, at: pos});
    return true;
  }
  const relHit = markdownActivatableRelativeMdLinkAtPosition(
    view.state,
    pos,
    isActivatableRelativeMarkdownHref,
  );
  if (relHit) {
    event.preventDefault();
    event.stopPropagation();
    handlers.onMarkdownRelativeLinkActivate({
      href: relHit.href,
      at: relHit.hrefFrom,
    });
    return true;
  }
  const extHit = options?.allowExternalLabelActivation === false
    ? markdownActivatableExternalMdLinkAtPosition(view.state, pos)
    : markdownActivatableRelativeMdLinkAtPosition(
      view.state,
      pos,
      isBrowserOpenableMarkdownHref,
    );
  const bareHit = markdownBareBrowserUrlAtPosition(view.state, pos);
  if (extHit) {
    event.preventDefault();
    event.stopPropagation();
    handlers.onMarkdownExternalLinkOpen({
      href: extHit.href,
      at: extHit.hrefFrom,
    });
    return true;
  }
  if (bareHit) {
    event.preventDefault();
    event.stopPropagation();
    handlers.onMarkdownExternalLinkOpen({
      href: bareHit.href,
      at: bareHit.hrefFrom,
    });
    return true;
  }
  return false;
}

export function activateNoteMarkdownMiddleLinkAtPosition(
  view: EditorView,
  pos: number,
  event: LinkActivationEvent,
  handlers: NoteMarkdownPointerLinkHandlers,
): boolean {
  const inner = wikiLinkPointerActivatableInnerAtDocPosition(
    view.state.doc,
    pos,
  );
  if (inner) {
    if (wikiLinkInnerBrowserOpenableHref(inner) != null) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    handlers.onWikiLinkActivate({
      inner,
      at: pos,
      openInBackgroundTab: true,
    });
    return true;
  }
  const relHit = markdownActivatableRelativeMdLinkAtPosition(
    view.state,
    pos,
    isActivatableRelativeMarkdownHref,
  );
  if (relHit) {
    event.preventDefault();
    event.stopPropagation();
    handlers.onMarkdownRelativeLinkActivate({
      href: relHit.href,
      at: relHit.hrefFrom,
      openInBackgroundTab: true,
    });
    return true;
  }
  return false;
}

export function createNoteMarkdownPointerLinkHandlers(
  handlers: NoteMarkdownPointerLinkHandlers,
): {
  onEditorClick: (event: MouseEvent, view: EditorView) => boolean;
  onEditorMiddleClick: (event: MouseEvent, view: EditorView) => boolean;
} {
  return {
    onEditorClick(event, view) {
      if (event.button !== 0) {
        return false;
      }
      if (event.shiftKey || event.altKey) {
        discardStoredPrimaryPointerDownForLinkClick(view);
        return false;
      }
      const click = resolvePrimaryLinkClickContext(view, event);
      const pos = click.pos;
      if (pos == null) {
        return false;
      }
      if (
        openDateTokenPickerAtClickPosition(
          view,
          pos,
          event,
          handlers.onOpenDateTokenPicker?.(),
          {forceIncludeBoundaries: click.dateToken},
        )
      ) {
        // Keep the click non-modal: CodeMirror can still place the caret for direct text editing.
        return false;
      }
      return activateNoteMarkdownPrimaryLinkAtPosition(
        view,
        pos,
        event,
        handlers,
        {allowExternalLabelActivation: !click.markerFocusLine},
      );
    },
    onEditorMiddleClick(event, view) {
      if (event.button !== 1) {
        return false;
      }
      const pos = view.posAtCoords({x: event.clientX, y: event.clientY});
      if (pos == null) {
        return false;
      }
      return activateNoteMarkdownMiddleLinkAtPosition(view, pos, event, handlers);
    },
  };
}
