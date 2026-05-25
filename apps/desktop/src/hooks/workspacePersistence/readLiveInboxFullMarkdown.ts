import type {MutableRefObject, RefObject} from 'react';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import {persistableInboxEditorFullMarkdown} from '../openNotePersistence';

export type LiveInboxMarkdownRefs = {
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorBodyRef: MutableRefObject<string>;
  openTimeDiskBodyRef: MutableRefObject<string>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
};

export function readLiveInboxFullMarkdownFromRefs(
  refs: LiveInboxMarkdownRefs,
  editorBodyFallback: string,
  selectedUri: string | null,
  composingNewEntry: boolean,
): string {
  return persistableInboxEditorFullMarkdown({
    editorBodySlice:
      refs.inboxEditorRef.current?.getMarkdown() ?? editorBodyFallback,
    diskBodyBaseline: refs.openTimeDiskBodyRef.current || null,
    selectedUri: refs.selectedUriRef.current ?? selectedUri,
    composingNewEntry: refs.composingNewEntryRef.current ?? composingNewEntry,
    yamlInner: refs.inboxYamlFrontmatterInnerRef.current,
    yamlLeading: refs.inboxEditorYamlLeadingBeforeFrontmatterRef.current,
  });
}
