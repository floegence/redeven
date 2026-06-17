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
    expect(html).toContain('<pre class="flower-chat-md-code-block"><code class="language-ts">const x = &quot;&lt;tag&gt;&quot;');
  });

  it('renders blockquote content through the controlled renderer', () => {
    const html = createMarked().parse('> **bold** <script>x</script>');

    expect(html).toContain('<blockquote class="flower-chat-md-blockquote">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
