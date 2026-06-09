import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {parseHubCalendarConfig} from './parseHubCalendarConfig';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK_TODAY_FIXTURE = resolve(HERE, '../../../../mock-vault/Work/Today.md');

describe('parseHubCalendarConfig', () => {
  it('resolves the Calendar column index from the mock Work/Today.md hub', () => {
    const markdown = readFileSync(WORK_TODAY_FIXTURE, 'utf8');
    const config = parseHubCalendarConfig(markdown);
    expect(config).not.toBeNull();
    expect(config?.columns).toEqual(['Next actions', 'Calendar']);
    // columns: [Next actions, Calendar] -> grid column 3 / split-segment index 2
    expect(config?.calendarColumnIndex).toBe(2);
    expect(config?.columnCount).toBe(3);
    expect(config?.start).toBe('monday');
    expect(config?.mdAgenda).toBeNull();
    expect(config?.icsUrls).toEqual([
      'https://outlook.office365.com/owa/calendar/me@example.com/123/calendar.ics',
    ]);
  });

  it('normalizes a scalar icsUrl into a single-element array', () => {
    const markdown = [
      '---',
      'icsUrl: https://example.com/a.ics',
      'mdAgenda: 🗓️ Personal agenda.md',
      'start: sunday',
      'columns:',
      '  - Calendar',
      '---',
      '# Hub',
    ].join('\n');
    const config = parseHubCalendarConfig(markdown);
    expect(config?.icsUrls).toEqual(['https://example.com/a.ics']);
    expect(config?.mdAgenda).toBe('🗓️ Personal agenda.md');
    expect(config?.start).toBe('sunday');
    expect(config?.calendarColumnIndex).toBe(1);
    expect(config?.columnCount).toBe(2);
  });

  it('returns null when there is no Calendar column', () => {
    const markdown = [
      '---',
      'columns:',
      '  - Next actions',
      '---',
      '# Hub',
    ].join('\n');
    expect(parseHubCalendarConfig(markdown)).toBeNull();
  });

  it('matches the Calendar column label case-insensitively and reports a later index', () => {
    const markdown = [
      '---',
      'columns:',
      '  - Phase',
      '  - Next actions',
      '  - calendar',
      '---',
    ].join('\n');
    const config = parseHubCalendarConfig(markdown);
    expect(config?.calendarColumnIndex).toBe(3);
    expect(config?.columnCount).toBe(4);
  });

  it('tolerates missing/empty icsUrl and mdAgenda', () => {
    const markdown = ['---', 'columns:', '  - Calendar', '---'].join('\n');
    const config = parseHubCalendarConfig(markdown);
    expect(config?.icsUrls).toEqual([]);
    expect(config?.mdAgenda).toBeNull();
  });
});
