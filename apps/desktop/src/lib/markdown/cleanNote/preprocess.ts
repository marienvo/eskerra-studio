/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
import type {ResolvedCleanNoteOptions} from './types';
import {escapeRegExp, getFence} from './markdownLineUtils';

function collapseInnerSpaces(line: string): string {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const trailing = line.match(/\s*$/)?.[0] ?? '';
  const middle = line.slice(leading.length, line.length - trailing.length);
  return `${leading}${middle.replace(/ {2,}/g, ' ')}${trailing}`;
}

function isFenceBoundary(line: string): boolean {
  return Boolean(getFence(line));
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
  line = line.replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_m, text, url) => `[${String(text).trim()}](${url})`);
  line = line.replace(/\[\[\s*([^\]]*?)\s*\]\]/g, '[[$1]]');

  if (resolved.removeEmptyListItems) {
    const emptyList = new RegExp(`^\\s*${bEsc}\\s*(?:\\[[ xX]\\])?\\s*$`);
    if (emptyList.test(line)) {
      return null;
    }
  }

  return collapseInnerSpaces(line);
}

export function preprocessMarkdown(input: string, resolved: ResolvedCleanNoteOptions): string {
  const b = resolved.bullet;
  const bEsc = escapeRegExp(b);
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  const dupBulletRe = new RegExp(`^((?:>\\s*)*\\s*${bEsc}\\s+)(?:${bEsc}\\s+)+`);
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
