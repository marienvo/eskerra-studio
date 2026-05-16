// @vitest-environment happy-dom
import {act, renderHook} from '@testing-library/react';
import {createRef, type RefObject} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {VaultMarkdownRef} from '@eskerra/core';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {RestoredInboxState} from './inboxShellRestoreHelpers';
import {useInboxShellRestore, type UseInboxShellRestoreArgs} from './useInboxShellRestore';

function ref<T>(current: T): {current: T} {
  return {current};
}

function makeArgs(
  overrides: Partial<UseInboxShellRestoreArgs> = {},
): UseInboxShellRestoreArgs {
  const editorWorkspaceTabsRef = ref<EditorWorkspaceTab[]>([]);
  const activeEditorTabIdRef = ref<string | null>(null);
  const activeTodayHubUriRef = ref<string | null>(null);
  const notesRef: RefObject<readonly {uri: string}[]> = createRef();
  (notesRef as {current: readonly {uri: string}[]}).current = [];
  return {
    vaultRoot: '/vault',
    inboxRestoreEnabled: true,
    inboxShellRestored: false,
    setInboxShellRestored: vi.fn(),
    restoredInboxState: null,
    notes: [],
    notesRef,
    vaultMarkdownRefs: [] as VaultMarkdownRef[],
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    activeTodayHubUriRef,
    setEditorWorkspaceTabs: vi.fn(),
    setActiveEditorTabId: vi.fn(),
    setActiveTodayHubUri: vi.fn(),
    replaceHomeStatesByHub: vi.fn(),
    mirrorShadowActiveHub: vi.fn(),
    mirrorShadowActiveWorkspaceTabs: vi.fn(),
    mirrorShadowActiveTab: vi.fn(),
    mirrorShadowHomeSurface: vi.fn(),
    syncShadowWorkspaceFromShellRestore: vi.fn(),
    startNewEntry: vi.fn(),
    selectNote: vi.fn(),
    selectHomeCurrentNote: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useInboxShellRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks shell restored when inbox restore is disabled', async () => {
    const setInboxShellRestored = vi.fn();
    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          inboxRestoreEnabled: false,
          setInboxShellRestored,
        }),
      ),
    );

    await flushMicrotasks();
    expect(setInboxShellRestored).toHaveBeenCalledWith(true);
  });

  it('clears shell restored when vault is missing but restore is enabled', async () => {
    const setInboxShellRestored = vi.fn();
    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          vaultRoot: null,
          inboxRestoreEnabled: true,
          setInboxShellRestored,
        }),
      ),
    );

    await flushMicrotasks();
    expect(setInboxShellRestored).toHaveBeenCalledWith(false);
  });

  it('marks shell restored when persisted vault does not match the open vault', async () => {
    const setInboxShellRestored = vi.fn();
    const replaceHomeStatesByHub = vi.fn();
    const restoredInboxState: RestoredInboxState = {
      vaultRoot: '/other-vault',
      composingNewEntry: false,
      selectedUri: null,
    };

    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          restoredInboxState,
          setInboxShellRestored,
          replaceHomeStatesByHub,
        }),
      ),
    );

    await flushMicrotasks();
    expect(setInboxShellRestored).toHaveBeenCalledWith(true);
    expect(replaceHomeStatesByHub).not.toHaveBeenCalled();
  });

  it('mirrors null active hub when the vault has markdown refs but no Today hub restore keys', async () => {
    const setInboxShellRestored = vi.fn();
    const mirrorShadowActiveHub = vi.fn();
    const restoredInboxState: RestoredInboxState = {
      vaultRoot: '/vault',
      composingNewEntry: false,
      selectedUri: null,
      todayHubWorkspaces: {},
    };
    const vaultMarkdownRefs: VaultMarkdownRef[] = [
      {name: 'Note', uri: '/vault/Inbox/a.md'},
    ];

    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          restoredInboxState,
          setInboxShellRestored,
          mirrorShadowActiveHub,
          vaultMarkdownRefs,
        }),
      ),
    );

    await flushMicrotasks();
    expect(mirrorShadowActiveHub).toHaveBeenCalledWith(null, 'restore active hub');
    expect(setInboxShellRestored).toHaveBeenCalledWith(true);
  });

  it('restores Today hub workspace and syncs shadow model when persisted state matches the vault', async () => {
    const HUB = '/vault/Daily/Today.md';
    const setInboxShellRestored = vi.fn();
    const setActiveTodayHubUri = vi.fn();
    const replaceHomeStatesByHub = vi.fn();
    const syncShadowWorkspaceFromShellRestore = vi.fn();
    const selectHomeCurrentNote = vi.fn().mockResolvedValue(undefined);

    const snap: TodayHubWorkspaceSnapshot = {editorWorkspaceTabs: []};
    const restoredInboxState: RestoredInboxState = {
      vaultRoot: '/vault',
      composingNewEntry: false,
      selectedUri: null,
      todayHubWorkspaces: {[HUB]: snap},
    };

    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          restoredInboxState,
          setInboxShellRestored,
          setActiveTodayHubUri,
          replaceHomeStatesByHub,
          syncShadowWorkspaceFromShellRestore,
          selectHomeCurrentNote,
        }),
      ),
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(setActiveTodayHubUri).toHaveBeenCalledWith(HUB);
    expect(replaceHomeStatesByHub).toHaveBeenCalled();
    expect(setInboxShellRestored).toHaveBeenCalledWith(true);
    expect(syncShadowWorkspaceFromShellRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTodayHubUri: HUB,
        hubUris: expect.arrayContaining([HUB]),
        todayHubWorkspaces: {
          [HUB]: {...snap, activeEditorTabId: null},
        },
      }),
    );
    expect(selectHomeCurrentNote).toHaveBeenCalledWith(HUB);
  });

  it('does not run restore while inboxShellRestored is already true', () => {
    const setInboxShellRestored = vi.fn();
    const replaceHomeStatesByHub = vi.fn();
    const restoredInboxState: RestoredInboxState = {
      vaultRoot: '/vault',
      composingNewEntry: false,
      selectedUri: null,
      todayHubWorkspaces: {
        '/vault/Daily/Today.md': {editorWorkspaceTabs: []},
      },
    };

    renderHook(() =>
      useInboxShellRestore(
        makeArgs({
          inboxShellRestored: true,
          restoredInboxState,
          setInboxShellRestored,
          replaceHomeStatesByHub,
        }),
      ),
    );

    expect(replaceHomeStatesByHub).not.toHaveBeenCalled();
    expect(setInboxShellRestored).not.toHaveBeenCalled();
  });
});
