import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {VaultDirEntry, VaultFilesystem} from '@eskerra/core';
import {
  __resetForTests,
  redactCalendarFeedUrl,
  runCalendarPipelineDesktop,
  runDesktopCalendarPipeline,
} from './runCalendarPipelineDesktop';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUAL_WEEK_ROW_FIXTURE = resolve(
  HERE,
  '__fixtures__/work-week-row-with-manual-calendar.md',
);
const NOW = new Date(2026, 0, 15); // Thursday, Jan 15 2026 (week of Mon Jan 12)

const WORK_TODAY = [
  '---',
  'icsUrl:',
  '  - https://example.com/work.ics',
  'mdAgenda: 🗓️ Personal agenda.md',
  'perpetualType: weekly',
  'start: monday',
  'columns:',
  '  - Next actions',
  '  - Calendar',
  '---',
  '# 🏢 Work',
].join('\n');

const AGENDA = [
  '---',
  'badge: focus',
  '---',
  '# Agenda',
  '',
  '## January',
  '',
  '### Friday, January 16th, 2026',
  '',
  '- Coffee with Sam',
].join('\n');

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:evt-1',
  'SUMMARY:Team sync',
  'DTSTART:20260116T100000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

class FakeVaultFs implements VaultFilesystem {
  files = new Map<string, string>();
  writes: string[] = [];

  async exists(uri: string): Promise<boolean> {
    return this.files.has(uri);
  }
  async mkdir(): Promise<void> {}
  async readFile(uri: string): Promise<string> {
    const v = this.files.get(uri);
    if (v == null) {
      throw new Error(`missing ${uri}`);
    }
    return v;
  }
  async writeFile(uri: string, content: string): Promise<void> {
    this.files.set(uri, content);
    this.writes.push(uri);
  }
  async unlink(uri: string): Promise<void> {
    this.files.delete(uri);
  }
  async removeTree(): Promise<void> {}
  async renameFile(): Promise<void> {}
  async listFiles(): Promise<VaultDirEntry[]> {
    return [];
  }
}

function makeFsWithWorkHub(): FakeVaultFs {
  const fs = new FakeVaultFs();
  fs.files.set('/vault/Work/Today.md', WORK_TODAY);
  fs.files.set('/vault/🗓️ Personal agenda.md', AGENDA);
  return fs;
}

function readManualWeekRowFixture(): string {
  return readFileSync(MANUAL_WEEK_ROW_FIXTURE, 'utf8');
}

const REFS = [{uri: '/vault/Work/Today.md', name: 'Today.md'}];

beforeEach(() => {
  __resetForTests();
});

describe('runCalendarPipelineDesktop', () => {
  it('redacts calendar feed query and path details for logs', () => {
    expect(redactCalendarFeedUrl('https://example.com/private/token/calendar.ics?secret=abc')).toBe(
      'https://example.com',
    );
    expect(redactCalendarFeedUrl('not a url')).toBe('[invalid-url]');
  });

  it('normalizes the agenda and upserts the Calendar column of the affected week row', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => ICS);

    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {now: NOW, fetchIcs});

    expect(result.hubsProcessed).toBe(1);
    expect(result.failedFetches).toBe(0);
    expect(fetchIcs).toHaveBeenCalledWith('https://example.com/work.ics', 8000);

    const rowUri = '/vault/Work/2026-01-12.md';
    expect(fs.files.has(rowUri)).toBe(true);
    const row = fs.files.get(rowUri)!;
    // Calendar column: timed token before untimed, no month heading.
    // Floating DTSTART is host-local, so the date assertion is timezone-independent.
    expect(row).toContain('@2026-01-16_1000 Team sync');
    expect(row).toContain('@2026-01-16 Coffee with Sam');
    // Other column delimiter preserved.
    expect(row).toContain('::today-section::');
  });

  it('performs zero writes on a second (no-op) run', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => ICS);
    await runCalendarPipelineDesktop(fs, '/vault', REFS, {now: NOW, fetchIcs});

    fs.writes = [];
    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {now: NOW, fetchIcs});
    expect(fs.writes).toEqual([]);
    expect(result.rowFilesWritten).toBe(0);
    expect(result.rowFilesSkipped).toBe(0);
    expect(result.agendaFilesWritten).toBe(0);
  });

  it('preserves manual Calendar fixture lines while adding missing agenda items', async () => {
    const fs = makeFsWithWorkHub();
    const rowUri = '/vault/Work/2026-01-12.md';
    fs.files.set(rowUri, readManualWeekRowFixture());

    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {
      now: NOW,
      fetchIcs: vi.fn(async () => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR'].join('\r\n')),
    });

    expect(result.rowFilesWritten).toBe(1);
    expect(result.rowFilesSkipped).toBe(0);
    expect(fs.files.get(rowUri)).toMatchInlineSnapshot(`
      "Opening note for the week

      ::today-section::

      - Prepare status update
      - Review proposal

      ::today-section::

      **January**
      - call Alex about venue
      Keep this paragraph exactly.
      @2026-01-16 Coffee with Sam
      **Sat 17:** Manual workshop"
    `);
  });

  it('skips hubs without a Calendar column', async () => {
    const fs = new FakeVaultFs();
    fs.files.set(
      '/vault/Notes/Today.md',
      ['---', 'columns:', '  - Next actions', 'start: monday', '---'].join('\n'),
    );
    const result = await runCalendarPipelineDesktop(
      fs,
      '/vault',
      [{uri: '/vault/Notes/Today.md', name: 'Today.md'}],
      {now: NOW, fetchIcs: vi.fn(async () => ICS)},
    );
    expect(result.hubsProcessed).toBe(0);
    expect(result.hubsSkipped).toBe(1);
    expect(fs.writes).toEqual([]);
  });

  it('counts ICS fetch failures without aborting the hub', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {now: NOW, fetchIcs});
    expect(result.failedFetches).toBe(1);
    expect(result.hubsProcessed).toBe(1);
    // Agenda-only content still upserted.
    expect(fs.files.get('/vault/Work/2026-01-12.md')).toContain('@2026-01-16 Coffee with Sam');
  });

  it('does not touch past-week rows', async () => {
    const fs = makeFsWithWorkHub();
    // Put a past-dated agenda bullet (previous week) and confirm its row is never written.
    fs.files.set(
      '/vault/🗓️ Personal agenda.md',
      ['# Agenda', '', '## January', '', '### Monday, January 5th, 2026', '', '- Old item'].join('\n'),
    );
    await runCalendarPipelineDesktop(fs, '/vault', REFS, {now: NOW, fetchIcs: vi.fn(async () => ICS)});
    // Jan 5 is the previous week (past) -> its row file must not be created.
    expect(fs.files.has('/vault/Work/2026-01-05.md')).toBe(false);
  });

  it('skips a row that is currently live-edited in the canvas', async () => {
    const fs = makeFsWithWorkHub();
    const rowUri = '/vault/Work/2026-01-12.md';
    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {
      now: NOW,
      fetchIcs: vi.fn(async () => ICS),
      isRowLiveEdited: uri => uri === rowUri,
    });
    expect(fs.files.has(rowUri)).toBe(false);
    expect(result.rowFilesSkipped).toBe(1);
    expect(result.rowFilesWritten).toBe(0);
  });

  it('skips a row with an ambiguous column split and fires onSplitSkip (fail closed)', async () => {
    const fs = makeFsWithWorkHub();
    const rowUri = '/vault/Work/2026-01-12.md';
    // Work hub has 3 columns (columnCount=3) so needs 2 delimiters; pre-populate with only 1.
    fs.files.set(rowUri, 'week start\n\n::today-section::\n\nnext actions only — no second delimiter');
    const onSplitSkip = vi.fn();
    const result = await runCalendarPipelineDesktop(fs, '/vault', REFS, {
      now: NOW,
      fetchIcs: vi.fn(async () => ICS),
      onSplitSkip,
    });
    expect(onSplitSkip).toHaveBeenCalledOnce();
    expect(onSplitSkip).toHaveBeenCalledWith(
      expect.objectContaining({rowUri, reason: 'ambiguous-column-split'}),
    );
    expect(result.rowFilesSkipped).toBe(1);
    expect(result.rowFilesWritten).toBe(0);
    // Row file must not have been overwritten.
    expect(fs.files.get(rowUri)).toContain('no second delimiter');
  });
});

describe('runDesktopCalendarPipeline (coalescing)', () => {
  it('coalesces concurrent calls into one run with a shared result', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => ICS);

    const [r1, r2] = await Promise.all([
      runDesktopCalendarPipeline(fs, '/vault', REFS, {now: NOW, fetchIcs}),
      runDesktopCalendarPipeline(fs, '/vault', REFS, {now: NOW, fetchIcs}),
    ]);

    expect(r1).toBe(r2);
    expect(fetchIcs).toHaveBeenCalledTimes(1);
  });

  it('delivers onProgress events to every concurrent caller', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => ICS);
    const progressA: number[] = [];
    const progressB: number[] = [];

    await Promise.all([
      runDesktopCalendarPipeline(fs, '/vault', REFS, {
        now: NOW,
        fetchIcs,
        onProgress: p => progressA.push(p.percent),
      }),
      runDesktopCalendarPipeline(fs, '/vault', REFS, {
        now: NOW,
        fetchIcs,
        onProgress: p => progressB.push(p.percent),
      }),
    ]);

    expect(progressA).toContain(100);
    expect(progressB).toContain(100);
    expect(progressA).toEqual(progressB);
  });

  it('resets after run completes so a second call starts a fresh run', async () => {
    const fs = makeFsWithWorkHub();
    const fetchIcs = vi.fn(async () => ICS);

    const r1 = await runDesktopCalendarPipeline(fs, '/vault', REFS, {now: NOW, fetchIcs});
    const r2 = await runDesktopCalendarPipeline(fs, '/vault', REFS, {now: NOW, fetchIcs});

    // Both complete, second run performed a second fetch
    expect(fetchIcs).toHaveBeenCalledTimes(2);
    // Results are separate objects (different runs)
    expect(r1).not.toBe(r2);
  });
});
