import emojiRows from '../../editor/noteEditor/data/emojiColonCompletionData.json';

type EmojiCompletionRow = {
  readonly e: string;
  readonly p: string;
};

/** Slack standard emoji CDN: `.../1f602.png` or ZWJ sequences `.../1f468-200d-1f469.png`. */
const SLACK_EMOJI_IMG_PATH_RE = /\/([0-9a-f]+(?:-[0-9a-f]+)*)\.png$/i;

const BARE_SHORTCODE_RE = /(^|\W)(:[\p{L}\p{N}_+-]+:)/gu;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

let shortcodeMap: Map<string, string> | null = null;

function getShortcodeMap(): Map<string, string> {
  if (!shortcodeMap) {
    shortcodeMap = new Map();
    for (const row of emojiRows as readonly EmojiCompletionRow[]) {
      shortcodeMap.set(row.p.toLowerCase(), row.e);
    }
  }
  return shortcodeMap;
}

function normalizeShortcodeKey(shortcode: string): string {
  let key = shortcode.trim();
  if (key.startsWith(':') && key.endsWith(':') && key.length >= 2) {
    key = key.slice(1, -1);
  }
  return key.toLowerCase();
}

/** GitHub-style shortcode (e.g. `joy` or `:joy:`) to Unicode emoji, or null if unknown. */
export function shortcodeToEmoji(shortcode: string): string | null {
  const key = normalizeShortcodeKey(shortcode);
  if (key === '') {
    return null;
  }
  return getShortcodeMap().get(key) ?? null;
}

/**
 * Decode Slack standard emoji asset URLs (`a.slack-edge.com/.../<hex>.png`) to Unicode.
 * Custom Slack emoji URLs without a codepoint filename return null.
 */
export function slackEmojiImgUrlToCodepoint(url: string): string | null {
  if (!url.includes('slack-edge.com')) {
    return null;
  }
  const match = url.match(SLACK_EMOJI_IMG_PATH_RE);
  if (!match) {
    return null;
  }
  try {
    const parts = match[1]!.split('-').map(hex => Number.parseInt(hex, 16));
    if (parts.some(n => Number.isNaN(n))) {
      return null;
    }
    return String.fromCodePoint(...parts);
  } catch {
    return null;
  }
}

function expandShortcodesInPlainText(text: string): string {
  return text.replace(BARE_SHORTCODE_RE, (match, prefix: string, token: string) => {
    const inner = token.slice(1, -1);
    const emoji = shortcodeToEmoji(inner);
    return emoji != null ? prefix + emoji : match;
  });
}

function expandShortcodesOutsideInlineCode(segment: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const inlineRe = new RegExp(INLINE_CODE_RE.source, INLINE_CODE_RE.flags);
  while ((m = inlineRe.exec(segment)) !== null) {
    if (m.index > last) {
      out += expandShortcodesInPlainText(segment.slice(last, m.index));
    }
    out += m[0];
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    out += expandShortcodesInPlainText(segment.slice(last));
  }
  return out;
}

/**
 * Replace known `:shortcode:` tokens with Unicode emoji in markdown prose.
 * Skips fenced code blocks and inline code spans.
 */
export function expandKnownEmojiShortcodes(md: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const fenceRe = new RegExp(FENCED_CODE_RE.source, FENCED_CODE_RE.flags);
  while ((m = fenceRe.exec(md)) !== null) {
    if (m.index > last) {
      out += expandShortcodesOutsideInlineCode(md.slice(last, m.index));
    }
    out += m[0];
    last = m.index + m[0].length;
  }
  if (last < md.length) {
    out += expandShortcodesOutsideInlineCode(md.slice(last));
  }
  return out;
}

/** Vitest harness: drop cached shortcode map. */
export function __resetForTests(): void {
  shortcodeMap = null;
}
