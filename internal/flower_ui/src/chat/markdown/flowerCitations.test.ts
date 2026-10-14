import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { flowerMessageTextForCopy, mapFlowerCitationSources, prepareFlowerCitations } from './flowerCitations';
import { createFlowerMarkdownRenderer } from './markedConfig';
const cite = '\uE200cite\uE202turn1view5\uE201';
const content = `你好😀 ${cite} done`;
const source = { title: '<Official> & docs', url: 'https://example.com/docs', start_index: 4, end_index: 4 + [...cite].length };

describe('canonical Flower citations', () => {
  it('binds exact Unicode ranges and safely escapes labels', () => {
    const result = prepareFlowerCitations(content, [source], 'Source unavailable', false);
    expect(result.markdown).not.toContain('turn1view5');
    expect(result.html[0]).toContain('href="https://example.com/docs"');
    expect(result.html[0]).toContain('&lt;Official&gt; &amp; docs');
    expect(result.remaining).toEqual([]);
  });
  it('keeps mismatched positions in the source list without guessing', () => {
    const result = prepareFlowerCitations(content, [{ ...source, start_index: 5 }], 'Unavailable', false);
    expect(result.html).toEqual([]);
    expect(result.remaining).toHaveLength(1);
    expect(result.markdown).toBe('你好😀  done');
  });
  it('supports multiple URLs for one marker and repeated occurrences', () => {
    const repeated = `${cite} ${cite}`;
    const length = [...cite].length;
    const result = prepareFlowerCitations(repeated, [
      { ...source, start_index: 0, end_index: length },
      { ...source, url: 'https://other.example/', start_index: 0, end_index: length },
      { ...source, start_index: length + 1, end_index: length * 2 + 1 },
    ], 'Unavailable', false);
    expect(result.html).toHaveLength(2);
    expect(result.html[0].match(/<a /g)).toHaveLength(2);
    expect(result.remaining).toHaveLength(0);
  });
  it('shows unavailable citations in historical prose and cleans copied text', () => {
    const result = prepareFlowerCitations(content, [], '来源不可用', false);
    expect(result.html[0]).toContain('来源不可用');
    expect(flowerMessageTextForCopy(content)).toBe('你好😀  done');
  });
  it('preserves fenced/inline code, escaped examples and ordinary Markdown', () => {
    const raw = `**bold** [normal](https://example.com)\n\n\`${cite}\`\n\n\`\`\`text\n${cite}\n\`\`\`\n\\${cite}`;
    expect(prepareFlowerCitations(raw, [], 'Unavailable', false).markdown).toBe(raw);
    expect(flowerMessageTextForCopy(raw)).toBe(raw);
    const marked = new Marked({ gfm: true });
    marked.use({ renderer: createFlowerMarkdownRenderer() });
    expect(marked.parse('**我的阅读评价： **')).toContain('**我的阅读评价： **');
  });
  it('hides every split marker prefix while streaming and preserves code prefixes', () => {
    for (let end = 1; end < cite.length; end += 1) {
      expect(prepareFlowerCitations(`answer ${cite.slice(0, end)}`, [], 'Unavailable', true).markdown).toBe('answer ');
    }
    expect(prepareFlowerCitations('```\n\uE200', [], 'Unavailable', true).markdown).toBe('```\n\uE200');
  });
  it('handles interrupted marker prefixes through the same unavailable and copy path', () => {
    const interrupted = 'answer \uE200cite\uE202turn1';
    const result = prepareFlowerCitations(interrupted, [], 'Unavailable', false);
    expect(result.markdown).not.toContain('turn1');
    expect(result.html[0]).toContain('Unavailable');
    expect(flowerMessageTextForCopy(interrupted)).toBe('answer ');
    expect(flowerMessageTextForCopy('```\n\uE200cite')).toBe('```\n\uE200cite');
  });
  it('rejects executable, credentialed and malformed URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/plain,a', 'file:///a', 'https://user:pass@example.com', 'https://example.com/\nx', 'https:///a', '//example.com', 'https://example.com\\@evil.com']) {
      expect(mapFlowerCitationSources([{ url }])).toEqual([]);
    }
  });
});
