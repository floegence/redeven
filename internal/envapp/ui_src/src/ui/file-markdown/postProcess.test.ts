// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { postProcess } from './postProcess';

function createRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('file markdown postProcess', () => {
  it('adds a language badge and copy button to rendered code blocks', () => {
    const root = createRoot('<pre class="fm-code-block"><code class="hljs language-ts">const value = 1;</code></pre>');

    postProcess(root);

    expect(root.querySelector('.fm-code-lang')?.textContent).toBe('TS');
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copy');
    expect(root.querySelector('pre.fm-code-block')?.getAttribute('data-fm-code-enhanced')).toBe('true');
  });

  it('does not add duplicate controls when postProcess runs again', () => {
    const root = createRoot('<pre class="fm-code-block"><code class="hljs language-ts">const value = 1;</code></pre>');

    postProcess(root);
    postProcess(root);

    expect(root.querySelectorAll('.fm-code-lang')).toHaveLength(1);
    expect(root.querySelectorAll('button.fm-code-copy')).toHaveLength(1);
  });

  it('copies code text from the code element instead of a data attribute', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    const root = createRoot('<pre class="fm-code-block"><code class="hljs language-ts"><span class="hljs-keyword">const</span> value = 1;</code></pre>');

    postProcess(root);
    root.querySelector<HTMLButtonElement>('button.fm-code-copy')?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('const value = 1;');
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copied');
    vi.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(root.querySelector('button.fm-code-copy')?.textContent).toBe('Copy');
  });

  it('does not show a language badge for plain text blocks', () => {
    const root = createRoot('<pre class="fm-code-block"><code class="hljs language-text">plain text</code></pre>');

    postProcess(root);

    expect(root.querySelector('.fm-code-lang')).toBeNull();
    expect(root.querySelector('button.fm-code-copy')).toBeTruthy();
  });
});
