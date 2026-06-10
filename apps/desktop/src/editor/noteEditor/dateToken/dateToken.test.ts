import {describe, expect, test} from 'vitest';

import {
  collectDateTokenSpansInLine,
  DATE_TOKEN_PATTERN,
  DATE_TOKEN_PREFIX_PATTERN,
  formatDateToken,
  formatDateTokenPretty,
  formatTodayDateToken,
  isDateTokenInPast,
  isValidCalendarDate,
  normalizeStruckDateTokenTimeSeparator,
  nowTimeParts,
  pad2,
  pad4,
  parseDateToken,
  parseDateTokenSpan,
  defaultDateTokenTimeFromNow,
  snapMinuteFieldToFiveMinuteGrid,
  snapTimeToFiveMinuteGrid,
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

describe('snapTimeToFiveMinuteGrid', () => {
  test('snaps to the nearest 5-minute boundary', () => {
    expect(snapTimeToFiveMinuteGrid(23, 52)).toEqual({hour: 23, minute: 50});
    expect(snapTimeToFiveMinuteGrid(10, 1)).toEqual({hour: 10, minute: 0});
    expect(snapTimeToFiveMinuteGrid(10, 3)).toEqual({hour: 10, minute: 5});
  });

  test('keeps an exact boundary unchanged', () => {
    expect(snapTimeToFiveMinuteGrid(10, 0)).toEqual({hour: 10, minute: 0});
  });

  test('wraps past midnight to 00:00', () => {
    expect(snapTimeToFiveMinuteGrid(23, 58)).toEqual({hour: 0, minute: 0});
  });
});

describe('snapMinuteFieldToFiveMinuteGrid', () => {
  test('snaps minute input to 00–55', () => {
    expect(snapMinuteFieldToFiveMinuteGrid(52)).toBe(50);
    expect(snapMinuteFieldToFiveMinuteGrid(58)).toBe(55);
  });
});

describe('defaultDateTokenTimeFromNow', () => {
  test('adds 15 minutes then snaps to the 5-minute grid', () => {
    expect(defaultDateTokenTimeFromNow(new Date(2026, 5, 6, 14, 30))).toEqual({
      hour: 14,
      minute: 45,
    });
    expect(defaultDateTokenTimeFromNow(new Date(2026, 5, 6, 14, 31))).toEqual({
      hour: 14,
      minute: 45,
    });
    expect(defaultDateTokenTimeFromNow(new Date(2026, 5, 6, 14, 33))).toEqual({
      hour: 14,
      minute: 50,
    });
  });
});

describe('formatDateTokenPretty', () => {
  // 2026-06-06 is a Saturday.
  const now = new Date(2026, 5, 6, 12, 0);

  test('today and tomorrow', () => {
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 6}, now)).toBe(
      'Today',
    );
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 7}, now)).toBe(
      'Tomorrow',
    );
  });

  test('this-week vs next-week weekday', () => {
    // 2026-06-08 (Mon) starts the following Monday-based week.
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 8}, now)).toBe(
      'Next Mon',
    );
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 11}, now)).toBe(
      'Next Thu',
    );
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 14}, now)).toBe(
      'Next Sun',
    );
  });

  test('beyond the relative window falls back to absolute', () => {
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 15}, now)).toBe(
      '15 Jun',
    );
    expect(formatDateTokenPretty({year: 2026, month: 12, day: 28}, now)).toBe(
      '28 Dec',
    );
  });

  test('past dates are absolute', () => {
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 5}, now)).toBe(
      '5 Jun',
    );
  });

  test('absolute dates include the year when not the current one', () => {
    expect(formatDateTokenPretty({year: 2027, month: 1, day: 15}, now)).toBe(
      '15 Jan 2027',
    );
  });

  test('appends the time when present, omits it otherwise', () => {
    expect(
      formatDateTokenPretty(
        {year: 2026, month: 6, day: 6, hour: 9, minute: 5},
        now,
      ),
    ).toBe('Today at 09:05');
    expect(
      formatDateTokenPretty(
        {year: 2026, month: 6, day: 11, hour: 15, minute: 0},
        now,
      ),
    ).toBe('Next Thu at 15:00');
    expect(formatDateTokenPretty({year: 2026, month: 6, day: 11}, now)).toBe(
      'Next Thu',
    );
  });
});

describe('isDateTokenInPast', () => {
  // 2026-06-06 14:30.
  const now = new Date(2026, 5, 6, 14, 30);

  test('timed tokens compare to the exact clock', () => {
    expect(
      isDateTokenInPast({year: 2026, month: 6, day: 6, hour: 14, minute: 29}, now),
    ).toBe(true);
    expect(
      isDateTokenInPast({year: 2026, month: 6, day: 6, hour: 14, minute: 31}, now),
    ).toBe(false);
  });

  test('date-only tokens are past only once the day is over', () => {
    expect(isDateTokenInPast({year: 2026, month: 6, day: 5}, now)).toBe(true);
    expect(isDateTokenInPast({year: 2026, month: 6, day: 6}, now)).toBe(false);
    expect(isDateTokenInPast({year: 2026, month: 6, day: 7}, now)).toBe(false);
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

  test('round-trips years shorter than four digits with zero padding', () => {
    const shortYear: DateTokenValue = {year: 100, month: 1, day: 1};
    const formatted = formatDateToken(shortYear);
    expect(formatted).toBe('@0100-01-01');
    expect(parseDateToken(formatted)).toEqual(shortYear);
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

describe('struck date tokens', () => {
  test('normalizeStruckDateTokenTimeSeparator maps \\_ to _', () => {
    expect(normalizeStruckDateTokenTimeSeparator('2026-06-08\\_0930')).toBe(
      '2026-06-08_0930',
    );
    expect(normalizeStruckDateTokenTimeSeparator('2026-06-08_0930')).toBe(
      '2026-06-08_0930',
    );
  });

  test('parseDateTokenSpan parses struck spans with optional escaped underscore', () => {
    expect(parseDateTokenSpan('@~~2026-06-08_0930~~')).toEqual({
      year: 2026,
      month: 6,
      day: 8,
      hour: 9,
      minute: 30,
      struck: true,
    });
    expect(parseDateTokenSpan('@~~2026-06-08\\_0930~~')).toEqual({
      year: 2026,
      month: 6,
      day: 8,
      hour: 9,
      minute: 30,
      struck: true,
    });
    expect(parseDateTokenSpan('@2026-06-08_0930')).toEqual({
      year: 2026,
      month: 6,
      day: 8,
      hour: 9,
      minute: 30,
      struck: false,
    });
  });

  test('formatDateToken emits canonical struck form without backslash', () => {
    expect(
      formatDateToken({
        year: 2026,
        month: 6,
        day: 8,
        hour: 9,
        minute: 30,
        struck: true,
      }),
    ).toBe('@~~2026-06-08_0930~~');
    expect(
      formatDateToken({year: 2026, month: 6, day: 8, struck: true}),
    ).toBe('@~~2026-06-08~~');
  });

  test('collectDateTokenSpansInLine prefers struck spans and avoids overlap', () => {
    const line = 'done @~~2026-06-08_0930~~ live @2026-12-28';
    expect(collectDateTokenSpansInLine(line).map(s => s.token)).toEqual([
      '@~~2026-06-08_0930~~',
      '@2026-12-28',
    ]);
  });
});
