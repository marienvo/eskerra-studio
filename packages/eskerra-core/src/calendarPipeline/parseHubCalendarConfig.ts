import {parse as parseYaml} from 'yaml';
import {splitYamlFrontmatter} from '../markdown/splitYamlFrontmatter';
import {
  parseTodayHubFrontmatter,
  todayHubColumnCount,
  type TodayHubStartDay,
} from '../todayHub/parseTodayHubFrontmatter';

/** Column label whose Today Hub segment the calendar pipeline owns. */
export const CALENDAR_COLUMN_LABEL = 'Calendar';

export const DEFAULT_ICS_DAYS_AHEAD = 7;
export const DEFAULT_ICS_TIMEOUT_MS = 8000;

export type TodayHubCalendarConfig = {
  /** ICS feed URLs to fetch for this hub (always an array; may be empty). */
  icsUrls: string[];
  /** Relative path/filename of this hub's agenda markdown source, or `null` when unset. */
  mdAgenda: string | null;
  /** Days of look-ahead for ICS events (frontmatter `daysAhead`, default {@link DEFAULT_ICS_DAYS_AHEAD}). */
  daysAhead: number;
  /** Per-feed fetch timeout in ms (frontmatter `timeoutMs`, default {@link DEFAULT_ICS_TIMEOUT_MS}). */
  timeoutMs: number;
  /** First day of the hub week (drives week-start bucketing). */
  start: TodayHubStartDay;
  /** Extra column labels from frontmatter (column 0 is the implicit week-start date column). */
  columns: string[];
  /** Total editor column count = `1 + columns.length`. */
  columnCount: number;
  /**
   * Split-segment index of the Calendar column, i.e. `columns.indexOf('Calendar') + 1`
   * (column 0 is the implicit week-start date column). Always `>= 1`.
   */
  calendarColumnIndex: number;
};

function stripFrontmatterFences(frontmatter: string): string {
  const lines = frontmatter.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() === '---') {
    lines.shift();
  }
  if (lines[lines.length - 1]?.trim() === '---') {
    lines.pop();
  }
  return lines.join('\n');
}

function coerceToStringArray(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
          out.push(trimmed);
        }
      }
    }
    return out;
  }
  return [];
}

function coerceToTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coercePositiveIntOrDefault(value: unknown, fallback: number, minValue: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(minValue, Math.floor(n));
}

/**
 * Parses a Today Hub `Today.md` body into the configuration the calendar pipeline needs.
 *
 * Reuses {@link parseTodayHubFrontmatter} for `start`/`columns` (single source of truth for hub
 * layout) and additionally reads `icsUrl` (scalar or list) and `mdAgenda`.
 *
 * Returns `null` when the hub has no `Calendar` column — such hubs are skipped by the pipeline.
 */
export function parseHubCalendarConfig(markdown: string): TodayHubCalendarConfig | null {
  const settings = parseTodayHubFrontmatter(markdown);
  const calendarColumnPosition = settings.columns.findIndex(
    col => col.trim().toLowerCase() === CALENDAR_COLUMN_LABEL.toLowerCase(),
  );
  if (calendarColumnPosition < 0) {
    return null;
  }

  const {frontmatter} = splitYamlFrontmatter(markdown);
  let icsUrls: string[] = [];
  let mdAgenda: string | null = null;
  let daysAhead = DEFAULT_ICS_DAYS_AHEAD;
  let timeoutMs = DEFAULT_ICS_TIMEOUT_MS;
  if (frontmatter != null) {
    try {
      const parsed = parseYaml(stripFrontmatterFences(frontmatter)) as unknown;
      if (parsed != null && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        icsUrls = coerceToStringArray(record.icsUrl);
        mdAgenda = coerceToTrimmedStringOrNull(record.mdAgenda);
        daysAhead = coercePositiveIntOrDefault(record.daysAhead, DEFAULT_ICS_DAYS_AHEAD, 0);
        timeoutMs = coercePositiveIntOrDefault(record.timeoutMs, DEFAULT_ICS_TIMEOUT_MS, 500);
      }
    } catch {
      // Malformed YAML: fall back to defaults rather than throwing.
    }
  }

  return {
    icsUrls,
    mdAgenda,
    daysAhead,
    timeoutMs,
    start: settings.start,
    columns: settings.columns,
    columnCount: todayHubColumnCount(settings),
    calendarColumnIndex: calendarColumnPosition + 1,
  };
}
