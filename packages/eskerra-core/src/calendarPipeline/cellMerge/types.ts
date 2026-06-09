/**
 * Shared types for the Calendar-cell merge contract (Part 3b of the calendar pipeline).
 * See `specs/plans/calendar-ics-agenda-pipeline.md`.
 */

export type CalendarItemSource = 'agenda' | 'calendar';

/**
 * A single structured calendar item destined for a Today Hub Calendar cell. The pipeline carries
 * these (not finished markdown) from bucketing through merge, so dedup/scope/insertion operate on
 * structured data and rendering happens once, in the merge step.
 */
export type CalendarItem = {
  /** Local calendar day (midnight) the item belongs to. */
  date: Date;
  /** True when the item has a clock time. */
  timed: boolean;
  /** Minutes since midnight when {@link timed}, else `null`. */
  timeMinutes: number | null;
  /** Rendered body text placed after `**{Wd} {day}:** ` (already includes any time/icon prefix). */
  body: string;
  /** `date.getMonth()`, for month-heading grouping. */
  monthIdx: number;
  /** `**{monthHeading}**` text (emoji + month, or plain month long name). */
  monthHeading: string;
  source: CalendarItemSource;
  /** Precise start instant (ICS only); used for strict-future scope. `null` for agenda items. */
  instant: Date | null;
  /** Stable source order, for deterministic tie-breaking. */
  order: number;
};

/** A classified line of an existing Calendar cell (read-only; used to locate keys + insert points). */
export type CalendarCellLine =
  | {kind: 'monthHeading'; raw: string; monthIdx: number}
  | {
      kind: 'pipelineItem';
      raw: string;
      /** Resolved calendar day (from the row's week-start + the line's day-of-month). */
      date: Date;
      timed: boolean;
      timeMinutes: number | null;
      /** Body text after `**{Wd} {day}:** `. */
      body: string;
    }
  | {kind: 'freeform'; raw: string};
