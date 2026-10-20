// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';
import { createMarkdownRenderModel } from './streamingMarkdownModel';
import { createIncrementalMarkdownDOM } from './incrementalMarkdownDOM';
import { createFlowerMarkdownRenderer } from './markedConfig';
import { createIncrementalCitations } from './incrementalCitations';

function fixture(initial = '', citationSources: readonly import('../../contracts/flowerSurfaceContracts').FlowerCitationSource[] = []) {
  const markdown = createMarkdownParser({ breaks: false });
  markdown.use({ renderer: createFlowerMarkdownRenderer() });
  let streaming = true;
  const citations = createIncrementalCitations(markdown, { sources: () => citationSources, unavailable: () => 'Unavailable', streaming: () => streaming });
  citations.sources();
  const root = document.createElement('div'); document.body.appendChild(root);
  const dispose = vi.fn();
  const dom = createIncrementalMarkdownDOM(markdown, root, () => ({ dispose }), citations.locate, undefined, citations.forget);
  const model = createMarkdownRenderModel(markdown, (update, live) => dom.apply(update, live), { reset: citations.reset, append: citations.index.append });
  let text = initial; const chunks: string[] = [];
  const source = { get length() { return chunks.length; }, get revision() { return chunks.length; }, read: (from: number) => chunks.slice(from) };
  model.update(() => text, true, source);
  return { root, model, markdown, source, dispose, dom, citations,
    append(delta: string) { text += delta; chunks.push(delta); model.update(() => { throw new Error('full source read during append'); }, true, source); },
    finish() { streaming = false; model.update(() => text, false, source); },
    replace(next: string) { text = next; model.update(() => text, false, undefined); },
  };
}
function normalizeHTML(html: string) { const element = document.createElement('div'); element.innerHTML = html; return element.innerHTML; }
function canonicalHTML(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const span of [...copy.querySelectorAll('span:not([class])')].reverse()) span.replaceWith(...span.childNodes);
  return [...copy.children].map(node => node.innerHTML).join('');
}
describe('incremental Markdown DOM', () => {
  it('keeps stable blocks, active text nodes, selection, and copy targets through ordinary appends', () => {
    const f = fixture('Stable\n\nTail');
    const stable = f.root.firstChild; const tail = f.root.lastChild; const text = tail!.firstChild!.firstChild!.firstChild!;
    const selection = window.getSelection()!; const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4); selection.addRange(range);
    for (let i = 0; i < 1000; i++) f.append('x');
    expect(f.root.firstChild).toBe(stable); expect(f.root.lastChild).toBe(tail);
    expect(tail!.firstChild!.firstChild!.firstChild).toBe(text); expect(selection.toString()).toBe('Tail');
    expect(f.root.textContent).toBe('Stable\nTail' + 'x'.repeat(1000) + '\n'); expect(f.model.diagnostics().fullParses).toBe(1);
    f.dom.dispose(); expect(f.root.children).toHaveLength(0);
  });
  it.each(['x'.repeat(1 << 20), '\x60\x60\x60text\n' + 'x'.repeat(1 << 20)])('appends long text/code without full source access, parsing, or replacement', initial => {
    const f = fixture(initial); const node = f.root.firstChild; const before = f.model.diagnostics();
    for (let i = 0; i < 200; i++) f.append(' additional text');
    expect(f.root.firstChild).toBe(node); expect(f.model.diagnostics().parsedCharacters).toBe(before.parsedCharacters);
    expect(f.root.textContent!.length).toBe((initial.startsWith('\x60') ? initial.length - 8 : initial.length + 1) + 200 * 16);
  });
  it('matches authoritative semantics at every random chunk boundary and after completion', () => {
    const cases = [
      '# Title\n\n中文🌸 **bold** [guide][ref]\n\n[ref]: /path\n\nEnd',
      'heading\n===\n\n| a | b |\n| --- | --- |\n| c | d |\n\nDone',
      '- one\n- two\n  - nested\n\n> quote\n> **bold**\n\nEnd',
      '\x60\x60\x60ts\nconst x = 1;\n\x60\x60\x60\n\n![image](/a.png)',
      'plain &amp; <script>alert(1)</script> [link](javascript:alert(1))',
    ];
    for (const source of cases) for (const size of [1, 3, 11]) {
      const f = fixture(); let prefix = '';
      for (let at = 0; at < source.length; at += size) {
        const delta = source.slice(at, at + size); prefix += delta; f.append(delta);
        expect(canonicalHTML(f.root), JSON.stringify({ prefix, size })).toBe(normalizeHTML(String(f.markdown.parse(prefix))));
      }
      f.finish(); expect(canonicalHTML(f.root)).toBe(normalizeHTML(String(f.markdown.parse(source)))); f.dom.dispose();
    }
  });
  it('resolves exact Unicode citation ranges from the same parse and leaves code and escapes literal', () => {
    const marker = '\uE200cite\uE202ref\uE201';
    const f = fixture('', [{ url: 'https://example.com/', title: 'Docs', start_index: 4, end_index: 4 + [...marker].length }]);
    for (const delta of ['你好😀 ', '\uE200', 'cite', '\uE202ref', '\uE201', ' done']) f.append(delta);
    expect(f.root.querySelector('a.flower-chat-citation')?.textContent).toBe('Docs');
    expect(f.citations.remaining()).toEqual([]); expect(f.root.textContent).toBe('你好😀 Docs done\n');
    f.finish(); expect(f.root.textContent).toBe('你好😀 Docs done\n');
    const code = fixture('\x60' + marker + '\x60 \\' + marker);
    expect(code.root.textContent).toContain(marker); expect(code.root.querySelector('.flower-chat-citation-unavailable')).toBeNull();
  });
  it('releases used citation positions when a block is removed or becomes literal code', () => {
    const marker = '\uE200cite\uE202ref\uE201';
    const source = { url: 'https://example.com/', title: 'Docs', start_index: 0, end_index: [...marker].length };
    const f = fixture(marker, [source]);
    expect(f.citations.remaining()).toEqual([]);
    f.replace('plain');
    expect(f.citations.remaining()).toEqual([source]);
    f.dom.dispose();
  });
  it('handles source replacement, deletion, completion, and normalization without stale blocks', () => {
    const f = fixture('old\r'); f.append('\nnew'); f.finish(); expect(f.root.textContent).toBe('old\nnew\n');
    f.replace('changed'); expect(f.root.textContent).toBe('changed\n'); f.replace(''); expect(f.root.textContent).toBe('');
  });
  it.each([
    '> first line\n> second marker MARK\n',
    '| Header | Source |\n| --- | --- |\n| value | MARK |\n',
    '- first\n  - nested MARK\n',
    '> repeated repeated\n> 你好😀 MARK\n',
    '| Source | Literal |\n| --- | --- |\n| MARK | escaped \\| pipe |\n',
  ])('locates citations in nested syntax without a second full lexer: %s', template => {
    const marker = '\uE200cite\uE202nested\uE201';
    const text = template.replace('MARK', marker);
    const start = [...text.slice(0, text.indexOf(marker))].length;
    const f = fixture('', [{ url: 'https://example.com/', title: 'Nested', start_index: start, end_index: start + [...marker].length }]);
    for (const char of text) f.append(char);
    f.finish();
    expect(f.root.querySelector('a.flower-chat-citation')?.textContent).toBe('Nested');
    expect(f.citations.remaining()).toEqual([]);
    f.dom.dispose();
  });
});
