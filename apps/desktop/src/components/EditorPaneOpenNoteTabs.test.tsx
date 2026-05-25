// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {createEditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {EditorPaneOpenNoteTabs} from './EditorPaneOpenNoteTabs';

describe('EditorPaneOpenNoteTabs title bar actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('plain click opens Quick Open and Shift+click opens Add to inbox', async () => {
    const user = userEvent.setup();
    const onTitleBarQuickOpen = vi.fn();
    const onTitleBarAddToInbox = vi.fn();
    const tab = createEditorWorkspaceTab('/vault/Inbox/a.md');

    render(
      <EditorPaneOpenNoteTabs
        notes={[]}
        workspaceTabs={[tab]}
        activeTabId={tab.id}
        busy={false}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameNote={vi.fn()}
        onCloseOtherTabs={vi.fn()}
        inTitleBar
        onTitleBarQuickOpen={onTitleBarQuickOpen}
        onTitleBarAddToInbox={onTitleBarAddToInbox}
      />,
    );

    const addBtn = screen.getByRole('button', {name: 'Open note or add to inbox'});
    await user.click(addBtn);
    expect(onTitleBarQuickOpen).toHaveBeenCalledTimes(1);
    expect(onTitleBarAddToInbox).not.toHaveBeenCalled();

    fireEvent.click(addBtn, {shiftKey: true});
    expect(onTitleBarAddToInbox).toHaveBeenCalledTimes(1);
  });

  it('renders add button when there are no open tabs', () => {
    const onTitleBarQuickOpen = vi.fn();
    render(
      <EditorPaneOpenNoteTabs
        notes={[]}
        workspaceTabs={[]}
        activeTabId={null}
        busy={false}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameNote={vi.fn()}
        onCloseOtherTabs={vi.fn()}
        inTitleBar
        onTitleBarQuickOpen={onTitleBarQuickOpen}
        onTitleBarAddToInbox={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', {name: 'Open note or add to inbox'})).toBeInstanceOf(
      HTMLButtonElement,
    );
  });
});
