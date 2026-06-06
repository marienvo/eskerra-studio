import {describe, expect, test} from 'vitest';

import {
  DATE_TOKEN_PATTERN,
  DATE_TOKEN_PREFIX_PATTERN,
  formatDateToken,
  formatTodayDateToken,
  isValidCalendarDate,
  nowTimeParts,
  pad2,
  pad4,
  parseDateToken,
  todayDateParts,
  type DateTokenValue,
} from './dateToken';

function matchAllDateTokens(text: string): string[] {
  const tokens: string[] = [];
  DATE_TOKEN_PATTERN.lastIndex = 0;
  let match = DATE_TOKEN_PATTERN.exec(text);
  while (match) {
    tokens.push(match[1]!);
    match = DATE_TOKEN_PATTERN.exec(text);
  }
  return tokens;
}

function matchPrefixBeforeCursor(textBeforeCursor: string) {
  return textBeforeCursor.match(DATE_TOKEN_PREFIX_PATTERN);
}

describe('pad2 and pad4', () => {
  test('pad2 zero-fills to two digits', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(6)).toBe('06');
    expect(pad2(28)).toBe('28');
  });

  test('pad4 zero-fills to four digits', () => {
    expect(pad4(0)).toBe('0000');
    expect(pad4(952)).toBe('0952');
    expect(pad4(2352)).toBe('2352');
  });
});

describe('isValidCalendarDate', () => {
  test('accepts ordinary dates', () => {
    expect(isValidCalendarDate(2026, 6, 6)).toBe(true);
    expect(isValidCalendarDate(2026, 12, 31)).toBe(true);
  });

  test('rejects invalid month and day', () => {
    expect(isValidCalendarDate(2026, 0, 1)).toBe(false);
    expect(isValidCalendarDate(2026, 13, 1)).toBe(false);
    expect(isValidCalendarDate(2026, 6, 0)).toBe(false);
    expect(isValidCalendarDate(2026, 6, 32)).toBe(false);
  });

  test('leap-year February 29', () => {
    expect(isValidCalendarDate(2028, 2, 29)).toBe(true);
    expect(isValidCalendarDate(2026, 2, 29)).toBe(false);
    expect(isValidCalendarDate(1900, 2, 29)).toBe(false);
    expect(isValidCalendarDate(2000, 2, 29)).toBe(true);
  });
});

describe('todayDateParts and nowTimeParts', () => {
  const fixedNow = new Date(2026, 5, 6, 23, 52, 0, 0);

  test('todayDateParts uses injectable now', () => {
    expect(todayDateParts(fixedNow)).toEqual({year: 2026, month: 6, day: 6});
  });

  test('nowTimeParts uses injectable now', () => {
    expect(nowTimeParts(fixedNow)).toEqual({hour: 23, minute: 52});
  });

  test('formatTodayDateToken formats date-only token for today', () => {
    expect(formatTodayDateToken(fixedNow)).toBe('@2026-06-06');
  });
});

describe('formatDateToken and parseDateToken', () => {
  const withTime: DateTokenValue = {
    year: 2026,
    month: 12,
    day: 28,
    hour: 23,
    minute: 52,
  };

  const dateOnly: DateTokenValue = {
    year: 2026,
    month: 12,
    day: 28,
  };

  test('round-trips date with time', () => {
    const formatted = formatDateToken(withTime);
    expect(formatted).toBe('@2026-12-28_2352');
    expect(parseDateToken(formatted)).toEqual(withTime);
  });

  test('round-trips date without time', () => {
    const formatted = formatDateToken(dateOnly);
    expect(formatted).toBe('@2026-12-28');
    expect(parseDateToken(formatted)).toEqual(dateOnly);
  });

  test('rejects invalid calendar dates', () => {
    expect(parseDateToken('@2026-13-99')).toBeNull();
    expect(parseDateToken('@2026-02-29')).toBeNull();
    expect(parseDateToken('@2026-13-01')).toBeNull();
  });

  test('rejects invalid time suffix', () => {
    expect(parseDateToken('@2026-06-06_2460')).toBeNull();
    expect(parseDateToken('@2026-06-06_9960')).toBeNull();
    expect(parseDateToken('@2026-06-06_123')).toBeNull();
  });

  test('accepts leap-day when valid', () => {
    expect(parseDateToken('@2028-02-29')).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  test('rejects malformed strings', () => {
    expect(parseDateToken('2026-06-06')).toBeNull();
    expect(parseDateToken('@26-06-06')).toBeNull();
    expect(parseDateToken('@2026-6-06')).toBeNull();
    expect(parseDateToken('@2026-06-06:2352')).toBeNull();
    expect(parseDateToken('')).toBeNull();
  });
});

describe('DATE_TOKEN_PATTERN', () => {
  test('finds tokens at line start and after whitespace', () => {
    expect(matchAllDateTokens('@2026-06-06')).toEqual(['@2026-06-06']);
    expect(matchAllDateTokens('meet @2026-06-06_1200 soon')).toEqual([
      '@2026-06-06_1200',
    ]);
    expect(matchAllDateTokens('@2026-06-06 and @2026-12-28_2352')).toEqual([
      '@2026-06-06',
      '@2026-12-28_2352',
    ]);
  });

  test('does not match inside email-like text', () => {
    expect(matchAllDateTokens('foo@bar.com')).toEqual([]);
    expect(matchAllDateTokens('user@2026-06-06')).toEqual([]);
  });

  test('does not match invalid date shapes in scan (validation is separate)', () => {
    expect(matchAllDateTokens('@2026-13-99')).toEqual(['@2026-13-99']);
    expect(parseDateToken('@2026-13-99')).toBeNull();
  });
});

describe('DATE_TOKEN_PREFIX_PATTERN', () => {
  test('matches @ at start of line', () => {
    expect(matchPrefixBeforeCursor('@')).not.toBeNull();
  });

  test('matches @ after whitespace', () => {
    expect(matchPrefixBeforeCursor('hello @')).not.toBeNull();
  });

  test('does not match @ inside words or emails', () => {
    expect(matchPrefixBeforeCursor('foo@')).toBeNull();
    expect(matchPrefixBeforeCursor('foo@bar')).toBeNull();
    expect(matchPrefixBeforeCursor('user@domain')).toBeNull();
  });
});
