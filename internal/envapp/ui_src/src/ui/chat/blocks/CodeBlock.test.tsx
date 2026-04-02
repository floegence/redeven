// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LARGE_CODE_FIXTURE } from '../__fixtures__/largeCode';
import { CodeBlock } from './CodeBlock';

const deferredPaintCallbacks = vi.hoisted(() => [] as Array<() => void>);
const highlightCodeToHtmlMock = vi.hoisted(() => vi.fn());
const highlightCodeToHtmlInWorkerMock = vi.hoisted(() => vi.fn());
const hasShikiWorkerSupportMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => {
    deferredPaintCallbacks.push(fn);
  },
}));

vi.mock('../../utils/shikiHighlight', () => ({
  highlightCodeToHtml: (...args: unknown[]) => highlightCodeToHtmlMock(...args),
  resolveCodeHighlightTheme: (resolvedTheme?: string | null) => (resolvedTheme === 'light' ? 'github-light' : 'github-dark'),
}));

vi.mock('../workers/shikiWorkerClient', () => ({
  hasShikiWorkerSupport: () => hasShikiWorkerSupportMock(),
  highlightCodeToHtmlInWorker: (...args: unknown[]) => highlightCodeToHtmlInWorkerMock(...args),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAfterPaint(): Promise<void> {
  while (deferredPaintCallbacks.length > 0) {
    const callback = deferredPaintCallbacks.shift();
    callback?.();
    await flushAsync();
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  deferredPaintCallbacks.length = 0;
  highlightCodeToHtmlMock.mockReset();
  highlightCodeToHtmlInWorkerMock.mockReset();
  hasShikiWorkerSupportMock.mockReset();
  hasShikiWorkerSupportMock.mockReturnValue(true);
});

describe('CodeBlock', () => {
  it('uses the shared highlighter helper for small chat code after paint', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki"><code><span class="line">const value = 1;</span></code></pre>');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodeBlock language="typescript" content="const value = 1;" filename="demo.ts" />, host);

    expect(highlightCodeToHtmlMock).not.toHaveBeenCalled();
    await flushAfterPaint();

    expect(highlightCodeToHtmlMock).toHaveBeenCalledWith({
      code: 'const value = 1;',
      language: 'typescript',
      theme: 'github-dark',
    });
    expect(highlightCodeToHtmlInWorkerMock).not.toHaveBeenCalled();
    expect(host.querySelector('.shiki')).toBeTruthy();
    expect(host.textContent).toContain('demo.ts');
  });

  it('prefers the worker highlighter for large code blocks', async () => {
    highlightCodeToHtmlInWorkerMock.mockResolvedValue('<pre class="shiki worker"><code><span class="line">generated</span></code></pre>');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodeBlock language="typescript" content={LARGE_CODE_FIXTURE} filename="generated.ts" />, host);

    expect(highlightCodeToHtmlInWorkerMock).not.toHaveBeenCalled();
    await flushAfterPaint();

    expect(highlightCodeToHtmlInWorkerMock).toHaveBeenCalledWith(
      LARGE_CODE_FIXTURE,
      'typescript',
      'github-dark',
    );
    expect(highlightCodeToHtmlMock).not.toHaveBeenCalled();
    expect(host.querySelector('.worker')).toBeTruthy();
  });

  it('falls back to plain preformatted text when highlighting is unavailable', async () => {
    highlightCodeToHtmlMock.mockResolvedValue(null);
    hasShikiWorkerSupportMock.mockReturnValue(false);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodeBlock language="bash" content="echo hi" />, host);
    await flushAfterPaint();

    expect(host.querySelector('.chat-code-pre')).toBeTruthy();
    expect(host.textContent).toContain('echo hi');
  });
});
