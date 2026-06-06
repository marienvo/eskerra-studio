import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import {todayDateParts} from '../dateToken';

import {
  addDays,
  buildCalendarGrid,
  buildDateTokenValue,
  clampHour,
  clampMinute,
  resolveInitialState,
  shiftMonth,
} from './calendar';
import type {DatePickerDate, DateTimePickerProps} from './types';

export function useDateTimePicker({
  initialValue,
  onConfirm,
  onCancel,
  now,
}: DateTimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [stableNow] = useState(() => now ?? new Date());
  const initial = useMemo(
    () => resolveInitialState(initialValue, stableNow),
    [initialValue, stableNow],
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
    (
      date: DatePickerDate,
      time?: {noTime?: boolean; hour?: number; minute?: number},
    ) => {
      onConfirm(
        buildDateTokenValue(date, {
          noTime: time?.noTime ?? noTime,
          hour: time?.hour ?? hour,
          minute: time?.minute ?? minute,
        }),
      );
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
    const today = todayDateParts(stableNow);
    selectDate(today.year, today.month, today.day);
  }, [selectDate, stableNow]);

  const shiftSelectedDay = useCallback((delta: number) => {
    setSelected(current => {
      const next = addDays(current.year, current.month, current.day, delta);
      setViewYear(next.year);
      setViewMonth(next.month);
      return next;
    });
  }, []);

  const goToPreviousMonth = useCallback(() => {
    const prev = shiftMonth(viewYear, viewMonth, -1);
    setViewYear(prev.year);
    setViewMonth(prev.month);
  }, [viewMonth, viewYear]);

  const goToNextMonth = useCallback(() => {
    const next = shiftMonth(viewYear, viewMonth, 1);
    setViewYear(next.year);
    setViewMonth(next.month);
  }, [viewMonth, viewYear]);

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

  const setNoTimeWithCommit = useCallback(
    (value: boolean) => {
      setNoTime(value);
      commitValue(selected, {noTime: value});
    },
    [commitValue, selected],
  );

  const setHourClamped = useCallback(
    (value: number) => {
      const next = clampHour(value);
      setHour(next);
      commitValue(selected, {hour: next});
    },
    [commitValue, selected],
  );

  const setMinuteClamped = useCallback(
    (value: number) => {
      const next = clampMinute(value);
      setMinute(next);
      commitValue(selected, {minute: next});
    },
    [commitValue, selected],
  );

  return {
    rootRef,
    viewYear,
    viewMonth,
    selected,
    noTime,
    hour,
    minute,
    calendarCells,
    setNoTime: setNoTimeWithCommit,
    setHour: setHourClamped,
    setMinute: setMinuteClamped,
    selectDate,
    goToToday,
    goToPreviousMonth,
    goToNextMonth,
    handleKeyDown,
  };
}
