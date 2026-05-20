import {FENCED_CODE_RE, INLINE_CODE_RE} from './markdownCodeRegex';

/** GFM pipe table row (allows `<br>` inside cells). */
const GFM_TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

const BR_TAG_RE = /^<br\s*\/?>$/i;

const HTML_ENTITY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/(?:&#39;|&apos;)/gi, "'"],
];

function stripTagsInLine(line: string, preserveBr: boolean): string {
  let result = '';
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('<', i);
    if (open === -1) {
      result += line.slice(i);
      break;
    }
    result += line.slice(i, open);
    const close = line.indexOf('>', open);
    if (close === -1) {
      result += line.slice(open);
      break;
    }
    const tag = line.slice(open, close + 1);
    if (preserveBr && BR_TAG_RE.test(tag)) {
      result += tag;
    }
    i = close + 1;
  }
  return result;
}

function stripHtmlTagsInText(text: string): string {
  return text
    .split('\n')
    .map(line => stripTagsInLine(line, GFM_TABLE_ROW_RE.test(line)))
    .join('\n');
}

function decodeHtmlEntities(text: string): string {
  let out = text;
  for (const [pattern, replacement] of HTML_ENTITY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function stripAndDecodeProse(text: string): string {
  return decodeHtmlEntities(stripHtmlTagsInText(text));
}

function stripProseOutsideInlineCode(segment: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const inlineRe = new RegExp(INLINE_CODE_RE.source, INLINE_CODE_RE.flags);
  while ((m = inlineRe.exec(segment)) !== null) {
    if (m.index > last) {
      out += stripAndDecodeProse(segment.slice(last, m.index));
    }
    out += m[0];
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    out += stripAndDecodeProse(segment.slice(last));
  }
  return out;
}

/**
 * Removes leftover HTML tags from Turndown markdown output. Preserves `<br>` only on
 * GFM table rows (multi-line cells). Skips fenced and inline code. Decodes common entities
 * in prose segments.
 */
export function stripLeakedHtmlInMarkdown(md: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const fenceRe = new RegExp(FENCED_CODE_RE.source, FENCED_CODE_RE.flags);
  while ((m = fenceRe.exec(md)) !== null) {
    if (m.index > last) {
      out += stripProseOutsideInlineCode(md.slice(last, m.index));
    }
    out += m[0];
    last = m.index + m[0].length;
  }
  if (last < md.length) {
    out += stripProseOutsideInlineCode(md.slice(last));
  }
  return out;
}
