import {describe, expect, it} from 'vitest';

import {
  isFourDigitYearString,
  isIso8601DateOnlyString,
  parseTaskCheckboxMarkAfterOpenBracket,
} from './stringScanners';

describe('isFourDigitYearString', () => {
  it('accepts four ASCII digits', () => {
    expect(isFourDigitYearString('2025')).toBe(true);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isFourDigitYearString('202')).toBe(false);
    expect(isFourDigitYearString('20256')).toBe(false);
    expect(isFourDigitYearString('20x5')).toBe(false);
  });
});

describe('isIso8601DateOnlyString', () => {
  it('accepts YYYY-MM-DD with hyphens', () => {
    expect(isIso8601DateOnlyString('2025-04-25')).toBe(true);
  });

  it('rejects bad separators or length', () => {
    expect(isIso8601DateOnlyString('2025/04/25')).toBe(false);
    expect(isIso8601DateOnlyString('2025-4-25')).toBe(false);
    expect(isIso8601DateOnlyString('2025-04-2')).toBe(false);
  });
});

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
