// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { postProcess } from './postProcess';

const highlightCodeToHtmlMock = vi.hoisted(() => vi.fn());

vi.mock('../utils/shikiHighlight', () => ({
  highlightCodeToHtml: (...args: unknown[]) => highlightCodeToHtmlMock(...args),
  resolveCodeHighlightTheme: (resolvedTheme?: string | null) => (resolvedTheme === 'light' ? 'github-light' : 'github-dark'),
}));

function createRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark', 'light');
  highlightCodeToHtmlMock.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('file markdown postProcess', () => {
  it('adds a language badge and copy button to rendered code blocks', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki" style="color:#24292f"><code><span class="line"><span style="color:#CF222E">const</span> value = 1;</span></code></pre>');
    document.documentElement.classList.add('light');
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-ts">const value = 1;</code></pre>');

    postProcess(root);
    await flushAsync();

    expect(root.querySelector('.fm-code-lang')?.textContent).toBe('TS');
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copy');
    expect(root.querySelector('pre.fm-code-block')?.getAttribute('data-fm-code-enhanced')).toBe('true');
    expect(root.querySelector('pre.fm-code-block')?.classList.contains('fm-code-block-shiki')).toBe(true);
    expect(root.querySelector<HTMLElement>('pre.fm-code-block')?.style.getPropertyValue('--fm-code-base-color')).toBe('rgb(36, 41, 47)');
    expect(root.querySelector('code')?.innerHTML).toContain('style="color:#CF222E"');
    expect(highlightCodeToHtmlMock).toHaveBeenCalledWith({
      code: 'const value = 1;',
      language: 'ts',
      theme: 'github-light',
    });
  });

  it('chooses the dark Shiki theme from the rendered code surface', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki" style="color:#c9d1d9"><code><span class="line"><span style="color:#ff7b72">const</span> value = 1;</span></code></pre>');
    document.documentElement.classList.add('light');
    const root = createRoot('<pre class="fm-code-block" style="--fm-code-surface:#0d1117"><code class="fm-code-source language-ts">const value = 1;</code></pre>');

    postProcess(root);
    await flushAsync();

    expect(highlightCodeToHtmlMock).toHaveBeenCalledWith({
      code: 'const value = 1;',
      language: 'ts',
      theme: 'github-dark',
    });
  });

  it('removes Shiki formatting whitespace between line nodes', async () => {
    highlightCodeToHtmlMock.mockResolvedValue(`
      <pre class="shiki" style="color:#c9d1d9"><code><span class="line">one</span>
<span class="line">two</span>
      </code></pre>
    `);
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-ts">one\ntwo</code></pre>');

    postProcess(root);
    await flushAsync();

    const code = root.querySelector('code');
    expect(Array.from(code?.childNodes ?? []).map((node) => node.nodeName)).toEqual(['SPAN', 'SPAN']);
    expect(code?.querySelectorAll('.line')).toHaveLength(2);
  });

  it('re-highlights existing code blocks when the rendered surface theme changes', async () => {
    highlightCodeToHtmlMock
      .mockResolvedValueOnce('<pre class="shiki" style="color:#24292f"><code><span class="line"><span style="color:#CF222E">const</span> value = 1;</span></code></pre>')
      .mockResolvedValueOnce('<pre class="shiki" style="color:#c9d1d9"><code><span class="line"><span style="color:#ff7b72">const</span> value = 1;</span></code></pre>');
    const root = createRoot('<pre class="fm-code-block" style="--fm-code-surface:#f7f8fb"><code class="fm-code-source language-ts">const value = 1;</code></pre>');

    postProcess(root);
    await flushAsync();

    const pre = root.querySelector<HTMLPreElement>('pre.fm-code-block');
    const code = root.querySelector<HTMLElement>('code');
    expect(pre).toBeTruthy();
    expect(code?.innerHTML).toContain('style="color:#CF222E"');
    expect(highlightCodeToHtmlMock).toHaveBeenLastCalledWith({
      code: 'const value = 1;',
      language: 'ts',
      theme: 'github-light',
    });

    pre!.style.setProperty('--fm-code-surface', '#0d1117');
    postProcess(root);
    await flushAsync();

    expect(code?.innerHTML).toContain('style="color:#ff7b72"');
    expect(highlightCodeToHtmlMock).toHaveBeenLastCalledWith({
      code: 'const value = 1;',
      language: 'ts',
      theme: 'github-dark',
    });
    expect(root.querySelectorAll('.fm-code-lang')).toHaveLength(1);
    expect(root.querySelectorAll('button.fm-code-copy')).toHaveLength(1);
  });

  it('does not add duplicate controls when postProcess runs again', () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki"><code><span class="line">const value = 1;</span></code></pre>');
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-ts">const value = 1;</code></pre>');

    postProcess(root);
    postProcess(root);

    expect(root.querySelectorAll('.fm-code-lang')).toHaveLength(1);
    expect(root.querySelectorAll('button.fm-code-copy')).toHaveLength(1);
    expect(highlightCodeToHtmlMock).toHaveBeenCalledTimes(1);
  });

  it('copies code text from the code element instead of a data attribute', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki"><code><span class="line"><span style="color:#CF222E">const</span> value = 1;</span></code></pre>');
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-ts">const value = 1;</code></pre>');

    postProcess(root);
    await flushAsync();
    root.querySelector<HTMLButtonElement>('button.fm-code-copy')?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('const value = 1;');
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copied');
    vi.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copy');
  });

  it('does not show a language badge for plain text blocks', () => {
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-text">plain text</code></pre>');

    postProcess(root);

    expect(root.querySelector('.fm-code-lang')).toBeNull();
    expect(root.querySelector('button.fm-code-copy')).toBeTruthy();
    expect(highlightCodeToHtmlMock).not.toHaveBeenCalled();
  });

  it('keeps the escaped source when Shiki cannot render a block', async () => {
    highlightCodeToHtmlMock.mockResolvedValue(null);
    const root = createRoot('<pre class="fm-code-block"><code class="fm-code-source language-madeup">value &amp; more</code></pre>');

    postProcess(root);
    await flushAsync();

    expect(root.querySelector('code')?.textContent).toBe('value & more');
    expect(root.querySelector('pre.fm-code-block')?.classList.contains('fm-code-block-shiki')).toBe(false);
  });
});
