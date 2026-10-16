import { describe, expect, it } from 'vitest';
import { parseFlowerSourceFence, renderFlowerSourceCards } from './flowerSourceCards';

const bibliography = '[1] Hermes v0.22.0\nhttps://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0\n\n[14] Bemula\nhttps://arxiv.org/abs/2610.18052';
const fence = (text = bibliography, lang = 'text') => ({ text, lang, raw: `\`\`\`${lang}\n${text}\n\`\`\`\n` });

describe('Flower source cards', () => {
  it('starts collapsed with a deduplicated website icon summary and compact rows', () => {
    const html = renderFlowerSourceCards([
      { url: 'https://github.com/one' }, { url: 'https://github.com/two' },
      { url: 'https://unknown.example/article' },
    ], { sources: 'Sources' });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('flower-chat-source-sites');
    expect(html.split('data-flower-source-origin="https://github.com"').length - 1).toBe(3);
    expect(html).not.toContain('flower-chat-source-url');
    expect(html).toContain(' hidden');
    expect(renderFlowerSourceCards([], { sources: 'Sources' })).toBe('');
  });

  it('presents an explicit bibliography without changing authored numbering or URLs', () => {
    const sources = parseFlowerSourceFence(fence());
    expect(sources?.map(source => source.number)).toEqual(['1', '14']);
    expect(sources?.[0].title).toBe('Hermes v0.22.0');
    const html = renderFlowerSourceCards(sources!, { sources: 'Sources', copy: 'Copy sources' }, bibliography);
    expect(html).toContain('github.com');
    expect(html).toContain('href="https://arxiv.org/abs/2610.18052"');
    expect(html).toContain('data-flower-source-copy=');
    expect(html).not.toContain('<pre');
  });

  it('keeps code, mixed prose, incomplete fences and ambiguous entries literal', () => {
    for (const token of [
      fence(bibliography, 'python'),
      { ...fence(), raw: `\`\`\`text\n${bibliography}` },
      fence(bibliography + '\nRun this command'),
      fence('[1] title\nhttps://example.com\n[1] other\nhttps://other.example'),
      fence('[0] title\nhttps://example.com'),
      fence('const url = "https://example.com";'),
      fence('[1] title\njavascript:alert(1)'),
      fence('[1] title\nhttps://user:secret@example.com'),
    ]) expect(parseFlowerSourceFence(token)).toBeNull();
    expect(parseFlowerSourceFence(fence(bibliography, ''))).toHaveLength(2);
    expect(parseFlowerSourceFence({ text: bibliography, raw: bibliography })).toBeNull();
  });

  it('escapes source titles, labels and original copy content', () => {
    const text = '[1] <img src=x onerror=alert(1)> & "Title"\nhttps://example.com/?q=%22';
    const html = renderFlowerSourceCards(parseFlowerSourceFence(fence(text))!, { sources: '<Sources>', copy: 'Copy "sources"' }, text);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;Sources&gt;');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
