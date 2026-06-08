import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  isVisibleTodayHubStaticLinkTokenElement,
  mapTodayHubStaticRenderedLineOffsetToDocOffset,
  todayHubStaticRichTextPointerHitsVisibleLinkToken,
} from './todayHubCellStaticPointer';

describe('isVisibleTodayHubStaticLinkTokenElement', () => {
  it('returns true for wiki inner span', () => {
    const el = document.createElement('span');
    el.className = 'cm-wiki-link cm-wiki-link--unresolved';
    expect(isVisibleTodayHubStaticLinkTokenElement(el)).toBe(true);
  });

  it('returns true for relative md label, not href', () => {
    const label = document.createElement('span');
    label.className = 'cm-md-rel-link cm-md-rel-link--resolved';
    expect(isVisibleTodayHubStaticLinkTokenElement(label)).toBe(true);

    const href = document.createElement('span');
    href.className = 'cm-md-rel-link cm-md-rel-link--resolved cm-md-rel-link-href';
    expect(isVisibleTodayHubStaticLinkTokenElement(href)).toBe(false);
  });

  it('returns true for external label / bare url, not hidden href', () => {
    const label = document.createElement('span');
    label.className = 'cm-md-external-link cm-md-external-link-glyph';
    expect(isVisibleTodayHubStaticLinkTokenElement(label)).toBe(true);

    const href = document.createElement('span');
    href.className = 'cm-md-external-link cm-md-external-href';
    expect(isVisibleTodayHubStaticLinkTokenElement(href)).toBe(false);
  });

  it('returns true when el is nested under wiki span', () => {
    const inner = document.createElement('span');
    inner.className = 'cm-wiki-link';
    const child = document.createElement('span');
    inner.appendChild(child);
    expect(isVisibleTodayHubStaticLinkTokenElement(child)).toBe(true);
  });

  it('returns false for plain cm-line', () => {
    const line = document.createElement('div');
    line.className = 'cm-line';
    expect(isVisibleTodayHubStaticLinkTokenElement(line)).toBe(false);
  });
});

describe('todayHubStaticRichTextPointerHitsVisibleLinkToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when elementFromPoint is null or outside root', () => {
    const root = document.createElement('div');
    const spy = vi.spyOn(root.ownerDocument, 'elementFromPoint').mockReturnValue(null);
    expect(todayHubStaticRichTextPointerHitsVisibleLinkToken(root, 1, 2)).toBe(false);
    spy.mockReturnValue(document.body);
    expect(todayHubStaticRichTextPointerHitsVisibleLinkToken(root, 1, 2)).toBe(false);
  });

  it('returns true when hit target is inside root and a link token', () => {
    const root = document.createElement('div');
    const link = document.createElement('span');
    link.className = 'cm-wiki-link';
    root.appendChild(link);
    vi.spyOn(root.ownerDocument, 'elementFromPoint').mockReturnValue(link);
    expect(todayHubStaticRichTextPointerHitsVisibleLinkToken(root, 0, 0)).toBe(true);
  });
});

describe('mapTodayHubStaticRenderedLineOffsetToDocOffset', () => {
  it('passes through 1:1 text when there are no pills', () => {
    const line = document.createElement('div');
    line.dataset.docLineFrom = '10';
    line.textContent = 'hello world';
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 0)).toBe(10);
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 5)).toBe(15);
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 11)).toBe(21);
  });

  it('maps rendered offsets through a date pill back to the raw token span', () => {
    const line = document.createElement('div');
    line.dataset.docLineFrom = '0';
    const before = document.createTextNode('Meet ');
    const pill = document.createElement('span');
    pill.dataset.docFrom = '5';
    pill.dataset.docTo = '15';
    pill.textContent = '🔔 Today';
    const after = document.createTextNode(' done');
    line.append(before, pill, after);

    const pillRenderedLen = pill.textContent!.length;
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 5)).toBe(5);
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 5 + pillRenderedLen)).toBe(15);
    expect(mapTodayHubStaticRenderedLineOffsetToDocOffset(line, 5 + pillRenderedLen + 1)).toBe(16);
  });

  it('maps a click inside the pill proportionally within the source token', () => {
    const line = document.createElement('div');
    line.dataset.docLineFrom = '0';
    const pill = document.createElement('span');
    pill.dataset.docFrom = '0';
    pill.dataset.docTo = '10';
    pill.textContent = '🔔 Today';
    line.appendChild(pill);

    const midRendered = Math.floor(pill.textContent!.length / 2);
    const mapped = mapTodayHubStaticRenderedLineOffsetToDocOffset(line, midRendered);
    expect(mapped).toBeGreaterThanOrEqual(0);
    expect(mapped).toBeLessThanOrEqual(10);
  });
});
