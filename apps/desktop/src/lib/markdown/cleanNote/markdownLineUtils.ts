/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function listLineRe(bullet: string): RegExp {
  const b = escapeRegExp(bullet);
  return new RegExp(`^\\s*(?:${b}|\\d+[.)])\\s+`);
}

export function getFence(line: string): {char: string; len: number} | null {
  const m = line.match(/^\s{0,3}([`~]{3,})/);
  if (!m) {
    return null;
  }
  return {char: m[1]![0]!, len: m[1]!.length};
}

export function splitBlockquotePrefix(line: string): {quotePrefix: string; content: string} {
  const m = line.match(/^((?:>\s*)*)(.*)$/);
  if (!m) {
    return {quotePrefix: '', content: line};
  }
  return {quotePrefix: m[1] ?? '', content: m[2] ?? ''};
}
