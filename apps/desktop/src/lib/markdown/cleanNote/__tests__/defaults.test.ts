import {describe, expect, it} from 'vitest';

import {resolveCleanNoteDefaults} from '..';

describe('resolveCleanNoteDefaults', () => {
  it('fills defaults for empty input', () => {
    const d = resolveCleanNoteDefaults();
    expect(d.bullet).toBe('-');
    expect(d.insertH1FromFilename).toBe(true);
    expect(d.normalizeEmojiVs16).toBe(true);
  });
});
