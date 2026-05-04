import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
  type AsyncDataLoaderDataRef,
  type SelectionDataRef,
  type TreeInstance,
} from '@headless-tree/core';
import {AssistiveTreeDescription, useTree} from '@headless-tree/react';
import {
  getInboxDirectoryUri,
  normalizeVaultBaseUri,
  trimTrailingSlashes,
  type VaultFilesystem,
} from '@eskerra/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {useVirtualizer} from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  planVaultTreeBulkTargets,
  type VaultTreeBulkItem,
} from '../lib/vaultTreeBulkPlan';
import {
  resolveVaultTreeDropFromMime,
  serializeVaultTreeDragPayload,
  VAULT_TREE_DND_MIME,
} from '../lib/vaultTreeDnd';
import {
  buildSparseLonelyExpandPlan,
  createVaultSparsePlanLoader,
  pickLonelySubfolderWhenNoMarkdown,
  type SparseLonelyExpandBatch,
} from '../lib/vaultTreeAutoExpandThroughSparseFolders';
import {filterTopLevelInboxFolderFromChildRows} from '../lib/vaultTreeFilterTopLevelInbox';
import {
  loadVaultTreeVisibleChildRows,
  VAULT_TREE_TODAY_HUB_NOTE_NAME,
  type VaultTreeItemData,
} from '../lib/vaultTreeLoadChildren';
import {vaultTreeRowLabel} from '../lib/vaultTreeRowLabel';
import {ChevronRightIcon, DashboardIcon, ReaderIcon} from '@radix-ui/react-icons';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  FILE_TREE_ICON_SIZE_PX,
  FILE_TREE_ROW_HEIGHT_PX,
} from './fileTree/fileTreeConstants';
import {FileTreeNode} from './fileTree/FileTreeNode';
import {vaultTreeItemToFileTreeRowViewModel} from './fileTree/vaultTreeItemToFileTreeRow';

/** Must match `.vault-tree-row` height in `App.css` and virtual row wrapper height. */
const VAULT_TREE_ROW_HEIGHT_PX = FILE_TREE_ROW_HEIGHT_PX;

function mergeExpandedItemsWithChain(
  expandChain: readonly string[],
  expandedItems: string[],
): string[] {
  const expanded = new Set(expandedItems);
  for (const id of expandChain) {
    expanded.add(id);
  }
  return [...expanded];
}

function applySparseLonelyPlanToTree(
  t: TreeInstance<VaultTreeItemData>,
  plan: {cacheBatches: SparseLonelyExpandBatch[]; expandChain: string[]},
): void {
  for (const batch of plan.cacheBatches) {
    const parentInst = t.getItemInstance(batch.parentUri);
    if (!parentInst) {
      continue;
    }
    for (const row of batch.rows) {
      t.getItemInstance(row.id).updateCachedData(row.data, true);
    }
    parentInst.updateCachedChildrenIds(
      batch.rows.map(r => r.id),
      true,
    );
  }
  if (plan.expandChain.length > 0) {
    t.applySubStateUpdate('expandedItems', expandedItems =>
      mergeExpandedItemsWithChain(plan.expandChain, expandedItems),
    );
  }
}

function vaultTreeFileNodeRowClassName(
  rowPropClassName: string | undefined,
  selected: boolean,
  isDropTargetDir: boolean,
  isActiveDrop: boolean,
  isDragSource: boolean,
): string {
  return [
    rowPropClassName,
    selected ? 'vault-tree-row vault-tree-row--selected' : 'vault-tree-row',
    isDropTargetDir && isActiveDrop ? 'vault-tree-row--drop-target' : '',
    isDragSource ? 'vault-tree-row--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function vaultTreeMiddleClickApplies(
  data: VaultTreeItemData,
  primaryMdUri: string | null,
): boolean {
  if (!primaryMdUri) {
    return false;
  }
  return data.kind === 'article' || data.kind === 'todayHub';
}

type VaultTreeDragGhostIcon = 'folder' | 'article' | 'today';

function vaultTreeDragGhostIconMarkup(kind: VaultTreeDragGhostIcon): string {
  const p = {
    width: FILE_TREE_ICON_SIZE_PX,
    height: FILE_TREE_ICON_SIZE_PX,
  } as const;
  if (kind === 'today') {
    return renderToStaticMarkup(<DashboardIcon {...p} />);
  }
  if (kind === 'folder') {
    return renderToStaticMarkup(<ChevronRightIcon {...p} />);
  }
  return renderToStaticMarkup(<ReaderIcon {...p} />);
}

function vaultTreeRowPrimaryMarkdownUri(data: VaultTreeItemData): string | null {
  if (data.kind === 'todayHub') {
    return data.todayNoteUri ?? null;
  }
  if (data.kind === 'article') {
    return data.uri;
  }
  return null;
}

function vaultTreeDragGhostIconForRow(data: VaultTreeItemData): VaultTreeDragGhostIcon {
  if (
    data.kind === 'todayHub'
    || (data.kind === 'article' && data.name === VAULT_TREE_TODAY_HUB_NOTE_NAME)
  ) {
    return 'today';
  }
  if (data.kind === 'folder') {
    return 'folder';
  }
  return 'article';
}

function isVaultTreeRowDirectoryDropTarget(data: VaultTreeItemData): boolean {
  return data.kind === 'folder' || data.kind === 'todayHub';
}

function dataTransferListsVaultTreeMime(dt: DataTransfer): boolean {
  return [...dt.types].includes(VAULT_TREE_DND_MIME);
}

function teardownVaultTreeDragGhost(hostRef: MutableRefObject<HTMLDivElement | null>): void {
  const el = hostRef.current;
  if (el?.parentNode) {
    el.parentNode.removeChild(el);
  }
  hostRef.current = null;
}

/**
 * Off-screen host + `setDragImage` so the pointer shows a clear vault-row chip (icon + label).
 */
function mountVaultTreeDragGhost(options: {
  icon: VaultTreeDragGhostIcon;
  label: string;
  /** When dragging a multi-selection, number of additional items after the primary label. */
  multiExtraCount?: number;
  dataTransfer: DataTransfer;
  pointerClientX: number;
  pointerClientY: number;
  sourceButton: HTMLButtonElement;
  hostRef: MutableRefObject<HTMLDivElement | null>;
}): void {
  const {
    icon: dragIcon,
    label,
    multiExtraCount,
    dataTransfer,
    pointerClientX,
    pointerClientY,
    sourceButton,
    hostRef,
  } = options;
  teardownVaultTreeDragGhost(hostRef);

  const ghost = document.createElement('div');
  ghost.className = 'vault-tree-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'vault-tree-drag-ghost__icon';
  icon.innerHTML = vaultTreeDragGhostIconMarkup(dragIcon);

  const text = document.createElement('span');
  text.className = 'vault-tree-drag-ghost__label';
  const displayLabel =
    multiExtraCount !== undefined && multiExtraCount > 0
      ? `${label} +${multiExtraCount}`
      : label;
  text.textContent = displayLabel;

  ghost.appendChild(icon);
  ghost.appendChild(text);
  document.body.appendChild(ghost);
  ghost.getBoundingClientRect();

  const btnRect = sourceButton.getBoundingClientRect();
  const relX = pointerClientX - btnRect.left;
  const relY = pointerClientY - btnRect.top;
  const gw = ghost.offsetWidth;
  const gh = ghost.offsetHeight;
  const scaleX = gw / Math.max(btnRect.width, 1);
  const scaleY = gh / Math.max(btnRect.height, 1);
  let imgX = Math.round(relX * scaleX);
  let imgY = Math.round(relY * scaleY);
  imgX = Math.max(0, Math.min(imgX, Math.max(0, gw - 1)));
  imgY = Math.max(0, Math.min(imgY, Math.max(0, gh - 1)));

  try {
    dataTransfer.setDragImage(ghost, imgX, imgY);
    hostRef.current = ghost;
  } catch {
    if (ghost.parentNode) {
      ghost.parentNode.removeChild(ghost);
    }
  }
}

export type VaultPaneTreeProps = {
  vaultRoot: string;
  fs: VaultFilesystem;
  /** Bumps when vault files change; expanded branches refetch without remounting the tree. */
  fsRefreshNonce: number;
  /** When this changes, multi-selection in the tree is cleared (after bulk mutations). */
  vaultTreeSelectionClearNonce: number;
  /** Open note URI for manual “reveal in tree” only (does not drive selection or expansion). */
  editorActiveMarkdownUri: string | null;
  /** Increment (from parent) to expand ancestors, select the row, and scroll it into view. */
  revealActiveNoteNonce: number;
  busy: boolean;
  onOpenMarkdownNote: (uri: string) => void;
  /** Middle-click (or non-primary open): new editor tab, focused. */
  onOpenMarkdownNoteInNewActiveTab: (uri: string) => void;
  onRenameMarkdownRequest: (uri: string) => void;
  onDeleteMarkdownRequest: (uri: string) => void;
  onRenameFolderRequest: (uri: string) => void;
  onDeleteFolderRequest: (uri: string) => void;
  onBulkDeleteRequest: (items: VaultTreeBulkItem[]) => void;
  onMoveVaultTreeItem: (
    sourceUri: string,
    sourceKind: 'folder' | 'article',
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  onBulkMoveVaultTreeItems: (
    items: VaultTreeBulkItem[],
    targetDirectoryUri: string,
  ) => void | Promise<void>;
  /** Main vault tree (hides top-level Inbox folder) vs Inbox-only tree rooted at `Inbox/`. */
  treeScope?: 'vaultRoot' | 'inboxRoot';
};

/** Preloads `Inbox/` children so first inbox note open hits warm loader state. */
async function warmInboxChildrenAtUri(
  tree: TreeInstance<VaultTreeItemData>,
  inboxUri: string,
): Promise<void> {
  await tree.loadChildrenIds(inboxUri);
}

export const VaultPaneTree = memo(function VaultPaneTree({
  vaultRoot,
  fs,
  fsRefreshNonce,
  vaultTreeSelectionClearNonce,
  editorActiveMarkdownUri,
  revealActiveNoteNonce,
  busy,
  onOpenMarkdownNote,
  onOpenMarkdownNoteInNewActiveTab,
  onRenameMarkdownRequest,
  onDeleteMarkdownRequest,
  onRenameFolderRequest,
  onDeleteFolderRequest,
  onBulkDeleteRequest,
  onMoveVaultTreeItem,
  onBulkMoveVaultTreeItems,
  treeScope = 'vaultRoot',
}: VaultPaneTreeProps) {
  const vaultBaseUri = useMemo(
    () => trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/')),
    [vaultRoot],
  );
  const inboxDirectoryUri = useMemo(
    () => trimTrailingSlashes(getInboxDirectoryUri(vaultBaseUri).replace(/\\/g, '/')),
    [vaultBaseUri],
  );
  const rootId = treeScope === 'inboxRoot' ? inboxDirectoryUri : vaultBaseUri;
  const itemStoreRef = useRef<Record<string, VaultTreeItemData>>({});
  const primedRootForStoreRef = useRef<string | null>(null);
  if (primedRootForStoreRef.current !== rootId) {
    primedRootForStoreRef.current = rootId;
    itemStoreRef.current = {
      [rootId]:
        treeScope === 'inboxRoot'
          ? {
              kind: 'folder',
              name: 'Inbox',
              uri: rootId,
              lastModified: null,
            }
          : {
              kind: 'folder',
              name: 'Vault',
              uri: rootId,
              lastModified: null,
            },
    };
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<TreeInstance<VaultTreeItemData> | null>(null);
  /** Serialize selection-driven loads with mount/fs-refresh Inbox warmup so we never run two cold `listFiles(Inbox)` in parallel. */
  const inboxWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const dragGhostHostRef = useRef<HTMLDivElement | null>(null);
  const [dropTargetUri, setDropTargetUri] = useState<string | null>(null);
  const [draggingSourceUri, setDraggingSourceUri] = useState<string | null>(null);
  /** Incremented after async FS reload so React re-runs flatten; headless-tree `rebuildTree` may not change `useState` reference. */
  const [treeViewRevision, setTreeViewRevision] = useState(0);
  const pendingScrollToTreeIdRef = useRef<string | null>(null);
  const revealScrollFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultTreeInnerRef = useRef<HTMLDivElement | null>(null);
  const [vaultTreeLayoutNonce, setVaultTreeLayoutNonce] = useState(0);
  /** Latest open note URI; reveal effect reads this only when `revealActiveNoteNonce` bumps. */
  const editorActiveUriRef = useRef(editorActiveMarkdownUri);
  editorActiveUriRef.current = editorActiveMarkdownUri;
  /** Serialize sparse deep opens so concurrent expansions do not interleave cache writes. */
  const sparseWalkTailRef = useRef(Promise.resolve());

  const clearDropTarget = () => setDropTargetUri(null);

  const endVaultTreeDrag = useCallback(() => {
    setDropTargetUri(null);
    setDraggingSourceUri(null);
    teardownVaultTreeDragGhost(dragGhostHostRef);
  }, []);

  useEffect(() => {
    const onDocDragEnd = () => endVaultTreeDrag();
    document.addEventListener('dragend', onDocDragEnd);
    return () => document.removeEventListener('dragend', onDocDragEnd);
  }, [endVaultTreeDrag]);

  const tree = useTree<VaultTreeItemData>({
    rootItemId: rootId,
    getItemName: item => {
      const d = item.getItemData();
      return d ? vaultTreeRowLabel(d) : '…';
    },
    isItemFolder: item => item.getItemData()?.kind === 'folder',
    onPrimaryAction: item => {
      const data = item.getItemData();
      if (!data?.uri) {
        return;
      }
      const openUri = vaultTreeRowPrimaryMarkdownUri(data);
      if (!openUri) {
        return;
      }
      if (data.kind === 'article' || data.kind === 'todayHub') {
        onOpenMarkdownNote(openUri);
      }
    },
    createLoadingItemData: () => ({
      kind: 'folder',
      name: '…',
      uri: '',
      lastModified: null,
    }),
    dataLoader: {
      getItem: async id => {
        const hit = itemStoreRef.current[id];
        if (hit) {
          return hit;
        }
        return {
          kind: 'folder',
          name: id.split(/[/\\]/).pop() ?? '…',
          uri: id,
          lastModified: null,
        };
      },
      getChildrenWithData: async parentId => {
        let rows = await loadVaultTreeVisibleChildRows({
          parentUri: parentId,
          fs,
          itemStoreRef,
        });
        if (treeScope === 'vaultRoot') {
          rows = filterTopLevelInboxFolderFromChildRows({
            rows,
            parentUri: parentId,
            vaultRootUri: vaultBaseUri,
          });
        }
        const childrenIds = rows.map(r => r.id);
        const lonely = pickLonelySubfolderWhenNoMarkdown(childrenIds, itemStoreRef.current, {
          parentUri: parentId,
        });
        if (lonely) {
          await new Promise<void>(resolve => {
            sparseWalkTailRef.current = sparseWalkTailRef.current
              .then(async () => {
                const t = treeRef.current;
                if (!t) {
                  resolve();
                  return;
                }
                try {
                  const loadChildRows = createVaultSparsePlanLoader({fs, itemStoreRef});
                  const plan = await buildSparseLonelyExpandPlan({
                    firstLonelyUri: lonely,
                    itemStoreRef,
                    loadChildRows,
                  });
                  applySparseLonelyPlanToTree(t, plan);
                } catch {
                  /* ignore */
                } finally {
                  resolve();
                }
              })
              .catch(() => {
                resolve();
              });
          });
        }
        return rows;
      },
    },
    // `hotkeysCoreFeature` dispatches selectionFeature presets (Shift+Arrow range select, Ctrl+A).
    // Keep it: removing it drops those tree shortcuts. `toggleSelectedItem` (Ctrl+Space) stays off
    // so we do not steal that chord from editors/OS. See specs/architecture/desktop-keybindings-inventory.md.
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
    initialState: {
      expandedItems: [rootId],
      focusedItem: null,
      selectedItems: [],
    },
    hotkeys: {
      // Shallow merge in headless-tree replaces the whole preset; include `hotkey` + `handler` (see ESKERRA-TAURI-9).
      toggleSelectedItem: {
        hotkey: 'Control+Space',
        preventDefault: true,
        isEnabled: () => false,
        handler: (_e, tree) => {
          tree.getFocusedItem().toggleSelect();
        },
      },
    },
  });

  treeRef.current = tree;

  useEffect(() => {
    sparseWalkTailRef.current = Promise.resolve();
  }, [rootId]);

  useEffect(() => {
    const t = treeRef.current;
    if (!t) {
      return;
    }
    const inboxUri = treeScope === 'inboxRoot' ? rootId : inboxDirectoryUri;
    const warmupPromise = warmInboxChildrenAtUri(t, inboxUri);
    inboxWarmupPromiseRef.current = warmupPromise;
    warmupPromise.finally(() => {
      if (inboxWarmupPromiseRef.current === warmupPromise) {
        inboxWarmupPromiseRef.current = null;
      }
    });
    return () => {
      if (inboxWarmupPromiseRef.current === warmupPromise) {
        inboxWarmupPromiseRef.current = null;
      }
    };
  }, [rootId, treeScope, inboxDirectoryUri]);

  const vaultTreeClearSelRef = useRef(vaultTreeSelectionClearNonce);
  useEffect(() => {
    if (vaultTreeClearSelRef.current === vaultTreeSelectionClearNonce) {
      return;
    }
    vaultTreeClearSelRef.current = vaultTreeSelectionClearNonce;
    treeRef.current?.setSelectedItems([]);
  }, [vaultTreeSelectionClearNonce]);

  const fsRefreshBaselineRef = useRef(fsRefreshNonce);
  /** Serializes tree reloads so overlapping `fsRefreshNonce` bumps cannot apply out-of-order list results. */
  const treeReloadChainRef = useRef(Promise.resolve());
  useEffect(() => {
    if (fsRefreshNonce === fsRefreshBaselineRef.current) {
      return;
    }
    fsRefreshBaselineRef.current = fsRefreshNonce;
    const t = treeRef.current;
    if (!t) {
      return;
    }
    const pathDepth = (uri: string) => uri.split('/').filter(Boolean).length;
    const asyncRef = t.getDataRef<AsyncDataLoaderDataRef<VaultTreeItemData>>().current;
    const parentsToReload = Object.keys(asyncRef.childrenIds ?? {}).filter(id => {
      const n = trimTrailingSlashes(id.replace(/\\/g, '/'));
      return n === rootId || n.startsWith(`${rootId}/`);
    });
    parentsToReload.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
    treeReloadChainRef.current = treeReloadChainRef.current
      .then(async () => {
        for (const id of parentsToReload) {
          const inst = t.getItemInstance(id);
          if (inst) {
            // `false`: drop cached child ids before reload (avoids stale branches after moves).
            await inst.invalidateChildrenIds(false);
          }
        }
        setTreeViewRevision(n => n + 1);
      })
      .then(async () => {
        const t2 = treeRef.current;
        if (!t2) {
          return;
        }
        const inboxUri = treeScope === 'inboxRoot' ? rootId : inboxDirectoryUri;
        const p = warmInboxChildrenAtUri(t2, inboxUri);
        inboxWarmupPromiseRef.current = p;
        try {
          await p;
        } catch {
          /* ignore */
        } finally {
          if (inboxWarmupPromiseRef.current === p) {
            inboxWarmupPromiseRef.current = null;
          }
        }
      })
      .catch(() => {
        /* ignore: item ids may be stale during vault teardown */
      });
  }, [fsRefreshNonce, rootId, treeScope, inboxDirectoryUri]);

  const items = tree.getItems();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VAULT_TREE_ROW_HEIGHT_PX,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const itemIds = useMemo(() => items.map(item => item.getId()), [items]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setVaultTreeLayoutNonce(n => n + 1);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (revealActiveNoteNonce === 0) {
      return;
    }
    const uri = editorActiveUriRef.current;
    if (!uri || (!uri.startsWith(`${rootId}/`) && uri !== rootId)) {
      return;
    }
    if (treeScope === 'vaultRoot') {
      if (uri === inboxDirectoryUri || uri.startsWith(`${inboxDirectoryUri}/`)) {
        return;
      }
    } else if (treeScope === 'inboxRoot') {
      if (uri !== inboxDirectoryUri && !uri.startsWith(`${inboxDirectoryUri}/`)) {
        return;
      }
    }
    let cancelled = false;
    void (async () => {
      const t = treeRef.current;
      if (!t) {
        return;
      }
      const pendingMountWarmup = inboxWarmupPromiseRef.current;
      if (pendingMountWarmup) {
        try {
          await pendingMountWarmup;
        } catch {
          /* ignore: warmup failed or vault torn down */
        }
      }
      if (cancelled) {
        return;
      }
      const rel = uri.slice(rootId.length).replace(/^\//, '');
      const segments = rel.split('/').filter(Boolean);
      if (segments.length === 0) {
        return;
      }
      const folderSegs = segments.length > 1 ? segments.slice(0, -1) : [];
      let acc = rootId;
      for (const seg of folderSegs) {
        acc = `${acc}/${seg}`;
        await t.loadChildrenIds(acc);
        if (cancelled) {
          return;
        }
        const expandedBefore = t.getState().expandedItems;
        const wasExpanded = expandedBefore.includes(acc);
        if (!wasExpanded) {
          t.getItemInstance(acc)?.expand();
        }
      }
      if (cancelled) {
        return;
      }
      const treeSelectId =
        Object.values(itemStoreRef.current).find(
          d => d?.kind === 'todayHub' && d.todayNoteUri === uri,
        )?.uri ?? uri;
      pendingScrollToTreeIdRef.current = treeSelectId;
      t.setSelectedItems([treeSelectId]);
      t.getItemInstance(treeSelectId)?.setFocused();
      const pendingId = treeSelectId;
      if (revealScrollFallbackTimeoutRef.current != null) {
        clearTimeout(revealScrollFallbackTimeoutRef.current);
      }
      revealScrollFallbackTimeoutRef.current = setTimeout(() => {
        revealScrollFallbackTimeoutRef.current = null;
        if (pendingScrollToTreeIdRef.current === pendingId) {
          pendingScrollToTreeIdRef.current = null;
        }
      }, 2500);
    })();
    return () => {
      cancelled = true;
      if (revealScrollFallbackTimeoutRef.current != null) {
        clearTimeout(revealScrollFallbackTimeoutRef.current);
        revealScrollFallbackTimeoutRef.current = null;
      }
    };
  }, [revealActiveNoteNonce, rootId, treeScope, inboxDirectoryUri]);

  useLayoutEffect(() => {
    const id = pendingScrollToTreeIdRef.current;
    if (!id) {
      return;
    }
    const idx = itemIds.indexOf(id);
    if (idx < 0) {
      return;
    }
    virtualizer.scrollToIndex(idx, {align: 'center'});
    pendingScrollToTreeIdRef.current = null;
  }, [itemIds, virtualizer, treeViewRevision]);

  useLayoutEffect(() => {
    const inner = vaultTreeInnerRef.current;
    if (!inner || virtualItems.length === 0) {
      if (inner) {
        inner.style.paddingLeft = '';
        inner.style.paddingTop = '';
      }
      return;
    }
    const wrap = inner.querySelector(
      '.vault-tree-row-virtual-wrap',
    ) as HTMLElement | null;
    if (!wrap) {
      inner.style.paddingLeft = '';
      inner.style.paddingTop = '';
      return;
    }

    /**
     * Subpixel alignment without `translate3d` on this inner (compositor blur on SVG strokes).
     * Padding nudge avoids margins on a `width: 100%` inner spilling wider than the scrollport.
     */
    inner.style.paddingLeft = '0px';
    inner.style.paddingTop = '0px';
    const pre = wrap.getBoundingClientRect();
    const dx = Math.round(pre.left) - pre.left;
    const dy = Math.round(pre.top) - pre.top;
    inner.style.paddingLeft = dx !== 0 ? `${dx}px` : '';
    inner.style.paddingTop = dy !== 0 ? `${dy}px` : '';
  }, [virtualItems, virtualizer, vaultTreeLayoutNonce, treeViewRevision]);

  const containerProps = tree.getContainerProps(
    treeScope === 'inboxRoot' ? 'Inbox' : 'Vault',
  );

  const selectedIdsForBulk = tree.getState().selectedItems;
  let vaultRootInMultiSelection = false;
  const bulkItemsFromSelection: VaultTreeBulkItem[] = [];
  for (const id of selectedIdsForBulk) {
    if (id === rootId) {
      vaultRootInMultiSelection = true;
      continue;
    }
    const stored = itemStoreRef.current[id];
    if (stored?.uri) {
      bulkItemsFromSelection.push({uri: stored.uri, kind: stored.kind});
    }
  }
  const multiSelectActive = selectedIdsForBulk.length > 1;
  const bulkDeletePlannedCount = planVaultTreeBulkTargets(
    bulkItemsFromSelection,
    rootId,
  ).length;
  const allowBulkDelete =
    multiSelectActive
    && !vaultRootInMultiSelection
    && bulkDeletePlannedCount > 0;

  const applyVaultTreeDrop = useCallback(
    (raw: string | undefined, targetDirectoryUri: string) => {
      if (!raw) {
        return;
      }
      const resolved = resolveVaultTreeDropFromMime(raw);
      if (!resolved.ok) {
        return;
      }
      if (resolved.mode === 'bulk') {
        Promise.resolve(
          onBulkMoveVaultTreeItems(resolved.items, targetDirectoryUri),
        );
        return;
      }
      Promise.resolve(
        onMoveVaultTreeItem(
          resolved.sourceUri,
          resolved.sourceKind,
          targetDirectoryUri,
        ),
      );
    },
    [onBulkMoveVaultTreeItems, onMoveVaultTreeItem],
  );

  return (
    <>
      <AssistiveTreeDescription tree={tree} className="visually-hidden" />
      <div
        {...containerProps}
        aria-multiselectable="true"
        className={[
          'vault-tree',
          (containerProps as {className?: string}).className,
          dropTargetUri === rootId ? 'vault-tree--root-drop-target vault-tree-panel--drop-target' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragEnter={e => {
          if (busy) {
            return;
          }
          if (!dataTransferListsVaultTreeMime(e.dataTransfer)) {
            return;
          }
          e.preventDefault();
        }}
        onDragOver={e => {
          if (busy) {
            return;
          }
          if (!dataTransferListsVaultTreeMime(e.dataTransfer)) {
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropTargetUri(rootId);
        }}
        onDragLeave={e => {
          if (!scrollRef.current?.contains(e.relatedTarget as Node | null)) {
            clearDropTarget();
          }
        }}
        onDrop={e => {
          if (busy) {
            return;
          }
          if (!dataTransferListsVaultTreeMime(e.dataTransfer)) {
            return;
          }
          e.preventDefault();
          const raw = e.dataTransfer.getData(VAULT_TREE_DND_MIME);
          clearDropTarget();
          applyVaultTreeDrop(raw, rootId);
        }}
        ref={el => {
          scrollRef.current = el;
          const r = (containerProps as {ref?: (node: HTMLDivElement | null) => void}).ref;
          if (typeof r === 'function') {
            r(el);
          }
        }}
      >
        <div
          ref={vaultTreeInnerRef}
          className="vault-tree__inner"
          style={{height: `${virtualizer.getTotalSize()}px`, position: 'relative'}}
        >
          {virtualItems.map(virtualRow => {
            const item = items[virtualRow.index];
            if (!item) {
              return null;
            }
            /** Integer Y avoids sub-pixel anti-alias “fake bold” on translated row layers (WebKit/Chromium). */
            const rowOffsetYPx = Math.round(virtualRow.start);
            const data = item.getItemData();
            if (!data?.uri) {
              return (
                <div
                  key={item.getKey()}
                  className="vault-tree-row-virtual-wrap vault-tree-row-virtual-wrap--placeholder"
                  style={{
                    position: 'absolute',
                    top: rowOffsetYPx,
                    left: 0,
                    width: '100%',
                    height: VAULT_TREE_ROW_HEIGHT_PX,
                  }}
                  aria-hidden
                />
              );
            }
            const rowProps = item.getProps();
            const {
              onClick: rowAriaOnClick,
              className: rowPropClassName,
              ...rowButtonA11yProps
            } = rowProps;
            const level = item.getItemMeta().level;
            const isDropTargetDir = isVaultTreeRowDirectoryDropTarget(data);
            const primaryMdUri = vaultTreeRowPrimaryMarkdownUri(data);
            const selected = item.isSelected();
            const isVaultRoot = data.uri === rootId;
            const rowVm = vaultTreeItemToFileTreeRowViewModel({
              data,
              level,
              isExpanded: item.isExpanded(),
              label: vaultTreeRowLabel(data),
              primaryOpenUri: primaryMdUri,
            });

            const canDragFromRow = Boolean(data.uri) && data.uri !== rootId && !busy;
            const rowButton = (
              <FileTreeNode
                {...rowButtonA11yProps}
                depth={rowVm.depth}
                label={rowVm.label}
                treeType={rowVm.treeType}
                isFolderExpanded={rowVm.isExpanded}
                selected={selected}
                className={vaultTreeFileNodeRowClassName(
                  rowPropClassName,
                  selected,
                  isDropTargetDir,
                  dropTargetUri === data.uri,
                  draggingSourceUri === data.uri,
                )}
                disabled={busy}
                draggable={canDragFromRow}
                onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    if (e.shiftKey) {
                      item.selectUpTo(e.ctrlKey || e.metaKey);
                    } else {
                      item.toggleSelect();
                    }
                    if (!e.shiftKey) {
                      tree.getDataRef<SelectionDataRef>().current.selectUpToAnchorId =
                        item.getId();
                    }
                    item.setFocused();
                    return;
                  }
                  rowAriaOnClick?.(e.nativeEvent);
                }}
                onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => {
                  if (e.button !== 1 || busy) {
                    return;
                  }
                  if (!vaultTreeMiddleClickApplies(data, primaryMdUri)) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onAuxClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                  if (e.button !== 1 || busy) {
                    return;
                  }
                  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
                    return;
                  }
                  if (!vaultTreeMiddleClickApplies(data, primaryMdUri)) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenMarkdownNoteInNewActiveTab(primaryMdUri!);
                }}
                onDoubleClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                  if (busy || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
                    return;
                  }
                  if (primaryMdUri) {
                    e.preventDefault();
                    onOpenMarkdownNote(primaryMdUri);
                  }
                }}
                onDragStart={e => {
                  if (!canDragFromRow) {
                    return;
                  }
                  setDraggingSourceUri(data.uri);
                  const selectedIds = tree.getState().selectedItems;
                  let multiExtraCount = 0;
                  if (selectedIds.length > 1 && selectedIds.includes(data.uri)) {
                    const movable = selectedIds.filter(
                      id => id !== rootId && itemStoreRef.current[id]?.uri,
                    );
                    if (movable.length > 1) {
                      multiExtraCount = movable.length - 1;
                    }
                  }
                  mountVaultTreeDragGhost({
                    icon: vaultTreeDragGhostIconForRow(data),
                    label: vaultTreeRowLabel(data),
                    multiExtraCount: multiExtraCount > 0 ? multiExtraCount : undefined,
                    dataTransfer: e.dataTransfer,
                    pointerClientX: e.clientX,
                    pointerClientY: e.clientY,
                    sourceButton: e.currentTarget,
                    hostRef: dragGhostHostRef,
                  });
                  e.dataTransfer.setData(
                    VAULT_TREE_DND_MIME,
                    serializeVaultTreeDragPayload({
                      draggedUri: data.uri,
                      draggedKind: data.kind,
                      selectedItemIds: selectedIds,
                      rootId,
                      getRow: id => itemStoreRef.current[id],
                    }),
                  );
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => endVaultTreeDrag()}
                onDragOver={
                  isDropTargetDir
                    ? e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTargetUri(data.uri);
                        e.stopPropagation();
                      }
                    : undefined
                }
                onDragLeave={
                  isDropTargetDir
                    ? e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setDropTargetUri(null);
                        }
                      }
                    : undefined
                }
                onDrop={
                  isDropTargetDir
                    ? e => {
                        e.preventDefault();
                        e.stopPropagation();
                        clearDropTarget();
                        if (busy) {
                          return;
                        }
                        const raw = e.dataTransfer.getData(VAULT_TREE_DND_MIME);
                        applyVaultTreeDrop(raw, data.uri);
                      }
                    : undefined
                }
              />
            );

            return (
              <div
                key={item.getKey()}
                className="vault-tree-row-virtual-wrap"
                style={{
                  position: 'absolute',
                  top: rowOffsetYPx,
                  left: 0,
                  width: '100%',
                  height: VAULT_TREE_ROW_HEIGHT_PX,
                }}
              >
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>{rowButton}</ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className="note-list-context-menu"
                      alignOffset={4}
                      collisionPadding={8}
                    >
                      {allowBulkDelete ? (
                        <ContextMenu.Item
                          className="note-list-context-menu__item note-list-context-menu__item--danger"
                          disabled={busy}
                          onSelect={() => {
                            onBulkDeleteRequest(bulkItemsFromSelection);
                          }}
                        >
                          Delete {bulkDeletePlannedCount} items…
                        </ContextMenu.Item>
                      ) : (
                        <>
                          <ContextMenu.Item
                            className="note-list-context-menu__item"
                            disabled={busy || multiSelectActive}
                            onSelect={() => {
                              if (data.kind === 'todayHub' && data.todayNoteUri) {
                                onOpenMarkdownNote(data.todayNoteUri);
                              } else if (data.kind === 'article') {
                                onOpenMarkdownNote(data.uri);
                              } else {
                                item.expand();
                              }
                            }}
                          >
                            Open
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="note-list-context-menu__item"
                            disabled={busy || isVaultRoot || multiSelectActive}
                            onSelect={() => {
                              if (data.kind === 'article') {
                                onRenameMarkdownRequest(data.uri);
                              } else {
                                onRenameFolderRequest(data.uri);
                              }
                            }}
                          >
                            Rename
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="note-list-context-menu__item note-list-context-menu__item--danger"
                            disabled={busy || isVaultRoot || multiSelectActive}
                            onSelect={() => {
                              if (data.kind === 'article') {
                                onDeleteMarkdownRequest(data.uri);
                              } else {
                                onDeleteFolderRequest(data.uri);
                              }
                            }}
                          >
                            Delete
                          </ContextMenu.Item>
                        </>
                      )}
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});
