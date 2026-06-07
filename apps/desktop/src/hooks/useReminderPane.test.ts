import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {Reminder} from '../lib/reminderIndex';
import {useReminderPane} from './useReminderPane';

const tauriTest = vi.hoisted(() => {
  const state: {
    invoke: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
  } = {invoke: vi.fn(), listen: vi.fn()};

  const reset = (): void => {
    state.invoke.mockReset();
    state.listen.mockReset();
    state.listen.mockResolvedValue(vi.fn());
  };

  return {state, reset};
});

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: tauriTest.state.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriTest.state.listen,
}));

vi.mock('../observability/captureObservabilityMessage', () => ({
  captureObservabilityMessage: vi.fn(),
}));

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-1',
    noteUri: 'file:///vault/a.md',
    vaultRelativePath: 'a.md',
    normalizedTokenText: '@2026-06-06_0900',
    occurrenceOrdinal: 0,
    dueAtMs: 1_000,
    fireAtMs: 700,
    state: 'notified',
    lastNotifiedMs: 700,
    tokenByteFrom: 0,
    tokenByteTo: 16,
    uiCaretHint: null,
    contextAnchor: 'anchor',
    duplicateCount: 1,
    scanFingerprint: 'fp',
    ...overrides,
  };
}

function indexJson(reminders: Reminder[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    vaultHash: 'vh1',
    vaultRelativeRootMarker: null,
    generatedAtMs: 0,
    reminders,
  });
}

/**
 * Wire the `invoke` mock per command. `remove` is the `reminders_remove`
 * IPC result (or a thrown error to simulate a transport failure).
 */
function mockInvoke(opts: {
  index: Reminder[];
  remove?: string | (() => never);
}): void {
  tauriTest.state.invoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'reminders_vault_hash':
        return Promise.resolve('vh1');
      case 'reminders_write_config':
        return Promise.resolve(true);
      case 'reminders_read_index':
        return Promise.resolve(indexJson(opts.index));
      case 'reminders_remove':
        if (typeof opts.remove === 'function') return Promise.reject(new Error('transport down'));
        return Promise.resolve(opts.remove ?? 'removed');
      default:
        return Promise.resolve(null);
    }
  });
}

describe('useReminderPane.removeReminder', () => {
  beforeEach(() => {
    tauriTest.reset();
  });

  async function renderWithReminder(remove?: string | (() => never)) {
    mockInvoke({index: [reminder()], remove});
    const hook = renderHook(() => useReminderPane('/vault'));
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
    return hook;
  }

  it('drops the row on a successful `removed` result', async () => {
    const {result} = await renderWithReminder('removed');
    await act(async () => {
      await result.current.removeReminder('file:///vault/a.md', 'rem-1');
    });
    expect(result.current.rows).toHaveLength(0);
  });

  it('keeps the row and surfaces remove-unavailable on a transport error', async () => {
    // Daemon unreachable: the IPC throws. The app must perform NO local write,
    // keep the row visible, and mark it remove-unavailable (distinct from stale).
    const {result} = await renderWithReminder(() => {
      throw new Error('transport down');
    });
    await act(async () => {
      await result.current.removeReminder('file:///vault/a.md', 'rem-1');
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.removeState).toBe('remove-unavailable');
    // remove-unavailable is app-local; the daemon's reminderState is untouched.
    expect(result.current.rows[0]?.reminderState).toBe('notified');
  });

  it('clears removing without dropping the row on a `stale` result', async () => {
    const {result} = await renderWithReminder('stale');
    await act(async () => {
      await result.current.removeReminder('file:///vault/a.md', 'rem-1');
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.removeState).toBe('idle');
  });

  it('recovers when a retry succeeds after an unavailable failure', async () => {
    // A mutable result lets the same mock fail first, then succeed on retry.
    let removeResult: string | (() => never) = () => {
      throw new Error('transport down');
    };
    tauriTest.state.invoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case 'reminders_vault_hash':
          return Promise.resolve('vh1');
        case 'reminders_write_config':
          return Promise.resolve(true);
        case 'reminders_read_index':
          return Promise.resolve(indexJson([reminder()]));
        case 'reminders_remove':
          if (typeof removeResult === 'function') return Promise.reject(new Error('down'));
          return Promise.resolve(removeResult);
        default:
          return Promise.resolve(null);
      }
    });
    const {result} = renderHook(() => useReminderPane('/vault'));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      await result.current.removeReminder('file:///vault/a.md', 'rem-1');
    });
    expect(result.current.rows[0]?.removeState).toBe('remove-unavailable');

    // Daemon comes back; retry succeeds and the row disappears.
    removeResult = 'removed';
    await act(async () => {
      await result.current.removeReminder('file:///vault/a.md', 'rem-1');
    });
    expect(result.current.rows).toHaveLength(0);
  });
});
