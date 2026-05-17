import {describe, expect, it} from 'vitest';

import {parseTaskCheckboxMarkAfterOpenBracket} from './stringScanners';

describe('parseTaskCheckboxMarkAfterOpenBracket', () => {
  it('treats a lone space as unchecked', () => {
    const s = ' ]';
    const r = parseTaskCheckboxMarkAfterOpenBracket(s, 0);
    expect(r).toEqual({checked: false, indexAfterCheckboxBody: 1});
  });

  it('parses checked lowercase and uppercase x', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket('x]', 0)).toEqual({checked: true, indexAfterCheckboxBody: 1});
    expect(parseTaskCheckboxMarkAfterOpenBracket('X]', 0)).toEqual({checked: true, indexAfterCheckboxBody: 1});
  });

  it('allows leading spaces before x', () => {
    const r = parseTaskCheckboxMarkAfterOpenBracket('  x]', 0);
    expect(r).toEqual({checked: true, indexAfterCheckboxBody: 3});
  });

  it('allows leading tab / CR / LF before x or X', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket('\tX]', 0)).toEqual({checked: true, indexAfterCheckboxBody: 2});
    expect(parseTaskCheckboxMarkAfterOpenBracket('\tx]', 0)).toEqual({checked: true, indexAfterCheckboxBody: 2});
  });

  it('treats tab then space as unchecked (leading tab only)', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket('\t ]', 0)).toEqual({checked: false, indexAfterCheckboxBody: 2});
  });

  it('treats a space before x as checked (GFM-style)', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket(' x]', 0)).toEqual({checked: true, indexAfterCheckboxBody: 2});
  });

  it('returns null for invalid marks', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket('z]', 0)).toBeNull();
    expect(parseTaskCheckboxMarkAfterOpenBracket('', 0)).toBeNull();
  });
});
