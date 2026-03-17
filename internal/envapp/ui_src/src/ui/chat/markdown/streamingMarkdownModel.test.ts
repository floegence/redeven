import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';

import { createMarkdownRenderer } from './markedConfig';
import { buildMarkdownRenderSnapshot } from './streamingMarkdownModel';

function createMarked(): Marked<string, string> {
  const marked = new Marked<string, string>();
  marked.use({ renderer: createMarkdownRenderer() });
  return marked;
}

describe('buildMarkdownRenderSnapshot', () => {
  it('returns an empty snapshot for empty content', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), '', true);

    expect(snapshot.committedSegments).toEqual([]);
    expect(snapshot.committedSourceLength).toBe(0);
    expect(snapshot.tail.kind).toBe('empty');
  });

  it('keeps a single paragraph as the live tail while streaming', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), 'Hello **Flower**', true);

    expect(snapshot.committedSegments).toEqual([]);
    expect(snapshot.committedSourceLength).toBe(0);
    expect(snapshot.tail.kind).toBe('html');
    expect(snapshot.tail.kind === 'html' ? snapshot.tail.html : '').toContain('<p>');
    expect(snapshot.tail.kind === 'html' ? snapshot.tail.html : '').toContain('<strong>Flower</strong>');
  });

  it('commits earlier top-level blocks once a new block starts', () => {
    const snapshot = buildMarkdownRenderSnapshot(
      createMarked(),
      'First paragraph.\n\n## Second block',
      true,
    );

    expect(snapshot.committedSegments).toHaveLength(1);
    expect(snapshot.committedSegments[0]?.html).toContain('<p>First paragraph.</p>');
    expect(snapshot.committedSourceLength).toBe('First paragraph.\n\n'.length);
    expect(snapshot.tail.kind).toBe('html');
    expect(snapshot.tail.kind === 'html' ? snapshot.tail.html : '').toContain('<h2>Second block</h2>');
  });

  it('commits the current block when streaming content ends with blank space', () => {
    const snapshot = buildMarkdownRenderSnapshot(createMarked(), 'First paragraph.\n\n', true);

    expect(snapshot.committedSegments).toHaveLength(1);
    expect(snapshot.committedSourceLength).toBe('First paragraph.\n\n'.length);
    expect(snapshot.tail.kind).toBe('empty');
  });

  it('commits the full document when streaming finishes', () => {
    const snapshot = buildMarkdownRenderSnapshot(
      createMarked(),
      'First paragraph.\n\n- One\n- Two',
      false,
    );

    expect(snapshot.committedSourceLength).toBe('First paragraph.\n\n- One\n- Two'.length);
    expect(snapshot.committedSegments).toHaveLength(2);
    expect(snapshot.committedSegments[0]?.html).toContain('<p>First paragraph.</p>');
    expect(snapshot.committedSegments[1]?.html).toContain('<ul>');
    expect(snapshot.tail.kind).toBe('empty');
  });
});
