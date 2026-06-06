import {fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DateTimePicker} from './DateTimePicker';
import type {DateTokenValue} from './dateToken';

const FIXED_NOW = new Date(2026, 5, 6, 14, 30, 0, 0);

describe('DateTimePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects today when Today is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 12, day: 28}}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Today'}));
    fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    expect(onConfirm).toHaveBeenCalledWith({
      year: 2026,
      month: 6,
      day: 6,
    });
  });

  it('navigates months with previous and next controls', () => {
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={FIXED_NOW}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('June 2026')).toBeInstanceOf(HTMLElement);

    fireEvent.click(screen.getByRole('button', {name: 'Next month'}));
    expect(screen.getByText('July 2026')).toBeInstanceOf(HTMLElement);

    fireEvent.click(screen.getByRole('button', {name: 'Previous month'}));
    expect(screen.getByText('June 2026')).toBeInstanceOf(HTMLElement);
  });

  it('disables time fields when No time is checked and confirms date-only', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{
          year: 2026,
          month: 6,
          day: 6,
          hour: 9,
          minute: 15,
        }}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const hourInput = screen.getByRole('spinbutton', {
      name: 'Hour',
    }) as HTMLInputElement;
    const minuteInput = screen.getByRole('spinbutton', {
      name: 'Minute',
    }) as HTMLInputElement;
    expect(hourInput.disabled).toBe(false);
    expect(minuteInput.disabled).toBe(false);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(hourInput.disabled).toBe(true);
    expect(minuteInput.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    const payload = onConfirm.mock.calls[0]![0] as DateTokenValue;
    expect(payload).toEqual({year: 2026, month: 6, day: 6});
    expect(payload.hour).toBeUndefined();
    expect(payload.minute).toBeUndefined();
  });

  it('confirms with time when No time is off', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Hour'}), {
      target: {value: '23'},
    });
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Minute'}), {
      target: {value: '52'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    expect(onConfirm).toHaveBeenCalledWith({
      year: 2026,
      month: 6,
      day: 6,
      hour: 23,
      minute: 52,
    });
  });

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(
      <DateTimePicker
        initialValue={null}
        now={FIXED_NOW}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
