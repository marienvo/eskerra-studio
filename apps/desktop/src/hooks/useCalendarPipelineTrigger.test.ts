import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {VaultFilesystem} from '@eskerra/core';
import {useCalendarPipelineTrigger} from './useCalendarPipelineTrigger';
import {__resetForTests} from '../lib/calendarPipeline/runCalendarPipelineDesktop';

vi.mock('../lib/calendarPipeline/runCalendarPipelineDesktop', () => ({
  runDesktopCalendarPipeline: vi.fn(async () => ({
    hubsProcessed: 1,
    failedFetches: 0,
    rowFilesWritten: 0,
    rowFilesSkipped: 0,
    agendaFilesWritten: 0,
  })),
  __resetForTests: vi.fn(),
}));

import {runDesktopCalendarPipeline} from '../lib/calendarPipeline/runCalendarPipelineDesktop';

const VAULT_ROOT = '/vault';
const VAULT_MARKDOWN_REFS = [{uri: '/vault/Today.md', name: 'Today.md'}];
const FAKE_FS = {} as VaultFilesystem;

function makeBridge(liveRowUri: string | null = null) {
  return {
    current: {
      flushPendingEdits: vi.fn(async () => undefined),
      getLiveRowUri: vi.fn(() => liveRowUri),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
});

describe('useCalendarPipelineTrigger', () => {
  it('calls flushPendingEdits before running the pipeline', async () => {
    const bridge = makeBridge();
    const {result} = renderHook(() =>
      useCalendarPipelineTrigger(VAULT_ROOT, FAKE_FS, VAULT_MARKDOWN_REFS, bridge),
    );

    let success = false;
    await act(async () => {
      success = await result.current.runCalendarSync();
    });

    expect(success).toBe(true);
    expect(bridge.current.flushPendingEdits).toHaveBeenCalledOnce();
    expect(runDesktopCalendarPipeline).toHaveBeenCalledOnce();
    // flush must happen before the pipeline call
    const flushOrder = (bridge.current.flushPendingEdits as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const pipelineOrder = (runDesktopCalendarPipeline as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(flushOrder).toBeLessThan(pipelineOrder);
  });

  it('passes isRowLiveEdited reflecting the live row URI', async () => {
    const bridge = makeBridge('/vault/Work/2026-01-12.md');
    const {result} = renderHook(() =>
      useCalendarPipelineTrigger(VAULT_ROOT, FAKE_FS, VAULT_MARKDOWN_REFS, bridge),
    );

    await act(async () => {
      await result.current.runCalendarSync();
    });

    const options = (runDesktopCalendarPipeline as ReturnType<typeof vi.fn>).mock.calls[0]?.[3];
    expect(options?.isRowLiveEdited?.('/vault/Work/2026-01-12.md')).toBe(true);
    expect(options?.isRowLiveEdited?.('/vault/Work/2026-01-19.md')).toBe(false);
  });

  it('returns false and does not call pipeline when vaultRoot is null', async () => {
    const bridge = makeBridge();
    const {result} = renderHook(() =>
      useCalendarPipelineTrigger(null, FAKE_FS, VAULT_MARKDOWN_REFS, bridge),
    );

    let success = true;
    await act(async () => {
      success = await result.current.runCalendarSync();
    });

    expect(success).toBe(false);
    expect(runDesktopCalendarPipeline).not.toHaveBeenCalled();
    expect(bridge.current.flushPendingEdits).not.toHaveBeenCalled();
  });
});
