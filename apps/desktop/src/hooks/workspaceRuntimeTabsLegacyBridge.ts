/**
 * Centralizes legacy editor workspace tab row updates (ref + React state) and optional shadow
 * workspace-tab mirrors. Legacy arrays remain authoritative; this module only deduplicates wiring.
 */
import type {MutableRefObject} from 'react';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';

export type MirrorShadowActiveWorkspaceTabsFn = (
  tabs: readonly EditorWorkspaceTab[],
  activeEditorTabId: string | null,
  reason: string,
) => void;

export type AssignLegacyEditorWorkspaceTabsArgs = {
  nextTabs: EditorWorkspaceTab[];
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  setEditorWorkspaceTabs: (tabs: EditorWorkspaceTab[]) => void;
  mirror?:
    | {
        mirrorShadowActiveWorkspaceTabs: MirrorShadowActiveWorkspaceTabsFn;
        activeEditorTabId: string | null;
        reason: string;
      }
    | undefined;
};

/**
 * Assigns `editorWorkspaceTabsRef`, React `editorWorkspaceTabs`, and optionally mirrors the active
 * hub tab strip into the shadow `WorkspaceModel`. Ref is updated before `setState` so synchronous
 * readers observe the new strip before commit (matches prior call sites).
 */
export function assignLegacyEditorWorkspaceTabs(
  args: AssignLegacyEditorWorkspaceTabsArgs,
): void {
  args.editorWorkspaceTabsRef.current = args.nextTabs;
  args.setEditorWorkspaceTabs(args.nextTabs);
  const m = args.mirror;
  if (m != null) {
    m.mirrorShadowActiveWorkspaceTabs(
      args.nextTabs,
      m.activeEditorTabId,
      m.reason,
    );
  }
}
