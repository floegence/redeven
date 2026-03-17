// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';

import { createMarkdownRenderer } from '../markdown/markedConfig';
import { buildMarkdownRenderSnapshot } from '../markdown/streamingMarkdownModel';
import { MarkdownBlock } from './MarkdownBlock';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

const renderMarkdownSnapshotMock = vi.fn();

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
});
