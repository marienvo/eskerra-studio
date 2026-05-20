import {describe, expect, it} from 'vitest';

import {
  __resetForTests,
  expandKnownEmojiShortcodes,
  shortcodeToEmoji,
  slackEmojiImgUrlToCodepoint,
} from './emojiShortcodeLookup';

describe('shortcodeToEmoji', () => {
  it('maps :joy: to the grinning-with-tears emoji', () => {
    expect(shortcodeToEmoji(':joy:')).toBe('😂');
    expect(shortcodeToEmoji('joy')).toBe('😂');
    expect(shortcodeToEmoji('JOY')).toBe('😂');
  });

  it('returns null for unknown shortcodes', () => {
    expect(shortcodeToEmoji(':notarealemoji:')).toBeNull();
  });
});

describe('slackEmojiImgUrlToCodepoint', () => {
  it('decodes a single-codepoint Slack PNG URL', () => {
    expect(
      slackEmojiImgUrlToCodepoint(
        'https://a.slack-edge.com/production-standard-emoji-assets/15.0/google-medium/1f602.png',
      ),
    ).toBe('😂');
  });

  it('decodes ZWJ sequence filenames', () => {
    expect(
      slackEmojiImgUrlToCodepoint(
        'https://a.slack-edge.com/production-standard-emoji-assets/15.0/google-medium/1f468-200d-1f469-200d-1f466.png',
      ),
    ).toBe('👨\u200d👩\u200d👦');
  });

  it('returns null for non-Slack URLs', () => {
    expect(slackEmojiImgUrlToCodepoint('https://example.com/1f602.png')).toBeNull();
  });
});

describe('expandKnownEmojiShortcodes', () => {
  it('expands bare shortcodes in prose', () => {
    expect(expandKnownEmojiShortcodes('Die zien we te vaak :joy:')).toBe(
      'Die zien we te vaak 😂',
    );
  });

  it('leaves unknown shortcodes unchanged', () => {
    expect(expandKnownEmojiShortcodes(':notarealemoji: stays')).toBe(
      ':notarealemoji: stays',
    );
  });

  it('skips fenced and inline code', () => {
    expect(expandKnownEmojiShortcodes('`:joy:` and ```\n:joy:\n```')).toBe(
      '`:joy:` and ```\n:joy:\n```',
    );
  });
});

describe('__resetForTests', () => {
  it('clears the shortcode map cache', () => {
    expect(shortcodeToEmoji('joy')).toBe('😂');
    __resetForTests();
    expect(shortcodeToEmoji('joy')).toBe('😂');
  });
});
