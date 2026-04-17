import { BrowserWindow } from 'electron';

import { desktopPaletteForResolvedTheme } from './desktopTheme';
import { buildDesktopWindowChromeOptions } from './windowChrome';
import type { DesktopResolvedTheme } from '../shared/desktopTheme';
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

const DESKTOP_CONFIRMATION_ACTION_ORIGIN = 'https://redeven-desktop.invalid';

export type DesktopConfirmationResult = 'confirm' | 'cancel';

export type DesktopConfirmationActionTone = 'danger' | 'warning';
export type DesktopConfirmationMetricTone = 'danger' | 'warning' | 'success' | 'neutral';
export type DesktopConfirmationCalloutTone = 'warning' | 'info' | 'success';

export type DesktopConfirmationMetric = Readonly<{
  value: string;
  label: string;
  detail: string;
  tone: DesktopConfirmationMetricTone;
}>;

export type DesktopConfirmationRuntimePreviewItem = Readonly<{
  label: string;
  badge: string;
}>;

export type DesktopConfirmationCallout = Readonly<{
  eyebrow: string;
  body: string;
  tone: DesktopConfirmationCalloutTone;
}>;

export type DesktopConfirmationDialogModel = Readonly<{
  title: string;
  eyebrow: string;
  heading: string;
  message: string;
  impact_label: string;
  confirm_label: string;
  cancel_label: string;
  confirm_tone: DesktopConfirmationActionTone;
  summary_items: readonly DesktopConfirmationMetric[];
  runtime_section_title?: string;
  runtime_section_body?: string;
  runtime_preview: readonly DesktopConfirmationRuntimePreviewItem[];
  runtime_overflow_count: number;
  callout?: DesktopConfirmationCallout;
  footnote: string;
}>;

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function desktopConfirmationActionURL(action: DesktopConfirmationResult): string {
  return `${DESKTOP_CONFIRMATION_ACTION_ORIGIN}/confirmation/${action}`;
}

export function isDesktopConfirmationActionURL(rawURL: string): boolean {
  return String(rawURL ?? '').startsWith(`${DESKTOP_CONFIRMATION_ACTION_ORIGIN}/`);
}

export function desktopConfirmationActionFromURL(rawURL: string): DesktopConfirmationResult | null {
  if (!isDesktopConfirmationActionURL(rawURL)) {
    return null;
  }
  const url = new URL(rawURL);
  switch (url.pathname) {
    case '/confirmation/confirm':
      return 'confirm';
    case '/confirmation/cancel':
      return 'cancel';
    default:
      return null;
  }
}

function renderSummaryItems(items: readonly DesktopConfirmationMetric[]): string {
  return items.map((item) => {
    const toneClass = `metric-${item.tone}`;
    return `
          <article class="metric ${toneClass}">
            <p class="metric-value">${escapeHTML(item.value)}</p>
            <h2 class="metric-label">${escapeHTML(item.label)}</h2>
            <p class="metric-detail">${escapeHTML(item.detail)}</p>
          </article>`;
  }).join('');
}

function renderRuntimePreview(model: DesktopConfirmationDialogModel): string {
  if (
    compact(model.runtime_section_title) === ''
    && compact(model.runtime_section_body) === ''
    && model.runtime_preview.length <= 0
    && model.runtime_overflow_count <= 0
  ) {
    return '';
  }

  const items = model.runtime_preview.map((item) => `
              <li class="runtime-item">
                <span class="runtime-label">${escapeHTML(item.label)}</span>
                <span class="runtime-badge">${escapeHTML(item.badge)}</span>
              </li>`).join('');
  const overflow = model.runtime_overflow_count > 0
    ? `
              <li class="runtime-item runtime-overflow">
                <span class="runtime-label">${model.runtime_overflow_count} more ${pluralize(model.runtime_overflow_count, 'environment')}</span>
                <span class="runtime-badge">More</span>
              </li>`
    : '';

  return `
        <section class="runtime-panel" aria-label="${escapeHTML(model.runtime_section_title ?? 'Affected environments')}">
          ${compact(model.runtime_section_title) === ''
            ? ''
            : `<div class="section-kicker">${escapeHTML(model.runtime_section_title ?? '')}</div>`}
          ${compact(model.runtime_section_body) === ''
            ? ''
            : `<p class="runtime-body">${escapeHTML(model.runtime_section_body ?? '')}</p>`}
          ${items === '' && overflow === ''
            ? ''
            : `<ul class="runtime-list">${items}${overflow}
            </ul>`}
        </section>`;
}

function renderCallout(callout: DesktopConfirmationCallout | undefined): string {
  if (!callout) {
    return '';
  }
  return `
        <aside class="callout callout-${callout.tone}" aria-label="${escapeHTML(callout.eyebrow)}">
          <div class="callout-eyebrow">${escapeHTML(callout.eyebrow)}</div>
          <p class="callout-body">${escapeHTML(callout.body)}</p>
        </aside>`;
}

export function buildDesktopConfirmationPageHTML(
  model: DesktopConfirmationDialogModel,
  resolvedTheme: DesktopResolvedTheme,
  platform: NodeJS.Platform = process.platform,
): string {
  const palette = desktopPaletteForResolvedTheme(resolvedTheme);
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  const confirmURL = desktopConfirmationActionURL('confirm');
  const cancelURL = desktopConfirmationActionURL('cancel');
  const colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const hasRuntimeSection = renderRuntimePreview(model);
  const callout = renderCallout(model.callout);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHTML(model.title)}</title>
    <style>
      :root {
        color-scheme: ${colorScheme};
        --bg: ${palette.pageBackground};
        --surface: ${palette.surface};
        --surface-muted: ${palette.surfaceMuted};
        --border: ${palette.border};
        --text: ${palette.text};
        --muted: ${palette.muted};
        --accent: ${palette.accent};
        --accent-text: ${palette.accentText};
        --danger: ${palette.danger};
        --warning: ${palette.warning};
        --success: ${palette.success};
        --info: ${palette.info};
        --signal: ${model.confirm_tone === 'danger' ? palette.danger : palette.warning};
        --signal-soft: color-mix(in srgb, var(--signal) 12%, var(--surface));
        --signal-border: color-mix(in srgb, var(--signal) 28%, var(--border));
        --shadow: ${resolvedTheme === 'dark' ? '0 28px 80px rgba(0, 0, 0, 0.46)' : '0 28px 80px rgba(20, 31, 46, 0.16)'};
      }
      * { box-sizing: border-box; }
      html { height: 100%; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Aptos", "Avenir Next", "Segoe UI Variable Text", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, color-mix(in srgb, var(--signal) 16%, transparent), transparent 42%),
          radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 34%),
          linear-gradient(180deg, color-mix(in srgb, var(--surface-muted) 64%, var(--bg)) 0%, var(--bg) 100%);
        padding: calc(28px + ${titleBarInset}) 28px 28px;
      }
      .dialog-shell {
        width: min(760px, 100%);
        margin: 0 auto;
        border-radius: 30px;
        border: 1px solid color-mix(in srgb, var(--border) 76%, var(--signal));
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, white 8%) 0%, var(--surface) 100%);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .dialog-content {
        padding: 34px 34px 28px;
      }
      .eyebrow-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }
      .eyebrow {
        margin: 0;
        font-size: 13px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .impact-chip {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--signal) 14%, var(--surface));
        border: 1px solid var(--signal-border);
        color: color-mix(in srgb, var(--signal) 70%, var(--text));
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.9fr);
        gap: 22px;
        align-items: start;
      }
      h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: clamp(34px, 5vw, 48px);
        line-height: 0.98;
        letter-spacing: -0.03em;
      }
      .message {
        margin: 16px 0 0;
        font-size: 16px;
        line-height: 1.7;
        color: color-mix(in srgb, var(--muted) 78%, var(--text));
        max-width: 32rem;
      }
      .summary-grid {
        display: grid;
        gap: 12px;
      }
      .metric {
        border-radius: 20px;
        padding: 18px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 65%, var(--surface));
      }
      .metric-danger {
        border-color: color-mix(in srgb, var(--danger) 24%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, var(--surface));
      }
      .metric-warning {
        border-color: color-mix(in srgb, var(--warning) 26%, var(--border));
        background: color-mix(in srgb, var(--warning) 11%, var(--surface));
      }
      .metric-success {
        border-color: color-mix(in srgb, var(--success) 28%, var(--border));
        background: color-mix(in srgb, var(--success) 11%, var(--surface));
      }
      .metric-value {
        margin: 0;
        font-size: clamp(28px, 4vw, 38px);
        line-height: 1;
        font-weight: 700;
        letter-spacing: -0.04em;
      }
      .metric-label {
        margin: 12px 0 0;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
      }
      .metric-detail {
        margin: 8px 0 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--muted);
      }
      .runtime-panel,
      .callout {
        margin-top: 22px;
        border-radius: 24px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 56%, var(--surface));
        padding: 22px 22px 20px;
      }
      .section-kicker,
      .callout-eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .section-kicker {
        color: color-mix(in srgb, var(--signal) 70%, var(--text));
      }
      .runtime-body,
      .callout-body {
        margin: 10px 0 0;
        font-size: 15px;
        line-height: 1.65;
        color: color-mix(in srgb, var(--muted) 74%, var(--text));
      }
      .runtime-list {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      .runtime-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid color-mix(in srgb, var(--border) 78%, var(--surface));
        background: color-mix(in srgb, var(--surface) 88%, white 12%);
      }
      .runtime-label {
        font-size: 15px;
        font-weight: 600;
        line-height: 1.45;
      }
      .runtime-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
        background: color-mix(in srgb, var(--accent) 8%, var(--surface));
        color: color-mix(in srgb, var(--accent) 76%, var(--text));
        font-size: 12px;
        font-weight: 700;
      }
      .runtime-overflow {
        border-style: dashed;
      }
      .callout-warning {
        border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
        background: color-mix(in srgb, var(--warning) 10%, var(--surface));
      }
      .callout-info {
        border-color: color-mix(in srgb, var(--info) 26%, var(--border));
        background: color-mix(in srgb, var(--info) 10%, var(--surface));
      }
      .callout-success {
        border-color: color-mix(in srgb, var(--success) 28%, var(--border));
        background: color-mix(in srgb, var(--success) 10%, var(--surface));
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-top: 28px;
        padding-top: 18px;
        border-top: 1px solid color-mix(in srgb, var(--border) 84%, var(--surface));
      }
      .footnote {
        margin: 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 12px;
      }
      .button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 34%, var(--surface));
        color: var(--text);
        text-decoration: none;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
      }
      .button:hover {
        transform: translateY(-1px);
      }
      .button:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--signal) 40%, white);
        outline-offset: 3px;
      }
      .button-secondary:hover {
        border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
        background: color-mix(in srgb, var(--accent) 9%, var(--surface));
      }
      .button-confirm {
        border-color: transparent;
        color: #111;
        box-shadow: 0 12px 30px color-mix(in srgb, var(--signal) 28%, transparent);
      }
      .button-confirm-danger {
        background: linear-gradient(135deg, color-mix(in srgb, var(--danger) 80%, white 20%), color-mix(in srgb, var(--danger) 92%, black 8%));
      }
      .button-confirm-warning {
        background: linear-gradient(135deg, color-mix(in srgb, var(--warning) 72%, white 28%), color-mix(in srgb, var(--warning) 86%, black 14%));
      }
      .button-confirm:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 34px color-mix(in srgb, var(--signal) 34%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
      }
      @media (max-width: 760px) {
        body {
          padding: calc(14px + ${titleBarInset}) 14px 14px;
        }
        .dialog-shell {
          border-radius: 24px;
        }
        .dialog-content {
          padding: 24px 20px 20px;
        }
        .hero {
          grid-template-columns: 1fr;
        }
        .actions {
          width: 100%;
        }
        .button {
          flex: 1 1 100%;
        }
        .runtime-item {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body data-tone="${model.confirm_tone}">
    <main
      class="dialog-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-confirmation-heading"
      aria-describedby="desktop-confirmation-message"
    >
      <div class="dialog-content">
        <div class="eyebrow-row">
          <p class="eyebrow">${escapeHTML(model.eyebrow)}</p>
          <span class="impact-chip">${escapeHTML(model.impact_label)}</span>
        </div>
        <section class="hero">
          <div class="hero-copy">
            <h1 id="desktop-confirmation-heading">${escapeHTML(model.heading)}</h1>
            <p id="desktop-confirmation-message" class="message">${escapeHTML(model.message)}</p>
          </div>
          <section class="summary-grid" aria-label="Impact summary">
${renderSummaryItems(model.summary_items)}
          </section>
        </section>
${hasRuntimeSection}
${callout}
        <footer class="footer">
          <p class="footnote">${escapeHTML(model.footnote)}</p>
          <div class="actions">
            <a id="desktop-confirmation-cancel" class="button button-secondary" href="${cancelURL}">${escapeHTML(model.cancel_label)}</a>
            <a
              id="desktop-confirmation-confirm"
              class="button button-confirm button-confirm-${model.confirm_tone}"
              href="${confirmURL}"
            >${escapeHTML(model.confirm_label)}</a>
          </div>
        </footer>
      </div>
    </main>
    <script>
      const cancelButton = document.getElementById('desktop-confirmation-cancel');
      const confirmButton = document.getElementById('desktop-confirmation-confirm');

      queueMicrotask(() => {
        cancelButton?.focus();
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (cancelButton instanceof HTMLAnchorElement) {
            window.location.href = cancelButton.href;
          }
          return;
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (confirmButton instanceof HTMLAnchorElement) {
            window.location.href = confirmButton.href;
          }
        }
      });
    </script>
  </body>
</html>`;
}

function desktopConfirmationWindowHeight(model: DesktopConfirmationDialogModel): number {
  let height = 612;
  if (model.runtime_preview.length > 0 || model.runtime_overflow_count > 0) {
    height += 88;
  }
  if (model.callout) {
    height += 52;
  }
  if (model.summary_items.length >= 3) {
    height += 24;
  }
  return Math.min(744, height);
}

export async function showDesktopConfirmationDialog(args: Readonly<{
  model: DesktopConfirmationDialogModel;
  resolvedTheme: DesktopResolvedTheme;
  parentWindow?: BrowserWindow | null;
  platform?: NodeJS.Platform;
}>): Promise<DesktopConfirmationResult> {
  const actualParent = args.parentWindow && !args.parentWindow.isDestroyed()
    ? args.parentWindow
    : undefined;
  const platform = args.platform ?? process.platform;
  const height = desktopConfirmationWindowHeight(args.model);
  const win = new BrowserWindow({
    width: 760,
    height,
    minWidth: 760,
    minHeight: height,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: args.model.title,
    modal: Boolean(actualParent),
    parent: actualParent,
    autoHideMenuBar: true,
    skipTaskbar: true,
    ...buildDesktopWindowChromeOptions(platform, desktopPaletteForResolvedTheme(args.resolvedTheme).nativeWindow),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  return await new Promise<DesktopConfirmationResult>((resolve) => {
    let settled = false;

    const handleClosed = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve('cancel');
    };

    const cleanup = () => {
      win.removeListener('closed', handleClosed);
      win.webContents.removeListener('will-navigate', handleWillNavigate);
      win.webContents.removeListener('did-fail-load', handleDidFailLoad);
    };

    const settle = (result: DesktopConfirmationResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
      if (!win.isDestroyed()) {
        win.destroy();
      }
    };

    const handleDidFailLoad = () => {
      settle('cancel');
    };

    const handleNavigationAction = (rawURL: string): DesktopConfirmationResult | null => {
      return desktopConfirmationActionFromURL(rawURL);
    };

    const handleWillNavigate = (event: Electron.Event, url: string) => {
      const action = handleNavigationAction(url);
      if (!action) {
        return;
      }
      event.preventDefault();
      settle(action);
    };

    win.on('closed', handleClosed);
    win.webContents.on('will-navigate', handleWillNavigate);
    win.webContents.on('did-fail-load', handleDidFailLoad);
    win.webContents.setWindowOpenHandler(({ url }) => {
      const action = handleNavigationAction(url);
      if (action) {
        settle(action);
      }
      return { action: 'deny' };
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });

    const pageHTML = buildDesktopConfirmationPageHTML(args.model, args.resolvedTheme, platform);
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHTML)}`).catch(() => {
      settle('cancel');
    });
  });
}
