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
  if (items.length <= 0) {
    return '';
  }

  return `
        <section class="summary-strip" aria-label="Impact summary">
${items.map((item) => `
          <div class="summary-pill summary-pill-${item.tone}">
            <span class="summary-value">${escapeHTML(item.value)}</span>
            <span class="summary-label">${escapeHTML(item.label)}</span>
          </div>`).join('')}
        </section>`;
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
            <span class="runtime-chip">${escapeHTML(item.label)}</span>`).join('');
  const overflow = model.runtime_overflow_count > 0
    ? `
            <span class="runtime-chip runtime-chip-overflow">+${model.runtime_overflow_count} more ${pluralize(model.runtime_overflow_count, 'environment')}</span>`
    : '';

  return `
        <section class="detail-panel" aria-label="${escapeHTML(model.runtime_section_title ?? 'Affected environments')}">
          ${compact(model.runtime_section_body) === ''
            ? ''
            : `<p class="detail-copy">${escapeHTML(model.runtime_section_body ?? '')}</p>`}
          ${items === '' && overflow === ''
            ? ''
            : `<div class="runtime-chips">${items}${overflow}</div>`}
        </section>`;
}

function renderCallout(callout: DesktopConfirmationCallout | undefined): string {
  if (!callout) {
    return '';
  }
  return `
        <p class="secondary-note secondary-note-${callout.tone}" aria-label="${escapeHTML(callout.eyebrow)}">
          ${escapeHTML(callout.body)}
        </p>`;
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
  const summaryStrip = renderSummaryItems(model.summary_items);
  const runtimePreview = renderRuntimePreview(model);
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
        --signal-soft: color-mix(in srgb, var(--signal) 10%, var(--surface));
        --signal-border: color-mix(in srgb, var(--signal) 18%, var(--border));
        --shadow: ${resolvedTheme === 'dark' ? '0 16px 44px rgba(0, 0, 0, 0.34)' : '0 16px 44px rgba(20, 31, 46, 0.12)'};
      }
      * { box-sizing: border-box; }
      html { height: 100%; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Aptos", "Avenir Next", "Segoe UI Variable Text", "Segoe UI", sans-serif;
        color: var(--text);
        background: color-mix(in srgb, var(--surface-muted) 55%, var(--bg));
        padding: calc(20px + ${titleBarInset}) 20px 20px;
      }
      .dialog-shell {
        width: min(600px, 100%);
        margin: 0 auto;
        border-radius: 18px;
        border: 1px solid var(--signal-border);
        background: var(--surface);
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .dialog-content {
        padding: 22px;
      }
      .header-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .eyebrow {
        margin: 0;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .impact-chip {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--signal-soft);
        border: 1px solid var(--signal-border);
        color: color-mix(in srgb, var(--signal) 72%, var(--text));
        font-size: 12px;
        font-weight: 600;
      }
      h1 {
        margin: 14px 0 0;
        font-size: clamp(24px, 4vw, 30px);
        line-height: 1.15;
        letter-spacing: -0.02em;
      }
      .message {
        margin: 10px 0 0;
        font-size: 15px;
        line-height: 1.6;
        color: var(--muted);
      }
      .summary-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
      .summary-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 72%, var(--surface));
      }
      .summary-pill-danger {
        border-color: color-mix(in srgb, var(--danger) 22%, var(--border));
        background: color-mix(in srgb, var(--danger) 8%, var(--surface));
      }
      .summary-pill-warning {
        border-color: color-mix(in srgb, var(--warning) 22%, var(--border));
        background: color-mix(in srgb, var(--warning) 8%, var(--surface));
      }
      .summary-pill-success {
        border-color: color-mix(in srgb, var(--success) 24%, var(--border));
        background: color-mix(in srgb, var(--success) 9%, var(--surface));
      }
      .summary-value {
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .summary-label {
        font-size: 13px;
        color: var(--muted);
      }
      .detail-panel {
        margin-top: 16px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 68%, var(--surface));
      }
      .detail-copy {
        margin: 0;
        font-size: 15px;
        line-height: 1.6;
        color: var(--muted);
      }
      .runtime-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .runtime-chip {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--border));
        background: color-mix(in srgb, var(--surface) 78%, white 22%);
        color: var(--text);
        font-size: 12px;
        font-weight: 600;
      }
      .runtime-chip-overflow {
        color: var(--muted);
      }
      .secondary-note {
        margin: 12px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--muted);
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        margin-top: 20px;
      }
      .footnote {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--muted);
        margin-right: auto;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 0 16px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-muted) 40%, var(--surface));
        color: var(--text);
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 160ms ease, border-color 160ms ease;
      }
      .button:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--signal) 40%, white);
        outline-offset: 2px;
      }
      .button-secondary:hover {
        border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
        background: color-mix(in srgb, var(--accent) 8%, var(--surface));
      }
      .button-confirm {
        border-color: transparent;
        color: #fafafa;
      }
      .button-confirm-danger {
        background: color-mix(in srgb, var(--danger) 80%, black 20%);
      }
      .button-confirm-warning {
        background: var(--accent);
      }
      .button-confirm:hover {
        filter: brightness(0.96);
      }
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
      }
      @media (max-width: 640px) {
        body {
          padding: calc(12px + ${titleBarInset}) 12px 12px;
        }
        .dialog-shell {
          border-radius: 16px;
        }
        .dialog-content {
          padding: 18px;
        }
        .actions {
          width: 100%;
        }
        .button {
          flex: 1 1 100%;
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
        <div class="header-row">
          <p class="eyebrow">${escapeHTML(model.eyebrow)}</p>
          <span class="impact-chip">${escapeHTML(model.impact_label)}</span>
        </div>
        <h1 id="desktop-confirmation-heading">${escapeHTML(model.heading)}</h1>
        <p id="desktop-confirmation-message" class="message">${escapeHTML(model.message)}</p>
${summaryStrip}
${runtimePreview}
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
  let height = 360;
  if (model.runtime_preview.length > 0 || model.runtime_overflow_count > 0) {
    height += 56;
  }
  if (model.callout) {
    height += 32;
  }
  if (model.summary_items.length >= 3) {
    height += 20;
  }
  return Math.min(520, height);
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
    width: 620,
    height,
    minWidth: 560,
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
