/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
import type {CleanNoteBullet, ResolvedCleanNoteOptions} from './types';
import {escapeRegExp, getFence, listLineRe, splitBlockquotePrefix} from './markdownLineUtils';

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

function removeBlankLinesBetweenListItems(lines: string[], bullet: CleanNoteBullet): string[] {
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
      ensureBlankBefore(out, i);
      ensureBlankAfter(out, i);
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

function normalizeBulletSpacingLine(line: string, bullet: string, lineRe: RegExp): string {
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

function normalizeBulletSpacing(lines: string[], bullet: CleanNoteBullet): string[] {
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

export function postprocessMarkdown(
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
