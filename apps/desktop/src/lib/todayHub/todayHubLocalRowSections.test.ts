import {describe, expect, it} from 'vitest';

import {retainTodayHubLocalRowSections} from './todayHubLocalRowSections';

describe('retainTodayHubLocalRowSections', () => {
  it('drops entries not in the retain set', () => {
    const prev = {a: ['1'], b: ['2'], c: ['3']};
    const next = retainTodayHubLocalRowSections(prev, new Set(['b']));
    expect(next).toEqual({b: ['2']});
  });

  it('returns the same reference when nothing is dropped', () => {
    const prev = {a: ['1'], b: ['2']};
    const next = retainTodayHubLocalRowSections(prev, new Set(['a', 'b']));
    expect(next).toBe(prev);
  });

  it('returns the same reference for an already-empty map', () => {
    const prev = {};
    expect(retainTodayHubLocalRowSections(prev, new Set())).toBe(prev);
  });

  it('drops everything when the retain set is empty', () => {
    const prev = {a: ['1'], b: ['2']};
    expect(retainTodayHubLocalRowSections(prev, new Set())).toEqual({});
  });

  it('ignores retain URIs that are not present', () => {
    const prev = {a: ['1']};
    const next = retainTodayHubLocalRowSections(prev, new Set(['a', 'missing']));
    expect(next).toBe(prev);
  });
});
