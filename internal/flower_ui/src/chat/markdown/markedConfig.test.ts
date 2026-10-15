import { describe, expect, it } from 'vitest';
import type { Marked } from 'marked';
import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';

import { createFlowerMarkdownRenderer } from './markedConfig';

function createMarked(): Marked<string, string> {
  const marked = createMarkdownParser({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer() });
  return marked;
}

describe('createFlowerMarkdownRenderer', () => {
  it('renders report labels and quoted CJK emphasis', () => {
    const content = '**为什么值得关注：**这不是单纯增加模型支持。\n\n**注意：**该版本汇总此前补丁周期的改动。\n\n这是**“调用工具”**的例子。';
    const html = createMarked().parse(content);
    expect(html).toContain('<strong>为什么值得关注：</strong>这不是单纯增加模型支持。');
    expect(html).toContain('<strong>注意：</strong>该版本汇总此前补丁周期的改动。');
    expect(html).toContain('这是<strong>“调用工具”</strong>的例子。');
  });

  it('preserves safe nested links and code literals inside CJK text', () => {
    const html = createMarked().parse('这是**“[来源](https://example.com)”**的例子。\n\n**“[危险](javascript:alert(1))”**继续。\n\n`**注意：**正文`\n\n\\*\\*注意：\\*\\*正文');
    expect(html).toContain('这是<strong>“<a href="https://example.com"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<strong>“危险”</strong>继续。');
    expect(html).toContain('<code class="flower-chat-md-inline-code">**注意：**正文</code>');
    expect(html).toContain('<p>**注意：**正文</p>');
  });

  it('keeps invalid whitespace delimiters and existing strikethrough semantics', () => {
    const html = createMarked().parse('**注意： **正文\n\n~~注意： ~~正文\n\n~~deleted~~');
    expect(html).toContain('<p>**注意： **正文</p>');
    expect(html).toContain('<p>~~注意： ~~正文</p>');
    expect(html).toContain('<del>deleted</del>');
    expect(html).not.toContain('<strong>');
  });

  it('keeps relative local report links available for host preview interception', () => {
    const html = createMarked().parse('[Full report](./report.md) and [notes](../notes.txt)');

    expect(html).toContain('href="./report.md"');
    expect(html).toContain('href="../notes.txt"');
    expect(html).not.toContain('target="_blank"');
  });

  it('preserves the first fence language for highlighting, including aliases and escaped input', () => {
    for (const [info, language] of [['Python title=weather.py', 'python'], ['c++', 'c++'], ['c#', 'c#'], ['ts {1,2}', 'ts']]) {
      expect(createMarked().parse('```' + info + '\ncode\n```')).toContain(`data-flower-code-language="${language}"`);
    }
    const escaped = createMarked().parse('```a" onmouseover="run\ncode\n```');
    expect(escaped).toContain('data-flower-code-language="a&quot;"');
    expect(escaped).not.toContain(' onmouseover=');
  });
  it('opts assistant media into inert placeholders and leaves ordinary HTML code alone', () => {
    const marked = createMarkdownParser({ gfm: true, breaks: false });
    marked.use({ renderer: createFlowerMarkdownRenderer({ media: true }) });
    for (const input of ['![Screenshot](computer://browser/' + 'a'.repeat(64) + ')', '![Clip](/project/demo.mp4)', '[Audio](./clip.mp3)', '[Image](./image.png)', '[Report](/project/report.html)', '[Absolute report](/Users/tangjianyin/Downloads/code/test/pelican-ride.html)', '[Relative report](./pelican-ride.html)', '```html preview\n<button>Try me</button>\n```']) {
      const html = marked.parse(input);
      expect(html).toContain('data-floe-markdown-media');
      expect(html).not.toContain('<a ');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<button>');
    }
    expect(marked.parse('```html\n<button>Code only</button>\n```')).not.toContain('data-floe-markdown-media');
    expect(marked.parse('![unsafe](javascript:alert(1))')).not.toContain('data-floe-markdown-media');
  });

  it('keeps external HTML pages navigable instead of creating an unsupported preview', () => {
    const marked = createMarkdownParser({ gfm: true });
    marked.use({ renderer: createFlowerMarkdownRenderer({ media: true }) });
    for (const url of ['https://example.com/announcement.html', 'http://example.com/report.htm?lang=en#details', 'https://example.com/REPORT.HTML']) {
      for (const prefix of ['', '!']) {
        const html = marked.parse(`${prefix}[Announcement](${url})`);
        expect(html).not.toContain('data-floe-markdown-media');
        expect(html).toContain(`href="${url}"`);
        expect(html).toContain('target="_blank" rel="noopener noreferrer"');
        expect(html).not.toContain('<svg');
      }
    }
    for (const url of ['/project/report.html', './report.htm', 'https://example.com/demo.mp4', 'https://example.com/chart.png']) {
      expect(marked.parse(`[Preview](${url})`)).toContain('data-floe-markdown-media');
    }
  });

  it('does not expose incomplete streaming HTML references as links', () => {
    const marked = createMarkdownParser({ gfm: true });
    marked.use({ renderer: createFlowerMarkdownRenderer({ media: true }) });
    const reference = '[Report](/Users/tangjianyin/Downloads/code/test/pelican-ride.html)';
    for (let length = 1; length < reference.length; length++) {
      const html = marked.parse(reference.slice(0, length));
      expect(html).not.toContain('<a ');
      expect(html).not.toContain('data-floe-markdown-media');
    }
    expect(marked.parse(reference)).toContain('data-floe-markdown-media');
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
