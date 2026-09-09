import { readFileSync } from 'node:fs';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';
import { desktopShellThemeCatalog, desktopShellThemeSemanticCatalog } from './desktopTheme';
import { buildDesktopWindowChromeStyleText } from '../shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
import { WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT, WEB_SERVICE_BROWSER_CHROME_HEIGHT } from '../shared/webServiceBrowserLayout';

const inputFocusStyleText = readFileSync(require.resolve('@floegence/floe-webapp-core/input-focus.css'), 'utf8');

export type WebServiceBrowserCopy = Readonly<{
  locale: string;
  title: string;
  addressLabel: string;
  addressPlaceholder: string;
  backLabel: string;
  forwardLabel: string;
  reloadLabel: string;
  stopLabel: string;
  navigateLabel: string;
  developerToolsLabel: string;
  openExternalLabel: string;
  secureRouteLabel: string;
}>;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function browserThemeStyleText(): string {
  return Object.entries(desktopShellThemeCatalog).map(([name, preset]) => {
    const palette = desktopShellThemeSemanticCatalog[name];
    return `:root[data-floe-shell-theme="${htmlEscape(name)}"] {
      color-scheme: ${preset.mode};
      --chrome: ${preset.window.backgroundColor};
      --foreground: ${preset.window.symbolColor};
      --border: ${palette.border};
      --primary: ${palette.primary};
      --error: ${palette.error};
    }`;
  }).join('\n');
}

export function buildWebServiceBrowserDocumentURL(
  copy: WebServiceBrowserCopy,
  theme: DesktopThemeSnapshot,
  platform: NodeJS.Platform = process.platform,
): string {
  const palette = theme.semantic;
  const document = `<!doctype html>
<html lang="${htmlEscape(copy.locale)}" data-floe-shell-theme="${htmlEscape(theme.activeShellTheme)}" data-theme-palette-version="${palette.version}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(copy.title)}</title>
  <style>
    :root {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ring: var(--primary);
      --accent: var(--hover);
      --accent-foreground: var(--foreground);
      --toolbar-height: ${WEB_SERVICE_BROWSER_TOOLBAR_HEIGHT}px;
      --chrome-height: ${WEB_SERVICE_BROWSER_CHROME_HEIGHT}px;
      --control-border: color-mix(in srgb, var(--border) 70%, var(--chrome));
      --divider: color-mix(in srgb, var(--border) 55%, var(--chrome));
      --address: color-mix(in srgb, var(--foreground) 4%, var(--chrome));
      --hover: color-mix(in srgb, var(--foreground) 8%, transparent);
      --primary-soft: color-mix(in srgb, var(--primary) 16%, var(--chrome));
      --error-soft: color-mix(in srgb, var(--error) 12%, var(--chrome));
      --error-border: color-mix(in srgb, var(--error) 38%, var(--chrome));
    }
    ${inputFocusStyleText}
    ${browserThemeStyleText()}
    ${buildDesktopWindowChromeStyleText(resolveDesktopWindowChromeSnapshot(platform))}
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: var(--chrome); color: var(--foreground); }
    .browser-titlebar { height: var(--redeven-desktop-titlebar-height); display: flex; align-items: center; padding-inline: var(--redeven-desktop-titlebar-start-inset) var(--redeven-desktop-titlebar-end-inset); background: var(--chrome); }
    .browser-title { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: 1.4; }
    .browser-bar { height: var(--toolbar-height); display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--divider); background: var(--chrome); }
    .nav-button { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
    .nav-button:not(:disabled):hover { background: var(--hover); cursor: pointer; }
    .nav-button[aria-pressed="true"] { background: var(--primary-soft); color: var(--primary); }
    .nav-button:focus-visible, .go-button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
    .nav-button:disabled { opacity: .34; cursor: default; }
    .nav-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .nav-button svg[hidden] { display: none; }
    .address-wrap { min-width: 0; height: 38px; flex: 1 1 auto; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px; border: 1px solid var(--control-border); border-radius: 8px; background: var(--address); }
    .address-input::placeholder { color: inherit; opacity: 1; }
    .route-mark { width: 16px; height: 16px; flex: 0 0 16px; color: var(--foreground); }
    .route-mark svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .address-input { min-width: 0; height: 100%; flex: 1 1 auto; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0; }
    .go-button { width: 30px; height: 28px; flex: 0 0 30px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--foreground); cursor: pointer; }
    .go-button:hover { background: var(--hover); }
    .go-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .status { position: fixed; left: 124px; right: 44px; top: calc(var(--chrome-height) - 28px); z-index: 2; min-height: 0; padding: 0 12px; color: var(--error); background: var(--error-soft); border: 1px solid var(--error-border); border-radius: 0 0 6px 6px; font-size: 12px; line-height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: translateY(-4px); opacity: 0; pointer-events: none; transition: opacity .12s ease, transform .12s ease; }
    .status[data-visible="true"] { opacity: 1; transform: translateY(0); }
    .progress { position: fixed; left: 0; right: 0; top: calc(var(--chrome-height) - 2px); z-index: 3; height: 2px; overflow: hidden; pointer-events: none; }
    .progress::after { content: ""; display: block; width: 34%; height: 100%; background: var(--primary); transform: translateX(-110%); opacity: 0; }
    .progress[data-loading="true"]::after { opacity: 1; animation: load 1.05s ease-in-out infinite; }
    :root[data-floe-shell-theme="hc-light"] { --control-border: var(--border); --divider: var(--border); }
    @media (forced-colors: active) {
      :root[data-floe-shell-theme] { --chrome: Canvas; --foreground: CanvasText; --address: Canvas; --control-border: ButtonText; --divider: CanvasText; --primary: Highlight; --primary-soft: Highlight; --hover: ButtonFace; --error: CanvasText; --error-soft: Canvas; --error-border: CanvasText; }
      .nav-button[aria-pressed="true"] { color: HighlightText; }
      .nav-button:disabled { opacity: 1; color: GrayText; }
      .progress::after { forced-color-adjust: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .status { transition: none; }
      .progress[data-loading="true"]::after { animation: none; transform: none; width: 100%; }
    }
    @keyframes load { to { transform: translateX(310%); } }
  </style>
</head>
<body>
  <header class="browser-titlebar" data-redeven-desktop-titlebar-drag-region="true">
    <p id="browser-title" class="browser-title">${htmlEscape(copy.title)}</p>
  </header>
  <form id="browser-form" class="browser-bar" novalidate>
    <button id="browser-back" class="nav-button" type="button" aria-label="${htmlEscape(copy.backLabel)}" title="${htmlEscape(copy.backLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <button id="browser-forward" class="nav-button" type="button" aria-label="${htmlEscape(copy.forwardLabel)}" title="${htmlEscape(copy.forwardLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
    <button id="browser-reload" class="nav-button" type="button" aria-label="${htmlEscape(copy.reloadLabel)}" title="${htmlEscape(copy.reloadLabel)}" data-stop-label="${htmlEscape(copy.stopLabel)}">
      <svg class="reload-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></svg>
      <svg class="stop-icon" viewBox="0 0 24 24" aria-hidden="true" hidden><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
    </button>
    <div class="address-wrap" data-floe-input-surface>
      <span class="route-mark" title="${htmlEscape(copy.secureRouteLabel)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>
      </span>
      <label for="browser-address" hidden>${htmlEscape(copy.addressLabel)}</label>
      <input id="browser-address" class="address-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${htmlEscape(copy.addressPlaceholder)}" aria-label="${htmlEscape(copy.addressLabel)}">
      <button class="go-button" type="submit" aria-label="${htmlEscape(copy.navigateLabel)}" title="${htmlEscape(copy.navigateLabel)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <button id="browser-devtools" class="nav-button" type="button" aria-label="${htmlEscape(copy.developerToolsLabel)}" title="${htmlEscape(copy.developerToolsLabel)}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 6-4 12"/></svg>
    </button>
    <button id="browser-open-external" class="nav-button" type="button" aria-label="${htmlEscape(copy.openExternalLabel)}" title="${htmlEscape(copy.openExternalLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h5v5"/><path d="m10 14 10-10"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>
    </button>
  </form>
  <div id="browser-status" class="status" role="status" aria-live="polite"></div>
  <div id="browser-progress" class="progress" aria-hidden="true"></div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}
