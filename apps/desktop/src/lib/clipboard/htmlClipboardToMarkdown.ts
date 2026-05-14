import TurndownService from 'turndown';
import {
  highlightedCodeBlock,
  tables,
  taskListItems,
} from 'turndown-plugin-gfm';

/** Reject huge clipboard HTML to avoid blocking the editor thread. */
export const CLIPBOARD_HTML_MAX_CHARS = 512_000;

let turndownSingleton: TurndownService | null = null;

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
    td.addRule('strikethrough', {
      filter: (node: HTMLElement) =>
        node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
      replacement: (content: string) => `~~${content}~~`,
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

function preprocessClipboardHtmlFragment(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc
      .querySelectorAll('script, style, meta')
      .forEach(el => el.remove());
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
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
 * Let CodeMirror `pasteURLAsLink` handle a lone URL when HTML is only a wrapper
 * around the same href (common browser / Office fragments).
 */
export function isHtmlWrapperForPasteUrlAsLink(
  html: string,
  plain: string,
): boolean {
  if (!plainIsSinglePasteAsLinkUrl(plain)) {
    return false;
  }
  const t = plain.trim();
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
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

export function clipboardHtmlToMarkdown(html: string): string {
  const cleaned = preprocessClipboardHtmlFragment(html);
  // Turndown escapes [ and ] individually, turning [[wiki link]] into \[\[wiki link\]\].
  // Undo that for double-bracket sequences so wiki links survive paste.
  return getTurndown()
    .turndown(cleaned)
    .replace(/\\\[\\\[/g, '[[')
    .replace(/\\\]\\\]/g, ']]');
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
  if (isHtmlWrapperForPasteUrlAsLink(html, plain)) {
    return null;
  }
  if (!clipboardHtmlLooksStructured(html)) {
    return null;
  }

  let md: string;
  try {
    md = clipboardHtmlToMarkdown(html);
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
