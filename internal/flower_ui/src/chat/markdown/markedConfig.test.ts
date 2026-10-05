import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';

import { createFlowerMarkdownRenderer } from './markedConfig';

function createMarked(): Marked<string, string> {
  const marked = new Marked<string, string>({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer() });
  return marked;
}

describe('createFlowerMarkdownRenderer', () => {
  it('preserves the first fence language for highlighting, including aliases and escaped input', () => {
    for (const [info, language] of [['Python title=weather.py', 'python'], ['c++', 'c++'], ['c#', 'c#'], ['ts {1,2}', 'ts']]) {
      expect(createMarked().parse('```' + info + '\ncode\n```')).toContain(`data-flower-code-language="${language}"`);
    }
    const escaped = createMarked().parse('```a" onmouseover="run\ncode\n```');
    expect(escaped).toContain('data-flower-code-language="a&quot;"');
    expect(escaped).not.toContain(' onmouseover=');
  });
  it('opts assistant media into inert placeholders and leaves ordinary HTML code alone', () => {
    const marked = new Marked<string, string>({ gfm: true });
    marked.use({ renderer: createFlowerMarkdownRenderer({ media: true }) });
    for (const input of ['![Screenshot](computer://browser/' + 'a'.repeat(64) + ')', '![Clip](/project/demo.mp4)', '[Report](/project/report.html)', '```html preview\n<button>Try me</button>\n```']) {
      const html = marked.parse(input);
      expect(html).toContain('data-floe-markdown-media');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<button>');
    }
    expect(marked.parse('```html\n<button>Code only</button>\n```')).not.toContain('data-floe-markdown-media');
    expect(marked.parse('![unsafe](javascript:alert(1))')).not.toContain('data-floe-markdown-media');
  });
  it('escapes raw html and script content', () => {
    const html = createMarked().parse('<script>alert(1)</script>\n\n<div onclick="x">text</div>');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<div');
    expect(html).not.toContain('<div onclick=');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;div onclick=&quot;x&quot;&gt;');
  });

  it('drops unsafe links while preserving their label', () => {
    const html = createMarked().parse('[run](javascript:alert(1)) and [ok](https://example.com)');

    expect(html).not.toContain('javascript:');
    expect(html).toContain('<p>run and ');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes inline and fenced code content', () => {
    const html = createMarked().parse('`<tag>`\n\n```ts\nconst x = "<tag>";\n```');

    expect(html).toContain('<code class="flower-chat-md-inline-code">&lt;tag&gt;</code>');
    expect(html).toContain('<pre class="flower-chat-md-code-block"><code class="language-ts" data-flower-code-language="ts">const x = &quot;&lt;tag&gt;&quot;');
  });

  it('renders blockquote content through the controlled renderer', () => {
    const html = createMarked().parse('> **bold** <script>x</script>');

    expect(html).toContain('<blockquote class="flower-chat-md-blockquote">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
