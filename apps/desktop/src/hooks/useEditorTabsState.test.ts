import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {useEditorTabsState} from './useEditorTabsState';

describe('useEditorTabsState', () => {
  it('tracks reopenable closed tab state against vaultRoot + notes', () => {
    const {result, rerender} = renderHook(
      ({vaultRoot, notes}: {vaultRoot: string | null; notes: Array<{lastModified: number | null; name: string; uri: string}>}) =>
        useEditorTabsState({vaultRoot, notes}),
      {
        initialProps: {
          vaultRoot: '/vault',
          notes: [{lastModified: null, name: 'n', uri: '/vault/Inbox/a.md'}],
        },
      },
    );

    expect(result.current.canReopenClosedEditorTab).toBe(false);
    act(() => {
      result.current.editorClosedTabsStackRef.current.push({
        uri: '/vault/Inbox/a.md',
        index: 0,
      });
      result.current.bumpEditorClosedStack();
    });
    expect(result.current.canReopenClosedEditorTab).toBe(true);

    rerender({vaultRoot: null, notes: [{lastModified: null, name: 'n', uri: '/vault/Inbox/a.md'}]});
    expect(result.current.canReopenClosedEditorTab).toBe(false);
  });
});
