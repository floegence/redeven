import mermaid from 'mermaid';

const MAX_MERMAID_CACHE_SIZE = 64;

let mermaidThemeKey = '';
let mermaidRenderQueue: Promise<void> = Promise.resolve();
const mermaidSvgCache = new Map<string, string>();

export interface MermaidThemeContext {
  key: string;
  mode: 'dark' | 'light';
  preset: string;
  variables: Record<string, string>;
}

export interface MermaidRunOptions {
  shouldContinue?: () => boolean;
  theme?: MermaidThemeContext;
}

export interface MermaidRenderOptions {
  shouldContinue?: () => boolean;
}

function readSemanticColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function resolveMode(root: HTMLElement, forcedMode?: 'dark' | 'light'): 'dark' | 'light' {
  if (forcedMode) return forcedMode;
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveMermaidThemeContext(
  root: HTMLElement = document.documentElement,
  forcedMode?: 'dark' | 'light',
  forcedPreset?: string,
): MermaidThemeContext {
  const mode = resolveMode(root, forcedMode);
  const style = getComputedStyle(root);
  const light = mode === 'light';
  const background = readSemanticColor(style, '--background', light ? '#ffffff' : '#171b22');
  const foreground = readSemanticColor(style, '--foreground', light ? '#1f2937' : '#f3f4f6');
  const card = readSemanticColor(style, '--card', background);
  const popover = readSemanticColor(style, '--popover', card);
  const muted = readSemanticColor(style, '--muted', card);
  const mutedForeground = readSemanticColor(style, '--muted-foreground', foreground);
  const border = readSemanticColor(style, '--border', mutedForeground);
  const primary = readSemanticColor(style, '--primary', foreground);
  const primaryForeground = readSemanticColor(style, '--primary-foreground', background);
  const accent = readSemanticColor(style, '--accent', muted);
  const categorical = Array.from({ length: 8 }, (_, index) => (
    readSemanticColor(style, `--redeven-categorical-graph-${index + 1}`, [
      primary,
      readSemanticColor(style, '--info', primary),
      readSemanticColor(style, '--success', primary),
      readSemanticColor(style, '--warning', primary),
      readSemanticColor(style, '--error', primary),
      accent,
      mutedForeground,
      foreground,
    ][index] ?? primary)
  ));
  const preset = String(
    forcedPreset
    ?? root.dataset.floeShellTheme
    ?? root.dataset.theme
    ?? mode,
  ).trim() || mode;

  const variables: Record<string, string> = {
    primaryColor: card,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    lineColor: mutedForeground,
    secondaryColor: muted,
    tertiaryColor: accent,
    background,
    mainBkg: card,
    nodeBorder: border,
    clusterBkg: muted,
    clusterBorder: border,
    titleColor: foreground,
    edgeLabelBackground: popover,
    actorBorder: border,
    actorBkg: card,
    actorTextColor: foreground,
    signalColor: foreground,
    signalTextColor: foreground,
    labelTextColor: foreground,
    loopTextColor: foreground,
    noteBorderColor: border,
    noteBkgColor: muted,
    noteTextColor: foreground,
    activationBorderColor: border,
    activationBkgColor: accent,
    sequenceNumberColor: primaryForeground,
    sectionBkgColor: muted,
  };

  categorical.forEach((color, index) => {
    variables[`cScale${index}`] = color;
    variables[`pie${index + 1}`] = color;
    variables[`git${index}`] = color;
  });

  return {
    key: [
      preset,
      mode,
      background,
      foreground,
      card,
      popover,
      muted,
      mutedForeground,
      border,
      primary,
      primaryForeground,
      accent,
      ...categorical,
    ].join('|'),
    mode,
    preset,
    variables,
  };
}

export function setupMermaid(theme: 'dark' | 'light' | MermaidThemeContext): MermaidThemeContext {
  return typeof theme === 'string'
    ? resolveMermaidThemeContext(document.documentElement, theme)
    : theme;
}

function initializeMermaid(context: MermaidThemeContext): void {
  if (mermaidThemeKey === context.key) return;

  // Mermaid configuration is global, so initialization must stay inside the render queue.
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'Inter, system-ui, sans-serif',
    themeVariables: context.variables,
    flowchart: { curve: 'basis', htmlLabels: true },
    sequence: { showSequenceNumbers: false, actorMargin: 50 },
  });
  mermaidThemeKey = context.key;
}

function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const result = mermaidRenderQueue.then(task);
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function mermaidCacheKey(source: string, theme: MermaidThemeContext): string {
  return `${theme.key}:${source}`;
}

function cacheMermaidSvg(key: string, svg: string): void {
  if (mermaidSvgCache.size >= MAX_MERMAID_CACHE_SIZE) {
    const firstKey = mermaidSvgCache.keys().next().value;
    if (firstKey) mermaidSvgCache.delete(firstKey);
  }
  mermaidSvgCache.set(key, svg);
}

type RenderMermaidSvg = {
  (
    source: string,
    id: string,
    theme: MermaidThemeContext,
    options: MermaidRenderOptions,
  ): Promise<string | null>;
  (
    source: string,
    id: string,
    theme?: MermaidThemeContext,
  ): Promise<string>;
};

const renderMermaidSvgImpl = async (
  source: string,
  id: string,
  theme: MermaidThemeContext = resolveMermaidThemeContext(),
  options: MermaidRenderOptions = {},
): Promise<string | null> => {
  const context = setupMermaid(theme);
  const shouldContinue = options.shouldContinue ?? (() => true);
  const key = mermaidCacheKey(source, context);
  if (!shouldContinue()) return null;

  const cached = mermaidSvgCache.get(key);
  if (cached) return cached;

  return enqueueMermaidRender(async () => {
    if (!shouldContinue()) return null;

    const queuedCached = mermaidSvgCache.get(key);
    if (queuedCached) return queuedCached;

    initializeMermaid(context);
    const { svg } = await mermaid.render(id, source);
    if (!shouldContinue()) return null;

    cacheMermaidSvg(key, svg);
    return svg;
  });
};

export const renderMermaidSvg = renderMermaidSvgImpl as RenderMermaidSvg;

export async function runMermaid(root: HTMLElement, options: MermaidRunOptions = {}): Promise<void> {
  const shouldContinue = options.shouldContinue ?? (() => true);
  if (!shouldContinue() || !root.isConnected) return;

  const theme = setupMermaid(options.theme ?? resolveMermaidThemeContext());
  const elements = root.querySelectorAll<HTMLElement>('.mermaid');
  const sandbox = document.createElement('div');
  sandbox.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px;';
  sandbox.className = 'file-markdown-body';
  document.body.appendChild(sandbox);

  try {
    for (const el of elements) {
      if (!shouldContinue() || !root.contains(el) || !el.isConnected) return;
      const src = el.getAttribute('data-mermaid-src');
      if (!src) continue;

      try {
        const code = decodeURIComponent(src);
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const container = document.createElement('div');
        container.id = id;
        sandbox.appendChild(container);

        const svg = await renderMermaidSvg(code, id, theme, {
          shouldContinue: () => (
            shouldContinue()
            && root.contains(el)
            && el.isConnected
          ),
        });
        if (svg === null || !shouldContinue() || !root.contains(el) || !el.isConnected) return;

        el.innerHTML = svg;
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
        container.remove();
      } catch (err) {
        if (!shouldContinue() || !root.contains(el) || !el.isConnected) return;
        const message = err instanceof Error ? err.message : String(err);
        el.innerHTML = renderMermaidError(message, el.getAttribute('data-mermaid-src') ?? '');
      }
    }
  } finally {
    sandbox.remove();
  }
}

function renderMermaidError(message: string, encodedSrc: string): string {
  const decoded = decodeURIComponent(encodedSrc);
  const escapedMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const escapedSrc = decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div class="fm-mermaid-error">
    <div class="fm-mermaid-error-header">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 5a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5ZM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
      <span>Diagram render error</span>
    </div>
    <pre class="fm-mermaid-error-msg">${escapedMsg}</pre>
    <pre class="fm-mermaid-error-src"><code>${escapedSrc}</code></pre>
  </div>`;
}
