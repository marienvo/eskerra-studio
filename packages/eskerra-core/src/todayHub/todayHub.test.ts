import {describe, expect, it} from 'vitest';

import {
  addLocalCalendarDays,
  enumerateTodayHubMondays,
  enumerateTodayHubWeekStarts,
  formatTodayHubMondayStem,
  mergeTodayRowColumns,
  normalizeTodayHubRowForDisk,
  parseTodayHubFrontmatter,
  splitTodayRowIntoColumns,
  splitTodayRowIntoColumnSpans,
  todayHubColumnOffsetToRowOffset,
  startOfLocalWeek,
  startOfLocalWeekMonday,
  todayHubColumnCount,
  todayHubRowSectionsAllBlank,
  todayHubRowUri,
  todayHubWeekEndInclusive,
  todayHubWeekendMergePair,
  todayHubWeekendSegmentState,
  todayHubWeekProgress,
  todayHubWeekProgressSegments,
} from './index';

describe('addLocalCalendarDays', () => {
  it('subtracts seven local days', () => {
    const d = new Date(2026, 3, 13);
    const prev = addLocalCalendarDays(d, -7);
    expect(prev.getFullYear()).toBe(2026);
    expect(prev.getMonth()).toBe(3);
    expect(prev.getDate()).toBe(6);
  });

  it('adds seven local days', () => {
    const d = new Date(2026, 3, 13);
    const next = addLocalCalendarDays(d, 7);
    expect(next.getDate()).toBe(20);
  });
});

describe('startOfLocalWeekMonday', () => {
  it('returns Monday for a Tuesday', () => {
    const tue = new Date(2026, 3, 7);
    const mon = startOfLocalWeekMonday(tue);
    expect(mon.getFullYear()).toBe(2026);
    expect(mon.getMonth()).toBe(3);
    expect(mon.getDate()).toBe(6);
  });

  it('returns same calendar Monday when input is Monday', () => {
    const mon = new Date(2026, 3, 6);
    const out = startOfLocalWeekMonday(mon);
    expect(out.getFullYear()).toBe(2026);
    expect(out.getMonth()).toBe(3);
    expect(out.getDate()).toBe(6);
  });

  it('maps Sunday to previous Monday', () => {
    const sun = new Date(2026, 3, 5);
    const out = startOfLocalWeekMonday(sun);
    expect(out.getDate()).toBe(30);
    expect(out.getMonth()).toBe(2);
  });
});

describe('startOfLocalWeek', () => {
  it('returns Saturday for a Tuesday when week starts Saturday', () => {
    const tue = new Date(2026, 3, 7);
    const sat = startOfLocalWeek(tue, 6);
    expect(sat.getFullYear()).toBe(2026);
    expect(sat.getMonth()).toBe(3);
    expect(sat.getDate()).toBe(4);
  });
});

describe('enumerateTodayHubMondays', () => {
  it('returns 53 Mondays starting at previous week', () => {
    const now = new Date(2026, 3, 7);
    const mondays = enumerateTodayHubMondays(now);
    expect(mondays).toHaveLength(53);
    expect(formatTodayHubMondayStem(mondays[0])).toBe('2026-03-30');
    expect(formatTodayHubMondayStem(mondays[1])).toBe('2026-04-06');
    expect(formatTodayHubMondayStem(mondays[52])).toBe('2027-03-29');
  });
});

describe('enumerateTodayHubWeekStarts', () => {
  it('returns 53 week starts when start is saturday', () => {
    const now = new Date(2026, 3, 7);
    const starts = enumerateTodayHubWeekStarts(now, 'saturday');
    expect(starts).toHaveLength(53);
    expect(formatTodayHubMondayStem(starts[0])).toBe('2026-03-28');
    expect(formatTodayHubMondayStem(starts[1])).toBe('2026-04-04');
    expect(formatTodayHubMondayStem(starts[52])).toBe('2027-03-27');
  });
});

describe('todayHubRowUri', () => {
  it('builds path with ISO date stem', () => {
    const mon = new Date(2026, 3, 6);
    expect(todayHubRowUri('/vault/Daily', mon)).toBe('/vault/Daily/2026-04-06.md');
    expect(todayHubRowUri('/vault/Daily/', mon)).toBe('/vault/Daily/2026-04-06.md');
  });
});

describe('todayHubWeekEndInclusive', () => {
  it('is six calendar days after the week start (local)', () => {
    const start = new Date(2026, 3, 6);
    const end = todayHubWeekEndInclusive(start);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(12);
  });
});

describe('todayHubWeekProgress', () => {
  const weekStart = new Date(2026, 3, 6); // Mon 6 Apr 2026 (local)

  it('returns future when now is before week start', () => {
    expect(todayHubWeekProgress(weekStart, new Date(2026, 3, 5))).toEqual({kind: 'future'});
  });

  it('returns current with dayIndex 0 on the first day of the week', () => {
    expect(todayHubWeekProgress(weekStart, new Date(2026, 3, 6))).toEqual({
      kind: 'current',
      dayIndex: 0,
    });
  });

  it('returns current with dayIndex 3 on the fourth day', () => {
    expect(todayHubWeekProgress(weekStart, new Date(2026, 3, 9))).toEqual({
      kind: 'current',
      dayIndex: 3,
    });
  });

  it('returns current with dayIndex 6 on the last day of the week', () => {
    expect(todayHubWeekProgress(weekStart, new Date(2026, 3, 12))).toEqual({
      kind: 'current',
      dayIndex: 6,
    });
  });

  it('returns past when now is after the inclusive week end', () => {
    expect(todayHubWeekProgress(weekStart, new Date(2026, 3, 13))).toEqual({kind: 'past'});
  });

  /**
   * Fall-back weekend (US): local midnight-to-midnight across the extra hour can be 25h.
   * `Math.round(ms / dayMs)` must still yield a whole number of calendar days.
   */
  it('counts calendar days across a 25-hour local midnight span (fall DST)', () => {
    const start = new Date(2025, 9, 27); // Mon 27 Oct 2025 (local)
    const sunday = new Date(2025, 10, 2); // Sun 2 Nov 2025 — week still in progress
    expect(todayHubWeekProgress(start, sunday)).toEqual({kind: 'current', dayIndex: 6});
    const mondayAfter = new Date(2025, 10, 3);
    expect(todayHubWeekProgress(start, mondayAfter)).toEqual({kind: 'past'});
  });
});

describe('todayHubWeekendMergePair', () => {
  it('returns adjacent Sat–Sun indices for Monday-start week', () => {
    const weekStart = new Date(2026, 3, 6); // Mon 6 Apr 2026
    expect(todayHubWeekendMergePair(weekStart)).toEqual({satIndex: 5, sunIndex: 6});
  });

  it('returns null when Saturday and Sunday are not consecutive in the strip', () => {
    const weekStart = new Date(2026, 3, 5); // Sun 5 Apr — window Sun..Sat
    expect(todayHubWeekendMergePair(weekStart)).toBeNull();
  });
});

describe('todayHubWeekendSegmentState', () => {
  const weekStart = new Date(2026, 3, 6); // Mon 6 Apr; Sat 11, Sun 12

  it('returns null when weekend is not merged', () => {
    const sunStart = new Date(2026, 3, 5);
    expect(todayHubWeekendSegmentState(sunStart, new Date(2026, 3, 10))).toBeNull();
  });

  it('is future before Saturday of that week', () => {
    expect(todayHubWeekendSegmentState(weekStart, new Date(2026, 3, 10))).toBe('future');
  });

  it('is current on Saturday', () => {
    expect(todayHubWeekendSegmentState(weekStart, new Date(2026, 3, 11))).toBe('current');
  });

  it('is current on Sunday', () => {
    expect(todayHubWeekendSegmentState(weekStart, new Date(2026, 3, 12))).toBe('current');
  });

  it('is past after Sunday of that week', () => {
    expect(todayHubWeekendSegmentState(weekStart, new Date(2026, 3, 13))).toBe('past');
  });
});

describe('todayHubWeekProgressSegments', () => {
  const cell = 10;
  const gap = 3;

  it('returns seven unit segments when weekend is not merged', () => {
    const weekStart = new Date(2026, 3, 5); // Sun start — Sat/Sun not adjacent in strip
    const progress = todayHubWeekProgress(weekStart, new Date(2026, 3, 7));
    const segs = todayHubWeekProgressSegments(progress, weekStart, new Date(2026, 3, 7), cell, gap);
    expect(segs).toHaveLength(7);
    expect(segs.every(s => s.widthPx === cell)).toBe(true);
  });

  it('returns six segments with wide weekend when Sat/Sun are consecutive', () => {
    const weekStart = new Date(2026, 3, 6);
    const progress = todayHubWeekProgress(weekStart, new Date(2026, 3, 11));
    const segs = todayHubWeekProgressSegments(progress, weekStart, new Date(2026, 3, 11), cell, gap);
    expect(segs).toHaveLength(6);
    const wide = segs.find(s => s.dayIndex === null);
    expect(wide?.widthPx).toBe(cell * 2 + gap);
    expect(wide?.kind).toBe('current');
  });
});

describe('parseTodayHubFrontmatter', () => {
  it('defaults when no frontmatter', () => {
    const s = parseTodayHubFrontmatter('# Hello\n\nbody');
    expect(s.perpetualType).toBe('weekly');
    expect(s.columns).toEqual([]);
    expect(s.start).toBe('monday');
  });

  it('reads perpetualType, columns, start', () => {
    const md = `---
perpetualType: weekly
columns:
  - Next actions
start: monday
---
# Today hub
`;
    const s = parseTodayHubFrontmatter(md);
    expect(s.perpetualType).toBe('weekly');
    expect(s.columns).toEqual(['Next actions']);
    expect(s.start).toBe('monday');
    expect(todayHubColumnCount(s)).toBe(2);
  });

  it('reads start: Saturday (case-insensitive)', () => {
    const md = `---
start: Saturday
---
`;
    expect(parseTodayHubFrontmatter(md).start).toBe('saturday');
  });

  it('ignores unknown start value (defaults to monday)', () => {
    const md = `---
start: funday
---
`;
    expect(parseTodayHubFrontmatter(md).start).toBe('monday');
  });

  it('reads multiple columns', () => {
    const md = `---
columns:
  - A
  - B
---
`;
    expect(parseTodayHubFrontmatter(md).columns).toEqual(['A', 'B']);
    expect(todayHubColumnCount(parseTodayHubFrontmatter(md))).toBe(3);
  });

  it('reads a single column as scalar on the same line as columns:', () => {
    const md = `---
columns: Next actions
start: monday
---
`;
    const s = parseTodayHubFrontmatter(md);
    expect(s.columns).toEqual(['Next actions']);
    expect(todayHubColumnCount(s)).toBe(2);
  });
});

describe('splitTodayRowIntoColumns / mergeTodayRowColumns', () => {
  it('single column is identity', () => {
    const raw = '# Hi\n\nfoo';
    expect(splitTodayRowIntoColumns(raw, 1)).toEqual([raw.replace(/\r\n/g, '\n')]);
  });

  it('splits on delimiter and merges back', () => {
    const merged = mergeTodayRowColumns(['# 2026-04-06\n\ndefault col', 'actions\n\nmore']);
    const parts = splitTodayRowIntoColumns(merged, 2);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('# 2026-04-06\n\ndefault col');
    expect(parts[1]).toBe('actions\n\nmore');
    expect(roundTrip(parts, 2)).toBe(merged);
  });

  it('pads when multi-column but no delimiter', () => {
    const parts = splitTodayRowIntoColumns('only default', 3);
    expect(parts).toEqual(['only default', '', '']);
  });

  it('merges extra chunks into last column', () => {
    const text = 'a\n\n::today-section::\n\nb\n\n::today-section::\n\nc\n\n::today-section::\n\nd';
    const parts = splitTodayRowIntoColumns(text, 2);
    expect(parts[0]).toBe('a');
    // Stray delimiter-only lines inside the tail chunk are stripped (never shown in cell editors).
    expect(parts[1]).toBe('b\n\n\nc\n\n\nd');
  });

  it('strips spurious marker-only lines when markers repeat without valid newlines between', () => {
    const text =
      '123\n\n::today-section::\n\n::today-section::\n\nsdf\n\n::today-section::';
    const parts = splitTodayRowIntoColumns(text, 2);
    expect(parts[0]).toBe('123');
    expect(parts[1]).toBe('\nsdf\n\n\n');
    expect(parts[1]).not.toContain('::today-section::');
  });

  it('splits when section ends at EOF after marker (no trailing blank line)', () => {
    const raw = '1\n\n::today-section::';
    const parts = splitTodayRowIntoColumns(raw, 2);
    expect(parts).toEqual(['1', '']);
  });

  it('splits with single newline before marker (flex paragraph break)', () => {
    const raw = '1\n::today-section::\n\n';
    const parts = splitTodayRowIntoColumns(raw, 2);
    expect(parts).toEqual(['1', '']);
  });

  it('keeps empty middle column slots when merging (does not collapse to fewer chunks)', () => {
    const sections = ['left', '', 'right'];
    const merged = mergeTodayRowColumns(sections);
    expect(splitTodayRowIntoColumns(merged, 3)).toEqual(sections);
    expect(roundTrip(sections, 3)).toBe(merged);
  });

  it('todayHubRowSectionsAllBlank', () => {
    expect(todayHubRowSectionsAllBlank(['', '  \n'])).toBe(true);
    expect(todayHubRowSectionsAllBlank(['x'])).toBe(false);
  });

  it('todayHubColumnOffsetToRowOffset maps column-local offsets into merged row text', () => {
    const sections = ['call @2026-06-08_0930', 'later @2026-06-08_0930'];
    const rowText = mergeTodayRowColumns(sections);
    const secondTokenInCol1 = sections[1]!.indexOf('@2026-06-08_0930');
    const rowOffset = todayHubColumnOffsetToRowOffset(sections, 1, secondTokenInCol1);
    expect(rowText.slice(rowOffset, rowOffset + '@2026-06-08_0930'.length)).toBe(
      '@2026-06-08_0930',
    );
    expect(rowOffset).toBeGreaterThan(sections[0]!.length);
  });
});

describe('splitTodayRowIntoColumnSpans', () => {
  it('single column starts at 0', () => {
    const raw = '# Hi\n\nfoo';
    expect(splitTodayRowIntoColumnSpans(raw, 1)).toEqual([{section: raw, sourceStart: 0}]);
  });

  it('reports a source offset that round-trips for each well-formed column', () => {
    const merged = mergeTodayRowColumns(['# 2026-04-06\n\ndefault col', 'actions\n\nmore']);
    const spans = splitTodayRowIntoColumnSpans(merged, 2);
    expect(spans).toHaveLength(2);
    // Each section is a contiguous slice of the normalized text at its reported start.
    for (const {section, sourceStart} of spans) {
      expect(merged.slice(sourceStart, sourceStart + section.length)).toBe(section);
    }
    expect(spans[0].sourceStart).toBe(0);
    // Column 1 begins right after the `\n\n::today-section::\n\n` delimiter.
    expect(spans[1].sourceStart).toBe('# 2026-04-06\n\ndefault col'.length + '\n\n::today-section::\n\n'.length);
  });

  it('trailing empty columns (no delimiter) start at end of text', () => {
    const spans = splitTodayRowIntoColumnSpans('only default', 3);
    expect(spans.map(s => s.section)).toEqual(['only default', '', '']);
    expect(spans[0].sourceStart).toBe(0);
    expect(spans[1].sourceStart).toBe('only default'.length);
    expect(spans[2].sourceStart).toBe('only default'.length);
  });

  it('last column start sits at the first tail chunk when over-split', () => {
    const text = 'a\n\n::today-section::\n\nb\n\n::today-section::\n\nc';
    const spans = splitTodayRowIntoColumnSpans(text, 2);
    expect(spans[0].sourceStart).toBe(0);
    expect(text.slice(spans[1].sourceStart)).toBe('b\n\n::today-section::\n\nc');
  });
});

describe('normalizeTodayHubRowForDisk', () => {
  it('turns space/tab-only lines into empty lines and trims column edges', () => {
    expect(normalizeTodayHubRowForDisk(' \n\t\na\n  ', 1)).toBe('a');
  });

  it('keeps internal blank lines', () => {
    expect(normalizeTodayHubRowForDisk('a\n\nb', 1)).toBe('a\n\nb');
  });

  it('round-trips canonical multi-column merge', () => {
    const canonical = mergeTodayRowColumns(['hello', 'world']);
    expect(normalizeTodayHubRowForDisk(canonical, 2)).toBe(canonical);
  });

  it('collapses messy spacing around delimiter to canonical', () => {
    const canonical = mergeTodayRowColumns(['hello', 'world']);
    expect(normalizeTodayHubRowForDisk('hello\n\n\n::today-section::\n\nworld', 2)).toBe(canonical);
  });

  it('normalizes CRLF before processing', () => {
    expect(normalizeTodayHubRowForDisk('a\r\n\r\nb', 1)).toBe('a\n\nb');
  });
});

function roundTrip(sections: string[], count: number): string {
  const merged = mergeTodayRowColumns(sections);
  const again = splitTodayRowIntoColumns(merged, count);
  return mergeTodayRowColumns(again);
}

describe('roundTrip', () => {
  it('stable for two columns', () => {
    const sections = ['# T\n\none', 'two\n'];
    expect(roundTrip(sections, 2)).toBe(mergeTodayRowColumns(sections));
  });

  it('stable for three columns with blank middle', () => {
    const sections = ['a\n', '  \n', 'c'];
    expect(roundTrip(sections, 3)).toBe(mergeTodayRowColumns(sections));
  });
});
