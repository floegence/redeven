import { describe, expect, it, vi } from 'vitest';
import type { Marked } from 'marked';
import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';

import { createFlowerMarkdownRenderer } from './markedConfig';
import { buildMarkdownRenderSnapshot, createMarkdownRenderModel } from './streamingMarkdownModel';

function createMarked(): Marked<string, string> {
  const marked = createMarkdownParser({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer() });
  return marked;
}

describe('buildMarkdownRenderSnapshot', () => {
  it('keeps HTML preview identity from generation through closure and completion', () => {
    const markdown = createMarked();
    const partial = 'Intro\n\n```html preview\n<main>Partial';
    const generating = buildMarkdownRenderSnapshot(markdown, partial, true, true);
    const complete = buildMarkdownRenderSnapshot(markdown, partial + '</main>\n```', false, true);
    const preview = generating.committedSegments.at(-1)!;
    expect(generating.tail.kind).toBe('empty');
    expect(preview.media).toEqual({ html: '<main>Partial', state: 'generating' });
    expect(complete.committedSegments.at(-1)?.key).toBe(preview.key);
    expect(complete.committedSegments.at(-1)?.media).toEqual({ html: '<main>Partial</main>', state: undefined });
    expect(buildMarkdownRenderSnapshot(markdown, partial, false, true).committedSegments.at(-1)?.media?.state).toBe('incomplete');
    expect(buildMarkdownRenderSnapshot(markdown, partial, true, false).tail.kind).toBe('raw');
  });
  it('requires the matching full fence before executing HTML and distinguishes multiple previews', () => {
    const markdown = createMarked();
    for (const fence of ['````', '~~~~']) {
      const short = fence.slice(1);
      const content = fence + 'HTML PREVIEW\n<main>Partial</main>\n' + short;
      const incomplete = buildMarkdownRenderSnapshot(markdown, content, false, true);
      expect(incomplete.committedSegments[0]?.media?.state).toBe('incomplete');
      const complete = buildMarkdownRenderSnapshot(markdown, content + '\n' + fence, true, true);
      expect(complete.committedSegments[0]?.media?.state).toBeUndefined();
    }
    const first = '```html preview\n<p>One</p>\n```\n\n';
    const render = createMarkdownRenderModel(markdown);
    const before = render(first + '```html preview\n<p>Two', true, '', true);
    const after = render(first + '```html preview\n<p>Two</p>\n```\n\nLater text', true, '', true);
    expect(before.committedSegments.map(segment => segment.key)).toEqual(after.committedSegments.map(segment => segment.key));
    expect(before.committedSegments[0]).toBe(after.committedSegments[0]);
    expect(new Set(after.committedSegments.map(segment => segment.key)).size).toBe(2);
  });
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
