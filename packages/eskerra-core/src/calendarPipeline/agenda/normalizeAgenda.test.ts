import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {normalizeAgenda} from './normalizeAgenda';
import {parseAgendaBullets} from './parseAgendaBullets';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERSONAL_AGENDA_FIXTURE = resolve(HERE, '../../../../../mock-vault/General/🗓️ Personal agenda.md');

// Fixed "now" so weekday/age/highlight output is deterministic.
const NOW = new Date(2026, 3, 20); // Monday, April 20 2026

function readAgenda(): string {
  return readFileSync(PERSONAL_AGENDA_FIXTURE, 'utf8');
}

describe('normalizeAgenda', () => {
  it('produces a stable golden snapshot for the Personal agenda fixture', () => {
    expect(normalizeAgenda(readAgenda(), NOW)).toMatchSnapshot();
  });

  it('is idempotent for a fixed now', () => {
    const once = normalizeAgenda(readAgenda(), NOW);
    const twice = normalizeAgenda(once, NOW);
    expect(twice).toBe(once);
  });

  it('canonicalizes dated and recurring H3 titles', () => {
    const out = normalizeAgenda(readAgenda(), NOW);
    // Recurring birthday entry gets weekday + rule token.
    expect(out).toContain('### Monday, April 27th, ↺');
    // Dated entry keeps its concrete year.
    expect(out).toContain('### Friday, May 1st, 2026');
  });

  it('ends with exactly one trailing newline', () => {
    const out = normalizeAgenda(readAgenda(), NOW);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('parseAgendaBullets', () => {
  it('extracts dated bullets with day, month heading and timed flag', () => {
    const normalized = normalizeAgenda(readAgenda(), NOW);
    const bullets = parseAgendaBullets(normalized, NOW);

    const kingsDay = bullets.find(b => b.body.includes("King's Day"));
    expect(kingsDay).toBeDefined();
    expect(kingsDay?.date.getMonth()).toBe(3); // April
    expect(kingsDay?.date.getDate()).toBe(27);
    expect(kingsDay?.timed).toBe(false);
    expect(kingsDay?.time).toBeNull();
  });

  it('parses a leading HH:MM time into timed bullets', () => {
    const bullets = parseAgendaBullets(
      ['## ☀️ June', '', '### Monday, June 1st, 2026', '', '- 09:30 Dentist'].join('\n'),
      NOW,
    );
    expect(bullets).toHaveLength(1);
    expect(bullets[0].timed).toBe(true);
    expect(bullets[0].time).toBe('09:30');
    expect(bullets[0].timeMinutes).toBe(9 * 60 + 30);
    expect(bullets[0].date.getMonth()).toBe(5);
    expect(bullets[0].date.getDate()).toBe(1);
  });

  it('ignores indented sub-bullets inside a day block', () => {
    const bullets = parseAgendaBullets(
      [
        '## ☀️ June',
        '',
        '### Monday, June 1st, 2026',
        '',
        '- Doctor appointment',
        '  - Bring insurance card',
        '    - Print forms',
      ].join('\n'),
      NOW,
    );
    expect(bullets).toHaveLength(1);
    expect(bullets[0].body).toBe('Doctor appointment');
  });
});
