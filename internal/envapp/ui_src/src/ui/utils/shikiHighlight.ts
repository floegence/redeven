// Shared Shiki-based syntax highlighting utilities for Redeven Env App surfaces.

export type CodeHighlightTheme = 'github-dark' | 'github-light';

type CodeHighlighter = Awaited<ReturnType<(typeof import('shiki'))['createHighlighter']>>;

const SHIKI_THEMES: CodeHighlightTheme[] = ['github-dark', 'github-light'];
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
  tex: 'latex',
  cs: 'csharp',
  fs: 'fsharp',
  docker: 'dockerfile',
  make: 'makefile',
};

let highlighterPromise: Promise<CodeHighlighter | null> | null = null;

export function resolveCodeHighlightTheme(resolvedTheme?: string | null): CodeHighlightTheme {
  return resolvedTheme === 'light' ? 'github-light' : 'github-dark';
}

export function normalizeCodeLanguage(language?: string | null): string | undefined {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

async function getHighlighter(): Promise<CodeHighlighter | null> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = import('shiki')
    .then(async (shiki) => shiki.createHighlighter({
      themes: SHIKI_THEMES,
      langs: [],
    }))
    .catch((error) => {
      console.error('Failed to initialize Shiki highlighter:', error);
      highlighterPromise = null;
      return null;
    });

  return highlighterPromise;
}

async function ensureLanguageLoaded(highlighter: CodeHighlighter, language?: string): Promise<string | undefined> {
  const normalized = normalizeCodeLanguage(language);
  if (!normalized || normalized === 'text' || normalized === 'plaintext') return normalized;

  const loadedLanguages = highlighter.getLoadedLanguages().map((entry) => String(entry));
  if (loadedLanguages.includes(normalized)) return normalized;

  try {
    await highlighter.loadLanguage(normalized as any);
    return normalized;
  } catch {
    return undefined;
  }
}

export async function highlightCodeToHtml(params: {
  code: string;
  language?: string;
  theme: CodeHighlightTheme;
}): Promise<string | null> {
  if (!params.code) return '';

  const highlighter = await getHighlighter();
  if (!highlighter) return null;

  try {
    const lang = (await ensureLanguageLoaded(highlighter, params.language)) ?? 'text';
    return highlighter.codeToHtml(params.code, {
      lang,
      theme: params.theme,
    });
  } catch (error) {
    console.error('Shiki highlight error:', error);
    return null;
  }
}
