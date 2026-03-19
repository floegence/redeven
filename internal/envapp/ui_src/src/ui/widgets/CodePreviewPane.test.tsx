// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodePreviewPane } from './CodePreviewPane';

const themeState = vi.hoisted(() => ({
  resolvedTheme: 'dark',
}));
const highlightCodeToHtmlMock = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-core', () => ({
  useTheme: () => ({
    resolvedTheme: () => themeState.resolvedTheme,
  }),
}));

vi.mock('../utils/shikiHighlight', () => ({
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
  themeState.resolvedTheme = 'dark';
});

describe('CodePreviewPane', () => {
  it('renders highlighted HTML with the active app theme', async () => {
    highlightCodeToHtmlMock.mockResolvedValue('<pre class="shiki"><code><span class="line">const value = 1;</span></code></pre>');

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodePreviewPane code="const value = 1;" language="typescript" />, host);
    await flushAsync();

    expect(highlightCodeToHtmlMock).toHaveBeenCalledWith({
      code: 'const value = 1;',
      language: 'typescript',
      theme: 'github-dark',
    });
    expect(host.querySelector('.shiki')).toBeTruthy();
    expect(host.textContent).toContain('typescript');
  });

  it('falls back to plain text and shows a notice when highlighting is disabled for large files', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodePreviewPane code={'x'.repeat(200 * 1024)} language="typescript" />, host);

    expect(highlightCodeToHtmlMock).not.toHaveBeenCalled();
    expect(host.querySelector('pre')).toBeTruthy();
    expect(host.textContent).toContain('Syntax highlighting disabled for large files.');
  });
});
