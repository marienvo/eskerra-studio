import {
  isAsciiWhitespaceCode,
  leadingSpaceTabIndentLen,
  shouldTryJsonParsePrefix,
  trimAsciiWhitespace,
  trimEndAsciiWhitespace,
} from './stringScanners';

/** Inner YAML between outer `---` fences (matches former `extractFrontmatterInner`). */
export function stripYamlFrontmatterOuterFences(frontmatter: string): string {
  let s = frontmatter;
  if (s.startsWith('---')) {
    let i = 3;
    while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) {
      i++;
    }
    if (i < s.length && s.charCodeAt(i) === 10) {
      s = s.slice(i + 1);
    } else if (i + 1 < s.length && s.slice(i, i + 2) === '\r\n') {
      s = s.slice(i + 2);
    } else {
      s = s.slice(i);
    }
  }
  const nl = s.lastIndexOf('\n---');
  if (nl >= 0) {
    let j = nl + 1;
    if (j + 3 <= s.length && s.slice(j, j + 3) === '---') {
      j += 3;
      while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) {
        j++;
      }
      if (j === s.length) {
        return s.slice(0, nl);
      }
    }
  }
  if (s.endsWith('---')) {
    let cut = s.length - 3;
    while (cut > 0 && (s.charCodeAt(cut - 1) === 32 || s.charCodeAt(cut - 1) === 9)) {
      cut--;
    }
    if (cut > 0 && s.charCodeAt(cut - 1) === 10) {
      cut--;
      if (cut > 0 && s.charCodeAt(cut - 1) === 13) {
        cut--;
      }
    }
    return s.slice(0, cut);
  }
  return s;
}

function lineHasYamlKeyColon(line: string, key: string): boolean {
  const i = leadingSpaceTabIndentLen(line);
  if (!line.startsWith(key, i)) {
    return false;
  }
  let j = i + key.length;
  while (j < line.length && isAsciiWhitespaceCode(line.charCodeAt(j))) {
    j++;
  }
  return j < line.length && line.charCodeAt(j) === 58;
}

export function findFirstYamlScalarLineRaw(frontmatter: string, key: string): string | null {
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!lineHasYamlKeyColon(line, key)) {
      continue;
    }
    const i = leadingSpaceTabIndentLen(line);
    let j = i + key.length;
    while (j < line.length && isAsciiWhitespaceCode(line.charCodeAt(j))) {
      j++;
    }
    if (j >= line.length || line.charCodeAt(j) !== 58) {
      continue;
    }
    j++;
    while (j < line.length && isAsciiWhitespaceCode(line.charCodeAt(j))) {
      j++;
    }
    const raw = trimEndAsciiWhitespace(line.slice(j));
    return trimAsciiWhitespace(raw);
  }
  return null;
}

export function parseYamlScalarValue(rawValue: string): unknown {
  if (rawValue.length === 0) {
    return '';
  }
  const singleQuoted =
    rawValue.startsWith('\'') && rawValue.endsWith('\'') && rawValue.length >= 2
      ? rawValue.slice(1, -1).trim()
      : null;
  if (singleQuoted != null) {
    return singleQuoted;
  }
  const shouldTryJson = shouldTryJsonParsePrefix(rawValue);
  if (!shouldTryJson) {
    return rawValue;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function isYamlKeyHeaderChar(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95;
}

function lineLooksLikeYamlKeyAtShallowIndent(line: string, maxIndent: number): boolean {
  const curIndent = leadingSpaceTabIndentLen(line);
  if (curIndent > maxIndent) {
    return false;
  }
  let i = curIndent;
  if (i >= line.length) {
    return false;
  }
  if (!isYamlKeyHeaderChar(line.charCodeAt(i))) {
    return false;
  }
  while (i < line.length && isYamlKeyHeaderChar(line.charCodeAt(i))) {
    i++;
  }
  while (i < line.length && isAsciiWhitespaceCode(line.charCodeAt(i))) {
    i++;
  }
  return i < line.length && line.charCodeAt(i) === 58;
}

function parseYamlListItemPayload(line: string): string | null {
  const i0 = leadingSpaceTabIndentLen(line);
  if (i0 >= line.length || line[i0] !== '-') {
    return null;
  }
  let i = i0 + 1;
  while (i < line.length && isAsciiWhitespaceCode(line.charCodeAt(i))) {
    i++;
  }
  return trimEndAsciiWhitespace(line.slice(i));
}

export function parseYamlListItemsForKey(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  let keyIndent = -1;
  const result: string[] = [];
  for (const line of lines) {
    if (keyIndent < 0) {
      const i = leadingSpaceTabIndentLen(line);
      if (line.startsWith(key, i)) {
        let j = i + key.length;
        while (j < line.length && isAsciiWhitespaceCode(line.charCodeAt(j))) {
          j++;
        }
        if (j < line.length && line.charCodeAt(j) === 58) {
          j++;
          while (j < line.length && isAsciiWhitespaceCode(line.charCodeAt(j))) {
            j++;
          }
          if (j >= line.length) {
            keyIndent = i;
          }
        }
      }
      continue;
    }
    if (trimAsciiWhitespace(line).length === 0) {
      continue;
    }
    const currentIndent = leadingSpaceTabIndentLen(line);
    if (
      currentIndent <= keyIndent
      && (lineLooksLikeYamlKeyAtShallowIndent(line, keyIndent) || trimAsciiWhitespace(line) === '---')
    ) {
      break;
    }
    const raw = parseYamlListItemPayload(line);
    if (raw == null) {
      continue;
    }
    const trimmed = trimAsciiWhitespace(raw);
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith('\'') && trimmed.endsWith('\'') && trimmed.length >= 2) {
      const singleQuoted = trimmed.slice(1, -1).trim();
      if (singleQuoted.length > 0) {
        result.push(singleQuoted);
        continue;
      }
    }
    if (trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          result.push(parsed.trim());
          continue;
        }
      } catch {
        // Keep raw fallback.
      }
    }
    result.push(trimmed);
  }
  return result;
}

export function setYamlInnerScalarKey(inner: string, key: string, value: string): string {
  const lines = inner.split(/\r?\n/);
  const kept = lines.filter(l => !lineHasYamlKeyColon(l, key));
  const newLine = `${key}: ${JSON.stringify(value)}`;
  return [newLine, ...kept].filter(l => trimAsciiWhitespace(l).length > 0).join('\n');
}
