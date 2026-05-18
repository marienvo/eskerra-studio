import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useAppMainWindowKeyboardEffects} from './useAppMainWindowKeyboardEffects';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

function cleanStatus(): GitStatusResult {
  return {
    branch: 'main',
    expectedBranch: 'main',
    hasUncommittedChanges: false,
    hasStagedChanges: false,
    hasUntrackedFiles: false,
    ahead: 0,
    behind: 0,
    remoteRefAvailable: true,
    unsafeState: null,
    isWrongBranch: false,
  };
}

function localChangesStatus(): GitStatusResult {
  return {...cleanStatus(), hasUncommittedChanges: true};
}

function renderKeyboardEffects(
  overrides: Partial<Parameters<typeof useAppMainWindowKeyboardEffects>[0]> = {},
) {
  const props: Parameters<typeof useAppMainWindowKeyboardEffects>[0] = {
    vaultRoot: '/vault',
    busy: false,
    canReopenClosedEditorTab: false,
    reopenLastClosedEditorTab: vi.fn(),
    composingNewEntry: false,
    selectedUri: '/vault/Inbox/Note.md',
    onCleanNoteInbox: vi.fn(),
    quickOpenOpen: false,
    setQuickOpenOpen: vi.fn(),
    vaultSearchOpen: false,
    setVaultSearchOpen: vi.fn(),
    onAddEntry: vi.fn(),
    manualSyncDisabled: false,
    manualSyncRunning: false,
    onManualSync: vi.fn(),
    ...overrides,
  };

  return renderHook(
    nextProps => useAppMainWindowKeyboardEffects(nextProps),
    {initialProps: props},
  );
}

function dispatchModS(init: {ctrlKey?: boolean; metaKey?: boolean} = {ctrlKey: true}) {
  const event = new KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function dispatchCtrlTap() {
  const keyDown = new KeyboardEvent('keydown', {
    key: 'Control',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  const keyUp = new KeyboardEvent('keyup', {
    key: 'Control',
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(keyDown);
    window.dispatchEvent(keyUp);
  });
}

function dispatchShiftTap() {
  const keyDown = new KeyboardEvent('keydown', {
    key: 'Shift',
    bubbles: true,
    cancelable: true,
  });
  const keyUp = new KeyboardEvent('keyup', {
    key: 'Shift',
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(keyDown);
    window.dispatchEvent(keyUp);
  });
}

describe('useAppMainWindowKeyboardEffects manual sync shortcut', () => {
  it('runs manual sync on Ctrl+S when enabled', () => {
    const onManualSync = vi.fn();
    renderKeyboardEffects({onManualSync});

    dispatchModS({ctrlKey: true});

    expect(onManualSync).toHaveBeenCalledTimes(1);
  });

  it('runs manual sync on Meta+S when enabled', () => {
    const onManualSync = vi.fn();
    renderKeyboardEffects({onManualSync});

    dispatchModS({metaKey: true});

    expect(onManualSync).toHaveBeenCalledTimes(1);
  });

  it('does not run manual sync when disabled', () => {
    const onManualSync = vi.fn();
    renderKeyboardEffects({manualSyncDisabled: true, onManualSync});

    dispatchModS({ctrlKey: true});

    expect(onManualSync).not.toHaveBeenCalled();
  });

  it('does not run manual sync while running', () => {
    const onManualSync = vi.fn();
    renderKeyboardEffects({manualSyncRunning: true, onManualSync});

    dispatchModS({ctrlKey: true});

    expect(onManualSync).not.toHaveBeenCalled();
  });

  it('prevents default when Ctrl+S starts manual sync', () => {
    const onManualSync = vi.fn();
    renderKeyboardEffects({onManualSync});

    const event = dispatchModS({ctrlKey: true});

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not install duplicate manual sync listeners across rerenders', () => {
    const onManualSync = vi.fn();
    const {rerender} = renderKeyboardEffects({onManualSync});

    rerender({
      vaultRoot: '/vault',
      busy: false,
      canReopenClosedEditorTab: false,
      reopenLastClosedEditorTab: vi.fn(),
      composingNewEntry: false,
      selectedUri: '/vault/Inbox/Note.md',
      onCleanNoteInbox: vi.fn(),
      quickOpenOpen: false,
      setQuickOpenOpen: vi.fn(),
      vaultSearchOpen: false,
      setVaultSearchOpen: vi.fn(),
      manualSyncDisabled: false,
      manualSyncRunning: false,
      onManualSync,
    });

    dispatchModS({ctrlKey: true});

    expect(onManualSync).toHaveBeenCalledTimes(1);
  });

  it('is a silent no-op when git status is clean (preflight returns false)', () => {
    const onManualSync = vi.fn();
    const gitStatusRef = {current: cleanStatus()};
    renderKeyboardEffects({onManualSync, gitStatusRef});

    dispatchModS({ctrlKey: true});

    expect(onManualSync).not.toHaveBeenCalled();
  });

  it('calls sync when git status shows local changes', () => {
    const onManualSync = vi.fn();
    const gitStatusRef = {current: localChangesStatus()};
    renderKeyboardEffects({onManualSync, gitStatusRef});

    dispatchModS({ctrlKey: true});

    expect(onManualSync).toHaveBeenCalledTimes(1);
  });
});

describe('useAppMainWindowKeyboardEffects modifier double-tap shortcuts', () => {
  it('opens Add to inbox on double Ctrl', () => {
    const onAddEntry = vi.fn();
    renderKeyboardEffects({onAddEntry});

    dispatchCtrlTap();
    dispatchCtrlTap();

    expect(onAddEntry).toHaveBeenCalledTimes(1);
  });

  it('does not open Add to inbox when busy', () => {
    const onAddEntry = vi.fn();
    renderKeyboardEffects({busy: true, onAddEntry});

    dispatchCtrlTap();
    dispatchCtrlTap();

    expect(onAddEntry).not.toHaveBeenCalled();
  });

  it('does not open Add to inbox when quick open is already open', () => {
    const onAddEntry = vi.fn();
    renderKeyboardEffects({quickOpenOpen: true, onAddEntry});

    dispatchCtrlTap();
    dispatchCtrlTap();

    expect(onAddEntry).not.toHaveBeenCalled();
  });

  it('still opens quick open on double Shift', () => {
    const setQuickOpenOpen = vi.fn();
    renderKeyboardEffects({setQuickOpenOpen});

    dispatchShiftTap();
    dispatchShiftTap();

    expect(setQuickOpenOpen).toHaveBeenCalledWith(true);
  });
});
