// @vitest-environment happy-dom
import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {type VaultMarkdownRef} from '@eskerra/core';

import * as vaultBootstrap from '../lib/vaultBootstrap';
import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {makeTodayHubsStateArgs, ref} from './todayHub/useTodayHubsStateTestFixtures';
import {useTodayHubsState} from './useTodayHubsState';

vi.mock('../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

vi.mock('../lib/vaultBootstrap', () => ({
  saveNoteMarkdown: vi.fn().mockResolvedValue(undefined),
  deleteVaultMarkdownNote: vi.fn().mockResolvedValue(undefined),
}));

describe('useTodayHubsState', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockClear();
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockResolvedValue(undefined);
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockResolvedValue(undefined);
  });

  it('owns Home history refs and mirrors changes to the workspace model bridge', () => {
    const replaceShadowHomeStateForHub = vi.fn();
    const args = makeTodayHubsStateArgs();
    args.workspace.mirror.replaceShadowHomeStateForHub = replaceShadowHomeStateForHub;
    const {result} = renderHook(() => useTodayHubsState(args));

    act(() => {
      result.current.pushHomeHistoryForHub('/vault/Today.md', '/vault/Inbox/a.md');
    });

    expect(result.current.homeStatesByHubRef.current['/vault/Today.md']).toEqual({
      history: {
        entries: ['/vault/Today.md', '/vault/Inbox/a.md'],
        index: 1,
      },
    });
    expect(replaceShadowHomeStateForHub).toHaveBeenCalledWith(
      '/vault/Today.md',
      {
        history: {
          entries: ['/vault/Today.md', '/vault/Inbox/a.md'],
          index: 1,
        },
      },
      'homeHistory set',
    );
  });

  it('blocks Today row cleanup for the active disk conflict URI', () => {
    const args = makeTodayHubsStateArgs();
    args.editorTabs.diskConflictRef = ref({
      uri: '/vault\\Inbox\\row.md',
      diskMarkdown: '# disk',
    });
    const {result} = renderHook(() => useTodayHubsState(args));

    expect(result.current.todayHubCleanRowBlocked('/vault/Inbox/row.md')).toBe(true);
    expect(result.current.todayHubCleanRowBlocked('/vault/Inbox/other.md')).toBe(false);
  });

  it('waits for vault markdown refs before syncing hub workspaces to vault refs', () => {
    const workspaceShadowModel: WorkspaceModel = {activeHub: null, workspaces: {}};
    const dispatch = vi.fn((_: string, reduce) => reduce(workspaceShadowModel));
    const hubRefs: VaultMarkdownRef[] = [{name: 'Today', uri: '/vault/Daily/Today.md'}];
    const vaultMarkdownRefsRef = ref(hubRefs);

    const {rerender} = renderHook(
      ({refsReady}: {refsReady: boolean}) => {
        const args = makeTodayHubsStateArgs({
          workspace: {workspaceShadowModel, dispatchWorkspaceActionSync: dispatch},
          vaultRoot: '/vault',
          inboxShellRestored: true,
          vaultMarkdownRefsReady: refsReady,
          vaultMarkdownRefs: hubRefs,
        });
        args.editorTabs.vaultRootRef = ref('/vault');
        args.editorTabs.vaultMarkdownRefsRef = vaultMarkdownRefsRef;
        return useTodayHubsState(args);
      },
      {initialProps: {refsReady: false}},
    );

    const syncCalls = () =>
      dispatch.mock.calls.filter(
        ([reason]) => reason === 'sync today hub workspaces to vault refs',
      );

    expect(syncCalls()).toHaveLength(0);
    rerender({refsReady: true});
    expect(syncCalls()).toHaveLength(1);
  });

  it('switchTodayHubWorkspace flushes inbox save and dispatches hub switch', async () => {
    const HUB_A = '/vault/A/Today.md';
    const HUB_B = '/vault/B/Today.md';
    const a = normalizeWorkspaceUri(HUB_A);
    const b = normalizeWorkspaceUri(HUB_B);
    const workspaceShadowModel: WorkspaceModel = {
      activeHub: a,
      workspaces: {
        [a]: createDefaultWorkspaceState(HUB_A),
        [b]: createDefaultWorkspaceState(HUB_B),
      },
    };
    const dispatch = vi.fn((_: string, reduce) => reduce(workspaceShadowModel));
    const flushInboxSave = vi.fn().mockResolvedValue(undefined);
    const hubRefs: VaultMarkdownRef[] = [
      {name: 'Today', uri: HUB_A},
      {name: 'Today', uri: HUB_B},
    ];
    const args = makeTodayHubsStateArgs({
      workspace: {workspaceShadowModel, dispatchWorkspaceActionSync: dispatch},
      vaultRoot: '/vault',
      inboxShellRestored: true,
      vaultMarkdownRefs: hubRefs,
    });
    args.editorTabs.vaultRootRef = ref('/vault');
    args.editorTabs.vaultMarkdownRefsRef = ref(hubRefs);
    args.editorTabs.flushInboxSaveRef = ref(flushInboxSave);
    args.editorTabs.openMarkdownInEditorRef = ref(vi.fn().mockResolvedValue(undefined));

    const {result} = renderHook(() => useTodayHubsState(args));

    await act(async () => {
      await Promise.resolve();
    });

    dispatch.mockClear();

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(flushInboxSave).toHaveBeenCalled();
    expect(
      dispatch.mock.calls.some(([reason]) => reason === 'today hub switch'),
    ).toBe(true);
  });

  it('openWorkspaceHomeCurrentInBackgroundTab opens hub Today, not home history cursor', async () => {
    const HUB = '/vault/Daily/Today.md';
    const SUB = '/vault/Daily/Note.md';
    const openMarkdownInEditor = vi.fn().mockResolvedValue(undefined);
    const args = makeTodayHubsStateArgs({vaultRoot: '/vault'});
    args.editorTabs.vaultRootRef = ref('/vault');
    args.editorTabs.openMarkdownInEditorRef = ref(openMarkdownInEditor);

    const {result} = renderHook(() => useTodayHubsState(args));

    act(() => {
      result.current.setActiveTodayHubUri(HUB);
      result.current.pushHomeHistoryForHub(HUB, SUB);
    });

    await act(async () => {
      result.current.openWorkspaceHomeCurrentInBackgroundTab();
    });

    expect(openMarkdownInEditor).toHaveBeenCalledWith(
      HUB,
      expect.objectContaining({
        newTab: true,
        activateNewTab: false,
        insertAfterActive: true,
      }),
    );
    expect(openMarkdownInEditor).not.toHaveBeenCalledWith(
      SUB,
      expect.anything(),
    );
  });
});
