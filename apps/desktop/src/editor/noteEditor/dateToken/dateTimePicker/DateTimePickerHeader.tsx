import {DsButton, DsText, IconGlyph} from '@eskerra/ds-desktop';

import {MONTH_LABELS} from './types';

import styles from './DateTimePicker.module.css';

type DateTimePickerHeaderProps = {
  readonly viewYear: number;
  readonly viewMonth: number;
  readonly onPrevMonth: () => void;
  readonly onNextMonth: () => void;
  readonly onToday: () => void;
};

export function DateTimePickerHeader({
  viewYear,
  viewMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
}: DateTimePickerHeaderProps) {
  return (
    <>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerNav}
          aria-label="Previous month"
          onClick={onPrevMonth}
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
          onClick={onNextMonth}
        >
          <IconGlyph name="chevron_right" size={12} aria-hidden />
        </button>
      </div>

      <div className={styles.todayRow}>
        <DsButton type="button" variant="primary" aria-label="Today" onClick={onToday}>
          Today
        </DsButton>
      </div>
    </>
  );
}
