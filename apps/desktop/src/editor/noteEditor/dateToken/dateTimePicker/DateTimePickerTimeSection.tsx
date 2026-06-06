import {DsText} from '@eskerra/ds-desktop';

import styles from './DateTimePicker.module.css';

type DateTimePickerTimeSectionProps = {
  readonly noTime: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly onNoTimeChange: (checked: boolean) => void;
  readonly onHourChange: (value: number) => void;
  readonly onMinuteChange: (value: number) => void;
};

export function DateTimePickerTimeSection({
  noTime,
  hour,
  minute,
  onNoTimeChange,
  onHourChange,
  onMinuteChange,
}: DateTimePickerTimeSectionProps) {
  return (
    <section className={styles.timeSection} aria-label="Time">
      <label className={styles.noTimeLabel}>
        <input
          type="checkbox"
          checked={noTime}
          onChange={event => onNoTimeChange(event.currentTarget.checked)}
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
          onChange={event => onHourChange(Number(event.currentTarget.value) || 0)}
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
          onChange={event => onMinuteChange(Number(event.currentTarget.value) || 0)}
        />
      </div>
    </section>
  );
}
