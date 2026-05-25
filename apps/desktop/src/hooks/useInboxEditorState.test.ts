import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useInboxEditorState} from './useInboxEditorState';

describe('useInboxEditorState', () => {
  it('loads note markdown body and frontmatter into editor state', () => {
    const loadMarkdown = vi.fn();
    const {result} = renderHook(() =>
      useInboxEditorState({
        inboxEditorRef: {current: {loadMarkdown} as never},
      }),
    );

    act(() => {
      result.current.setSelectedUri('/note.md');
      result.current.setComposingNewEntry(false);
    });
    act(() => {
      result.current.loadFullMarkdownIntoInboxEditor(
        '---\ntags: [a]\n---\n# Body',
        '/note.md',
        'start',
      );
    });

    expect(loadMarkdown).toHaveBeenCalledWith('# Body', {selection: 'start'});
    expect(result.current.editorBody).toBe('# Body');
    expect(result.current.inboxYamlFrontmatterInner).toContain('tags: [a]');
    expect(result.current.inboxEditorYamlLeadingBeforeFrontmatter).toBe('');
    expect(result.current.openTimeDiskBodyRef.current).toBe('# Body');
  });

  it('records open-time disk body separately from open-note buffer padding', () => {
    const loadMarkdown = vi.fn();
    const getMarkdown = vi.fn(() => '# Title\n\n');
    const {result} = renderHook(() =>
      useInboxEditorState({
        inboxEditorRef: {current: {loadMarkdown, getMarkdown} as never},
      }),
    );

    act(() => {
      result.current.setSelectedUri('/note.md');
      result.current.setComposingNewEntry(false);
    });
    act(() => {
      result.current.loadFullMarkdownIntoInboxEditor('# Title', '/note.md', 'openNote');
    });

    expect(result.current.openTimeDiskBodyRef.current).toBe('# Title');
    expect(result.current.editorBodyRef.current).toBe('# Title\n\n');
  });

  it('guardedSetEditorBody updates activity timestamp unless suppressed', () => {
    const {result} = renderHook(() =>
      useInboxEditorState({
        inboxEditorRef: {current: null},
      }),
    );

    const before = result.current.lastInboxEditorActivityAtRef.current;
    act(() => {
      result.current.guardedSetEditorBody('a');
    });
    expect(result.current.editorBody).toBe('a');
    expect(result.current.lastInboxEditorActivityAtRef.current).toBeGreaterThanOrEqual(before);

    const ts = result.current.lastInboxEditorActivityAtRef.current;
    act(() => {
      result.current.suppressEditorOnChangeRef.current = true;
      result.current.guardedSetEditorBody('b');
      result.current.suppressEditorOnChangeRef.current = false;
    });
    expect(result.current.editorBody).toBe('a');
    expect(result.current.lastInboxEditorActivityAtRef.current).toBe(ts);
  });

  it('clearInboxSelection clears selection and resets editor compose state', () => {
    const {result} = renderHook(() =>
      useInboxEditorState({
        inboxEditorRef: {current: null},
      }),
    );

    act(() => {
      result.current.setSelectedUri('/note.md');
      result.current.setComposingNewEntry(true);
      result.current.setEditorBody('body');
      result.current.setInboxYamlFrontmatterInner('tags: [a]');
      result.current.setInboxEditorYamlLeadingBeforeFrontmatter('lead\n');
    });
    act(() => {
      result.current.clearInboxSelection();
    });

    expect(result.current.selectedUri).toBeNull();
    expect(result.current.composingNewEntry).toBe(false);
    expect(result.current.editorBody).toBe('');
    expect(result.current.inboxYamlFrontmatterInner).toBeNull();
    expect(result.current.inboxEditorYamlLeadingBeforeFrontmatter).toBe('');
    expect(result.current.inboxEditorResetNonce).toBe(1);
  });
});
