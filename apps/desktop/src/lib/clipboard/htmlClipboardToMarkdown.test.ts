import {parseEskerraTableV1FromLines} from '@eskerra/core';
import {describe, expect, it} from 'vitest';

import {
  CLIPBOARD_HTML_MAX_CHARS,
  clipboardHtmlToMarkdown,
  isHtmlWrapperForPasteUrlAsLink,
  tryClipboardHtmlToMarkdownInsert,
} from './htmlClipboardToMarkdown';

describe('isHtmlWrapperForPasteUrlAsLink', () => {
  it('returns true for a single anchor wrapping the same URL as plain text', () => {
    expect(
      isHtmlWrapperForPasteUrlAsLink(
        '<a href="https://example.com/path">https://example.com/path</a>',
        'https://example.com/path',
      ),
    ).toBe(true);
  });

  it('returns true when body text is only the URL (no structure)', () => {
    expect(
      isHtmlWrapperForPasteUrlAsLink(
        '<html><body>https://example.com/x</body></html>',
        'https://example.com/x',
      ),
    ).toBe(true);
  });

  it('returns false when plain is not a single URL token', () => {
    expect(
      isHtmlWrapperForPasteUrlAsLink('<p><a href="https://x.com">x</a></p>', 'hello'),
    ).toBe(false);
  });
});

describe('clipboardHtmlToMarkdown', () => {
  it('converts list and emphasis', () => {
    const md = clipboardHtmlToMarkdown(
      '<ul><li><strong>Bold</strong> and <em>italic</em></li></ul>',
    );
    expect(md).toContain('- ');
    expect(md).toContain('**Bold**');
    expect(md).toContain('*italic*');
  });

  it('converts links', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><a href="https://example.com">Example</a></p>',
    );
    expect(md).toContain('[Example](https://example.com)');
  });

  it('converts a simple table to GFM pipe table', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
        + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(md).toContain('|');
    expect(md).toMatch(/A/);
    expect(md).toMatch(/B/);
  });

  it('converts task list checkboxes', () => {
    const md = clipboardHtmlToMarkdown(
      '<ul><li><input type="checkbox" checked /> Done</li>'
        + '<li><input type="checkbox" /> Todo</li></ul>',
    );
    expect(md).toContain('[x]');
    expect(md).toContain('[ ]');
  });

  it('uses GFM double-tilde strikethrough', () => {
    const md = clipboardHtmlToMarkdown('<p><del>gone</del></p>');
    expect(md).toContain('~~gone~~');
  });

  it('preserves wiki links unescaped', () => {
    const md = clipboardHtmlToMarkdown('<p>See [[My Note]] for details.</p>');
    expect(md).toContain('[[My Note]]');
    expect(md).not.toContain('\\[');
  });

  it('preserves wiki links in list items', () => {
    const md = clipboardHtmlToMarkdown('<ul><li>[[Note A]] and [[Note B]]</li></ul>');
    expect(md).toContain('[[Note A]]');
    expect(md).toContain('[[Note B]]');
  });

  it('strips script tags before conversion', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><script>document.cookie</script>Hello</p>',
    );
    expect(md.toLowerCase()).not.toContain('<script');
    expect(md).not.toContain('document.cookie');
    expect(md).toContain('Hello');
  });

  it('strips event handler attributes from pasted HTML', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><img src="https://example.com/x.png" onerror="alert(1)" alt="x"></p>',
    );
    expect(md).not.toContain('onerror');
    expect(md).not.toContain('alert(');
  });

  it('does not emit Markdown links for javascript: URLs', () => {
    const jsScheme = ['java', 'script', ':'].join('');
    const md = clipboardHtmlToMarkdown(
      `<p><a href="${jsScheme}alert(1)">click</a></p>`,
    );
    expect(md).not.toContain(jsScheme);
  });

  it('converts Slack emoji img tags to Unicode', () => {
    const md = clipboardHtmlToMarkdown(
      '<p>Die zien we te vaak <img alt=":joy:" '
        + 'src="https://a.slack-edge.com/production-standard-emoji-assets/15.0/google-medium/1f602.png"></p>',
    );
    expect(md).toContain('😂');
    expect(md).not.toContain('![:joy:]');
    expect(md).not.toContain('slack-edge.com');
  });

  it('converts Slack emoji img by URL when alt is not a shortcode', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><img alt="custom" '
        + 'src="https://a.slack-edge.com/production-standard-emoji-assets/15.0/google-medium/1f602.png"></p>',
    );
    expect(md).toBe('😂');
    expect(md).not.toContain('slack-edge.com');
  });

  it('keeps non-Slack images as markdown image links', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><img src="https://example.com/foo.png" alt="Foo"></p>',
    );
    expect(md).toContain('![Foo](https://example.com/foo.png)');
  });

  it('expands bare :shortcode: text from HTML paste', () => {
    const md = clipboardHtmlToMarkdown('<p>Die zien we te vaak :joy:</p>');
    expect(md).toContain('😂');
    expect(md).not.toContain(':joy:');
  });

  it('leaves :shortcode: inside code elements literal', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><code>:joy:</code> and</p><pre><code>:joy:</code></pre>',
    );
    expect(md).toContain('`:joy:`');
    const fenceOpen = md.indexOf('```');
    const fenceClose = md.indexOf('```', fenceOpen + 3);
    expect(fenceOpen).toBeGreaterThanOrEqual(0);
    expect(fenceClose).toBeGreaterThan(fenceOpen);
    expect(md.slice(fenceOpen, fenceClose + 3)).toContain(':joy:');
    expect(md).not.toContain('😂');
  });

  it('leaves unknown shortcodes literal', () => {
    const md = clipboardHtmlToMarkdown('<p>:notarealemoji: stays</p>');
    expect(md).toContain(':notarealemoji:');
    expect(md).not.toContain('😂');
  });

  it('converts mark to Eskerra highlight syntax', () => {
    const md = clipboardHtmlToMarkdown('<p><mark>highlight</mark></p>');
    expect(md).toContain('==highlight==');
    expect(md).not.toMatch(/<mark/i);
  });

  it('converts kbd to inline code backticks', () => {
    const md = clipboardHtmlToMarkdown('<p><kbd>Ctrl</kbd>+<kbd>C</kbd></p>');
    expect(md).toContain('`Ctrl`');
    expect(md).toContain('`C`');
    expect(md).not.toMatch(/<kbd/i);
  });

  it('converts standalone pre to fenced code block', () => {
    const md = clipboardHtmlToMarkdown('<pre>raw text</pre>');
    const fenceOpen = md.indexOf('```');
    const fenceClose = md.indexOf('```', fenceOpen + 3);
    expect(fenceOpen).toBeGreaterThanOrEqual(0);
    expect(fenceClose).toBeGreaterThan(fenceOpen);
    expect(md.slice(fenceOpen, fenceClose + 3)).toContain('raw text');
    expect(md).not.toMatch(/<pre/i);
  });

  it('uses GFM highlighted fence for pretty-printed pre>code', () => {
    const md = clipboardHtmlToMarkdown(
      '<pre>\n  <code class="language-javascript">const x = 1;</code>\n</pre>',
    );
    expect(md).toContain('```javascript');
    expect(md).toContain('const x = 1;');
    expect(md).not.toMatch(/```\n\nconst x = 1;/);
  });

  it('uses a longer fence when pre content contains triple backticks', () => {
    const md = clipboardHtmlToMarkdown('<pre>```not a fence```</pre>');
    expect(md).toContain('````\n```not a fence```\n````');
    expect(md).not.toMatch(/^```\n```not/m);
  });

  it('does not expand shortcodes inside a four-backtick pre fence', () => {
    const md = clipboardHtmlToMarkdown('<pre>```\n:joy:\n```</pre>');
    expect(md).toContain('````\n```\n:joy:\n```\n````');
    expect(md).not.toContain('😂');
  });

  it('uses a longer fence when pre content contains indented triple backticks', () => {
    const md = clipboardHtmlToMarkdown('<pre>   ```\nline\n   ```</pre>');
    expect(md).toContain('````\n   ```\nline\n   ```\n````');
    expect(md).not.toMatch(/^```\n {3}```/m);
  });

  it('does not rewrite non-Slack images whose path contains slack-edge.com', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><img src="https://example.com/slack-edge.com/1f602.png" alt="x"></p>',
    );
    expect(md).toContain('![x](https://example.com/slack-edge.com/1f602.png)');
    expect(md).not.toContain('😂');
  });

  it('emits a leading pipe for the first cell when row HTML has whitespace text nodes', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr>\n  <th>A</th>\n  <th>B</th>\n</tr></thead>'
        + '<tbody><tr>\n  <td>1</td>\n  <td>2</td>\n</tr></tbody></table>',
    );
    const pipeRows = md.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    expect(pipeRows[0]).toMatch(/^\| A \| B \|$/);
    expect(pipeRows[2]).toMatch(/^\| 1 \| 2 \|$/);
  });

  it('escapes backslashes before pipes in table cells', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
        + '<tbody><tr><td>a\\\\|b</td><td>c</td></tr></tbody></table>',
    );
    const pipeRows = md.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    expect(pipeRows[2]!.match(/(?<!\\)\|/g)?.length).toBe(3);
    const parsed = parseEskerraTableV1FromLines(pipeRows);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error('Expected pasted table to parse as Eskerra v1');
    }
    expect(parsed.model.cells[1]).toEqual(['a\\\\|b', 'c']);
  });

  it('keeps pre with code child as fenced block', () => {
    const md = clipboardHtmlToMarkdown('<pre><code>fn()</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('fn()');
    expect(md).not.toMatch(/<pre/i);
    expect(md).not.toMatch(/<code/i);
  });

  it('strips tags with no markdown equivalent from paste output', () => {
    const md = clipboardHtmlToMarkdown(
      '<p><u>u</u> <sub>s</sub> <sup>p</sup> <font>x</font></p>'
        + '<details><summary>S</summary>D</details>'
        + '<dl><dt>T</dt><dd>D</dd></dl>',
    );
    expect(md).not.toMatch(/<[a-z]/i);
    expect(md).toContain('u');
    expect(md).toContain('SD');
  });

  it('flattens paragraph-wrapped table cells into one GFM pipe row', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
        + '<tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>',
    );
    const rows = md.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    expect(rows).toContain('| x | y |');
    expect(md.split('\n').filter(line => line.trim() === '|').length).toBe(0);
  });

  it('joins multiple paragraphs in one cell with br inside a single pipe row', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
        + '<tbody><tr><td><p>a</p><p>b</p></td><td>c</td></tr></tbody></table>',
    );
    expect(md).toMatch(/\| a[\s\S]*b \| c \|/);
    expect(md.split('\n').filter(line => line.trim() === '|').length).toBe(0);
  });

  it('flattens paragraph-wrapped header cells', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th><p>Input</p></th><th><p>Output</p></th></tr></thead>'
        + '<tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table>',
    );
    expect(md).toContain('| Input | Output |');
    expect(md.split('\n').filter(line => line.trim() === '|').length).toBe(0);
  });

  it('escapes pipes inside inline code in table cells', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>Input</th><th>Output</th></tr></thead>'
        + '<tbody><tr><td><p><code>&lt;table&gt;</code></p></td>'
        + '<td><p><code>| ... |</code> GFM</p></td></tr></tbody></table>',
    );
    const pipeRows = md.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    expect(pipeRows.length).toBe(3);
    const dataRow = pipeRows[2]!;
    expect(dataRow).toContain('`<table>`');
    expect(dataRow).toContain('`\\| ... \\|`');
    expect(dataRow).toContain('GFM');
    expect(dataRow.match(/(?<!\\)\|/g)?.length).toBe(3);
  });

  it('converts rendered chat-style coverage tables without broken pipe rows', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr>'
        + '<th><p>Input</p></th><th><p>Markdown output</p></th><th><p>Bron</p></th>'
        + '</tr></thead><tbody>'
        + '<tr><td><p><code>&lt;table&gt;</code></p></td>'
        + '<td><p><code>| ... |</code> GFM</p></td>'
        + '<td><p>bestaand (GFM plugin)</p></td></tr>'
        + '<tr><td><p><code>&lt;pre&gt;</code></p></td>'
        + '<td><p>fenced</p></td><td><p>bestaand</p></td></tr>'
        + '</tbody></table>',
    );
    const pipeRows = md.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    const separatorRows = pipeRows.filter(line =>
      /\|\s*---/.test(line) || /---\s*\|/.test(line),
    );
    expect(separatorRows.length).toBe(1);
    expect(pipeRows.length).toBe(4);
    expect(md.split('\n').filter(line => line.trim() === '|').length).toBe(0);
    expect(md).toContain('`<table>`');
    expect(md).toContain('bestaand (GFM plugin)');
  });

  it('keeps non-table paragraphs as separate blocks', () => {
    const md = clipboardHtmlToMarkdown('<p>a</p><p>b</p>');
    expect(md).toContain('a');
    expect(md).toContain('b');
    const blankGap = md.indexOf('\n\n', md.indexOf('a'));
    expect(blankGap).toBeGreaterThanOrEqual(0);
  });

  it('converts HTML tables with line breaks in cells to GFM pipe tables', () => {
    const md = clipboardHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
        + '<tbody><tr><td>a<br>b</td><td>c</td></tr></tbody></table>',
    );
    expect(md).toContain('|');
    expect(md).not.toMatch(/<td/i);
    expect(md).toContain('a');
    expect(md).toContain('b');
    expect(md.indexOf('b')).toBeGreaterThan(md.indexOf('a'));
  });

  it('decodes HTML entities in pasted prose', () => {
    const md = clipboardHtmlToMarkdown('<p>&amp; ok</p>');
    expect(md).toContain('&');
    expect(md).not.toContain('&amp;');
    expect(md).not.toMatch(/<[a-z]/i);
  });
});

describe('tryClipboardHtmlToMarkdownInsert', () => {
  it('returns null for URL-only paste so pasteURLAsLink can run', () => {
    expect(
      tryClipboardHtmlToMarkdownInsert(
        '<meta><a href="https://example.com">https://example.com</a>',
        'https://example.com',
      ),
    ).toBeNull();
  });

  it('returns null when HTML is not structurally interesting', () => {
    expect(tryClipboardHtmlToMarkdownInsert('<span>x</span>', 'x')).toBeNull();
  });

  it('returns null for span-wrapped plain text without real structural tags', () => {
    expect(
      tryClipboardHtmlToMarkdownInsert(
        '<span>hello world</span>',
        'hello world',
      ),
    ).toBeNull();
  });

  it('still treats real <s> strikethrough as structured HTML', () => {
    const out = tryClipboardHtmlToMarkdownInsert('<p><s>x</s></p>', 'x');
    expect(out).toContain('~~');
  });

  it('returns null when converted Markdown matches plain text', () => {
    expect(
      tryClipboardHtmlToMarkdownInsert('<p>hello</p>', 'hello'),
    ).toBeNull();
  });

  it('returns Markdown when structure differs from plain', () => {
    const out = tryClipboardHtmlToMarkdownInsert(
      '<p><strong>x</strong></p>',
      'x',
    );
    expect(out).toContain('**x**');
  });

  it('sanitizes hostile HTML in structured paste before Markdown insert', () => {
    const out = tryClipboardHtmlToMarkdownInsert(
      '<p><strong>Safe</strong><script>document.cookie</script></p>',
      'Safe',
    );
    expect(out).toBeTruthy();
    expect(out!.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('document.cookie');
    expect(out).toContain('**Safe**');
  });

  it('returns Markdown when plain is empty but HTML is structured (WebKit empty text/plain)', () => {
    const out = tryClipboardHtmlToMarkdownInsert(
      '<p><strong>Hi</strong></p>',
      '',
    );
    expect(out).toContain('**Hi**');
  });

  it('returns null when HTML exceeds size limit', () => {
    const huge = `<p><strong>${'a'.repeat(CLIPBOARD_HTML_MAX_CHARS)}</strong></p>`;
    expect(tryClipboardHtmlToMarkdownInsert(huge, '')).toBeNull();
  });
});
