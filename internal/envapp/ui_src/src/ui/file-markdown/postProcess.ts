import {
  highlightCodeToHtml,
  resolveCodeHighlightTheme,
  type CodeHighlightTheme,
} from '../utils/shikiHighlight';

export function postProcess(root: HTMLElement): void {
  enhanceCodeBlocks(root);
  protectExternalLinks(root);
}

interface FileMarkdownCodeBlockMeta {
  readonly language: string;
  readonly displayLanguage: string;
  readonly copyText: string;
}

interface FileMarkdownCodeBlockState extends FileMarkdownCodeBlockMeta {
  highlightedTheme?: CodeHighlightTheme;
  pendingTheme?: CodeHighlightTheme;
  requestSeq: number;
}

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  csharp: 'C#',
  cpp: 'C++',
  js: 'JS',
  javascript: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  md: 'Markdown',
  py: 'Python',
  sh: 'Shell',
  shell: 'Shell',
  shellscript: 'Shell',
  ts: 'TS',
  tsx: 'TSX',
  typescript: 'TypeScript',
  yaml: 'YAML',
  yml: 'YAML',
};

const PLAIN_TEXT_LANGUAGES = new Set(['', 'text', 'txt', 'plain', 'plaintext']);
const codeBlockStates = new WeakMap<HTMLPreElement, FileMarkdownCodeBlockState>();

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseCssColor(value: string): RgbColor | null {
  const color = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const raw = hex[1];
    const expanded = raw.length === 3
      ? raw.split('').map((char) => `${char}${char}`).join('')
      : raw;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/i.exec(color);
  if (!rgb) return null;
  const alpha = rgb[4]?.endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4] ?? '1');
  if (alpha <= 0) return null;
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
  };
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  const [linearR, linearG, linearB] = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linearR) + (0.7152 * linearG) + (0.0722 * linearB);
}

function resolveFileMarkdownCodeTheme(pre: HTMLPreElement): CodeHighlightTheme {
  const styles = window.getComputedStyle(pre);
  const surfaceColor = parseCssColor(styles.getPropertyValue('--fm-code-surface')) ?? parseCssColor(styles.backgroundColor);
  if (surfaceColor) {
    return resolveCodeHighlightTheme(relativeLuminance(surfaceColor) < 0.45 ? 'dark' : 'light');
  }

  const colorScheme = `${styles.colorScheme} ${window.getComputedStyle(document.documentElement).colorScheme}`;
  if (/\bdark\b/i.test(colorScheme) && !/\blight\b/i.test(colorScheme)) {
    return resolveCodeHighlightTheme('dark');
  }

  const html = document.documentElement;
  if (html.classList.contains('dark')) return resolveCodeHighlightTheme('dark');
  if (html.classList.contains('light')) return resolveCodeHighlightTheme('light');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  return resolveCodeHighlightTheme(prefersDark ? 'dark' : 'light');
}

function extractCodeBlockMeta(code: HTMLElement): FileMarkdownCodeBlockMeta {
  const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-')) ?? '';
  const language = languageClass.replace(/^language-/, '').trim().toLowerCase();
  const displayLanguage = LANGUAGE_LABELS[language] ?? language;

  return {
    language,
    displayLanguage,
    copyText: code.textContent ?? '',
  };
}

function getCodeBlockState(pre: HTMLPreElement, code: HTMLElement): FileMarkdownCodeBlockState {
  const existing = codeBlockStates.get(pre);
  if (existing) return existing;

  const meta = extractCodeBlockMeta(code);
  const state: FileMarkdownCodeBlockState = {
    ...meta,
    requestSeq: 0,
  };
  codeBlockStates.set(pre, state);
  return state;
}

function restorePlainCode(pre: HTMLPreElement, code: HTMLElement, state: FileMarkdownCodeBlockState): void {
  code.textContent = state.copyText;
  pre.classList.remove('fm-code-block-shiki');
  pre.style.removeProperty('--fm-code-base-color');
  state.highlightedTheme = undefined;
}

function applyShikiHtml(pre: HTMLPreElement, code: HTMLElement, html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const shikiPre = template.content.querySelector<HTMLElement>('pre.shiki');
  const shikiCode = shikiPre?.querySelector<HTMLElement>('code');
  if (!shikiPre || !shikiCode) return false;

  const baseColor = shikiPre.style.color;
  if (baseColor) {
    pre.style.setProperty('--fm-code-base-color', baseColor);
  }

  const highlightedFragment = document.createDocumentFragment();
  for (const child of Array.from(shikiCode.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '') {
      continue;
    }
    highlightedFragment.append(child.cloneNode(true));
  }
  code.replaceChildren(highlightedFragment);
  pre.classList.add('fm-code-block-shiki');
  return true;
}

async function highlightCodeBlock(pre: HTMLPreElement, code: HTMLElement, state: FileMarkdownCodeBlockState): Promise<void> {
  if (PLAIN_TEXT_LANGUAGES.has(state.language) || !state.copyText.trim()) return;

  const theme = resolveFileMarkdownCodeTheme(pre);
  if (state.highlightedTheme === theme) {
    if (state.pendingTheme && state.pendingTheme !== theme) {
      state.requestSeq += 1;
      state.pendingTheme = undefined;
    }
    return;
  }
  if (state.pendingTheme === theme) return;

  state.pendingTheme = theme;
  const requestSeq = (state.requestSeq += 1);

  try {
    const html = await highlightCodeToHtml({
      code: state.copyText,
      language: state.language,
      theme,
    });
    if (requestSeq !== state.requestSeq) return;
    if (!html || !pre.isConnected || !code.isConnected) {
      if (pre.isConnected && code.isConnected) {
        restorePlainCode(pre, code, state);
      }
      return;
    }
    if (applyShikiHtml(pre, code, html)) {
      state.highlightedTheme = theme;
    } else {
      restorePlainCode(pre, code, state);
    }
  } catch {
    if (requestSeq === state.requestSeq && pre.isConnected && code.isConnected) {
      restorePlainCode(pre, code, state);
    }
  } finally {
    if (requestSeq === state.requestSeq && state.pendingTheme === theme) {
      state.pendingTheme = undefined;
    }
  }
}

function enhanceCodeBlocks(root: HTMLElement): void {
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre.fm-code-block > code');

  for (const code of codeBlocks) {
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) {
      continue;
    }

    const state = getCodeBlockState(pre, code);
    void highlightCodeBlock(pre, code, state);

    if (pre.dataset.fmCodeEnhanced === 'true') {
      continue;
    }

    pre.dataset.fmCodeEnhanced = 'true';

    if (!PLAIN_TEXT_LANGUAGES.has(state.language)) {
      const badge = document.createElement('span');
      badge.className = 'fm-code-lang';
      badge.textContent = state.displayLanguage;
      pre.appendChild(badge);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fm-code-copy';
    button.setAttribute('aria-label', 'Copy code');
    button.setAttribute('title', 'Copy code');
    button.textContent = 'Copy';

    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.copyText);
        button.classList.add('fm-copied');
        button.setAttribute('aria-label', 'Code copied');
        button.setAttribute('title', 'Copied');
        button.textContent = 'Copied';
        setTimeout(() => {
          button.classList.remove('fm-copied');
          button.setAttribute('aria-label', 'Copy code');
          button.setAttribute('title', 'Copy code');
          button.textContent = 'Copy';
        }, 1500);
      } catch {
        // Clipboard API not available
      }
    });

    pre.appendChild(button);
  }
}

function protectExternalLinks(root: HTMLElement): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]');
  for (const link of links) {
    if (!link.getAttribute('rel')) {
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
}
