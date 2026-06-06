/**
 * L3 sandbox story: lives under `__sandbox__`, tag `sandbox` in the default export.
 */
import {useState} from 'react';

import {formatDateToken, type DateTokenValue} from '../dateToken';
import {DateTimePicker} from '../DateTimePicker';

const STORY_NOW = new Date(2026, 5, 6, 14, 30, 0, 0);

export default {
  title: 'sandbox/DateTimePicker',
  tags: ['sandbox'],
};

export function DefaultEmpty() {
  const [last, setLast] = useState<string>('(none)');
  return (
    <div style={{maxWidth: 320, padding: 12}}>
      <DateTimePicker
        initialValue={null}
        now={STORY_NOW}
        onConfirm={value => setLast(formatDateToken(value))}
        onCancel={() => setLast('(cancelled)')}
      />
      <p style={{marginTop: 12, fontSize: 12, opacity: 0.75}}>Last action: {last}</p>
    </div>
  );
}

export function PrefilledWithTime() {
  const initial: DateTokenValue = {
    year: 2026,
    month: 12,
    day: 28,
    hour: 23,
    minute: 52,
  };
  const [last, setLast] = useState(formatDateToken(initial));
  return (
    <div style={{maxWidth: 320, padding: 12}}>
      <DateTimePicker
        initialValue={initial}
        now={STORY_NOW}
        onConfirm={value => setLast(formatDateToken(value))}
        onCancel={() => setLast('(cancelled)')}
      />
      <p style={{marginTop: 12, fontSize: 12, opacity: 0.75}}>Last action: {last}</p>
    </div>
  );
}
