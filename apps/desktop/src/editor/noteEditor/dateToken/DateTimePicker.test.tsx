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

  it('commits today when Today is clicked', () => {
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

    expect(onConfirm).toHaveBeenCalledWith({
      year: 2026,
      month: 6,
      day: 6,
    });
  });

  it('commits immediately when a calendar day is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('gridcell', {name: '15 June 2026'}));

    expect(onConfirm).toHaveBeenCalledWith({
      year: 2026,
      month: 6,
      day: 15,
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

    fireEvent.click(screen.getByRole('checkbox', {name: /no time/i}));
    expect(hourInput.disabled).toBe(true);
    expect(minuteInput.disabled).toBe(true);

    fireEvent.click(screen.getByRole('gridcell', {name: '6 June 2026'}));

    const payload = onConfirm.mock.calls[0]![0] as DateTokenValue;
    expect(payload).toEqual({year: 2026, month: 6, day: 6});
    expect(payload.hour).toBeUndefined();
    expect(payload.minute).toBeUndefined();
  });

  it('commits time changes without requiring a calendar day click', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', {name: /no time/i}));
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Hour'}), {
      target: {value: '23'},
    });
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Minute'}), {
      target: {value: '52'},
    });

    expect(onConfirm).toHaveBeenLastCalledWith({
      year: 2026,
      month: 6,
      day: 6,
      hour: 23,
      minute: 50,
    });
  });

  it('keeps a stable default clock when now is omitted across rerenders', () => {
    const onConfirm = vi.fn();
    const {rerender} = render(
      <DateTimePicker
        initialValue={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    rerender(
      <DateTimePicker
        initialValue={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Today'}));

    expect(onConfirm).toHaveBeenCalledWith({
      year: 2026,
      month: 6,
      day: 6,
    });
  });

  it('returns focus after Today, a calendar day, and toggling time', () => {
    const onReturnFocus = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={FIXED_NOW}
        onConfirm={vi.fn()}
        onReturnFocus={onReturnFocus}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Today'}));
    fireEvent.click(screen.getByRole('gridcell', {name: '15 June 2026'}));
    fireEvent.click(screen.getByRole('checkbox', {name: /no time/i}));
    expect(onReturnFocus).toHaveBeenCalledTimes(3);
  });

  it('does not return focus while editing the hour or minute fields', () => {
    const onReturnFocus = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6, hour: 9, minute: 15}}
        now={FIXED_NOW}
        onConfirm={vi.fn()}
        onReturnFocus={onReturnFocus}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', {name: 'Hour'}), {
      target: {value: '23'},
    });
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Minute'}), {
      target: {value: '52'},
    });
    expect(onReturnFocus).not.toHaveBeenCalled();
  });

  it('prefills now plus 15 minutes snapped to 5 when time is enabled', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{year: 2026, month: 6, day: 6}}
        now={new Date(2026, 5, 6, 14, 31, 0, 0)}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Token has no time → "No time" starts checked. Unchecking enables time.
    fireEvent.click(screen.getByRole('checkbox', {name: /no time/i}));

    expect(onConfirm).toHaveBeenLastCalledWith({
      year: 2026,
      month: 6,
      day: 6,
      hour: 14,
      minute: 45,
    });

    const hourInput = screen.getByRole('spinbutton', {
      name: 'Hour',
    }) as HTMLInputElement;
    const minuteInput = screen.getByRole('spinbutton', {
      name: 'Minute',
    }) as HTMLInputElement;
    expect(hourInput.value).toBe('14');
    expect(minuteInput.value).toBe('45');
  });

  it('toggles completed to emit struck and bare tokens live', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePicker
        initialValue={{
          year: 2026,
          month: 6,
          day: 8,
          hour: 9,
          minute: 30,
        }}
        now={FIXED_NOW}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', {name: /completed/i}));
    expect(onConfirm).toHaveBeenLastCalledWith({
      year: 2026,
      month: 6,
      day: 8,
      hour: 9,
      minute: 30,
      struck: true,
    });

    onConfirm.mockClear();
    fireEvent.click(screen.getByRole('checkbox', {name: /completed/i}));
    expect(onConfirm).toHaveBeenLastCalledWith({
      year: 2026,
      month: 6,
      day: 8,
      hour: 9,
      minute: 30,
    });
    expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty('struck');
  });
});
