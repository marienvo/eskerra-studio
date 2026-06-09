import {
  bucketCalendarWeekEntries,
  enumerateTodayHubWeekStarts,
  formatTodayHubMondayStem,
  normalizeAgenda,
  parseAgendaBullets,
  parseHubCalendarConfig,
  parseIcsEvents,
  sortedTodayHubNoteUrisFromRefs,
  todayHubRowUriFromTodayNoteUri,
  todayHubWeekProgress,
  upsertCalendarColumn,
  type AgendaBullet,
  type IcsEvent,
  type TodayHubCalendarConfig,
  type VaultFilesystem,
} from '@eskerra/core';

import {fetchIcsDesktop} from './fetchIcsDesktop';

export type VaultMarkdownRefLike = {uri: string; name: string};

export type DesktopCalendarPipelineResult = {
  hubsProcessed: number;
  hubsSkipped: number;
  agendaFilesWritten: number;
  rowFilesWritten: number;
  failedFetches: number;
};

export type DesktopCalendarPipelineProgress = {
  percent: number;
  phase: 'hub' | 'complete';
  detail?: string;
};

export type RunCalendarPipelineDesktopOptions = {
  now?: Date;
  /** Injected for tests; defaults to the Rust `fetch_ics` command. */
  fetchIcs?: (url: string, timeoutMs?: number) => Promise<string>;
  onProgress?: (payload: DesktopCalendarPipelineProgress) => void;
};

function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') {
    end -= 1;
  }
  return s.slice(0, end);
}

function stripLeadingSlashes(s: string): string {
  let start = 0;
  while (start < s.length && s[start] === '/') {
    start += 1;
  }
  return s.slice(start);
}

/** Join a vault-relative path under a base URI (desktop POSIX paths). */
function joinVaultChildPath(baseUri: string, relativePath: string): string {
  return `${stripTrailingSlashes(baseUri)}/${stripLeadingSlashes(relativePath)}`;
}

async function readFileOrNull(fs: VaultFilesystem, uri: string): Promise<string | null> {
  try {
    if (!(await fs.exists(uri))) {
      return null;
    }
    return await fs.readFile(uri, {encoding: 'utf8'});
  } catch {
    return null;
  }
}

/** Normalize the hub's agenda in place (if set) and return its dated bullets. */
async function normalizeAndReadAgenda(
  fs: VaultFilesystem,
  baseUri: string,
  config: TodayHubCalendarConfig,
  now: Date,
): Promise<{bullets: AgendaBullet[]; wroteAgenda: boolean}> {
  if (config.mdAgenda == null) {
    return {bullets: [], wroteAgenda: false};
  }
  const agendaUri = joinVaultChildPath(baseUri, config.mdAgenda);
  const existing = await readFileOrNull(fs, agendaUri);
  if (existing == null) {
    return {bullets: [], wroteAgenda: false};
  }
  const normalized = normalizeAgenda(existing, now);
  let wroteAgenda = false;
  if (normalized !== existing) {
    await fs.writeFile(agendaUri, normalized, {encoding: 'utf8'});
    wroteAgenda = true;
  }
  return {bullets: parseAgendaBullets(normalized, now), wroteAgenda};
}

async function fetchHubIcsEvents(
  config: TodayHubCalendarConfig,
  now: Date,
  fetchIcs: (url: string, timeoutMs?: number) => Promise<string>,
): Promise<{events: IcsEvent[]; failed: number}> {
  const events: IcsEvent[] = [];
  let failed = 0;
  for (const url of config.icsUrls) {
    const startedAt = Date.now();
    try {
      const text = await fetchIcs(url, config.timeoutMs);
      const parsed = parseIcsEvents(text, {now, daysAhead: config.daysAhead});
      events.push(...parsed);
      console.info(
        `[calendar-pipeline] Fetched ICS (${parsed.length} events, ${Date.now() - startedAt}ms): ${url}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[calendar-pipeline] ICS fetch failed (${url}):`, err);
    }
  }
  return {events, failed};
}

/** Upsert bucketed Calendar bodies into current/future week-row files, skipping past weeks + no-ops. */
async function writeHubWeekRows(
  fs: VaultFilesystem,
  todayNoteUri: string,
  config: TodayHubCalendarConfig,
  bucketed: Map<string, string>,
  now: Date,
): Promise<number> {
  let written = 0;
  for (const weekStart of enumerateTodayHubWeekStarts(now, config.start)) {
    if (todayHubWeekProgress(weekStart, now).kind === 'past') {
      continue;
    }
    const stem = formatTodayHubMondayStem(weekStart);
    const desiredCalendarBody = bucketed.get(stem);
    if (desiredCalendarBody == null || desiredCalendarBody.length === 0) {
      continue;
    }
    const rowUri = todayHubRowUriFromTodayNoteUri(todayNoteUri, weekStart);
    const existing = (await readFileOrNull(fs, rowUri)) ?? '';
    const next = upsertCalendarColumn({
      rowBody: existing,
      columnCount: config.columnCount,
      calendarColumnIndex: config.calendarColumnIndex,
      desiredCalendarBody,
    });
    if (next !== existing) {
      await fs.writeFile(rowUri, next, {encoding: 'utf8'});
      written += 1;
    }
  }
  return written;
}

async function processHub(
  fs: VaultFilesystem,
  baseUri: string,
  todayNoteUri: string,
  now: Date,
  fetchIcs: (url: string, timeoutMs?: number) => Promise<string>,
  result: DesktopCalendarPipelineResult,
): Promise<void> {
  const todayMd = await readFileOrNull(fs, todayNoteUri);
  if (todayMd == null) {
    result.hubsSkipped += 1;
    return;
  }
  const config = parseHubCalendarConfig(todayMd);
  if (config == null) {
    // No Calendar column: nothing to manage for this hub.
    result.hubsSkipped += 1;
    return;
  }

  const transformStartedAt = Date.now();
  const {bullets, wroteAgenda} = await normalizeAndReadAgenda(fs, baseUri, config, now);
  if (wroteAgenda) {
    result.agendaFilesWritten += 1;
  }
  const {events, failed} = await fetchHubIcsEvents(config, now, fetchIcs);
  result.failedFetches += failed;

  const bucketed = bucketCalendarWeekEntries({
    agendaBullets: bullets,
    icsEvents: events,
    start: config.start,
    mdAgenda: config.mdAgenda,
  });
  const written = await writeHubWeekRows(fs, todayNoteUri, config, bucketed, now);
  result.rowFilesWritten += written;
  result.hubsProcessed += 1;
  console.info(
    `[calendar-pipeline] Hub done (${written} rows, ${Date.now() - transformStartedAt}ms): ${todayNoteUri}`,
  );
}

/**
 * On-demand calendar pipeline for the desktop app. Discovers Today Hubs from the already-built vault
 * markdown index refs, normalizes each hub's `mdAgenda` (writing back only on change), fetches ICS
 * feeds via the Rust `fetch_ics` command, buckets agenda + ICS into per-week Calendar bodies, and
 * upserts the Calendar column of current/future week-row files (past weeks untouched, no-op writes
 * skipped). Disk is treated as the source of truth — writes flow through the normal vault-watch
 * reconcile path; the runner does not mutate in-memory note caches.
 *
 * Yields between hubs to keep the UI responsive. Nothing here runs at startup.
 */
export async function runCalendarPipelineDesktop(
  fs: VaultFilesystem,
  baseUri: string,
  vaultMarkdownRefs: readonly VaultMarkdownRefLike[],
  options?: RunCalendarPipelineDesktopOptions,
): Promise<DesktopCalendarPipelineResult> {
  const now = options?.now ?? new Date();
  const fetchIcs = options?.fetchIcs ?? fetchIcsDesktop;
  const result: DesktopCalendarPipelineResult = {
    hubsProcessed: 0,
    hubsSkipped: 0,
    agendaFilesWritten: 0,
    rowFilesWritten: 0,
    failedFetches: 0,
  };

  const hubUris = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
  const denom = Math.max(1, hubUris.length);
  let done = 0;
  for (const todayNoteUri of hubUris) {
    try {
      await processHub(fs, baseUri, todayNoteUri, now, fetchIcs, result);
    } catch (err) {
      console.error(`[calendar-pipeline] Hub failed: ${todayNoteUri}`, err);
      result.hubsSkipped += 1;
    }
    done += 1;
    options?.onProgress?.({
      percent: Math.min(99, Math.floor((done * 100) / denom)),
      phase: 'hub',
      detail: todayNoteUri,
    });
    // Yield to the event loop between hubs so the UI stays responsive.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  options?.onProgress?.({percent: 100, phase: 'complete'});
  return result;
}

type ActiveCalendarRun = {
  listeners: Set<(payload: DesktopCalendarPipelineProgress) => void>;
  promise: Promise<DesktopCalendarPipelineResult>;
};

/** Coalesces concurrent manual triggers; every caller's `onProgress` is registered for that run. */
let active: ActiveCalendarRun | null = null;

export function __resetForTests(): void {
  active = null;
}

/**
 * Coalescing entry point for the manual trigger (mirrors `runDesktopPodcastRssSync`). Concurrent
 * callers share one in-flight run; each caller's `onProgress` is attached to it.
 */
export function runDesktopCalendarPipeline(
  fs: VaultFilesystem,
  baseUri: string,
  vaultMarkdownRefs: readonly VaultMarkdownRefLike[],
  options?: RunCalendarPipelineDesktopOptions,
): Promise<DesktopCalendarPipelineResult> {
  if (active != null) {
    if (options?.onProgress != null) {
      active.listeners.add(options.onProgress);
    }
    return active.promise;
  }
  const listeners = new Set<(payload: DesktopCalendarPipelineProgress) => void>();
  if (options?.onProgress != null) {
    listeners.add(options.onProgress);
  }
  const promise = runCalendarPipelineDesktop(fs, baseUri, vaultMarkdownRefs, {
    ...options,
    onProgress: payload => {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  }).finally(() => {
    active = null;
  });
  active = {listeners, promise};
  return promise;
}
