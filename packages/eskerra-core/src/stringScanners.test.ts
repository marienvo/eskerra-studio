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

  it('returns null for invalid marks', () => {
    expect(parseTaskCheckboxMarkAfterOpenBracket('z]', 0)).toBeNull();
    expect(parseTaskCheckboxMarkAfterOpenBracket('', 0)).toBeNull();
  });
});
