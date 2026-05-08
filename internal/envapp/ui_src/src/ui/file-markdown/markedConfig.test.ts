import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markedConfig';

describe('file markdown marked renderer', () => {
  it('renders fenced code blocks with the file markdown code structure', () => {
    const html = parseMarkdown('```ts\nconst value = 1 < 2;\n```');

    expect(html).toContain('<pre class="fm-code-block">');
    expect(html).toContain('<code class="fm-code-source language-ts">');
    expect(html).toContain('const value = 1 &lt; 2;');
    expect(html).not.toContain('hljs');
    expect(html).not.toContain('fm-code-block-wrapper');
  });

  it('renders inline code without using the block code structure', () => {
    const html = parseMarkdown('Use `const value = 1` inline.');

    expect(html).toContain('<code class="fm-inline-code">const value = 1</code>');
    expect(html).not.toContain('fm-code-block');
  });

  it('keeps soft line breaks inline so badge images can flow like GitHub markdown', () => {
    const html = parseMarkdown([
      '![Go Version](https://img.shields.io/badge/Go-1.25.9-00ADD8?logo=go)',
      '![Node Version](https://img.shields.io/badge/Node.js-24-339933?logo=node.js)',
    ].join('\n'));

    expect(html).toContain('<p><img class="fm-image"');
    expect(html).toContain('alt="Go Version"');
    expect(html).toContain('alt="Node Version"');
    expect(html).not.toContain('<br>');
  });

  it('still renders explicit hard line breaks inside paragraphs', () => {
    const html = parseMarkdown('First line  \nSecond line');

    expect(html).toContain('First line<br>Second line');
  });

  it('keeps mermaid fences on the mermaid rendering path', () => {
    const html = parseMarkdown('```mermaid\ngraph TD\n  A-->B\n```');

    expect(html).toContain('<div class="mermaid"');
    expect(html).toContain('data-mermaid-src=');
    expect(html).not.toContain('fm-code-block');
  });

  it('renders stable heading ids for the table of contents', () => {
    const html = parseMarkdown('# Hello `Code` & World\n\n## Hello Code\n\n## Hello Code');

    expect(html).toContain('<h1 id="hello-code-world" class="fm-heading">');
    expect(html).toContain('<h2 id="hello-code" class="fm-heading">Hello Code</h2>');
    expect(html).toContain('<h2 id="hello-code-1" class="fm-heading">Hello Code</h2>');
  });

  it('renders GFM alerts with a semantic heading outside the body paragraph', () => {
    const html = parseMarkdown('> [!NOTE]\n> Hello **world**');

    expect(html).toContain('<blockquote class="fm-alert fm-alert-note">');
    expect(html).toContain('<div class="fm-alert-heading">');
    expect(html).toContain('<p>Hello <strong>world</strong></p>');
    expect(html).not.toContain('[!NOTE]');
  });
});
