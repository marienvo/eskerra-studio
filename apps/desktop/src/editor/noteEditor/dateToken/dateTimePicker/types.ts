import type {DateTokenValue} from '../dateToken';

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type DatePickerDate = Pick<DateTokenValue, 'year' | 'month' | 'day'>;

export type CalendarCell = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly inCurrentMonth: boolean;
};

export type DateTimePickerProps = {
  readonly initialValue: DateTokenValue | null;
  readonly onConfirm: (value: DateTokenValue) => void;
  readonly onCancel: () => void;
  /**
   * Return focus to the editor (caret right after the tag) after a discrete
   * pick — Today, a calendar day, or toggling time. Not fired while editing the
   * hour/minute fields so those stay focused for typing.
   */
  readonly onReturnFocus?: () => void;
  /** Injectable clock for Today and defaults (tests use 2026-06-06). */
  readonly now?: Date;
};
