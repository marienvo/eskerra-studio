/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
import {remark} from 'remark';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import {defaultHandlers} from 'mdast-util-to-markdown';
import type {VFile} from 'vfile';

import {normalizeEmojiText} from './emojiVariation';

type AnyNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: AnyNode[];
};

export type CleanNoteBullet = '-' | '*' | '+';
export type CleanNoteBulletOrdered = '.' | ')';
export type CleanNoteListItemIndent = 'tab' | 'one';

/** Stylistic options for future settings UI; all optional with script-compatible defaults. */
export type CleanNoteOptions = {
  bullet?: CleanNoteBullet;
  bulletOrdered?: CleanNoteBulletOrdered;
  emphasis?: '*' | '_';
  strong?: '*' | '_';
  listItemIndent?: CleanNoteListItemIndent;
  insertH1FromFilename?: boolean;
  capHeadingDepthJumps?: boolean;
  removeEmptyListItems?: boolean;
  normalizeEmojiVs16?: boolean;
  rejoinHyphenatedLineBreaks?: boolean;
};

export type ResolvedCleanNoteOptions = Required<CleanNoteOptions>;

export function resolveCleanNoteDefaults(opts?: CleanNoteOptions): ResolvedCleanNoteOptions {
  return {
    bullet: opts?.bullet ?? '-',
    bulletOrdered: opts?.bulletOrdered ?? '.',
    emphasis: opts?.emphasis ?? '*',
    strong: opts?.strong ?? '*',
    listItemIndent: opts?.listItemIndent ?? 'tab',
    insertH1FromFilename: opts?.insertH1FromFilename ?? true,
    capHeadingDepthJumps: opts?.capHeadingDepthJumps ?? true,
    removeEmptyListItems: opts?.removeEmptyListItems ?? true,
    normalizeEmojiVs16: opts?.normalizeEmojiVs16 ?? true,
    rejoinHyphenatedLineBreaks: opts?.rejoinHyphenatedLineBreaks ?? true,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileStemFromPath(filepath: string): string {
  const norm = filepath.replace(/\\/g, '/');
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  return base.replace(/\.md$/i, '');
}

function listLineRe(bullet: string): RegExp {
  const b = escapeRegExp(bullet);
  return new RegExp(`^\\s*(?:${b}|\\d+[.)])\\s+`);
}

const processorCache = new Map<string, ReturnType<typeof remark>>();

function getMarkdownProcessor(resolved: ResolvedCleanNoteOptions): ReturnType<typeof remark> {
  const key = JSON.stringify(resolved);
  let p = processorCache.get(key);
  if (!p) {
    p = createMarkdownProcessor(resolved);
    processorCache.set(key, p);
  }
  return p;
}

function createMarkdownProcessor(resolved: ResolvedCleanNoteOptions): ReturnType<typeof remark> {
  return remark()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => (tree: AnyNode, file: VFile) => {
      const fileStem = String((file.data as {fileStem?: string} | undefined)?.fileStem ?? '');
      normalizeAst(tree, fileStem, resolved);
    })
    .use(remarkStringify, {
      bullet: resolved.bullet,
      bulletOrdered: resolved.bulletOrdered,
      incrementListMarker: true,
      emphasis: resolved.emphasis,
      strong: resolved.strong,
      fence: '`',
      fences: true,
      rule: '-',
      setext: false,
      listItemIndent: resolved.listItemIndent,
      handlers: {
        link(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          const n = node as {
            children?: unknown[];
            title?: unknown;
            url?: unknown;
          };
          const text = getSingleTextLinkValue(n);
          if (text && shouldSerializeAsPlainAutolink(n, text)) {
            return text;
          }
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.link(node as never, parent as never, state as never, info as never),
          );
        },
        image(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.image(node as never, parent as never, state as never, info as never),
          );
        },
        definition(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.definition(node as never, parent as never, state as never, info as never),
          );
        },
      },
    });
}

/**
 * Normalizes markdown body (no YAML frontmatter). Matches legacy `processMarkDownContent` behavior
 * when defaults are used.
 */
export function cleanNoteMarkdownBody(
  content: string,
  filepath: string,
  options?: CleanNoteOptions,
): string {
  const resolved = resolveCleanNoteDefaults(options);
  const preserveLeadingBlankLine = /^[\t ]*\n/.test(content);
  const preprocessed = preprocessMarkdown(content, resolved);
  const {text: wikiProtectedInput, tokens: wikiTokens} = protectWikiLinks(preprocessed);
  const {text: protectedInput, tokens: highlightTokens} = protectHighlights(wikiProtectedInput);
  const {text: issueProtectedInput, tokens: issueTokens} =
    protectIssueNumberHashes(protectedInput);
  const {text: admonitionProtectedInput, tokens: admonitionTokens} =
    protectBlockquoteAdmonitions(issueProtectedInput);
  const fileStem = fileStemFromPath(filepath);

  const processor = getMarkdownProcessor(resolved);
  const file = processor.processSync({
    path: filepath,
    value: admonitionProtectedInput,
    data: {fileStem},
  });

  const unhighlighted = restoreHighlights(String(file), highlightTokens);
  const afterEmoji = resolved.normalizeEmojiVs16
    ? normalizeEmojiText(unhighlighted)
    : unhighlighted;
  const restoredWiki = restoreWikiLinks(afterEmoji, wikiTokens);
  const restoredIssues = restoreIssueNumberHashes(restoredWiki, issueTokens);
  const restored = restoreBlockquoteAdmonitions(restoredIssues, admonitionTokens);
  return postprocessMarkdown(restored, {preserveLeadingBlankLine}, resolved);
}

/**
 * Placeholder path for `cleanNoteMarkdownBody` when pasting while no vault file path exists yet
 * (for example a new inbox entry). Not used for H1 injection when `insertH1FromFilename` is false.
 */
export const CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH = '/virtual/Untitled.md';

/**
 * Same normalization pipeline as "Clean this note", scoped to pasted markdown only.
 * Never injects H1 from the filename (safe for mid-document fragments).
 */
export function cleanPastedMarkdownFragment(
  markdown: string,
  activeNotePath: string | null,
  options?: CleanNoteOptions,
): string {
  const filepath = activeNotePath ?? CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH;
  return cleanNoteMarkdownBody(markdown, filepath, {
    ...options,
    insertH1FromFilename: false,
  });
}

function preprocessMarkdownLineOutsideFence(
  rawLine: string,
  resolved: ResolvedCleanNoteOptions,
  b: string,
  bEsc: string,
  dupBulletRe: RegExp,
  dupBulletOnlyRe: RegExp,
  alternateBulletRe: RegExp,
): string | null {
  let line = rawLine.trimEnd();
  line = line.replace(/^\s+(#{1,6}\s)/, '$1');
  line = line.replace(alternateBulletRe, `$1${b} `);
  if (b !== '-') {
    line = line.replace(
      /^((?:>\s*)*)([ \t]*)-\s+(?!\[[ xX]\])/,
      `$1$2${b} `,
    );
    line = line.replace(/^([ \t]*)-\s+(?!\[[ xX]\])/, `$1${b} `);
  }
  line = line.replace(new RegExp(`^((?:>\\s*)*)([ \\t]*)${bEsc}(?:[ \\t]+)`, 'g'), `$1$2${b} `);
  line = line.replace(new RegExp(`^([ \\t]*)${bEsc}(?:[ \\t]+)`), `$1${b} `);
  line = line.replace(
    /^((?:>\s*)*)(\s*)-\s*\[([ xX])\]\s*/,
    (_m, quotePrefix: string, indent: string, mark: string) => {
      const normalizedMark = mark.toLowerCase() === 'x' ? 'x' : ' ';
      return `${quotePrefix}${indent}- [${normalizedMark}] `;
    },
  );
  line = line.replace(/^(\s*)-\s*\[([ xX])\]\s*/, (_m, indent, mark) => {
    const normalizedMark = (mark as string).toLowerCase() === 'x' ? 'x' : ' ';
    return `${indent}- [${normalizedMark}] `;
  });
  line = line.replace(dupBulletRe, '$1');
  line = line.replace(dupBulletOnlyRe, '$1');
  line = line.replace(/^(\s*\d+[.)])\s*/, '$1 ');
  line = line.replace(/^((?:>\s*)*\s*-\s\[[ xX]\])\s*/, '$1 ');
  line = line.replace(/^(\s*-\s\[[ xX]\])\s*/, '$1 ');
  line = line.replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_m, text, url) => {
    return `[${String(text).trim()}](${url})`;
  });
  line = line.replace(/\[\[\s*([^\]]*?)\s*\]\]/g, '[[$1]]');

  if (resolved.removeEmptyListItems) {
    const emptyList = new RegExp(`^\\s*${bEsc}\\s*(?:\\[[ xX]\\])?\\s*$`);
    if (emptyList.test(line)) {
      return null;
    }
  }

  return collapseInnerSpaces(line);
}

function preprocessMarkdown(input: string, resolved: ResolvedCleanNoteOptions): string {
  const b = resolved.bullet;
  const bEsc = escapeRegExp(b);
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  const dupBulletRe = new RegExp(
    `^((?:>\\s*)*\\s*${bEsc}\\s+)(?:${bEsc}\\s+)+`,
  );
  const dupBulletOnlyRe = new RegExp(`^(\\s*${bEsc}\\s+)(?:${bEsc}\\s+)+`);
  const alternateBulletRe = /^(\s*)[*+•◦▪‣]\s+/u;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const fence = getFence(rawLine);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(rawLine.trimEnd());
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(rawLine.trimEnd());
      continue;
    }

    if (inFence) {
      out.push(rawLine);
      continue;
    }

    const processed = preprocessMarkdownLineOutsideFence(
      rawLine,
      resolved,
      b,
      bEsc,
      dupBulletRe,
      dupBulletOnlyRe,
      alternateBulletRe,
    );
    if (processed != null) {
      out.push(processed);
    }
  }

  const noHyphenBreaks = resolved.rejoinHyphenatedLineBreaks
    ? removeHyphenatedLineBreaks(out)
    : out;
  return noHyphenBreaks.join('\n');
}

function trimEndOutsideFences(rawLines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of rawLines) {
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(line.trimEnd());
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(line.trimEnd());
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function postprocessMarkdown(
  input: string,
  postOpts: {preserveLeadingBlankLine?: boolean} = {},
  resolved: ResolvedCleanNoteOptions,
): string {
  if (input.trim().length === 0) {
    return '';
  }

  let lines = trimEndOutsideFences(input.replace(/\r\n/g, '\n').split('\n'));

  lines = normalizeBulletSpacing(lines, resolved.bullet);
  if (resolved.listItemIndent === 'tab') {
    lines = normalizeListIndentTabs(lines);
  }
  lines = removeBlankLinesBetweenListItems(lines, resolved.bullet);
  lines = ensureBlankLinesAroundBlocks(lines);
  lines = collapseConsecutiveBlankLines(lines);
  lines = normalizeBulletSpacing(lines, resolved.bullet);

  if (postOpts.preserveLeadingBlankLine && lines[0] !== '') {
    lines.unshift('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return `${lines.join('\n')}\n`;
}

function normalizeAst(tree: AnyNode, fileStem: string, resolved: ResolvedCleanNoteOptions): void {
  let hasH1 = false;
  walkTree(tree, node => {
    if (node.type === 'heading' && Number(node.depth ?? 1) === 1) {
      hasH1 = true;
    }
  });

  if (resolved.insertH1FromFilename && !hasH1 && tree.type === 'root') {
    if (!Array.isArray(tree.children)) {
      tree.children = [];
    }
    tree.children.unshift({
      type: 'heading',
      depth: 1,
      children: [{type: 'text', value: fileStem}],
    });
  }

  let previousHeadingDepth: number | null = null;
  walkTree(tree, (node, parent) => {
    if (node.type === 'heading') {
      const depth = Number(node.depth ?? 1);
      if (
        resolved.capHeadingDepthJumps
        && previousHeadingDepth !== null
        && depth > previousHeadingDepth + 1
      ) {
        node.depth = previousHeadingDepth + 1;
      }
      previousHeadingDepth = Number(node.depth ?? depth);
    }

    if (node.type === 'link' || node.type === 'linkReference') {
      trimLinkPadding(node);
    }

    if (
      resolved.removeEmptyListItems
      && parent
      && parent.children
      && parent.children.length > 0
    ) {
      parent.children = parent.children.filter(child => {
        return !(child.type === 'listItem' && isEmptyListItem(child));
      });
    }
  });
}

function walkTree(
  node: AnyNode,
  visit: (node: AnyNode, parent: AnyNode | null) => void,
  parent: AnyNode | null = null,
): void {
  visit(node, parent);
  if (!node.children) {
    return;
  }
  for (const child of node.children) {
    walkTree(child, visit, node);
  }
}

function trimLinkPadding(node: AnyNode): void {
  const children = node.children;
  if (!children || children.length === 0) {
    return;
  }
  const first = children[0]!;
  const last = children[children.length - 1]!;
  if (first.type === 'text' && typeof first.value === 'string') {
    first.value = first.value.replace(/^\s+/, '');
  }
  if (last.type === 'text' && typeof last.value === 'string') {
    last.value = last.value.replace(/\s+$/, '');
  }
}

function getSingleTextLinkValue(node: {
  children?: unknown[];
}): string | null {
  if (!node || !Array.isArray(node.children) || node.children.length !== 1) {
    return null;
  }
  const [child] = node.children;
  const c = child as {type?: string; value?: unknown};
  if (!c || c.type !== 'text' || typeof c.value !== 'string') {
    return null;
  }
  return c.value;
}

function shouldSerializeAsPlainAutolink(node: {title?: unknown; url?: unknown}, text: string): boolean {
  if (!text || node?.title != null || typeof node?.url !== 'string') {
    return false;
  }
  const isHttpUrl = /^https?:\/\/\S+$/.test(text);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (!isHttpUrl && !isEmail) {
    return false;
  }
  if (isHttpUrl) {
    return node.url === text;
  }
  return node.url === text || node.url === `mailto:${text}`;
}

function unescapeAmpersandsInSerializedUrl(markdown: string): string {
  return markdown.replace(/\\&/g, '&');
}

function isEmptyListItem(node: AnyNode): boolean {
  return !hasMeaningfulContent(node);
}

function hasMeaningfulContent(node: AnyNode): boolean {
  if (typeof node.value === 'string' && node.value.trim().length > 0) {
    return true;
  }
  if (!node.children || node.children.length === 0) {
    return false;
  }
  for (const child of node.children) {
    if (hasMeaningfulContent(child)) {
      return true;
    }
  }
  return false;
}

function collapseInnerSpaces(line: string): string {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const trailing = line.match(/\s*$/)?.[0] ?? '';
  const middle = line.slice(leading.length, line.length - trailing.length);
  return `${leading}${middle.replace(/ {2,}/g, ' ')}${trailing}`;
}

function removeHyphenatedLineBreaks(lines: string[]): string[] {
  const out = lines.slice();
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let i = 0;
  while (i < out.length) {
    const line = out[i]!;
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      i++;
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      i++;
      continue;
    }
    if (inFence) {
      i++;
      continue;
    }
    if (i < out.length - 1) {
      const current = out[i]!;
      const next = out[i + 1]!;
      if (
        shouldJoinHyphenBreak(current, next)
        && /[A-Za-z]-$/.test(current)
        && /^[a-z]/.test(next.trim())
      ) {
        const merged = `${current.replace(/-\s*$/, '')}${next.trimStart()}`;
        out.splice(i, 2, merged);
        continue;
      }
    }
    i++;
  }
  return out;
}

function shouldJoinHyphenBreak(current: string, next: string): boolean {
  if (!current.trim() || !next.trim()) {
    return false;
  }
  if (isFenceBoundary(current) || isFenceBoundary(next)) {
    return false;
  }
  if (isBlockStart(current) || isBlockStart(next)) {
    return false;
  }
  return true;
}

function removeBlankLinesBetweenListItems(lines: string[], bullet: string): string[] {
  const re = listLineRe(bullet);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line !== '') {
      out.push(line);
      continue;
    }

    const previous = out.length > 0 ? out[out.length - 1]! : '';
    const next = i + 1 < lines.length ? lines[i + 1]! : '';
    if (re.test(previous) && re.test(next)) {
      continue;
    }
    out.push(line);
  }
  return out;
}

function advanceAfterBlockquoteBlankLines(out: string[], i: number): number {
  const start = i;
  let end = i;
  while (end + 1 < out.length && isBlockquote(out[end + 1]!)) {
    end++;
  }
  ensureBlankBefore(out, start);
  ensureBlankAfter(out, end);
  return end + 1;
}

function advanceAfterFenceBlankLines(out: string[], i: number): number {
  const start = i;
  let end = i;
  const openingFence = getFence(out[start]!);
  if (openingFence) {
    end++;
    while (end < out.length) {
      const maybeClose = getFence(out[end]!);
      if (
        maybeClose
        && maybeClose.char === openingFence.char
        && maybeClose.len >= openingFence.len
      ) {
        break;
      }
      end++;
    }
  }
  ensureBlankBefore(out, start);
  ensureBlankAfter(out, Math.min(end, out.length - 1));
  return Math.min(end, out.length - 1) + 1;
}

function ensureBlankLinesAroundBlocks(lines: string[]): string[] {
  const out = lines.slice();

  let i = 0;
  while (i < out.length) {
    if (isHeading(out[i]!) || isHorizontalRule(out[i]!)) {
      ensureBlankAroundSingleLineBlock(out, i);
      i++;
      continue;
    }

    if (isBlockquote(out[i]!)) {
      i = advanceAfterBlockquoteBlankLines(out, i);
      continue;
    }

    if (isFenceBoundary(out[i]!)) {
      i = advanceAfterFenceBlankLines(out, i);
      continue;
    }

    const tableEnd = tableEndIndex(out, i);
    if (tableEnd >= i) {
      ensureBlankBefore(out, i);
      ensureBlankAfter(out, tableEnd);
      i = tableEnd + 1;
    } else {
      i++;
    }
  }

  return out;
}

function ensureBlankAroundSingleLineBlock(lines: string[], idx: number): number {
  ensureBlankBefore(lines, idx);
  ensureBlankAfter(lines, idx);
  return idx;
}

function ensureBlankBefore(lines: string[], idx: number): void {
  if (idx <= 0) {
    return;
  }
  if (lines[idx - 1] === '') {
    return;
  }
  lines.splice(idx, 0, '');
}

function ensureBlankAfter(lines: string[], idx: number): void {
  if (idx >= lines.length - 1) {
    return;
  }
  if (lines[idx + 1] === '') {
    return;
  }
  lines.splice(idx + 1, 0, '');
}

function collapseConsecutiveBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && out.length > 0 && out[out.length - 1] === '') {
      continue;
    }
    out.push(line);
  }
  return out;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isBlockquote(line: string): boolean {
  return /^\s*>/.test(line);
}

function isHorizontalRule(line: string): boolean {
  const t = line.trim();
  return /^([-*_])(?:\s*\1){2,}$/.test(t);
}

function isFenceBoundary(line: string): boolean {
  return Boolean(getFence(line));
}

function tableEndIndex(lines: string[], idx: number): number {
  if (idx + 1 >= lines.length) {
    return -1;
  }
  const header = lines[idx]!;
  const divider = lines[idx + 1]!;
  if (!header.includes('|')) {
    return -1;
  }
  if (!/^\s*\|?[\s:-|]+\|?\s*$/.test(divider) || !divider.includes('-')) {
    return -1;
  }

  let end = idx + 1;
  while (
    end + 1 < lines.length
    && lines[end + 1]!.includes('|')
    && lines[end + 1]!.trim() !== ''
  ) {
    end++;
  }
  return end;
}

function isBlockStart(line: string): boolean {
  const t = line.trimStart();
  return (
    /^#{1,6}\s+/.test(t)
    || /^>\s?/.test(t)
    || /^[-*_]{3,}\s*$/.test(t)
    || /^\s*[-+*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || isFenceBoundary(line)
  );
}

function getFence(line: string): {char: string; len: number} | null {
  const m = line.match(/^\s{0,3}([`~]{3,})/);
  if (!m) {
    return null;
  }
  return {char: m[1]![0]!, len: m[1]!.length};
}

function normalizeBulletSpacingLine(
  line: string,
  bullet: string,
  lineRe: RegExp,
): string {
  const {quotePrefix, content} = splitBlockquotePrefix(line);
  if (isHorizontalRule(content)) {
    return line;
  }

  const unescaped = content.replace(/^([ \t]*)\\-\s+/, '$1- ');
  const m = unescaped.match(lineRe);
  if (!m) {
    return `${quotePrefix}${unescaped}`;
  }

  const indent = m[1]!;
  const rest = m[2] ?? '';
  const checklist = rest.match(/^\s*\[([ xX])\](.*)$/);
  if (checklist) {
    const mark = checklist[1]!.toLowerCase() === 'x' ? 'x' : ' ';
    const text = (checklist[2] ?? '').trimStart();
    return `${quotePrefix}${indent}- [${mark}] ${text}`.trimEnd();
  }

  const text = rest.trimStart();
  return `${quotePrefix}${indent}${bullet} ${text}`.trimEnd();
}

function normalizeBulletSpacing(lines: string[], bullet: string): string[] {
  const bEsc = escapeRegExp(bullet);
  const lineRe = new RegExp(`^([ \\t]*)${bEsc}(.*)$`);
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(line);
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    out.push(normalizeBulletSpacingLine(line, bullet, lineRe));
  }

  return out;
}

function normalizeListIndentTabs(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(line);
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const {quotePrefix, content} = splitBlockquotePrefix(line);
    const m = content.match(/^([ \t]+)([-*+] |\d+[.)] )/);
    if (!m) {
      out.push(line);
      continue;
    }

    const oldIndent = m[1]!;
    const newIndent = indentToTabs(oldIndent);
    out.push(`${quotePrefix}${newIndent}${content.slice(oldIndent.length)}`);
  }

  return out;
}

function splitBlockquotePrefix(line: string): {quotePrefix: string; content: string} {
  const m = line.match(/^((?:>\s*)*)(.*)$/);
  if (!m) {
    return {quotePrefix: '', content: line};
  }
  return {quotePrefix: m[1] ?? '', content: m[2] ?? ''};
}

function indentToTabs(indent: string): string {
  let tabCount = 0;
  let spaceRun = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      tabCount += 1;
      tabCount += Math.floor(spaceRun / 4);
      spaceRun = 0;
      continue;
    }
    if (ch === ' ') {
      spaceRun += 1;
    }
  }
  tabCount += Math.floor(spaceRun / 4);
  return '\t'.repeat(tabCount);
}

function protectWikiLinks(text: string): {text: string; tokens: Map<string, string>} {
  const tokens = new Map<string, string>();
  let index = 0;
  const protectedText = text.replace(/\[\[\s*([^\]\n]+?)\s*\]\]/g, (_m, value: string) => {
    const token = `WIKILINKTOKEN${String(index++).padStart(8, '0')}END`;
    tokens.set(token, `[[${value.trim()}]]`);
    return token;
  });
  return {text: protectedText, tokens};
}

function protectHighlights(text: string): {text: string; tokens: Map<string, string>} {
  const tokens = new Map<string, string>();
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let index = 0;

  for (const line of lines) {
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(line);
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const {line: replaced, nextIndex} = protectHighlightsInLine(line, tokens, index);
    index = nextIndex;
    out.push(replaced);
  }

  return {text: out.join('\n'), tokens};
}

function protectHighlightsInLine(
  line: string,
  tokens: Map<string, string>,
  startIndex: number,
): {line: string; nextIndex: number} {
  const codeRanges = collectInlineCodeRanges(line);
  if (codeRanges.length === 0) {
    return protectHighlightsInPlainText(line, tokens, startIndex);
  }

  let index = startIndex;
  let cursor = 0;
  let out = '';
  for (const range of codeRanges) {
    const plain = protectHighlightsInPlainText(line.slice(cursor, range.from), tokens, index);
    out += plain.line;
    index = plain.nextIndex;
    out += line.slice(range.from, range.to);
    cursor = range.to;
  }

  const trailing = protectHighlightsInPlainText(line.slice(cursor), tokens, index);
  out += trailing.line;
  return {line: out, nextIndex: trailing.nextIndex};
}

function protectHighlightsInPlainText(
  text: string,
  tokens: Map<string, string>,
  startIndex: number,
): {line: string; nextIndex: number} {
  let index = startIndex;
  const line = text.replace(/==([^\n=][^\n]*?)==/g, (_m, inner: string) => {
    const token = `HIGHLIGHTTOKEN${String(index++).padStart(8, '0')}END`;
    tokens.set(token, `==${inner}==`);
    return token;
  });
  return {line, nextIndex: index};
}

function collectInlineCodeRanges(line: string): Array<{from: number; to: number}> {
  const ranges: Array<{from: number; to: number}> = [];
  for (let i = 0; i < line.length; ) {
    if (line[i] !== '`') {
      i++;
      continue;
    }

    const openLen = countRun(line, i, '`');
    const close = findMatchingBacktickRun(line, i + openLen, openLen);
    if (close < 0) {
      i += openLen;
      continue;
    }

    const to = close + openLen;
    ranges.push({from: i, to});
    i = to;
  }
  return ranges;
}

function countRun(text: string, from: number, ch: string): number {
  let i = from;
  while (i < text.length && text[i] === ch) {
    i++;
  }
  return i - from;
}

function findMatchingBacktickRun(line: string, from: number, len: number): number {
  for (let i = from; i < line.length; ) {
    if (line[i] !== '`') {
      i++;
      continue;
    }

    const runLen = countRun(line, i, '`');
    if (runLen === len) {
      return i;
    }
    i += runLen;
  }
  return -1;
}

function restoreTokenPlaceholders(
  text: string,
  tokens: Map<string, string>,
): string {
  let output = text;
  for (const [token, value] of tokens.entries()) {
    output = output.split(token).join(value);
  }
  return output;
}

function restoreWikiLinks(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

function restoreHighlights(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

function protectIssueNumberHashes(text: string): {
  text: string;
  tokens: Map<string, string>;
} {
  const tokens = new Map<string, string>();
  let index = 0;
  const protectedText = text.replace(/\\?#\d+\b/g, (match: string) => {
    const token = `ISSUETOKEN${String(index++).padStart(8, '0')}END`;
    tokens.set(token, match);
    return token;
  });
  return {text: protectedText, tokens};
}

function restoreIssueNumberHashes(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

function protectBlockquoteAdmonitions(text: string): {
  text: string;
  tokens: Map<string, string>;
} {
  const tokens = new Map<string, string>();
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let index = 0;

  for (const line of lines) {
    const fence = getFence(line);
    if (fence && !inFence) {
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      out.push(line);
      continue;
    }
    if (fence && inFence && fence.char === fenceChar && fence.len >= fenceLen) {
      inFence = false;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const replaced = line.replace(
      /^((?:>\s*)+)(\[![^\]\s]+\](?:[+-])?)/,
      (_m, quotePrefix: string, header: string) => {
        const token = `ADMONITIONTOKEN${String(index++).padStart(8, '0')}END`;
        tokens.set(token, header);
        return `${quotePrefix}${token}`;
      },
    );
    out.push(replaced);
  }

  return {text: out.join('\n'), tokens};
}

function restoreBlockquoteAdmonitions(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

/** Vitest harness: clear cached remark processors keyed by resolved options. */
export function __resetForTests(): void {
  processorCache.clear();
}
