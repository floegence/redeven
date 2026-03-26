// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';

import { createMarkdownRenderer } from '../markdown/markedConfig';
import type { MarkdownRendererVariant } from '../markdown/markdownRendererOptions';
import { normalizeMarkdownForDisplay, normalizeMarkdownForStreamingDisplay } from '../markdown/normalizeMarkdownForDisplay';
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

function createMarked(rendererVariant: MarkdownRendererVariant = 'default'): Marked<string, string> {
  const marked = new Marked<string, string>();
  marked.use({ renderer: createMarkdownRenderer({ variant: rendererVariant }) });
  return marked;
}

function createSnapshot(
  content: string,
  streaming: boolean,
  rendererVariant: MarkdownRendererVariant = 'default',
) {
  return buildMarkdownRenderSnapshot(createMarked(rendererVariant), content, streaming);
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

  it('anchors the streaming cursor at the tail of non-empty streaming content', async () => {
    const content = 'Hello **Flower**';
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(content, true));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} streaming />, host);

    await waitFor(() => {
      const block = host.querySelector('.chat-markdown-block');
      expect(block?.lastElementChild?.classList.contains('chat-markdown-streaming-cursor-row')).toBe(true);
      expect(host.querySelector('[aria-label="Assistant is responding"]')).toBeNull();
    });
  });

  it('uses append-safe normalization while content is still streaming', async () => {
    const content = '# Title##Chapter One';
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(content, true));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} streaming />, host);

    await waitFor(() => {
      expect(renderMarkdownSnapshotMock).toHaveBeenCalledWith(
        normalizeMarkdownForStreamingDisplay(content),
        { streaming: true },
      );
    });
  });

  it('keeps the latest rendered markdown tail visible while a fresher snapshot is pending', async () => {
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

    expect(host.querySelector('h2')?.textContent).toBe('Second');
    expect(host.textContent).toContain('First paragraph.');
    expect(host.textContent).not.toContain('## Second block');

    secondSnapshot.resolve(createSnapshot(nextContent, true));
    await waitFor(() => {
      expect(host.querySelector('h2')?.textContent).toBe('Second block');
    });
  });

  it('keeps committed segment DOM nodes stable when fresher snapshots arrive', async () => {
    const firstContent = 'First paragraph.\n\nSecond paragraph.\n\n## Third';
    const nextContent = 'First paragraph.\n\nSecond paragraph.\n\n## Third block';

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

    let committedNode: Element | null = null;
    let committedKey = '';
    await waitFor(() => {
      committedNode = host.querySelector('.chat-markdown-committed-segment');
      committedKey = String(committedNode?.getAttribute('data-segment-key') ?? '');
      expect(committedNode).toBeTruthy();
      expect(committedKey).not.toBe('');
    });

    setContent(nextContent);
    await flushAsync();

    secondSnapshot.resolve(createSnapshot(nextContent, true));
    await waitFor(() => {
      const nextNode = host.querySelector(`[data-segment-key="${committedKey}"]`);
      expect(nextNode).toBe(committedNode);
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

  it('renders file links with line anchors as links instead of headings', async () => {
    const content = [
      'Current behavior is controlled in',
      '[TerminalPanel.tsx](/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx#L1069)',
      'and',
      '[TerminalPanel.tsx](/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx#L1113).',
    ].join(' ');
    const normalized = normalizeMarkdownForDisplay(content);
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(normalized, false));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} />, host);

    await waitFor(() => {
      expect(host.querySelectorAll('a.chat-md-link')).toHaveLength(2);
    });

    const links = Array.from(host.querySelectorAll('a.chat-md-link')) as HTMLAnchorElement[];
    expect(links[0]?.getAttribute('href')).toContain('#L1069');
    expect(links[1]?.getAttribute('href')).toContain('#L1113');
    expect(host.querySelector('h1')?.textContent ?? '').not.toContain('L1069');
    expect(host.querySelector('h1')?.textContent ?? '').not.toContain('L1113');
  });

  it('renders compact file-reference chips for codex markdown links', async () => {
    const content = [
      'Current path is',
      '[controlplaneApi.ts',
      'L278](/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278).',
    ].join(' ');
    const normalized = normalizeMarkdownForDisplay(content);
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(normalized, false, 'codex'));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} class="codex-chat-markdown-block" rendererVariant="codex" />, host);

    await waitFor(() => {
      expect(host.querySelectorAll('.chat-md-file-ref')).toHaveLength(1);
    });

    const fileRef = host.querySelector('.chat-md-file-ref') as HTMLAnchorElement | null;
    expect(fileRef?.getAttribute('href')).toContain('#L278');
    expect(fileRef?.querySelector('.chat-md-file-ref-name')?.textContent).toBe('controlplaneApi.ts');
    expect(fileRef?.querySelector('.chat-md-file-ref-line')?.textContent).toBe('L278');
    expect(renderMarkdownSnapshotMock).toHaveBeenCalledWith(normalized, {
      streaming: false,
      rendererVariant: 'codex',
    });
  });

  it('keeps default markdown link rendering outside codex', async () => {
    const content = '[controlplaneApi.ts\nL278](/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278)';
    const normalized = normalizeMarkdownForDisplay(content);
    renderMarkdownSnapshotMock.mockResolvedValue(createSnapshot(normalized, false));

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MarkdownBlock content={content} />, host);

    await waitFor(() => {
      expect(host.querySelectorAll('a.chat-md-link')).toHaveLength(1);
    });

    expect(host.querySelector('.chat-md-file-ref')).toBeNull();
    expect((host.querySelector('a.chat-md-link') as HTMLAnchorElement | null)?.textContent).toContain('controlplaneApi.ts');
  });
});
