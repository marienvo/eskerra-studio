import * as ContextMenu from '@radix-ui/react-context-menu';
import {isDesktopTauriHost} from '../lib/desktopTauriWindow';
import {Cross2Icon, DashboardIcon, PlusIcon, ReaderIcon} from '@radix-ui/react-icons';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  editorOpenTabPillIconName,
  editorOpenTabPillLabel,
  type EditorOpenTabPillIconName,
} from '../lib/editorOpenTabPillLabel';
import {tabCurrentUri, type EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';

import {FILE_TREE_ICON_SIZE_PX} from './fileTree/fileTreeConstants';

const TAB_PILL_ICON_DIM = {
  width: FILE_TREE_ICON_SIZE_PX,
  height: FILE_TREE_ICON_SIZE_PX,
} as const;

const DRAG_THRESHOLD_PX = 6;

function TitleBarTabStripDragFiller() {
  const tauri = isDesktopTauriHost();
  return (
    <div
      className="editor-open-tabs-titlebar-drag-filler"
      aria-hidden
      {...(tauri ? {'data-tauri-drag-region': true} : {})}
    />
  );
}

type TitleBarTabStripAddButtonProps = {
  disabled: boolean;
  onQuickOpen?: () => void;
  onAddToInbox?: () => void;
};

function TitleBarTabStripAddButton({
  disabled,
  onQuickOpen,
  onAddToInbox,
}: TitleBarTabStripAddButtonProps) {
  const hasQuickOpen = onQuickOpen != null;
  const hasAddToInbox = onAddToInbox != null;
  if (!hasQuickOpen && !hasAddToInbox) {
    return null;
  }

  return (
    <button
      type="button"
      className="editor-open-tab-add-btn icon-btn-ghost app-tooltip-trigger"
      disabled={disabled}
      aria-label="Open note or add to inbox"
      data-tooltip="Open note (Shift Shift). Shift+click: Add to inbox."
      data-tooltip-placement="bottom"
      onClick={e => {
        if (disabled) {
          return;
        }
        if (e.shiftKey) {
          onAddToInbox?.();
        } else {
          onQuickOpen?.();
        }
      }}
    >
      <span className="editor-open-tab-add-btn__glyph" aria-hidden>
        <PlusIcon width={15} height={15} />
      </span>
    </button>
  );
}

function readInsertBeforeIndexFromClientX(stripEl: HTMLElement, clientX: number): number {
  const pills = [...stripEl.querySelectorAll(':scope > .editor-open-tab-pill')] as HTMLElement[];
  for (let j = 0; j < pills.length; j++) {
    const {left, right} = pills[j]!.getBoundingClientRect();
    if (clientX < (left + right) / 2) {
      return j;
    }
  }
  return pills.length;
}

function readDropIndicatorLeftPx(stripEl: HTMLElement, insertBefore: number): number {
  const stripR = stripEl.getBoundingClientRect();
  const pills = [...stripEl.querySelectorAll(':scope > .editor-open-tab-pill')] as HTMLElement[];
  if (pills.length === 0) {
    return 0;
  }
  if (insertBefore <= 0) {
    const r0 = pills[0]!.getBoundingClientRect();
    return r0.left - stripR.left - 2;
  }
  if (insertBefore >= pills.length) {
    const r = pills[pills.length - 1]!.getBoundingClientRect();
    return r.right - stripR.left + 2;
  }
  const a = pills[insertBefore - 1]!.getBoundingClientRect();
  const b = pills[insertBefore]!.getBoundingClientRect();
  return (a.right + b.left) / 2 - stripR.left;
}

function EditorOpenTabPillLeadingIcon({iconName}: {iconName: EditorOpenTabPillIconName}) {
  return iconName === 'today' ? (
    <DashboardIcon {...TAB_PILL_ICON_DIM} aria-hidden />
  ) : (
    <ReaderIcon {...TAB_PILL_ICON_DIM} aria-hidden />
  );
}

type NoteRow = {lastModified: number | null; name: string; uri: string};

type EditorOpenTabPillProps = {
  tabIndex: number;
  tabId: string;
  uri: string | null;
  label: string;
  iconName: EditorOpenTabPillIconName;
  active: boolean;
  busy: boolean;
  multiTabs: boolean;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameNote: (uri: string) => void;
  onCloseOtherTabs: (keepTabId: string) => void;
  onReorderPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    tabIndex: number,
    label: string,
  ) => void;
  isDragSource?: boolean;
};

const EditorOpenTabPill = memo(function EditorOpenTabPill({
  tabIndex,
  tabId,
  uri,
  label,
  iconName,
  active,
  busy,
  multiTabs,
  onActivateTab,
  onCloseTab,
  onRenameNote,
  onCloseOtherTabs,
  onReorderPointerDown,
  isDragSource = false,
}: EditorOpenTabPillProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelTruncated, setLabelTruncated] = useState(false);

  const measureLabelTruncation = useCallback(() => {
    const el = labelRef.current;
    if (!el) {
      return;
    }
    setLabelTruncated(el.scrollWidth > el.clientWidth + 0.5);
  }, []);

  useLayoutEffect(() => {
    measureLabelTruncation();
  }, [label, measureLabelTruncation]);

  useEffect(() => {
    const el = labelRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => measureLabelTruncation());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureLabelTruncation]);

  const onCloseClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab, tabId],
  );

  const onPillAuxClick = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 1) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab, tabId],
  );

  const onPillMiddleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 1) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={busy}>
        <div
          className={[
            active ? 'editor-open-tab-pill editor-open-tab-pill--active' : 'editor-open-tab-pill',
            isDragSource ? 'editor-open-tab-pill--dragging-source' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="none"
          onAuxClick={onPillAuxClick}
          onMouseDown={onPillMiddleMouseDown}
          onPointerDown={
            onReorderPointerDown && !busy
              ? e => {
                  if (e.button !== 0) {
                    return;
                  }
                  if ((e.target as HTMLElement).closest('.editor-open-tab-pill__close')) {
                    return;
                  }
                  onReorderPointerDown(e, tabIndex, label);
                }
              : undefined
          }
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className={[
              'editor-open-tab-pill__main',
              labelTruncated ? 'app-tooltip-trigger' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={busy}
            {...(labelTruncated
              ? {
                  'data-tooltip': label,
                  'data-tooltip-placement': 'inline-end' as const,
                }
              : {})}
            onClick={() => {
              onActivateTab(tabId);
            }}
          >
            <span className="editor-open-tab-pill__icon" aria-hidden>
              <EditorOpenTabPillLeadingIcon iconName={iconName} />
            </span>
            <span ref={labelRef} className="editor-open-tab-pill__label">
              {label}
            </span>
          </button>
          <button
            type="button"
            className="editor-open-tab-pill__close icon-btn-ghost app-tooltip-trigger"
            aria-label={`Close ${label}`}
            data-tooltip="Close tab"
            data-tooltip-placement="inline-end"
            disabled={busy}
            onClick={onCloseClick}
          >
            <Cross2Icon {...TAB_PILL_ICON_DIM} aria-hidden />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="note-list-context-menu"
          alignOffset={4}
          collisionPadding={8}
        >
          <ContextMenu.Item
            className="note-list-context-menu__item"
            disabled={busy || uri == null}
            onSelect={() => {
              if (uri) {
                onRenameNote(uri);
              }
            }}
          >
            Rename note
          </ContextMenu.Item>
          <ContextMenu.Item
            className="note-list-context-menu__item"
            disabled={busy}
            onSelect={() => {
              onCloseTab(tabId);
            }}
          >
            Close tab
          </ContextMenu.Item>
          <ContextMenu.Item
            className="note-list-context-menu__item"
            disabled={busy || !multiTabs || uri == null}
            onSelect={() => {
              onCloseOtherTabs(tabId);
            }}
          >
            Close other tabs
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

export type EditorPaneOpenNoteTabsProps = {
  notes: readonly NoteRow[];
  workspaceTabs: readonly EditorWorkspaceTab[];
  activeTabId: string | null;
  busy: boolean;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameNote: (uri: string) => void;
  onCloseOtherTabs: (keepTabId: string) => void;
  /** When true, tab strip uses title bar layout (single row, flex shrink, clip). */
  inTitleBar?: boolean;
  /** Title bar only: reorder tabs after drag-drop; indices are pre-move order. */
  onReorderTabs?: (fromIndex: number, insertBeforeIndex: number) => void;
  /** Title bar only: plain click opens Quick Open (Shift+Shift). */
  onTitleBarQuickOpen?: () => void;
  /** Title bar only: Shift+click opens Add to inbox (Ctrl+Ctrl). */
  onTitleBarAddToInbox?: () => void;
  titleBarActionsDisabled?: boolean;
};

export const EditorPaneOpenNoteTabs = memo(function EditorPaneOpenNoteTabs({
  notes,
  workspaceTabs,
  activeTabId,
  busy,
  onActivateTab,
  onCloseTab,
  onRenameNote,
  onCloseOtherTabs,
  inTitleBar = false,
  onReorderTabs,
  onTitleBarQuickOpen,
  onTitleBarAddToInbox,
  titleBarActionsDisabled = false,
}: EditorPaneOpenNoteTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const workspaceTabsRef = useRef(workspaceTabs);
  const onReorderTabsRef = useRef(onReorderTabs);

  useLayoutEffect(() => {
    workspaceTabsRef.current = workspaceTabs;
  }, [workspaceTabs]);
  useLayoutEffect(() => {
    onReorderTabsRef.current = onReorderTabs;
  }, [onReorderTabs]);

  type DragLive = {
    pointerId: number;
    fromTabId: string;
    label: string;
    startX: number;
    startY: number;
    dragActive: boolean;
    insertBefore: number;
  };
  const dragLiveRef = useRef<DragLive | null>(null);
  const detachWindowDragRef = useRef<(() => void) | null>(null);

  const suppressNextTabActivateRef = useRef(false);

  const [dragSurface, setDragSurface] = useState<{
    insertBefore: number;
    indicatorLeftPx: number;
    ghostX: number;
    ghostY: number;
    label: string;
    fromTabId: string;
  } | null>(null);

  const onActivateWrapped = useCallback(
    (tabId: string) => {
      if (suppressNextTabActivateRef.current) {
        suppressNextTabActivateRef.current = false;
        return;
      }
      onActivateTab(tabId);
    },
    [onActivateTab],
  );

  useEffect(
    () => () => {
      detachWindowDragRef.current?.();
      detachWindowDragRef.current = null;
      dragLiveRef.current = null;
      document.body.classList.remove('editor-tab-strip--dragging');
    },
    [],
  );

  const handleReorderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, fromIndex: number, label: string) => {
      if (!onReorderTabs || busy || workspaceTabsRef.current.length < 2) {
        return;
      }
      if (dragLiveRef.current != null) {
        return;
      }
      const strip = stripRef.current;
      const tab = workspaceTabsRef.current[fromIndex];
      if (!strip || !tab) {
        return;
      }

      const insertBefore = readInsertBeforeIndexFromClientX(strip, e.clientX);
      dragLiveRef.current = {
        pointerId: e.pointerId,
        fromTabId: tab.id,
        label,
        startX: e.clientX,
        startY: e.clientY,
        dragActive: false,
        insertBefore,
      };

      const onMove = (ev: PointerEvent) => {
        const d = dragLiveRef.current;
        if (!d || ev.pointerId !== d.pointerId) {
          return;
        }
        const s = stripRef.current;
        if (!s) {
          return;
        }
        const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
        if (!d.dragActive) {
          if (dist < DRAG_THRESHOLD_PX) {
            return;
          }
          d.dragActive = true;
          document.body.classList.add('editor-tab-strip--dragging');
          try {
            s.setPointerCapture(d.pointerId);
          } catch {
            /* ignore */
          }
        }
        d.insertBefore = readInsertBeforeIndexFromClientX(s, ev.clientX);
        setDragSurface({
          insertBefore: d.insertBefore,
          indicatorLeftPx: readDropIndicatorLeftPx(s, d.insertBefore),
          ghostX: ev.clientX,
          ghostY: ev.clientY,
          label: d.label,
          fromTabId: d.fromTabId,
        });
      };

      const onUp = (ev: PointerEvent) => {
        const d = dragLiveRef.current;
        if (!d || ev.pointerId !== d.pointerId) {
          return;
        }
        try {
          strip.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        document.body.classList.remove('editor-tab-strip--dragging');
        const wasDrag = d.dragActive;
        const fromTabId = d.fromTabId;
        const insertBefore = d.insertBefore;
        dragLiveRef.current = null;
        setDragSurface(null);
        detachWindowDragRef.current?.();
        detachWindowDragRef.current = null;

        if (wasDrag) {
          suppressNextTabActivateRef.current = true;
          const tabs = workspaceTabsRef.current;
          const fromIdx = tabs.findIndex(t => t.id === fromTabId);
          const reorder = onReorderTabsRef.current;
          if (fromIdx >= 0 && reorder) {
            reorder(fromIdx, insertBefore);
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      detachWindowDragRef.current = detach;
    },
    [busy, onReorderTabs],
  );

  if (workspaceTabs.length === 0) {
    if (inTitleBar) {
      return (
        <div className="editor-open-tabs-scroll editor-open-tabs-scroll--titlebar editor-open-tabs-scroll--titlebar-empty">
          <TitleBarTabStripAddButton
            disabled={titleBarActionsDisabled}
            onQuickOpen={onTitleBarQuickOpen}
            onAddToInbox={onTitleBarAddToInbox}
          />
          <TitleBarTabStripDragFiller />
        </div>
      );
    }
    return null;
  }

  const multiTabs = workspaceTabs.length > 1;
  const reorderEnabled = Boolean(inTitleBar && onReorderTabs && multiTabs && !busy);

  const scrollClass = inTitleBar
    ? 'editor-open-tabs-scroll editor-open-tabs-scroll--titlebar'
    : 'editor-open-tabs-scroll';

  return (
    <div
      ref={inTitleBar ? stripRef : undefined}
      className={scrollClass}
      role="tablist"
      aria-label="Open notes"
    >
      {dragSurface ? (
        <div
          className="editor-open-tabs-drop-indicator"
          style={{left: `${dragSurface.indicatorLeftPx}px`}}
          aria-hidden
        />
      ) : null}
      {workspaceTabs.map((tab, tabIndex) => {
        const uri = tabCurrentUri(tab);
        const active = tab.id === activeTabId;
        const label = uri ? editorOpenTabPillLabel(notes, uri) : 'Editor';
        const iconName = uri ? editorOpenTabPillIconName(uri) : 'description';
        return (
          <EditorOpenTabPill
            key={tab.id}
            tabIndex={tabIndex}
            tabId={tab.id}
            uri={uri}
            label={label}
            iconName={iconName}
            active={active}
            busy={busy}
            multiTabs={multiTabs}
            onActivateTab={onActivateWrapped}
            onCloseTab={onCloseTab}
            onRenameNote={onRenameNote}
            onCloseOtherTabs={onCloseOtherTabs}
            onReorderPointerDown={reorderEnabled ? handleReorderPointerDown : undefined}
            isDragSource={dragSurface != null && dragSurface.fromTabId === tab.id}
          />
        );
      })}
      {inTitleBar ? (
        <TitleBarTabStripAddButton
          disabled={titleBarActionsDisabled}
          onQuickOpen={onTitleBarQuickOpen}
          onAddToInbox={onTitleBarAddToInbox}
        />
      ) : null}
      {inTitleBar ? <TitleBarTabStripDragFiller /> : null}
      {dragSurface ? (
        <div
          className="editor-open-tab-drag-ghost"
          style={{
            left: `${dragSurface.ghostX}px`,
            top: `${dragSurface.ghostY}px`,
          }}
          aria-hidden
        >
          <span className="editor-open-tab-drag-ghost__label">{dragSurface.label}</span>
        </div>
      ) : null}
    </div>
  );
});
