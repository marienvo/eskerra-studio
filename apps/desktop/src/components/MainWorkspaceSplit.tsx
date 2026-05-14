import type {ReactNode} from 'react';

import {
  INBOX_LEFT_PANEL,
  MIN_RESIZABLE_PANE_PX,
  PODCASTS_LEFT_PANEL,
  VAULT_EPISODES_STACK_TOP,
} from '../lib/layout/layoutStore';

import {DesktopHorizontalSplit} from './DesktopHorizontalSplit';
import {DesktopVerticalSplit} from './DesktopVerticalSplit';

export type MainWorkspaceSplitProps = {
  vaultVisible: boolean;
  episodesVisible: boolean;
  vaultWidthPx: number;
  episodesWidthPx: number;
  onVaultWidthPxChanged: (px: number) => void;
  onEpisodesWidthPxChanged: (px: number) => void;
  /** Height of the Vault pane when Vault and Episodes are both visible (vertical stack). */
  stackTopHeightPx: number;
  onStackTopHeightPxChanged: (px: number) => void;
  vaultPane: ReactNode;
  episodesPane: ReactNode;
  editorPane: ReactNode;
};

/**
 * Optional vault and episodes areas to the left of the center workspace. When both are visible they stack
 * vertically in one column; otherwise the same fixed-px horizontal splits as before apply.
 *
 * The editor always stays under `DesktopHorizontalSplit` as `centerWorkspace` so toggling Vault (with
 * Episodes hidden) does not swap React roots and remount the editor subtree.
 */
export function MainWorkspaceSplit({
  vaultVisible,
  episodesVisible,
  vaultWidthPx,
  episodesWidthPx,
  onVaultWidthPxChanged,
  onEpisodesWidthPxChanged,
  stackTopHeightPx,
  onStackTopHeightPxChanged,
  vaultPane,
  episodesPane,
  editorPane,
}: MainWorkspaceSplitProps) {
  const leftCollapsed = !vaultVisible && !episodesVisible;

  let leftWidthPx: number;
  let minLeftPx: number;
  let maxLeftPx: number;
  let onLeftWidthPxChanged: (px: number) => void;
  let left: ReactNode;

  if (vaultVisible && episodesVisible) {
    leftWidthPx = vaultWidthPx;
    minLeftPx = INBOX_LEFT_PANEL.minPx;
    maxLeftPx = INBOX_LEFT_PANEL.maxPx;
    onLeftWidthPxChanged = onVaultWidthPxChanged;
    left = (
      <DesktopVerticalSplit
        className="split-inner"
        topHeightPx={stackTopHeightPx}
        minTopPx={MIN_RESIZABLE_PANE_PX}
        maxTopPx={VAULT_EPISODES_STACK_TOP.maxPx}
        minBottomPx={MIN_RESIZABLE_PANE_PX}
        onTopHeightPxChanged={onStackTopHeightPxChanged}
        top={vaultPane}
        bottom={episodesPane}
      />
    );
  } else if (vaultVisible) {
    leftWidthPx = vaultWidthPx;
    minLeftPx = INBOX_LEFT_PANEL.minPx;
    maxLeftPx = INBOX_LEFT_PANEL.maxPx;
    onLeftWidthPxChanged = onVaultWidthPxChanged;
    left = vaultPane;
  } else if (episodesVisible) {
    leftWidthPx = episodesWidthPx;
    minLeftPx = PODCASTS_LEFT_PANEL.minPx;
    maxLeftPx = PODCASTS_LEFT_PANEL.maxPx;
    onLeftWidthPxChanged = onEpisodesWidthPxChanged;
    left = episodesPane;
  } else {
    leftWidthPx = vaultWidthPx;
    minLeftPx = INBOX_LEFT_PANEL.minPx;
    maxLeftPx = INBOX_LEFT_PANEL.maxPx;
    onLeftWidthPxChanged = onVaultWidthPxChanged;
    left = null;
  }

  return (
    <DesktopHorizontalSplit
      className="split-inner"
      leftCollapsed={leftCollapsed}
      leftWidthPx={leftWidthPx}
      minLeftPx={minLeftPx}
      maxLeftPx={maxLeftPx}
      minCenterWorkspacePx={MIN_RESIZABLE_PANE_PX}
      onLeftWidthPxChanged={onLeftWidthPxChanged}
      left={left}
      centerWorkspace={editorPane}
    />
  );
}
