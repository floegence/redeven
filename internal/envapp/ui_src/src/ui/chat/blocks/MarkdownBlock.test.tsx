// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';

import { createMarkdownRenderer } from '../markdown/markedConfig';
import { normalizeMarkdownForDisplay } from '../markdown/normalizeMarkdownForDisplay';
import { buildMarkdownRenderSnapshot } from '../markdown/streamingMarkdownModel';
import { MarkdownBlock } from './MarkdownBlock';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

const renderMarkdownSnapshotMock = vi.fn();
const chatStyles = readFileSync(resolve(process.cwd(), 'src/ui/chat/chat.css'), 'utf8');

vi.mock('../workers/markdownWorkerClient', () => ({
  renderMarkdownSnapshot: (...args: unknown[]) => renderMarkdownSnapshotMock(...args),
}));

function createMarked(): Marked<string, string> {
  const marked = new Marked<string, string>();
  marked.use({ renderer: createMarkdownRenderer() });
  return marked;
}

function createSnapshot(content: string, streaming: boolean) {
  return buildMarkdownRenderSnapshot(createMarked(), content, streaming);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check: () => void): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (err) {
      lastError = err;
      await flushAsync();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

beforeEach(() => {
  renderMarkdownSnapshotMock.mockReset();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('MarkdownBlock', () => {
  it('shows the empty streaming cursor before any content arrives', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content="" streaming />, host);

    const cursor = host.querySelector('[aria-label="Assistant is responding"]');
    expect(cursor).toBeTruthy();
  });

  it('keeps committed segments stable and falls back to raw suffix while a fresher snapshot is pending', async () => {
    const firstContent = 'First paragraph.\n\n## Second';
    const nextContent = 'First paragraph.\n\n## Second block';

    const firstSnapshot = createSnapshot(firstContent, true);
    const secondSnapshot = deferred<ReturnType<typeof createSnapshot>>();

    renderMarkdownSnapshotMock
      .mockResolvedValueOnce(firstSnapshot)
      .mockImplementationOnce(() => secondSnapshot.promise);

    let setContent!: (value: string) => void;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => {
      const [content, updateContent] = createSignal(firstContent);
      setContent = updateContent;
      return <MarkdownBlock content={content()} streaming />;
    }, host);

    await waitFor(() => {
      expect(host.querySelector('h2')?.textContent).toBe('Second');
    });

    setContent(nextContent);
    await flushAsync();

    expect(host.querySelector('h2')).toBeNull();
    expect(host.textContent).toContain('First paragraph.');
    expect(host.textContent).toContain('## Second block');

    secondSnapshot.resolve(createSnapshot(nextContent, true));
    await waitFor(() => {
      expect(host.querySelector('h2')?.textContent).toBe('Second block');
    });
  });

  it('renders the final markdown snapshot when streaming stops', async () => {
    const streamingContent = 'Intro paragraph.\n\n## Title';
    const finalContent = 'Intro paragraph.\n\n## Title\n\n- One\n- Two';

    renderMarkdownSnapshotMock
      .mockResolvedValueOnce(createSnapshot(streamingContent, true))
      .mockResolvedValue(createSnapshot(finalContent, false));

    let setContent!: (value: string) => void;
    let setStreaming!: (value: boolean) => void;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => {
      const [content, updateContent] = createSignal(streamingContent);
      const [streaming, updateStreaming] = createSignal(true);
      setContent = updateContent;
      setStreaming = updateStreaming;
      return <MarkdownBlock content={content()} streaming={streaming()} />;
    }, host);

    await waitFor(() => {
      expect(host.querySelector('h2')?.textContent).toBe('Title');
    });

    batch(() => {
      setContent(finalContent);
      setStreaming(false);
    });
    await waitFor(() => {
      expect(host.querySelectorAll('li')).toHaveLength(2);
    });
    expect(host.textContent).toContain('One');
    expect(host.textContent).toContain('Two');
  });

  it('preserves paragraph spacing across committed markdown segments', async () => {
    const content = 'First paragraph.\n\nSecond paragraph.';
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(content, false));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} />, host);

    await waitFor(() => {
      expect(host.querySelectorAll('p')).toHaveLength(2);
    });

    const paragraphs = Array.from(host.querySelectorAll('p')) as HTMLParagraphElement[];
    expect(chatStyles).toContain('.chat-markdown-block > :last-child p:last-child { margin-bottom: 0; }');
    expect(chatStyles).not.toContain('.chat-markdown-block p:last-child { margin-bottom: 0; }');
    expect(paragraphs[0].matches('.chat-markdown-block > :last-child p:last-child')).toBe(false);
    expect(paragraphs[1].matches('.chat-markdown-block > :last-child p:last-child')).toBe(true);
  });

  it('normalizes malformed markdown boundaries before rendering', async () => {
    const content = '# Title##Chapter One';
    const normalized = normalizeMarkdownForDisplay(content);
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(normalized, false));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} />, host);

    await waitFor(() => {
      expect(renderMarkdownSnapshotMock).toHaveBeenCalledWith(normalized, { streaming: false });
    });
  });

  it('renders repaired chapter headings from malformed transcript fragments', async () => {
    const content = [
      '# 🌟星光森林的秘密##第一章：莉莉的发现在遥远的北方，有一片被繁星眷顾的神秘森林。',
      '',
      '*（全文完）*我将为您创作一篇完整的童话故事。',
    ].join('\n');
    const normalized = normalizeMarkdownForDisplay(content);
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(normalized, false));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} />, host);

    await waitFor(() => {
      expect(host.querySelector('h1')?.textContent).toBe('🌟星光森林的秘密');
      expect(host.querySelector('h2')?.textContent).toBe('第一章：莉莉的发现');
    });

    expect(host.querySelector('p')?.textContent).toContain('在遥远的北方，有一片被繁星眷顾的神秘森林。');
    expect(host.textContent).toContain('（全文完）');
    expect(host.textContent).toContain('我将为您创作一篇完整的童话故事。');
    expect(host.textContent).not.toContain('##第一章');
  });
});
