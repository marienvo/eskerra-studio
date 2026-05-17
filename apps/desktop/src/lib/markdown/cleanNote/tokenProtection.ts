/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
import {getFence} from './markdownLineUtils';

function restoreTokenPlaceholders(text: string, tokens: Map<string, string>): string {
  let output = text;
  for (const [token, value] of tokens.entries()) {
    output = output.split(token).join(value);
  }
  return output;
}

export function protectWikiLinks(text: string): {text: string; tokens: Map<string, string>} {
  const tokens = new Map<string, string>();
  let index = 0;
  const protectedText = text.replace(/\[\[\s*([^\]\n]+?)\s*\]\]/g, (_m, value: string) => {
    const token = `WIKILINKTOKEN${String(index++).padStart(8, '0')}END`;
    tokens.set(token, `[[${value.trim()}]]`);
    return token;
  });
  return {text: protectedText, tokens};
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

export function protectHighlights(text: string): {text: string; tokens: Map<string, string>} {
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

export function protectIssueNumberHashes(text: string): {
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

export function protectBlockquoteAdmonitions(text: string): {
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

export function restoreWikiLinks(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

export function restoreHighlights(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

export function restoreIssueNumberHashes(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}

export function restoreBlockquoteAdmonitions(text: string, tokens: Map<string, string>): string {
  return restoreTokenPlaceholders(text, tokens);
}
