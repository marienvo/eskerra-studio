import {DsText} from '@eskerra/ds-desktop';

import styles from './DateTimePicker.module.css';

type DateTimePickerCompletedSectionProps = {
  readonly struck: boolean;
  readonly onStruckChange: (checked: boolean) => void;
};

export function DateTimePickerCompletedSection({
  struck,
  onStruckChange,
}: DateTimePickerCompletedSectionProps) {
  return (
    <section className={styles.completedSection} aria-label="Completion">
      <label className={styles.completedLabel}>
        <input
          type="checkbox"
          checked={struck}
          onChange={event => onStruckChange(event.currentTarget.checked)}
        />
        <DsText variant="body">Completed</DsText>
      </label>
    </section>
  );
}
