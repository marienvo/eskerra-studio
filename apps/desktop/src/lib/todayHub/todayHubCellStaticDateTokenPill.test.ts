import {describe, expect, it} from 'vitest';

import type {CellStaticSegment} from '../../editor/noteEditor/eskerraTableV1/eskerraTableCellStaticSegments';

import {
  cellTextHasDateTokenPill,
  todayHubStaticLineParts,
  type TodayHubStaticPillPart,
} from './todayHubCellStaticDateTokenPill';

const NOW = new Date(2026, 11, 29, 9, 0); // 2026-12-29 09:00 local

function segments(text: string): CellStaticSegment[] {
  return [{from: 0, to: text.length, className: ''}];
}

function pills(parts: ReturnType<typeof todayHubStaticLineParts>): TodayHubStaticPillPart[] {
  return parts.filter((p): p is TodayHubStaticPillPart => p.kind === 'date-pill');
}

describe('cellTextHasDateTokenPill', () => {
  it('detects a valid date token', () => {
    expect(cellTextHasDateTokenPill('call mom @2026-12-30_1200')).toBe(true);
  });

  it('returns false for an invalid calendar date', () => {
    expect(cellTextHasDateTokenPill('bogus @2026-13-40')).toBe(false);
  });

  it('returns false when there is no token', () => {
    expect(cellTextHasDateTokenPill('just text')).toBe(false);
  });
});

describe('todayHubStaticLineParts', () => {
  it('replaces a date token with a pill and keeps surrounding text as segments', () => {
    const text = 'call mom @2026-12-30_1200';
    const parts = todayHubStaticLineParts(0, text, segments(text), NOW);

    expect(parts.map(p => p.kind)).toEqual(['segments', 'date-pill']);
    const [pill] = pills(parts);
    const tokenStart = text.indexOf('@');
    expect(pill).toMatchObject({
      from: tokenStart,
      to: text.length,
      past: false,
    });
    // "call mom " segment precedes the pill (token start is preceded by a space).
    expect(parts[0]).toEqual({
      kind: 'segments',
      segments: [{from: 0, to: tokenStart, className: ''}],
    });
  });

  it('keeps text after the token as a trailing segments run', () => {
    const text = '@2026-12-30 then lunch';
    const parts = todayHubStaticLineParts(0, text, segments(text), NOW);

    expect(parts.map(p => p.kind)).toEqual(['date-pill', 'segments']);
    const [pill] = pills(parts);
    expect(pill!.from).toBe(0);
  });

  it('marks past tokens', () => {
    const text = 'overdue @2026-12-01_0800';
    const [pill] = pills(todayHubStaticLineParts(0, text, segments(text), NOW));
    expect(pill!.past).toBe(true);
  });

  it('honours the line offset for multi-line cells', () => {
    const text = 'do @2026-12-31';
    const lineFrom = 100;
    const parts = todayHubStaticLineParts(lineFrom, text, [
      {from: lineFrom, to: lineFrom + text.length, className: ''},
    ], NOW);
    const [pill] = pills(parts);
    expect(pill!.from).toBe(lineFrom + text.indexOf('@'));
    expect(pill!.to).toBe(lineFrom + text.length);
  });

  it('returns a single segments part when there is no token', () => {
    const text = 'plain row';
    const parts = todayHubStaticLineParts(0, text, segments(text), NOW);
    expect(parts).toEqual([
      {kind: 'segments', segments: [{from: 0, to: text.length, className: ''}]},
    ]);
  });

  it('handles two tokens on one line', () => {
    const text = '@2026-12-30 and @2026-12-31';
    const parts = todayHubStaticLineParts(0, text, segments(text), NOW);
    expect(parts.map(p => p.kind)).toEqual([
      'date-pill',
      'segments',
      'date-pill',
    ]);
    expect(pills(parts)).toHaveLength(2);
  });
});
