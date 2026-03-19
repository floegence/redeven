// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

const highlightCodeToHtmlMock = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('../../utils/shikiHighlight', () => ({
  highlightCodeToHtml: (...args: unknown[]) => highlightCodeToHtmlMock(...args),
  resolveCodeHighlightTheme: (resolvedTheme?: string | null) => (resolvedTheme === 'light' ? 'github-light' : 'github-dark'),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
  highlightCodeToHtmlMock.mockReset();
});

describe('CodeBlock', () => {
  it('uses the shared highlighter helper for chat code rendering', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki"><code><span class="line">const value = 1;</span></code></pre>');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodeBlock language="typescript" content="const value = 1;" filename="demo.ts" />, host);
    await flushAsync();

    expect(highlightCodeToHtmlMock).toHaveBeenCalledWith({
      code: 'const value = 1;',
      language: 'typescript',
      theme: 'github-dark',
    });
    expect(host.querySelector('.shiki')).toBeTruthy();
    expect(host.textContent).toContain('demo.ts');
  });

  it('falls back to plain preformatted text when highlighting is unavailable', async () => {
    highlightCodeToHtmlMock.mockResolvedValue(null);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodeBlock language="bash" content="echo hi" />, host);
    await flushAsync();

    expect(host.querySelector('.chat-code-pre')).toBeTruthy();
    expect(host.textContent).toContain('echo hi');
  });
});
