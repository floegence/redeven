import { describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';

import { createFlowerMarkdownRenderer } from './markedConfig';
import { buildMarkdownRenderSnapshot, createMarkdownRenderModel } from './streamingMarkdownModel';

function createMarked(): Marked<string, string> {
  const marked = new Marked<string, string>({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer() });
  return marked;
}

describe('buildMarkdownRenderSnapshot', () => {
  it('commits all rendered segments for complete markdown', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), '# Title\n\n- one\n- two', false);

    expect(snapshot.sourceLength).toBe('# Title\n\n- one\n- two'.length);
    expect(snapshot.committedSourceLength).toBe(snapshot.sourceLength);
    expect(snapshot.tail.kind).toBe('empty');
    expect(snapshot.committedSegments.map((segment) => segment.html).join('')).toContain('<h1>Title</h1>');
    expect(snapshot.committedSegments.map((segment) => segment.html).join('')).toContain('<ul>');
  });

  it('keeps the last open paragraph as html tail while streaming', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), '# Stable\n\nTail **bo', true);

    expect(snapshot.committedSegments).toHaveLength(1);
    expect(snapshot.committedSegments[0]?.html).toContain('<h1>Stable</h1>');
    expect(snapshot.tail.kind).toBe('html');
    if (snapshot.tail.kind !== 'html') throw new Error('expected html tail');
    expect(snapshot.tail.html).toContain('Tail **bo');
  });

  it('uses raw tail for unclosed fenced code while streaming', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), 'Intro\n\n```ts\nconst a = 1;', true);

    expect(snapshot.committedSegments).toHaveLength(1);
    expect(snapshot.committedSegments[0]?.html).toContain('Intro');
    expect(snapshot.tail).toEqual({
      kind: 'raw',
      key: `${'Intro\n\n'.length}:${'Intro\n\n```ts\nconst a = 1;'.length}:raw-code`,
      text: '```ts\nconst a = 1;',
    });
  });

  it('renders closed fenced code as a streaming html tail', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), 'Intro\n\n```ts\nconst a = 1;\n```', true);

    expect(snapshot.committedSegments).toHaveLength(1);
    expect(snapshot.tail.kind).toBe('html');
    if (snapshot.tail.kind !== 'html') throw new Error('expected html tail');
    expect(snapshot.tail.html).toContain('flower-chat-md-code-block');
  });

  it('keeps committed segment keys stable when only the tail grows', () => {
    const first = buildMarkdownRenderSnapshot(createMarked(), '# Stable\n\nTail', true);
    const second = buildMarkdownRenderSnapshot(createMarked(), '# Stable\n\nTail grows', true);

    expect(first.committedSegments.map((segment) => segment.key)).toEqual(
      second.committedSegments.map((segment) => segment.key),
    );
  });
});

describe('incremental markdown rendering', () => {
  it('lexes the full source but reuses unchanged token HTML across 300 appends', () => {
    const markdown = createMarked();
    const lexer = vi.spyOn(markdown, 'lexer');
    const parser = vi.spyOn(markdown, 'parser');
    const render = createMarkdownRenderModel(markdown);
    const prefix = Array.from({ length: 200 }, (_, index) => `Paragraph ${index}\n\n`).join('');
    const first = render(`${prefix}tail`, true);
    const initialParses = parser.mock.calls.length;
    for (let index = 1; index <= 300; index += 1) {
      const next = render(`${prefix}tail ${index}`, true);
      expect(next.committedSegments).toBe(first.committedSegments);
    }
    expect(lexer).toHaveBeenCalledTimes(301);
    expect(parser.mock.calls.length - initialParses).toBe(300);
  });

  it('invalidates reference definitions, replacements and completion without stale HTML', () => {
    const markdown = createMarked();
    const render = createMarkdownRenderModel(markdown);
    for (const [content, streaming] of [
      ['[guide][ref]\n\nTail', true],
      ['[guide][ref]\n\nTail\n\n[ref]: https://example.com/one', true],
      ['[guide][ref]\n\nTail\n\n[ref]: https://example.com/two', true],
      ['Changed\n\n```ts\nconst value = 1;', true],
      ['Changed\n\n```ts\nconst value = 1;\n```', true],
      ['Changed\n\n```ts\nconst value = 1;\n```', false],
      ['', false],
    ] as const) {
      expect(render(content, streaming)).toEqual(buildMarkdownRenderSnapshot(markdown, content, streaming));
    }
  });
});
