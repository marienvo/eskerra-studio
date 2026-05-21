import TurndownService from 'turndown';
import {
  highlightedCodeBlock,
  tables,
  taskListItems,
} from 'turndown-plugin-gfm';

import {
  expandKnownEmojiShortcodes,
  shortcodeToEmoji,
  slackEmojiImgUrlToCodepoint,
} from '../emoji/emojiShortcodeLookup';
import {sanitizeClipboardHtml} from './sanitizeClipboardHtml';
import {stripLeakedHtmlInMarkdown} from './stripLeakedHtmlInMarkdown';

/** Reject huge clipboard HTML to avoid blocking the editor thread. */
export const CLIPBOARD_HTML_MAX_CHARS = 512_000;

let turndownSingleton: TurndownService | null = null;

const SLACK_EMOJI_ALT_SHORTCODE_RE = /^:([\p{L}\p{N}_+-]+):$/u;

function escapeMarkdownImageLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function escapeMarkdownAngleDestination(text: string): string {
  return text.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '%0A');
}

function escapeMarkdownTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function turndownDefaultImageMarkdown(img: HTMLImageElement): string {
  const src = img.getAttribute('src') ?? '';
  if (!src) {
    return '';
  }
  const alt = escapeMarkdownImageLabel(img.getAttribute('alt') ?? '');
  const safeSrc = escapeMarkdownAngleDestination(src);
  const title = img.getAttribute('title') ?? '';
  const titlePart = title ? ` "${escapeMarkdownTitle(title)}"` : '';
  return `![${alt}](<${safeSrc}>${titlePart})`;
}

function escapeTableCellPipes(content: string): string {
  return content.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '\n') {
    end -= 1;
  }
  return text.slice(0, end);
}

function fenceLengthForPreContent(text: string): number {
  const runs = text.match(/`+/g);
  if (!runs) {
    return 3;
  }
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return Math.max(3, longest + 1);
}

/** Turndown's built-in fenced rule uses `firstChild`, which misses `<pre>\\n  <code>`. */
function fencedPreCodeReplacement(
  node: HTMLElement,
  fence: string,
): string {
  const codeEl = node.firstElementChild as HTMLElement;
  const className = codeEl.getAttribute('class') ?? '';
  const languageMatch = className.match(/language-(\S+)/);
  const language = languageMatch?.[1] ?? '';
  const code = codeEl.textContent ?? '';
  const fenceChar = fence.charAt(0) || '`';
  let fenceSize = 3;
  const fenceInCodeRegex = new RegExp(`^ {0,3}${fenceChar}{3,}`, 'gm');
  let match: RegExpExecArray | null;
  while ((match = fenceInCodeRegex.exec(code)) !== null) {
    if (match[0].length >= fenceSize) {
      fenceSize = match[0].length + 1;
    }
  }
  const fenceStr = fenceChar.repeat(fenceSize);
  const trimmed = code.replace(/\n$/, '');
  return `\n\n${fenceStr}${language}\n${trimmed}\n${fenceStr}\n\n`;
}

function slackEmojiImgReplacement(img: HTMLImageElement): string | null {
  const alt = img.getAttribute('alt') ?? '';
  const src = img.getAttribute('src') ?? '';
  const altMatch = alt.match(SLACK_EMOJI_ALT_SHORTCODE_RE);
  if (altMatch) {
    const fromAlt = shortcodeToEmoji(altMatch[1]!);
    if (fromAlt) {
      return fromAlt;
    }
  }
  return slackEmojiImgUrlToCodepoint(src);
}

function getTurndown(): TurndownService {
  if (!turndownSingleton) {
    const td = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
    });
    td.use(highlightedCodeBlock);
    td.use(tables);
    td.use(taskListItems);
    td.addRule('tableCellEscapePipes', {
      filter: (node: HTMLElement) =>
        node.nodeName === 'TH' || node.nodeName === 'TD',
      replacement: (content: string, node: HTMLElement) => {
        const isFirst = node.previousElementSibling === null;
        const prefix = isFirst ? '| ' : ' ';
        const escaped = escapeTableCellPipes(content.replace(/\n+/g, ' ').trim());
        return `${prefix}${escaped} |`;
      },
    });
    td.addRule('preWithoutCode', {
      filter: (node: HTMLElement) =>
        node.nodeName === 'PRE'
        && !(node.firstElementChild && node.firstElementChild.nodeName === 'CODE'),
      replacement: (_content: string, node: HTMLElement) => {
        const text = (node as HTMLElement).textContent ?? '';
        const fence = '`'.repeat(fenceLengthForPreContent(text));
        return `\n\n${fence}\n${trimTrailingNewlines(text)}\n${fence}\n\n`;
      },
    });
    td.addRule('eskerraHighlight', {
      filter: (node: HTMLElement) => node.nodeName === 'MARK',
      replacement: (content: string) => `==${content}==`,
    });
    td.addRule('kbdAsInlineCode', {
      filter: (node: HTMLElement) => node.nodeName === 'KBD',
      replacement: (content: string) => `\`${content}\``,
    });
    td.addRule('strikethrough', {
      filter: (node: HTMLElement) =>
        node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
      replacement: (content: string) => `~~${content}~~`,
    });
    td.addRule('slackEmojiImg', {
      filter: (node: HTMLElement) => node.nodeName === 'IMG',
      replacement: (_content: string, node: HTMLElement) => {
        const img = node as HTMLImageElement;
        const emoji = slackEmojiImgReplacement(img);
        return emoji ?? turndownDefaultImageMarkdown(img);
      },
    });
    td.addRule('fencedPreCode', {
      filter: (node: HTMLElement, options) =>
        options.codeBlockStyle === 'fenced'
        && node.nodeName === 'PRE'
        && node.firstElementChild?.nodeName === 'CODE',
      replacement: (_content: string, node: HTMLElement, options) =>
        fencedPreCodeReplacement(node, options.fence ?? '```'),
    });
    turndownSingleton = td;
  }
  return turndownSingleton;
}

/**
 * Heuristic: `text/html` carries meaningful structure worth converting to Markdown.
 * Conservative about bare `<span>` so trivial fragments still fall through to default paste.
 */
const STRUCTURAL_HTML_MARKERS = [
  '<table',
  '<thead',
  '<tbody',
  '<tfoot',
  '<tr',
  '<th',
  '<td',
  '<ul',
  '<ol',
  '<li',
  '<h1',
  '<h2',
  '<h3',
  '<h4',
  '<h5',
  '<h6',
  '<blockquote',
  '<pre',
  '<p',
  '<div',
  '<br',
  '<hr',
  '<img',
  '<a',
  '<strong',
  '<em',
  '<b',
  '<i',
  '<u',
  '<del',
  '<strike',
  '<s',
  '<sup',
  '<sub',
  '<code',
  '<kbd',
  '<mark',
] as const;

/**
 * True when `lowerHtml` contains this tag open at a word boundary (so `<s` does not
 * match `<span` / `<style` / `<script`, and `<th` does not match `<thead`).
 */
function lowerHtmlContainsTagOpen(lowerHtml: string, marker: string): boolean {
  let from = 0;
  while (from < lowerHtml.length) {
    const idx = lowerHtml.indexOf(marker, from);
    if (idx < 0) {
      return false;
    }
    const after = lowerHtml[idx + marker.length];
    if (after === undefined || !/[a-z0-9]/.test(after)) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

/** Block tags that break GFM pipe-table rows when left as direct `<th>`/`<td>` children. */
const BLOCK_TAGS_IN_CELL = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
]);

const FLATTEN_CELL_MAX_ITERATIONS = 50;

function trimCellBrNoise(cell: Element): void {
  while (cell.firstChild && (cell.firstChild as HTMLElement).tagName === 'BR') {
    cell.removeChild(cell.firstChild);
  }
  while (cell.lastChild && (cell.lastChild as HTMLElement).tagName === 'BR') {
    cell.removeChild(cell.lastChild);
  }
}

function unwrapBlockChildInCell(
  cell: Element,
  child: Element,
  doc: Document,
): void {
  if (child.tagName === 'LI') {
    cell.insertBefore(doc.createTextNode('- '), child);
  }
  const ref = child.nextSibling;
  while (child.firstChild) {
    cell.insertBefore(child.firstChild, child);
  }
  if (ref) {
    cell.insertBefore(doc.createElement('br'), ref);
  }
  cell.removeChild(child);
}

function flattenSingleTableCell(cell: Element, doc: Document): void {
  let mutated = true;
  let safety = 0;
  while (mutated && safety++ < FLATTEN_CELL_MAX_ITERATIONS) {
    mutated = false;
    for (const child of Array.from(cell.children)) {
      if (!BLOCK_TAGS_IN_CELL.has(child.tagName)) {
        continue;
      }
      unwrapBlockChildInCell(cell, child, doc);
      mutated = true;
    }
  }
  trimCellBrNoise(cell);
}

/**
 * Flatten block content inside table cells so Turndown's GFM tables plugin can emit
 * one `| ... |` row per `<tr>` (rendered chat HTML often wraps each cell in `<p>`).
 */
function flattenTableCellsForGfm(doc: Document): void {
  doc.querySelectorAll('th, td').forEach(cell => {
    flattenSingleTableCell(cell, doc);
  });
}

function preprocessClipboardHtmlFragment(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc
      .querySelectorAll('script, style, meta')
      .forEach(el => el.remove());
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
    flattenTableCellsForGfm(doc);
    return doc.body?.innerHTML ?? html;
  } catch {
    return html;
  }
}

function plainIsSinglePasteAsLinkUrl(plain: string): boolean {
  const t = plain.trim();
  if (!t || /\s/.test(t)) {
    return false;
  }
  return /^(https?:\/\/|mailto:)\S+$/i.test(t);
}

/**
 * Same as {@link isHtmlWrapperForPasteUrlAsLink} but assumes `safeHtml` was
 * produced by {@link sanitizeClipboardHtml} (avoids double DOMPurify on hot paths).
 */
function isHtmlWrapperForPasteUrlAsLinkFromSanitized(
  safeHtml: string,
  plain: string,
): boolean {
  if (!plainIsSinglePasteAsLinkUrl(plain)) {
    return false;
  }
  const t = plain.trim();
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(safeHtml, 'text/html');
  } catch {
    return false;
  }
  const body = doc.body;
  if (!body) {
    return false;
  }

  const anchors = body.querySelectorAll('a[href]');
  if (anchors.length === 1) {
    const a = anchors[0]! as HTMLAnchorElement;
    const href = a.getAttribute('href')?.trim() ?? '';
    if (
      href === t
      || a.href === t
      || href.replace(/\/$/, '') === t.replace(/\/$/, '')
    ) {
      const inner = (a.textContent ?? '').trim();
      if (inner === '' || inner === t) {
        return true;
      }
    }
  }

  const text = (body.textContent ?? '').trim().replace(/\s+/g, ' ');
  const plainOneLine = t.replace(/\s+/g, ' ');
  if (
    text === plainOneLine
    && !body.querySelector(
      'table, ul, ol, img, h1, h2, h3, h4, h5, h6, blockquote, pre',
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Let CodeMirror `pasteURLAsLink` handle a lone URL when HTML is only a wrapper
 * around the same href (common browser / Office fragments).
 */
export function isHtmlWrapperForPasteUrlAsLink(
  html: string,
  plain: string,
): boolean {
  return isHtmlWrapperForPasteUrlAsLinkFromSanitized(
    sanitizeClipboardHtml(html),
    plain,
  );
}

function clipboardHtmlLooksStructured(html: string): boolean {
  const lower = html.toLowerCase();
  return STRUCTURAL_HTML_MARKERS.some(marker =>
    lowerHtmlContainsTagOpen(lower, marker),
  );
}

function normalizeForPlainComparison(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function looselySameMarkdownAsPlain(md: string, plain: string): boolean {
  const a = normalizeForPlainComparison(md);
  const b = normalizeForPlainComparison(plain);
  if (a === b) {
    return true;
  }
  const aOne = a.replace(/\s+/g, ' ');
  const bOne = b.replace(/\s+/g, ' ');
  return aOne === bOne;
}

/**
 * Converts clipboard HTML that was already passed through {@link sanitizeClipboardHtml}.
 * All module-owned `DOMParser` use for Turndown preprocessing must go through this path.
 */
function clipboardSanitizedHtmlToMarkdown(safeHtml: string): string {
  const cleaned = preprocessClipboardHtmlFragment(safeHtml);
  // Turndown escapes [ and ] individually, turning [[wiki link]] into \[\[wiki link\]\].
  // Undo that for double-bracket sequences so wiki links survive paste.
  const md = getTurndown()
    .turndown(cleaned)
    .replace(/\\\[\\\[/g, '[[')
    .replace(/\\\]\\\]/g, ']]');
  return stripLeakedHtmlInMarkdown(expandKnownEmojiShortcodes(md));
}

/**
 * Converts HTML from the clipboard to Markdown. Untrusted HTML is sanitized before any
 * module-owned DOM parsing (see {@link clipboardSanitizedHtmlToMarkdown}).
 */
export function clipboardHtmlToMarkdown(html: string): string {
  return clipboardSanitizedHtmlToMarkdown(sanitizeClipboardHtml(html));
}

/**
 * When non-null, callers should insert this Markdown instead of default plain paste.
 * Returns null when HTML should not drive paste (opaque blocks handled separately).
 */
export function tryClipboardHtmlToMarkdownInsert(
  html: string,
  plain: string,
): string | null {
  const h = html.trim();
  if (h === '' || h.length > CLIPBOARD_HTML_MAX_CHARS) {
    return null;
  }
  const safeHtml = sanitizeClipboardHtml(html);
  if (isHtmlWrapperForPasteUrlAsLinkFromSanitized(safeHtml, plain)) {
    return null;
  }
  if (!clipboardHtmlLooksStructured(safeHtml)) {
    return null;
  }

  let md: string;
  try {
    md = clipboardSanitizedHtmlToMarkdown(safeHtml);
  } catch {
    return null;
  }

  md = md.replace(/\u00a0/g, ' ');
  const trimmed = md.trimEnd();
  if (!trimmed) {
    return null;
  }
  if (looselySameMarkdownAsPlain(trimmed, plain)) {
    return null;
  }
  return trimmed;
}

/** Vitest harness: drop cached Turndown instance. */
export function __resetForTests(): void {
  turndownSingleton = null;
}
