import {
  findTabById,
  firstSurvivorUriFromTabs,
  tabCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';

import type {TabCommandContext} from './workspaceTabCommands';

/**
 * Pick where to refocus after the active tab is removed from the strip (vault watch / model sync).
 * Extracted from {@link workspaceTabCommands} to keep that module within budget.
 */
export async function runRefocusAfterActiveTabRemoved(
  ctx: TabCommandContext,
  closedNorm: string,
  nextTabs: readonly EditorWorkspaceTab[],
  nextActive: string | null,
  options?: {wasOnHomeNoActiveTab?: boolean},
): Promise<void> {
  const {refs, callbacks} = ctx;
  if (options?.wasOnHomeNoActiveTab) {
    const shellHub = refs.activeTodayHubUriRef.current;
    if (shellHub && shellHub !== closedNorm) {
      await callbacks.selectHomeCurrentNote(shellHub);
      return;
    }
    callbacks.clearInboxSelection();
    return;
  }
  const activeTab = nextActive ? findTabById(nextTabs, nextActive) : undefined;
  const nextAfterRemove =
    (activeTab ? tabCurrentUri(activeTab) : null) ?? firstSurvivorUriFromTabs(nextTabs);
  if (nextAfterRemove) {
    await callbacks.openMarkdownInEditor(nextAfterRemove, {skipHistory: true});
    return;
  }
  const shellHub = refs.activeTodayHubUriRef.current;
  if (shellHub && shellHub !== closedNorm) {
    await callbacks.selectHomeCurrentNote(shellHub);
    return;
  }
  callbacks.clearInboxSelection();
}
