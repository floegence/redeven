import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

export type CodespaceLoadingWindowCopy = Readonly<{
  state?: 'loading' | 'error';
  title?: string;
  detail?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function htmlEscape(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCodespaceLoadingDocumentURL(
  codeSpaceID: string,
  theme: DesktopThemeSnapshot,
  copy: CodespaceLoadingWindowCopy = {},
): string {
  const state = copy.state === 'error' ? 'error' : 'loading';
  const title = htmlEscape(compact(copy.title) || 'Opening Codespace');
  const detail = htmlEscape(compact(copy.detail) || 'Redeven is preparing the browser editor.');
  const codeSpaceLabel = htmlEscape(compact(codeSpaceID) || 'codespace');
  const eyebrow = state === 'error' ? 'Needs attention' : 'Codespaces';
  const palette = theme.semantic;
  const html = `<!doctype html>
<html lang="en" data-floe-shell-theme="${htmlEscape(theme.activeShellTheme)}" data-theme-palette-version="${palette.version}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: ${theme.resolvedTheme};
      --background: ${palette.background};
      --surface: ${palette.surface};
      --foreground: ${palette.foreground};
      --muted-foreground: ${palette.mutedForeground};
      --border: ${palette.border};
      --primary: ${palette.primary};
      --primary-foreground: ${palette.primaryForeground};
      --error: ${palette.error};
      --track: color-mix(in srgb, var(--foreground) 13%, transparent);
      --primary-soft: color-mix(in srgb, var(--primary) 28%, transparent);
      --error-soft: color-mix(in srgb, var(--error) 20%, transparent);
    }
    * { box-sizing: border-box; }
    html {
      min-height: 100%;
      background: var(--background);
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: clamp(24px, 6vw, 56px);
      background:
        radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 34rem),
        var(--background);
      color: var(--foreground);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .redeven-loading-curtain__panel {
      width: min(24rem, 100%);
      display: grid;
      justify-items: center;
      gap: 1rem;
      text-align: center;
    }
    .redeven-loading-curtain__eyebrow {
      color: ${state === 'error' ? 'var(--error)' : 'var(--muted-foreground)'};
      font-size: 0.6875rem;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .redeven-loading-curtain__indicator {
      width: 10.5rem;
      height: 3px;
      border-radius: 999px;
      background: ${state === 'error' ? 'var(--error-soft)' : 'var(--track)'};
      overflow: hidden;
    }
    .redeven-loading-curtain__indicator::after {
      content: "";
      display: block;
      width: ${state === 'error' ? '100%' : '42%'};
      height: 100%;
      border-radius: inherit;
      background: ${state === 'error'
    ? 'var(--error)'
    : 'linear-gradient(90deg, transparent 0%, var(--primary-soft) 42%, var(--primary) 55%, transparent 100%)'};
      box-shadow: ${state === 'error' ? 'none' : '0 0 10px var(--primary-soft)'};
      animation: ${state === 'error' ? 'none' : 'redeven-loading-curtain-sweep 1.35s cubic-bezier(0.42, 0, 0.2, 1) infinite'};
      will-change: transform;
    }
    .redeven-loading-curtain__message {
      max-width: 22rem;
      margin: 0;
      color: ${state === 'error' ? 'var(--foreground)' : 'var(--muted-foreground)'};
      font-size: 0.8125rem;
      line-height: 1.5;
      font-weight: 480;
    }
    .detail {
      max-width: 24rem;
      margin: -0.35rem 0 0;
      color: var(--muted-foreground);
      font-size: 0.75rem;
      line-height: 1.5;
      font-weight: 440;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @keyframes redeven-loading-curtain-sweep {
      from { transform: translateX(-120%); }
      to { transform: translateX(260%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .redeven-loading-curtain__indicator::after { animation-duration: 1ms; }
    }
  </style>
</head>
<body>
  <main class="redeven-loading-curtain__panel" role="status" aria-live="polite" aria-busy="${state === 'error' ? 'false' : 'true'}" aria-label="${title}">
    <div class="redeven-loading-curtain__eyebrow">${eyebrow}</div>
    <div class="redeven-loading-curtain__indicator" role="progressbar" aria-label="${title}"></div>
    <p class="redeven-loading-curtain__message">${title}</p>
    ${state === 'error' ? `<p class="detail">${detail}</p>` : ''}
    <p class="sr-only">${codeSpaceLabel}</p>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
