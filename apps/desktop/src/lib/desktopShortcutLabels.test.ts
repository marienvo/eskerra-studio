import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  cleanNoteMenuShortcutLabel,
  modEnterSaveShortcutLabel,
  reopenClosedTabMenuShortcutLabel,
} from './desktopShortcutLabels';

describe('reopenClosedTabMenuShortcutLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Ctrl+Shift+T for Linux', () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 X11; Linux',
    });
    expect(reopenClosedTabMenuShortcutLabel()).toBe('Ctrl+Shift+T');
  });

  it('returns ⌘⇧T for macOS', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 Macintosh',
    });
    expect(reopenClosedTabMenuShortcutLabel()).toBe('⌘⇧T');
  });
});

describe('cleanNoteMenuShortcutLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Ctrl+E for Linux', () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 X11; Linux',
    });
    expect(cleanNoteMenuShortcutLabel()).toBe('Ctrl+E');
  });

  it('returns ⌘E for macOS', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 Macintosh',
    });
    expect(cleanNoteMenuShortcutLabel()).toBe('⌘E');
  });
});

describe('modEnterSaveShortcutLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Ctrl+Enter for Linux', () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 X11; Linux',
    });
    expect(modEnterSaveShortcutLabel()).toBe('Ctrl+Enter');
  });

  it('returns ⌘Enter for macOS', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 Macintosh',
    });
    expect(modEnterSaveShortcutLabel()).toBe('⌘Enter');
  });
});
