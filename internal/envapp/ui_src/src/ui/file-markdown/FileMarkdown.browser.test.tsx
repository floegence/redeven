import '../../index.css';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileMarkdown } from './FileMarkdown';
import { resolveMermaidThemeContext } from './mermaidPlugin';

const RICH_MARKDOWN = [
  '# Markdown rendering',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[User types] --> B{Parser}',
  '  B -->|markdown| C[Marked.js]',
  '  B -->|mermaid block| D[Mermaid]',
  '  B -->|LaTeX| E[KaTeX]',
  '  C --> F[DOMPurify]',
  '  D --> G[SVG]',
  '  E --> H[HTML+MathML]',
  '  F --> I((Preview))',
  '  G --> I',
  '  H --> I',
  '```',
  '',
  "Inline: Euler's identity is $e^{i\\pi} + 1 = 0$.",
  '',
  '$$',
  '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
  '$$',
].join('\n');

function applyTheme(preset: 'classic-dark' | 'classic-light', mode: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.dataset.floeShellTheme = preset;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('style');
});

describe('FileMarkdown rich rendering', () => {
  it('projects CSS Color 4 theme tokens to Mermaid-compatible sRGB colors', () => {
    applyTheme('classic-dark', 'dark');

    const sourceColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--redeven-categorical-graph-6')
      .trim();
    const theme = resolveMermaidThemeContext();

    expect(sourceColor).toMatch(/^oklch\(/u);
    expect(theme.mode).toBe('dark');
    expect(theme.preset).toBe('classic-dark');
    expect(Object.values(theme.variables)).not.toHaveLength(0);
    for (const color of Object.values(theme.variables)) {
      expect(color).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/u);
    }
  });

  it('rejects invalid theme colors instead of forwarding or substituting them', () => {
    applyTheme('classic-dark', 'dark');
    document.documentElement.style.setProperty('--redeven-categorical-graph-8', 'url("https://example.invalid/color")');

    expect(() => resolveMermaidThemeContext()).toThrow(
      'Mermaid theme token --redeven-categorical-graph-8 is not a valid browser color.',
    );
  });

  it('keeps untrusted KaTeX and Markdown content outside executable DOM', () => {
    applyTheme('classic-dark', 'dark');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const content = [
      String.raw`Inline $\href{javascript:alert(1)}{unsafe}$.`,
      '<script>globalThis.markdownExecuted = true</script>',
    ].join('\n\n');
    const dispose = render(() => <FileMarkdown content={content} filePath="/workspace/untrusted.md" />, host);

    try {
      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(host.querySelector('.katex')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('renders Mermaid and one accessible KaTeX presentation across theme changes', async () => {
    applyTheme('classic-dark', 'dark');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <FileMarkdown content={RICH_MARKDOWN} filePath="/workspace/test.md" />, host);

    try {
      await vi.waitFor(() => {
        expect(host.querySelector('.mermaid svg')).toBeTruthy();
      }, { timeout: 10_000 });

      expect(host.querySelector('.fm-mermaid-error')).toBeNull();
      expect(host.querySelector('.fm-preview-warning')).toBeNull();
      const darkSvg = host.querySelector('.mermaid svg')?.outerHTML;
      expect(darkSvg).toContain('User types');

      const mathml = Array.from(host.querySelectorAll<HTMLElement>('.katex-mathml'));
      const html = Array.from(host.querySelectorAll<HTMLElement>('.katex-html'));
      expect(mathml).toHaveLength(2);
      expect(html).toHaveLength(2);
      expect(html.every((element) => element.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(html.every((element) => element.getBoundingClientRect().width > 0)).toBe(true);

      for (const accessibleMath of mathml) {
        const style = getComputedStyle(accessibleMath);
        expect(style.position).toBe('absolute');
        expect(style.clipPath).toBe('inset(50%)');
        expect(style.width).toBe('1px');
        expect(style.height).toBe('1px');
        expect(style.overflow).toBe('hidden');
      }

      applyTheme('classic-light', 'light');
      await vi.waitFor(() => {
        const lightSvg = host.querySelector('.mermaid svg')?.outerHTML;
        expect(lightSvg).toBeTruthy();
        expect(lightSvg).not.toBe(darkSvg);
      }, { timeout: 10_000 });
      expect(host.querySelector('.fm-mermaid-error')).toBeNull();
      expect(host.querySelector('.fm-preview-warning')).toBeNull();
    } finally {
      dispose();
    }
  });
});
