import type {CleanNoteOptions, ResolvedCleanNoteOptions} from './types';

export function resolveCleanNoteDefaults(opts?: CleanNoteOptions): ResolvedCleanNoteOptions {
  return {
    bullet: opts?.bullet ?? '-',
    bulletOrdered: opts?.bulletOrdered ?? '.',
    emphasis: opts?.emphasis ?? '*',
    strong: opts?.strong ?? '*',
    listItemIndent: opts?.listItemIndent ?? 'tab',
    insertH1FromFilename: opts?.insertH1FromFilename ?? true,
    capHeadingDepthJumps: opts?.capHeadingDepthJumps ?? true,
    removeEmptyListItems: opts?.removeEmptyListItems ?? true,
    normalizeEmojiVs16: opts?.normalizeEmojiVs16 ?? true,
    rejoinHyphenatedLineBreaks: opts?.rejoinHyphenatedLineBreaks ?? true,
  };
}
