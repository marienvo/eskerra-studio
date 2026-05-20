import {describe, expect, it} from 'vitest';

import {stripLeakedHtmlInMarkdown} from './stripLeakedHtmlInMarkdown';

function expectNoHtmlTags(md: string): void {
  expect(md).not.toMatch(/<[a-z]/i);
}

describe('stripLeakedHtmlInMarkdown', () => {
  it('strips unknown tags and keeps inner text', () => {
    expect(stripLeakedHtmlInMarkdown('<u>x</u>')).toBe('x');
    expect(stripLeakedHtmlInMarkdown('<font color="red">x</font>')).toBe('x');
    expect(stripLeakedHtmlInMarkdown('<details><summary>S</summary>D</details>')).toBe(
      'SD',
    );
  });

  it('removes br tags outside GFM table rows', () => {
    expect(stripLeakedHtmlInMarkdown('line one<br>line two')).toBe('line oneline two');
  });

  it('preserves br tags inside GFM table rows', () => {
    const md = '| a<br>b | c |';
    expect(stripLeakedHtmlInMarkdown(md)).toBe(md);
  });

  it('leaves fenced code blocks literal', () => {
    const md = '```\n<u>x</u>\n```';
    expect(stripLeakedHtmlInMarkdown(md)).toBe(md);
  });

  it('leaves inline code literal', () => {
    const md = 'use `<u>x</u>` here';
    expect(stripLeakedHtmlInMarkdown(md)).toBe(md);
  });

  it('decodes common HTML entities in prose', () => {
    expect(stripLeakedHtmlInMarkdown('&amp; &lt; &gt; &nbsp;')).toBe('& < >  ');
    expect(stripLeakedHtmlInMarkdown('&#39; &quot;')).toBe("' \"");
  });

  it('strips tags and decodes entities together', () => {
    const out = stripLeakedHtmlInMarkdown('<p>&amp; ok</p>');
    expectNoHtmlTags(out);
    expect(out).toContain('&');
    expect(out).not.toContain('&amp;');
  });
});
