const TRIANGLE = '\u25B6';
const VS16 = '\uFE0F';

/** `[▶]` / `[▶️]` markdown links with URL in `(...)`. */
export function scanPlayTriangleMarkdownLinks(line: string): Array<{url: string; start: number}> {
  const out: Array<{url: string; start: number}> = [];
  let i = 0;
  while (i < line.length) {
    const openBracket = line.indexOf('[', i);
    if (openBracket < 0) {
      break;
    }
    if (openBracket + 1 >= line.length || line[openBracket + 1] !== TRIANGLE) {
      i = openBracket + 1;
      continue;
    }
    let p = openBracket + 2;
    if (p < line.length && line[p] === VS16) {
      p++;
    }
    if (p >= line.length || line[p] !== ']') {
      i = openBracket + 1;
      continue;
    }
    p++;
    if (p >= line.length || line[p] !== '(') {
      i = openBracket + 1;
      continue;
    }
    const hrefStart = p + 1;
    let q = hrefStart;
    while (q < line.length) {
      const c = line[q]!;
      if (c === '\\' && q + 1 < line.length) {
        q += 2;
        continue;
      }
      if (c === ')') {
        if (q > hrefStart) {
          out.push({url: line.slice(hrefStart, q), start: openBracket});
        }
        i = q + 1;
        break;
      }
      q++;
    }
    if (q >= line.length) {
      i = openBracket + 1;
    }
  }
  return out;
}
