import mermaid from 'mermaid';

const MAX_MERMAID_CACHE_SIZE = 64;
const MERMAID_COLOR_TOKENS = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  popover: '--popover',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--accent',
} as const;
const MERMAID_CATEGORICAL_COLOR_TOKENS = Array.from(
  { length: 8 },
  (_, index) => `--redeven-categorical-graph-${index + 1}`,
);

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

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function resolveMermaidColors(root: HTMLElement): Record<string, string> {
  const rootStyle = getComputedStyle(root);
  const document = root.ownerDocument;
  const host = document.body && root.contains(document.body) ? document.body : root;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  host.appendChild(probe);

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) {
    probe.remove();
    throw new Error('Mermaid theme color projection requires a 2D canvas context.');
  }

  const projectToken = (token: string): string => {
    const declared = rootStyle.getPropertyValue(token).trim();
    if (!declared) {
      throw new Error(`Mermaid theme requires the ${token} color token.`);
    }
    if (!document.defaultView?.CSS.supports('color', declared)) {
      throw new Error(`Mermaid theme token ${token} is not a valid browser color.`);
    }

    probe.style.color = `var(${token})`;
    const resolved = getComputedStyle(probe).color.trim();
    if (!resolved) {
      throw new Error(`Mermaid theme could not resolve the ${token} color token.`);
    }

    const invalidColorSentinel = context.createLinearGradient(0, 0, 1, 1);
    context.fillStyle = invalidColorSentinel;
    context.fillStyle = resolved;
    if (typeof context.fillStyle !== 'string') {
      throw new Error(`Mermaid theme token ${token} is not a valid browser color.`);
    }

    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}${alpha < 255 ? byteToHex(alpha) : ''}`;
  };

  try {
    return Object.fromEntries([
      ...Object.entries(MERMAID_COLOR_TOKENS),
      ...MERMAID_CATEGORICAL_COLOR_TOKENS.map((token, index) => [`categorical${index + 1}`, token]),
    ].map(([name, token]) => [name, projectToken(token)]));
  } finally {
    probe.remove();
  }
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
  const colors = resolveMermaidColors(root);
  const background = colors.background;
  const foreground = colors.foreground;
  const card = colors.card;
  const popover = colors.popover;
  const muted = colors.muted;
  const mutedForeground = colors.mutedForeground;
  const border = colors.border;
  const primary = colors.primary;
  const primaryForeground = colors.primaryForeground;
  const accent = colors.accent;
  const categorical = MERMAID_CATEGORICAL_COLOR_TOKENS.map((_, index) => colors[`categorical${index + 1}`]);
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

function initializeMermaid(context: MermaidThemeContext): void {
  if (mermaidThemeKey === context.key) return;

  // Mermaid configuration is global, so initialization must stay inside the render queue.
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'Inter, system-ui, sans-serif',
    themeVariables: context.variables,
    flowchart: { curve: 'basis', htmlLabels: false },
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
  const shouldContinue = options.shouldContinue ?? (() => true);
  const key = mermaidCacheKey(source, theme);
  if (!shouldContinue()) return null;

  const cached = mermaidSvgCache.get(key);
  if (cached) return cached;

  return enqueueMermaidRender(async () => {
    if (!shouldContinue()) return null;

    const queuedCached = mermaidSvgCache.get(key);
    if (queuedCached) return queuedCached;

    initializeMermaid(theme);
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

  const theme = options.theme ?? resolveMermaidThemeContext();
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
        const id = `mermaid-${crypto.randomUUID()}`;
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

        const svgDocument = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const svgRoot = svgDocument.documentElement;
        if (!svgRoot || svgRoot.tagName.toLowerCase() !== 'svg' || svgDocument.querySelector('parsererror')) {
          throw new Error('Mermaid returned invalid SVG.');
        }
        svgRoot.querySelectorAll('script, foreignObject, [onload], [onclick], [onerror]').forEach((node) => node.remove());
        svgRoot.querySelectorAll('[href], [xlink\\:href]').forEach((node) => {
          const href = node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? '';
          if (/^javascript:/iu.test(href.trim())) node.removeAttribute('href');
          node.removeAttribute('xlink:href');
        });
        const importedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        // Preserve Mermaid's safe presentation attributes across document
        // boundaries (some DOM implementations drop custom data attributes).
        for (const attribute of Array.from(svgRoot.attributes)) {
          importedSvg.setAttribute(attribute.name, attribute.value);
        }
        for (const child of Array.from(svgRoot.childNodes)) {
          importedSvg.appendChild(document.importNode(child, true));
        }
        el.replaceChildren(importedSvg);
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
