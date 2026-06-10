/**
 * Minimal `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` token helpers scoped to the calendar pipeline.
 * Mirrors the grammar in `apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts` without
 * importing it (core must stay framework-agnostic). Struck reminders (`@~~…~~`, daemon-completed)
 * are recognized too, so a completed line still dedups by its underlying date/time key.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `@YYYY-MM-DD` or `@YYYY-MM-DD_HHMM`. */
export function formatCalendarToken(date: Date, timeMinutes: number | null): string {
  const d = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (timeMinutes != null) {
    return `@${d}_${pad2(Math.floor(timeMinutes / 60))}${pad2(timeMinutes % 60)}`;
  }
  return `@${d}`;
}

// Live: `@YYYY-MM-DD_HHMM rest` or `@YYYY-MM-DD rest` at the start of a line.
const TOKEN_LINE_RE = /^(@(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})(\d{2}))?)(?:\s(.*))?$/;
// Struck (daemon-completed): `@~~YYYY-MM-DD_HHMM~~ rest`, with an optional `\` escape before `_`.
const STRUCK_TOKEN_LINE_RE =
  /^(@~~(\d{4})-(\d{2})-(\d{2})(?:\\?_(\d{2})(\d{2}))?~~)(?:\s(.*))?$/;

export type ParsedCalendarTokenLine = {
  token: string;
  date: Date;
  timed: boolean;
  timeMinutes: number | null;
  /** True when the source line was a struck (`@~~…~~`) completed reminder. */
  struck: boolean;
  rest: string;
};

function buildParsed(
  m: RegExpExecArray,
  struck: boolean,
): ParsedCalendarTokenLine | null {
  const year = Number(m[2]);
  const month = Number(m[3]) - 1;
  const day = Number(m[4]);
  if (month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }
  const token = m[1]!;
  const date = new Date(year, month, day);
  if (m[5] !== undefined) {
    const h = Number(m[5]);
    const min = Number(m[6]);
    if (h > 23 || min > 59) {
      return null;
    }
    return {token, date, timed: true, timeMinutes: h * 60 + min, struck, rest: m[7] ?? ''};
  }
  return {token, date, timed: false, timeMinutes: null, struck, rest: m[7] ?? ''};
}

/** Returns null when the line does not start with a valid (live or struck) calendar token. */
export function parseCalendarTokenLine(line: string): ParsedCalendarTokenLine | null {
  const struckMatch = STRUCK_TOKEN_LINE_RE.exec(line);
  if (struckMatch) {
    return buildParsed(struckMatch, true);
  }
  const m = TOKEN_LINE_RE.exec(line);
  if (!m) {
    return null;
  }
  return buildParsed(m, false);
}
