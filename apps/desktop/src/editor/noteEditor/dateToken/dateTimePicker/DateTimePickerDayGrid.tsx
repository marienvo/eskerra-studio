import type {CalendarCell, DatePickerDate} from './types';
import {MONTH_LABELS, WEEKDAY_LABELS} from './types';

import styles from './DateTimePicker.module.css';

type DateTimePickerDayGridProps = {
  readonly cells: readonly CalendarCell[];
  readonly selected: DatePickerDate;
  readonly onSelectDate: (year: number, month: number, day: number) => void;
};

export function DateTimePickerDayGrid({
  cells,
  selected,
  onSelectDate,
}: DateTimePickerDayGridProps) {
  return (
    <>
      <div className={styles.weekdayRow} aria-hidden>
        {WEEKDAY_LABELS.map(label => (
          <p key={label} className={styles.weekday}>
            {label}
          </p>
        ))}
      </div>

      <div className={styles.dayGrid} role="grid" aria-label="Calendar days">
        {cells.map(cell => {
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
              onClick={() => onSelectDate(cell.year, cell.month, cell.day)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </>
  );
}
