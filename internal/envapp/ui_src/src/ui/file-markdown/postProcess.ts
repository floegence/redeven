export function postProcess(root: HTMLElement): void {
  enhanceCodeBlocks(root);
  protectExternalLinks(root);
}

interface FileMarkdownCodeBlockMeta {
  readonly language: string;
  readonly displayLanguage: string;
  readonly copyText: string;
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

function enhanceCodeBlocks(root: HTMLElement): void {
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre.fm-code-block > code');

  for (const code of codeBlocks) {
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement) || pre.dataset.fmCodeEnhanced === 'true') {
      continue;
    }

    pre.dataset.fmCodeEnhanced = 'true';
    const meta = extractCodeBlockMeta(code);

    if (!PLAIN_TEXT_LANGUAGES.has(meta.language)) {
      const badge = document.createElement('span');
      badge.className = 'fm-code-lang';
      badge.textContent = meta.displayLanguage;
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
        await navigator.clipboard.writeText(meta.copyText);
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
