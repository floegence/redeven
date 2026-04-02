/// <reference lib="webworker" />

import type { ShikiWorkerRequest, ShikiWorkerResponse } from '../types';

type CodeHighlighter = Awaited<ReturnType<(typeof import('shiki'))['createHighlighter']>>;

const SHIKI_THEMES = ['github-dark', 'github-light'] as const;
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
  jsonc: 'json',
  webmanifest: 'json',
  tex: 'latex',
  cs: 'csharp',
  fs: 'fsharp',
  docker: 'dockerfile',
  make: 'makefile',
  gql: 'graphql',
  ps1: 'powershell',
  styl: 'stylus',
  pcss: 'postcss',
};

let highlighterPromise: Promise<CodeHighlighter | null> | null = null;

function normalizeLanguage(language: string): string | undefined {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

async function getHighlighter(): Promise<CodeHighlighter | null> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = import('shiki')
    .then(async (shiki) => shiki.createHighlighter({
      themes: [...SHIKI_THEMES],
      langs: [],
    }))
    .catch((error) => {
      console.error('Failed to initialize Shiki worker highlighter:', error);
      highlighterPromise = null;
      return null;
    });

  return highlighterPromise;
}

async function ensureLanguageLoaded(highlighter: CodeHighlighter, language: string | undefined): Promise<string | undefined> {
  const normalized = normalizeLanguage(language ?? '');
  if (!normalized || normalized === 'text' || normalized === 'plaintext') {
    return normalized;
  }

  const loadedLanguages = highlighter.getLoadedLanguages().map((entry) => String(entry));
  if (loadedLanguages.includes(normalized)) {
    return normalized;
  }

  try {
    await highlighter.loadLanguage(normalized as any);
    return normalized;
  } catch {
    return undefined;
  }
}

postMessage({ type: 'ready' });

addEventListener('message', async (event: MessageEvent<ShikiWorkerRequest>) => {
  const { id, code, language, theme } = event.data;

  try {
    const highlighter = await getHighlighter();
    if (!highlighter) {
      throw new Error('Shiki highlighter is unavailable.');
    }

    const resolvedLanguage = (await ensureLanguageLoaded(highlighter, language)) ?? 'text';
    postMessage({
      id,
      html: highlighter.codeToHtml(code, {
        lang: resolvedLanguage,
        theme,
      }),
    } satisfies ShikiWorkerResponse);
  } catch (error) {
    postMessage({
      id,
      html: '',
      error: error instanceof Error ? error.message : 'Failed to highlight code',
    } satisfies ShikiWorkerResponse);
  }
});
