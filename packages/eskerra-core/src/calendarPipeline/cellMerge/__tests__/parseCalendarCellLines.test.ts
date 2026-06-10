import {describe, expect, it} from 'vitest';
import {parseCalendarCellLines} from '../parseCalendarCellLines';

describe('parseCalendarCellLines', () => {
  it('classifies @token lines as pipelineItem and everything else as freeform', () => {
    const cell = [
      '@2026-01-19_0900 Standup',
      '@2026-01-20 🎂 Birthday',
      '- bellen met X',
      'free paragraph',
      '**January**',
    ].join('\n');
    const lines = parseCalendarCellLines(cell);
    expect(lines.map(l => l.kind)).toEqual([
      'pipelineItem',
      'pipelineItem',
      'freeform',
      'freeform',
      'freeform',
    ]);
  });

  it('parses date, timed, timeMinutes, and body from a timed token line', () => {
    const [line] = parseCalendarCellLines('@2026-01-19_0900 Standup');
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.date.getFullYear()).toBe(2026);
    expect(line.date.getMonth()).toBe(0);
    expect(line.date.getDate()).toBe(19);
    expect(line.timed).toBe(true);
    expect(line.timeMinutes).toBe(9 * 60);
    expect(line.body).toBe('Standup');
  });

  it('parses an untimed token line', () => {
    const [line] = parseCalendarCellLines('@2026-07-11 Team day');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.timed).toBe(false);
    expect(line.timeMinutes).toBeNull();
    expect(line.date.getDate()).toBe(11);
    expect(line.date.getMonth()).toBe(6);
    expect(line.body).toBe('Team day');
  });

  it('recognizes a struck (@~~…~~) line as a pipelineItem with the same date/time', () => {
    const [line] = parseCalendarCellLines('@~~2026-06-12_0930~~ Stand-up B2B');
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.timed).toBe(true);
    expect(line.timeMinutes).toBe(9 * 60 + 30);
    expect(line.date.getMonth()).toBe(5);
    expect(line.date.getDate()).toBe(12);
    expect(line.body).toBe('Stand-up B2B');
  });

  it('recognizes a struck line with the daemon \\_ escape noise', () => {
    const [line] = parseCalendarCellLines('@~~2026-06-12\\_0930~~ Stand-up B2B');
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.timeMinutes).toBe(9 * 60 + 30);
  });

  it('recognizes a date-only struck line', () => {
    const [line] = parseCalendarCellLines('@~~2026-06-12~~ Team day');
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.timed).toBe(false);
    expect(line.body).toBe('Team day');
  });

  it('treats a legacy **Wd d:** line as freeform without weekStart', () => {
    const [line] = parseCalendarCellLines('**Mon 19:** 09:00 Standup');
    expect(line.kind).toBe('freeform');
  });

  it('classifies a legacy **Wd d:** line as pipelineItem when weekStart is provided', () => {
    const weekStart = new Date(2026, 0, 19); // Mon Jan 19
    const [line] = parseCalendarCellLines('**Mon 19:** 09:00 Standup', weekStart);
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.date.getDate()).toBe(19);
    expect(line.timed).toBe(true);
    expect(line.timeMinutes).toBe(9 * 60);
    expect(line.body).toBe('09:00 Standup');
    expect(line.raw).toBe('**Mon 19:** 09:00 Standup');
  });

  it('treats a bold month heading as freeform', () => {
    const [line] = parseCalendarCellLines('**January**');
    expect(line.kind).toBe('freeform');
  });

  it('skips blank lines', () => {
    const lines = parseCalendarCellLines('\n\n@2026-01-19 Foo\n\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('pipelineItem');
  });

  it('classifies a token-only line (no body) as pipelineItem with empty body', () => {
    const [line] = parseCalendarCellLines('@2026-03-15_1030');
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') throw new Error('expected pipelineItem');
    expect(line.body).toBe('');
    expect(line.timeMinutes).toBe(10 * 60 + 30);
  });
});
