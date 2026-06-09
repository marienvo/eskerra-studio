import {describe, expect, it, vi} from 'vitest';
import type {VaultDirEntry, VaultFilesystem} from '@eskerra/core';
import {runCalendarPipelineDesktop} from './runCalendarPipelineDesktop';

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
  'DTSTART:20260116T090000Z',
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

const REFS = [{uri: '/vault/Work/Today.md', name: 'Today.md'}];

describe('runCalendarPipelineDesktop', () => {
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
    // Calendar column holds the bucketed bodies; ICS timed before untimed agenda.
    expect(row).toContain('**January**');
    expect(row).toContain('**Fri 16:** 10:00 Team sync');
    expect(row).toContain('**Fri 16:** Coffee with Sam');
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
    expect(result.agendaFilesWritten).toBe(0);
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
    expect(fs.files.get('/vault/Work/2026-01-12.md')).toContain('**Fri 16:** Coffee with Sam');
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
});
