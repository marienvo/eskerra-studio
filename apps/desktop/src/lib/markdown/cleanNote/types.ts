export type CleanNoteBullet = '-' | '*' | '+';
export type CleanNoteBulletOrdered = '.' | ')';
export type CleanNoteListItemIndent = 'tab' | 'one';

/** Stylistic options for future settings UI; all optional with script-compatible defaults. */
export type CleanNoteOptions = {
  bullet?: CleanNoteBullet;
  bulletOrdered?: CleanNoteBulletOrdered;
  emphasis?: '*' | '_';
  strong?: '*' | '_';
  listItemIndent?: CleanNoteListItemIndent;
  insertH1FromFilename?: boolean;
  capHeadingDepthJumps?: boolean;
  removeEmptyListItems?: boolean;
  normalizeEmojiVs16?: boolean;
  rejoinHyphenatedLineBreaks?: boolean;
};

export type ResolvedCleanNoteOptions = Required<CleanNoteOptions>;
