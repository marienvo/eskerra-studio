import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {SubmitNewEntryResult} from '../hooks/workspaceComposeCommands';

export function applyComposeSubmitResultToEditor(
  editor: NoteMarkdownEditorHandle | null,
  result: SubmitNewEntryResult | undefined,
): void {
  if (!result || result.created || result.rewrittenMarkdown === undefined) {
    return;
  }
  editor?.loadMarkdown(result.rewrittenMarkdown, {selection: 'preserve'});
}

export function submitComposeEntryAndApplyResult(args: {
  editor: NoteMarkdownEditorHandle | null;
  draftMarkdown: string;
  onCreateNewEntry: (liveComposeMarkdown?: string) => Promise<SubmitNewEntryResult>;
  onError: (message: string) => void;
}): void {
  const {editor, draftMarkdown, onCreateNewEntry, onError} = args;
  onCreateNewEntry(editor?.getMarkdown() ?? draftMarkdown)
    .then(result => {
      applyComposeSubmitResultToEditor(editor, result);
    })
    .catch(e => {
      onError(e instanceof Error ? e.message : String(e));
    });
}
