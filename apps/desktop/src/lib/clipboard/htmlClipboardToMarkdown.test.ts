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
