import mermaid from 'mermaid';

let mermaidInitialized = false;
let renderGen = 0;

export function setupMermaid(theme: 'dark' | 'light'): void {
  const themeVars = theme === 'dark'
    ? {
        primaryColor: '#1f2937',
        primaryTextColor: '#e5e7eb',
        primaryBorderColor: '#374151',
        lineColor: '#6b7280',
        secondaryColor: '#111827',
        tertiaryColor: '#0f172a',
        background: '#0b0d12',
        mainBkg: '#1f2937',
        nodeBorder: '#4b5563',
        clusterBkg: '#1f2937',
        clusterBorder: '#374151',
        titleColor: '#f3f4f6',
        edgeLabelBackground: '#1f2937',
        actorBorder: '#6b7280',
        actorBkg: '#1f2937',
        actorTextColor: '#e5e7eb',
        signalColor: '#e5e7eb',
        signalTextColor: '#e5e7eb',
        labelTextColor: '#d1d5db',
        loopTextColor: '#d1d5db',
        noteBorderColor: '#374151',
        noteBkgColor: '#111827',
        noteTextColor: '#e5e7eb',
        activationBorderColor: '#6b7280',
        activationBkgColor: '#1f2937',
        sequenceNumberColor: '#0b0d12',
        sectionBkgColor: '#1f2937',
      }
    : {
        primaryColor: '#f3f4f6',
        primaryTextColor: '#1f2937',
        primaryBorderColor: '#d1d5db',
        lineColor: '#9ca3af',
        secondaryColor: '#f9fafb',
        tertiaryColor: '#f3f4f6',
        background: '#f7f8fb',
        mainBkg: '#ffffff',
        nodeBorder: '#d1d5db',
        clusterBkg: '#f9fafb',
        clusterBorder: '#e5e7eb',
        titleColor: '#0f172a',
        edgeLabelBackground: '#ffffff',
        actorBorder: '#9ca3af',
        actorBkg: '#f9fafb',
        actorTextColor: '#1f2937',
        signalColor: '#1f2937',
        signalTextColor: '#1f2937',
        labelTextColor: '#374151',
        loopTextColor: '#374151',
        noteBorderColor: '#d1d5db',
        noteBkgColor: '#f9fafb',
        noteTextColor: '#1f2937',
        activationBorderColor: '#9ca3af',
        activationBkgColor: '#f3f4f6',
        sequenceNumberColor: '#f7f8fb',
        sectionBkgColor: '#f9fafb',
      };

  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'Inter, system-ui, sans-serif',
    themeVariables: themeVars,
    flowchart: { curve: 'basis', htmlLabels: true },
    sequence: { showSequenceNumbers: false, actorMargin: 50 },
  });
  mermaidInitialized = true;
}

export async function runMermaid(root: HTMLElement): Promise<void> {
  if (!mermaidInitialized) return;

  const gen = (renderGen += 1);
  const elements = root.querySelectorAll<HTMLElement>('.mermaid');

  // Create off-screen sandbox for proper font metrics
  const sandbox = document.createElement('div');
  sandbox.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px;';
  sandbox.className = 'file-markdown-body';
  document.body.appendChild(sandbox);

  try {
    for (const el of elements) {
      if (gen !== renderGen) return;
      const src = el.getAttribute('data-mermaid-src');
      if (!src) continue;

      try {
        const code = decodeURIComponent(src);
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const container = document.createElement('div');
        container.id = id;
        sandbox.appendChild(container);

        const { svg } = await mermaid.render(id, code);
        el.innerHTML = svg;
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }

        container.remove();
      } catch (err) {
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
