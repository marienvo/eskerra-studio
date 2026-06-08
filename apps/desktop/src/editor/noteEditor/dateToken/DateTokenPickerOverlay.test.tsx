import {fireEvent, render} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {DateTokenPickerOverlay} from './DateTokenPickerOverlay';

afterEach(() => {
  document.body.replaceChildren();
});

describe('DateTokenPickerOverlay dismiss', () => {
  it('calls onCancel for Escape without re-subscribing on parent re-render', () => {
    const onCancel = vi.fn();
    function Host() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick(t => t + 1)}>
            bump {tick}
          </button>
          <DateTokenPickerOverlay
            anchorRect={{left: 8, top: 8, bottom: 16}}
            initialValue={{year: 2026, month: 6, day: 8}}
            onConfirm={vi.fn()}
            onCancel={onCancel}
          />
        </>
      );
    }

    const {getByRole} = render(<Host />);
    fireEvent.click(getByRole('button', {name: /bump/i}));
    fireEvent.keyDown(document, {key: 'Escape'});
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
