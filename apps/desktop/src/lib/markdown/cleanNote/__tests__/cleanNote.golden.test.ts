import {describe, expect, it} from 'vitest';

import {clean, readFixture} from './testUtils';

const GOLDEN_FIXTURES = [
  '001-basic-normalization',
  '002-link-ampersand',
  '003-emoji-vs16-normalization',
  '004-flag-zwj-normalization',
  '005-code-block-whitespace',
] as const;

describe('cleanNoteMarkdownBody golden fixtures', () => {
  it.each(GOLDEN_FIXTURES)('%s', fixtureId => {
    const input = readFixture(`markdown/${fixtureId}.input.md`);
    const expected = readFixture(`markdown/${fixtureId}.expected.md`);
    const actual = clean(input, '/tmp/Fixture.md');
    expect(actual).toBe(expected);
  });
});
