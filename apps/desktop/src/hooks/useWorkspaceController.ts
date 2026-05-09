import {useCallback, useLayoutEffect, useRef, useState} from 'react';

import {
  validateWorkspaceModel,
  type WorkspaceModel,
  type WorkspaceModelIssue,
} from '../lib/workspaceModel';

const EMPTY_WORKSPACE_MODEL: WorkspaceModel = {activeHub: null, workspaces: {}};

function shouldCheckWorkspaceModelInvariants(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test';
}

function warnWorkspaceModelIssues(
  reason: string,
  issues: readonly WorkspaceModelIssue[],
): void {
  if (issues.length === 0 || !shouldCheckWorkspaceModelInvariants()) {
    return;
  }
  console.warn('[workspaceModel] invariant issues after', reason, issues);
}

export function useWorkspaceController(initialModel: WorkspaceModel = EMPTY_WORKSPACE_MODEL) {
  const [model, setModel] = useState<WorkspaceModel>(initialModel);
  const modelRef = useRef(model);

  useLayoutEffect(() => {
    modelRef.current = model;
  }, [model]);

  const replaceModel = useCallback((next: WorkspaceModel, reason: string) => {
    warnWorkspaceModelIssues(reason, validateWorkspaceModel(next));
    modelRef.current = next;
    setModel(next);
  }, []);

  const dispatchWorkspaceAction = useCallback((
    actionDescription: string,
    updater: (current: WorkspaceModel) => WorkspaceModel,
  ) => {
    setModel(current => {
      const next = updater(current);
      warnWorkspaceModelIssues(actionDescription, validateWorkspaceModel(next));
      modelRef.current = next;
      return next;
    });
  }, []);

  /**
   * Same validation as {@link dispatchWorkspaceAction}, but applies `updater(modelRef.current)`
   * synchronously and assigns `modelRef.current` before `setModel(next)` so callers can mirror
   * legacy UI state in the same synchronous turn (e.g. tab reorder → derive `editorWorkspaceTabs`).
   *
   * Prefer {@link dispatchWorkspaceAction} for ordinary updates. Use this only when the next model
   * must be read immediately after the action; avoid mixing with a queued async dispatch in the
   * same handler unless ordering is intentional.
   */
  const dispatchWorkspaceActionSync = useCallback((
    actionDescription: string,
    updater: (current: WorkspaceModel) => WorkspaceModel,
  ): WorkspaceModel => {
    const next = updater(modelRef.current);
    warnWorkspaceModelIssues(actionDescription, validateWorkspaceModel(next));
    modelRef.current = next;
    setModel(next);
    return next;
  }, []);

  return {
    model,
    modelRef,
    replaceModel,
    dispatchWorkspaceAction,
    dispatchWorkspaceActionSync,
  };
}
