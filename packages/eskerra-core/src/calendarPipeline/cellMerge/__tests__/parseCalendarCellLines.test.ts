import {describe, expect, it} from 'vitest';
import {parseCalendarCellLines} from '../parseCalendarCellLines';

const WEEK_START = new Date(2026, 0, 19); // Monday Jan 19 2026 (week 19..25)

describe('parseCalendarCellLines', () => {
  it('classifies pipeline items, month headings, and freeform lines', () => {
    const cell = [
      '**January**',
      '**Mon 19:** 09:00 Standup',
      '**Tue 20:** 🎂 Birthday',
      '- bellen met X',
      'free paragraph',
    ].join('\n');
    const lines = parseCalendarCellLines(cell, WEEK_START);
    expect(lines.map(l => l.kind)).toEqual([
      'monthHeading',
      'pipelineItem',
      'pipelineItem',
      'freeform',
      'freeform',
    ]);
  });

  it('resolves the day-of-month to a full date inside the week and parses the time', () => {
    const [line] = parseCalendarCellLines('**Mon 19:** 09:00 Standup', WEEK_START);
    expect(line.kind).toBe('pipelineItem');
    if (line.kind !== 'pipelineItem') {
      throw new Error('expected pipelineItem');
    }
    expect(line.date.getFullYear()).toBe(2026);
    expect(line.date.getMonth()).toBe(0);
    expect(line.date.getDate()).toBe(19);
    expect(line.timed).toBe(true);
    expect(line.timeMinutes).toBe(9 * 60);
    expect(line.body).toBe('09:00 Standup');
  });

  it('resolves a day-of-month across a month boundary within the week', () => {
    const weekStart = new Date(2026, 5, 29); // Mon Jun 29 -> Jul 5
    const [line] = parseCalendarCellLines('**Thu 2:** Something', weekStart);
    if (line.kind !== 'pipelineItem') {
      throw new Error('expected pipelineItem');
    }
    expect(line.date.getMonth()).toBe(6); // July
    expect(line.date.getDate()).toBe(2);
  });

  it('treats a bold line that is not a month as freeform', () => {
    const [line] = parseCalendarCellLines('**important note**', WEEK_START);
    expect(line.kind).toBe('freeform');
  });

  it('treats a near-pipeline line with odd spacing as freeform', () => {
    const [line] = parseCalendarCellLines('**Tu  14 :** weird', WEEK_START);
    expect(line.kind).toBe('freeform');
  });

  it('skips blank lines', () => {
    expect(parseCalendarCellLines('\n\n**January**\n\n', WEEK_START).map(l => l.kind)).toEqual([
      'monthHeading',
    ]);
  });
});
