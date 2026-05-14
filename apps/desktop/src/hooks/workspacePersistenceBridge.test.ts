import {describe, expect, it} from 'vitest';

import type {SerializedWorkspacePersistence} from '../lib/workspaceModel';
import type {RuntimePersistencePayload} from '../lib/workspacePersistenceShadow';
import {collectShadowDivergenceDevDiagnostics} from './workspacePersistenceBridge';

const HUB = '/vault/Daily/Today.md';
const OTHER_HUB = '/vault/Other/Today.md';

const emptyModel: SerializedWorkspacePersistence = {
  activeTodayHubUri: null,
  todayHubWorkspaces: {},
};

const emptyLegacy: RuntimePersistencePayload = {
  activeTodayHubUri: null,
  todayHubWorkspaces: {},
};

const baseParams = {
  inboxShellRestored: true,
  isDevOrTest: true,
  shadowModelActiveHub: HUB,
  modelDerivedPersistence: emptyModel,
  legacyRuntimePayload: emptyLegacy,
  hubForProjection: HUB,
  restoredActiveTodayHubUri: null,
  todayHubWorkspacesForProjection: {} as Record<string, unknown>,
};

describe('collectShadowDivergenceDevDiagnostics', () => {
  it('suppresses when inboxShellRestored is false', () => {
    expect(
      collectShadowDivergenceDevDiagnostics({...baseParams, inboxShellRestored: false}),
    ).toEqual({suppress: true, diffs: []});
  });

  it('suppresses when isDevOrTest is false', () => {
    expect(
      collectShadowDivergenceDevDiagnostics({...baseParams, isDevOrTest: false}),
    ).toEqual({suppress: true, diffs: []});
  });

  it('suppresses when shadowModelActiveHub is null', () => {
    expect(
      collectShadowDivergenceDevDiagnostics({...baseParams, shadowModelActiveHub: null}),
    ).toEqual({suppress: true, diffs: []});
  });

  it('returns suppress: false with empty diffs when model and legacy are identical', () => {
    const snap = {editorWorkspaceTabs: [], activeEditorTabId: null};
    const model: SerializedWorkspacePersistence = {
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {[HUB]: snap},
    };
    const legacy: RuntimePersistencePayload = {
      activeTodayHubUri: HUB,
      todayHubWorkspaces: {[HUB]: snap},
    };
    expect(
      collectShadowDivergenceDevDiagnostics({
        ...baseParams,
        modelDerivedPersistence: model,
        legacyRuntimePayload: legacy,
        hubForProjection: HUB,
      }),
    ).toEqual({suppress: false, diffs: []});
  });

  it('returns unfiltered diffs when a hub is in legacy but absent from both model and projection', () => {
    // Hub in legacy, absent from model and projection → presence divergence is not a known
    // timing gap → appears in diffs unfiltered.
    const legacy: RuntimePersistencePayload = {
      activeTodayHubUri: null,
      todayHubWorkspaces: {[HUB]: {editorWorkspaceTabs: [], activeEditorTabId: null}},
    };
    const result = collectShadowDivergenceDevDiagnostics({
      ...baseParams,
      shadowModelActiveHub: OTHER_HUB,
      modelDerivedPersistence: {activeTodayHubUri: null, todayHubWorkspaces: {}},
      legacyRuntimePayload: legacy,
      hubForProjection: null,
      restoredActiveTodayHubUri: null,
      todayHubWorkspacesForProjection: {},
    });
    expect(result.suppress).toBe(false);
    expect(result.diffs).toEqual([`hub ${HUB} presence model=no runtime=yes`]);
  });

  it('filters the presence diff when the hub is a pending projection hub (hasPendingProjectionHubs path)', () => {
    // Hub in legacy and projection but absent from model → hasPendingProjectionHubs = true
    // → isKnownPersistenceTimingDivergence suppresses the diff → diffs: [].
    const legacy: RuntimePersistencePayload = {
      activeTodayHubUri: null,
      todayHubWorkspaces: {[HUB]: {editorWorkspaceTabs: [], activeEditorTabId: null}},
    };
    const result = collectShadowDivergenceDevDiagnostics({
      ...baseParams,
      shadowModelActiveHub: OTHER_HUB,
      modelDerivedPersistence: {activeTodayHubUri: null, todayHubWorkspaces: {}},
      legacyRuntimePayload: legacy,
      hubForProjection: null,
      restoredActiveTodayHubUri: null,
      todayHubWorkspacesForProjection: {[HUB]: {}}, // HUB in projection → pending
    });
    expect(result.suppress).toBe(false);
    expect(result.diffs).toEqual([]);
  });
});
