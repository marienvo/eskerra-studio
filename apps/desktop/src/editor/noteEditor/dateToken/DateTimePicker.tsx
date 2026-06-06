import {DsButton, DsSurface, DsText, IconGlyph} from '@eskerra/ds-desktop';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import {
  isValidCalendarDate,
  todayDateParts,
  type DateTokenValue,
} from './dateToken';

import styles from './DateTimePicker.module.css';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTH_LABELS = [
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

type CalendarCell = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly inCurrentMonth: boolean;
};

export type DateTimePickerProps = {
  readonly initialValue: DateTokenValue | null;
  readonly onConfirm: (value: DateTokenValue) => void;
  readonly onCancel: () => void;
  /** Injectable clock for Today and defaults (tests use 2026-06-06). */
  readonly now?: Date;
};

function mondayBasedWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function daysInCalendarMonth(year: number, month: number): number {
  for (let day = 31; day >= 28; day--) {
    if (isValidCalendarDate(year, month, day)) {
      return day;
    }
  }
  return 30;
}

function shiftMonth(year: number, month: number, delta: number): {year: number; month: number} {
  const date = new Date(year, month - 1 + delta, 1);
  return {year: date.getFullYear(), month: date.getMonth() + 1};
}

function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): Pick<DateTokenValue, 'year' | 'month' | 'day'> {
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function buildCalendarGrid(viewYear: number, viewMonth: number): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const firstWeekday = mondayBasedWeekday(viewYear, viewMonth, 1);
  const daysInViewMonth = daysInCalendarMonth(viewYear, viewMonth);
  const prev = shiftMonth(viewYear, viewMonth, -1);
  const prevMonthDays = daysInCalendarMonth(prev.year, prev.month);

  for (let index = firstWeekday - 1; index >= 0; index--) {
    cells.push({
      year: prev.year,
      month: prev.month,
      day: prevMonthDays - index,
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInViewMonth; day++) {
    cells.push({
      year: viewYear,
      month: viewMonth,
      day,
      inCurrentMonth: true,
    });
  }

  const next = shiftMonth(viewYear, viewMonth, 1);
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({
      year: next.year,
      month: next.month,
      day: nextDay,
      inCurrentMonth: false,
    });
    nextDay++;
  }

  return cells;
}

function resolveInitialState(
  initialValue: DateTokenValue | null,
  now: Date,
): {
  selected: Pick<DateTokenValue, 'year' | 'month' | 'day'>;
  viewYear: number;
  viewMonth: number;
  noTime: boolean;
  hour: number;
  minute: number;
} {
  const selected = initialValue ?? todayDateParts(now);
  const hasTime =
    initialValue?.hour !== undefined && initialValue.minute !== undefined;
  return {
    selected: {
      year: selected.year,
      month: selected.month,
      day: selected.day,
    },
    viewYear: selected.year,
    viewMonth: selected.month,
    noTime: !hasTime,
    hour: initialValue?.hour ?? 0,
    minute: initialValue?.minute ?? 0,
  };
}

function clampHour(value: number): number {
  return Math.min(23, Math.max(0, value));
}

function clampMinute(value: number): number {
  return Math.min(59, Math.max(0, value));
}

export function DateTimePicker({
  initialValue,
  onConfirm,
  onCancel,
  now = new Date(),
}: DateTimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(
    () => resolveInitialState(initialValue, now),
    [initialValue, now],
  );
  const [viewYear, setViewYear] = useState(initial.viewYear);
  const [viewMonth, setViewMonth] = useState(initial.viewMonth);
  const [selected, setSelected] = useState(initial.selected);
  const [noTime, setNoTime] = useState(initial.noTime);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);

  const calendarCells = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewMonth, viewYear],
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const commitValue = useCallback(
    (date: Pick<DateTokenValue, 'year' | 'month' | 'day'>) => {
      const value: DateTokenValue = noTime
        ? {
            year: date.year,
            month: date.month,
            day: date.day,
          }
        : {
            year: date.year,
            month: date.month,
            day: date.day,
            hour: clampHour(hour),
            minute: clampMinute(minute),
          };
      onConfirm(value);
    },
    [hour, minute, noTime, onConfirm],
  );

  const selectDate = useCallback(
    (year: number, month: number, day: number) => {
      const next = {year, month, day};
      setSelected(next);
      setViewYear(year);
      setViewMonth(month);
      commitValue(next);
    },
    [commitValue],
  );

  const goToToday = useCallback(() => {
    const today = todayDateParts(now);
    selectDate(today.year, today.month, today.day);
  }, [now, selectDate]);

  const shiftSelectedDay = useCallback((delta: number) => {
    setSelected(current => {
      const next = addDays(current.year, current.month, current.day, delta);
      setViewYear(next.year);
      setViewMonth(next.month);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    commitValue(selected);
  }, [commitValue, selected]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirm();
        return;
      }

      if (event.target instanceof HTMLInputElement) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        shiftSelectedDay(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        shiftSelectedDay(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        shiftSelectedDay(-7);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        shiftSelectedDay(7);
      }
    },
    [handleConfirm, onCancel, shiftSelectedDay],
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Pick date and time"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <DsSurface className={styles.root}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerNav}
          aria-label="Previous month"
          onClick={() => {
            const prev = shiftMonth(viewYear, viewMonth, -1);
            setViewYear(prev.year);
            setViewMonth(prev.month);
          }}
        >
          <IconGlyph name="chevron_left" size={12} aria-hidden />
        </button>
        <DsText variant="title" className={styles.monthLabel}>
          {MONTH_LABELS[viewMonth - 1]} {viewYear}
        </DsText>
        <button
          type="button"
          className={styles.headerNav}
          aria-label="Next month"
          onClick={() => {
            const next = shiftMonth(viewYear, viewMonth, 1);
            setViewYear(next.year);
            setViewMonth(next.month);
          }}
        >
          <IconGlyph name="chevron_right" size={12} aria-hidden />
        </button>
      </div>

      <div className={styles.todayRow}>
        <DsButton type="button" variant="primary" aria-label="Today" onClick={goToToday}>
          Today
        </DsButton>
      </div>

      <div className={styles.weekdayRow} aria-hidden>
        {WEEKDAY_LABELS.map(label => (
          <p key={label} className={styles.weekday}>
            {label}
          </p>
        ))}
      </div>

      <div className={styles.dayGrid} role="grid" aria-label="Calendar days">
        {calendarCells.map(cell => {
          const isSelected =
            cell.year === selected.year
            && cell.month === selected.month
            && cell.day === selected.day;
          const cellKey = `${cell.year}-${cell.month}-${cell.day}`;
          return (
            <button
              key={cellKey}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${cell.day} ${MONTH_LABELS[cell.month - 1]} ${cell.year}`}
              className={[
                styles.dayCell,
                cell.inCurrentMonth ? '' : styles.dayCellOutside,
                isSelected ? styles.dayCellSelected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => selectDate(cell.year, cell.month, cell.day)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <section className={styles.timeSection} aria-label="Time">
        <label className={styles.noTimeLabel}>
          <input
            type="checkbox"
            checked={noTime}
            onChange={event => setNoTime(event.currentTarget.checked)}
          />
          <DsText variant="body">No time</DsText>
        </label>
        <div className={styles.timeFields}>
          <input
            className={styles.timeInput}
            type="number"
            min={0}
            max={23}
            aria-label="Hour"
            disabled={noTime}
            value={hour}
            onChange={event => setHour(clampHour(Number(event.currentTarget.value) || 0))}
          />
          <span className={styles.timeSeparator} aria-hidden>
            :
          </span>
          <input
            className={styles.timeInput}
            type="number"
            min={0}
            max={59}
            aria-label="Minute"
            disabled={noTime}
            value={minute}
            onChange={event =>
              setMinute(clampMinute(Number(event.currentTarget.value) || 0))
            }
          />
        </div>
      </section>

      <div className={styles.actions}>
        <DsButton type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </DsButton>
      </div>
      </DsSurface>
    </div>
  );
}
