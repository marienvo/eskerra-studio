import {useCallback, useMemo, useRef, useState} from 'react';

import {defaultDateTokenTimeFromNow, todayDateParts} from '../dateToken';

import {
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
  onReturnFocus,
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
      onReturnFocus?.();
    },
    [commitValue, onReturnFocus],
  );

  const goToToday = useCallback(() => {
    const today = todayDateParts(stableNow);
    selectDate(today.year, today.month, today.day);
  }, [selectDate, stableNow]);

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

  const setNoTimeWithCommit = useCallback(
    (value: boolean) => {
      setNoTime(value);
      if (!value) {
        // Enabling time: prefill now + 15 min, snapped to the 5-minute grid.
        const rounded = defaultDateTokenTimeFromNow(stableNow);
        setHour(rounded.hour);
        setMinute(rounded.minute);
        commitValue(selected, {noTime: false, ...rounded});
      } else {
        commitValue(selected, {noTime: value});
      }
      onReturnFocus?.();
    },
    [commitValue, onReturnFocus, selected, stableNow],
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
  };
}
