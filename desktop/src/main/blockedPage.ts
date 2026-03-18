import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import { desktopTheme } from './desktopTheme';

const BLOCKED_ACTION_ORIGIN = 'https://redeven-desktop.invalid';

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function blockedHeadline(report: LaunchBlockedReport): { title: string; body: string } {
  if (report.code === 'state_dir_locked') {
    if (report.lock_owner?.local_ui_enabled === true) {
      return {
        title: 'Redeven is already starting elsewhere',
        body: 'Another Redeven agent is using the default state directory and appears to provide Local UI. If it is still starting, retry in a moment so Desktop can attach to it.',
      };
    }
    return {
      title: 'Redeven is already running',
      body: 'Another Redeven agent is using the default state directory without an attachable Local UI. Stop that agent or restart it in a Local UI mode, then retry.',
    };
  }
  return {
    title: 'Redeven Desktop is blocked',
    body: report.message,
  };
}

function actionURL(action: 'retry' | 'copy-diagnostics' | 'settings' | 'quit'): string {
  return `${BLOCKED_ACTION_ORIGIN}/${action}`;
}

export function isBlockedActionURL(rawURL: string): boolean {
  return String(rawURL ?? '').startsWith(`${BLOCKED_ACTION_ORIGIN}/`);
}

export function blockedActionFromURL(rawURL: string): 'retry' | 'copy-diagnostics' | 'settings' | 'quit' | null {
  if (!isBlockedActionURL(rawURL)) {
    return null;
  }
  const url = new URL(rawURL);
  switch (url.pathname) {
    case '/retry':
      return 'retry';
    case '/copy-diagnostics':
      return 'copy-diagnostics';
    case '/settings':
      return 'settings';
    case '/quit':
      return 'quit';
    default:
      return null;
  }
}

export function buildBlockedPageHTML(report: LaunchBlockedReport): string {
  const headline = blockedHeadline(report);
  const diagnostics = escapeHTML(formatBlockedLaunchDiagnostics(report));
  const details = report.diagnostics?.state_dir
    ? `Default state directory: ${escapeHTML(report.diagnostics.state_dir)}`
    : 'Desktop could not attach to an existing Local UI instance.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Redeven Desktop</title>
    <style>
      :root {
        color-scheme: light;
        --bg: ${desktopTheme.pageBackground};
        --panel: ${desktopTheme.surface};
        --panel-muted: ${desktopTheme.surfaceMuted};
        --text: ${desktopTheme.text};
        --muted: ${desktopTheme.muted};
        --border: ${desktopTheme.border};
        --accent: ${desktopTheme.accent};
        --accent-text: ${desktopTheme.accentText};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(760px, 100%);
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: 0 18px 48px rgba(24, 19, 17, 0.08);
        padding: 32px;
      }
      .eyebrow {
        margin: 0 0 12px;
        font-size: 13px;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.1;
      }
      p {
        margin: 16px 0 0;
        font-size: 16px;
        line-height: 1.65;
        color: var(--muted);
      }
      .meta {
        margin-top: 18px;
        padding: 16px 18px;
        border-radius: 16px;
        background: var(--panel-muted);
        border: 1px solid var(--border);
        color: var(--text);
        font-size: 14px;
        line-height: 1.6;
      }
      .actions {
        margin-top: 24px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--border);
        text-decoration: none;
        color: var(--text);
        background: var(--panel);
        font-weight: 600;
      }
      .button.primary {
        background: var(--accent);
        color: var(--accent-text);
        border-color: transparent;
      }
      details {
        margin-top: 24px;
        border-top: 1px solid var(--border);
        padding-top: 18px;
      }
      summary {
        cursor: pointer;
        font-weight: 600;
      }
      pre {
        margin: 14px 0 0;
        padding: 16px;
        border-radius: 14px;
        background: #201917;
        color: #f9efe8;
        overflow: auto;
        font-size: 12px;
        line-height: 1.6;
      }
      @media (max-width: 640px) {
        body { padding: 12px; }
        main { padding: 22px; border-radius: 18px; }
        .actions { flex-direction: column; }
        .button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Redeven Desktop</p>
      <h1>${escapeHTML(headline.title)}</h1>
      <p>${escapeHTML(headline.body)}</p>
      <div class="meta">${details}</div>
      <div class="actions">
        <a class="button primary" href="${actionURL('retry')}">Retry</a>
        <a class="button" href="${actionURL('settings')}">Settings</a>
        <a class="button" href="${actionURL('copy-diagnostics')}">Copy diagnostics</a>
        <a class="button" href="${actionURL('quit')}">Quit</a>
      </div>
      <details>
        <summary>Technical details</summary>
        <pre>${diagnostics}</pre>
      </details>
    </main>
  </body>
</html>`;
}

export function blockedPageDataURL(report: LaunchBlockedReport): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildBlockedPageHTML(report))}`;
}
