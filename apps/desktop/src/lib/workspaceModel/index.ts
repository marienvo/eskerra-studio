export type {
  ActiveSurface,
  HistoryStack,
  TabEntry,
  WorkspaceModel,
  WorkspaceState,
} from './types';
export {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
} from './types';

export {
  activeSurfaceUri,
  activeTabHistory,
  activeWorkspaceState,
  canGoBack,
  canGoForward,
  homeCurrentUri,
  workspaceSelectorShowsActiveTabPill,
  workspaceSelectorSubLabel,
} from './selectors';

export {validateWorkspaceModel} from './invariants';
export type {WorkspaceModelIssue} from './invariants';

export {activateTabAction, activateWorkspaceSelectorAction} from './actions/activateSurface';
export {
  goBackAction,
  goForwardAction,
  pushHomeNavigationAction,
  pushTabNavigationAction,
} from './actions/navigate';
export {
  closeAllTabsAction,
  closeOtherTabsAction,
  closeTabAction,
  openTabBackgroundAction,
  openTabForegroundAction,
  reorderTabsAction,
  type OpenTabBackgroundOptions,
} from './actions/tabs';
export {
  applyIncomingHubWorkspaceAction,
  ensureWorkspaceForHubsAction,
  selectWorkspaceAction,
} from './actions/workspace';
export {remapPrefixAction, removeUrisAction} from './actions/external';

export {
  parseWorkspaceModelFromPersistence,
  serializeWorkspaceModelToPersistence,
  sortedNormalizedHubs,
} from './persistence';
export type {
  ParseWorkspacePersistenceArgs,
  PersistedEditorDocumentHistoryState,
  PersistedStoredEditorWorkspaceTab,
  SerializedWorkspacePersistence,
  TodayHubWorkspaceSnapshotPersisted,
} from './persistence';
