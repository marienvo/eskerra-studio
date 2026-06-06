import {DsButton, DsSurface} from '@eskerra/ds-desktop';

import {DateTimePickerDayGrid} from './DateTimePickerDayGrid';
import {DateTimePickerHeader} from './DateTimePickerHeader';
import {DateTimePickerTimeSection} from './DateTimePickerTimeSection';
import type {DateTimePickerProps} from './types';
import {useDateTimePicker} from './useDateTimePicker';

import styles from './DateTimePicker.module.css';

export type {DateTimePickerProps} from './types';

export function DateTimePicker(props: DateTimePickerProps) {
  const {
    rootRef,
    viewYear,
    viewMonth,
    selected,
    noTime,
    hour,
    minute,
    calendarCells,
    setNoTime,
    setHour,
    setMinute,
    selectDate,
    goToToday,
    goToPreviousMonth,
    goToNextMonth,
    handleKeyDown,
  } = useDateTimePicker(props);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Pick date and time"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <DsSurface className={styles.root}>
        <DateTimePickerHeader
          viewYear={viewYear}
          viewMonth={viewMonth}
          onPrevMonth={goToPreviousMonth}
          onNextMonth={goToNextMonth}
          onToday={goToToday}
        />
        <DateTimePickerDayGrid
          cells={calendarCells}
          selected={selected}
          onSelectDate={selectDate}
        />
        <DateTimePickerTimeSection
          noTime={noTime}
          hour={hour}
          minute={minute}
          onNoTimeChange={setNoTime}
          onHourChange={setHour}
          onMinuteChange={setMinute}
        />
        <div className={styles.actions}>
          <DsButton type="button" variant="secondary" onClick={props.onCancel}>
            Cancel
          </DsButton>
        </div>
      </DsSurface>
    </div>
  );
}
