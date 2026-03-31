import { DEFAULT_LOCAL_NETWORK_BIND, type DesktopConnectionCenterSnapshot } from './connectionCenterState';
import { desktopDarkTheme, desktopLightTheme } from './desktopTheme';
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

function escapeHTML(value: string): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializeJSON(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function shareSummaryValue(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.share_preset) {
    case 'this_device':
      return 'Private to this device';
    case 'local_network':
      return 'Shared on your local network';
    default:
      return 'Custom sharing';
  }
}

function shareSummaryBody(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.share_preset) {
    case 'this_device':
      return 'Desktop keeps This device on a loopback-only Local UI bind until you choose to share it.';
    case 'local_network':
      return snapshot.current_target_kind === 'managed_local' && snapshot.current_local_ui_url
        ? `This device can be opened from another trusted machine through ${snapshot.current_local_ui_url}.`
        : `Desktop will expose This device on ${DEFAULT_LOCAL_NETWORK_BIND} with an access password.`;
    default:
      return 'This device uses a custom Local UI bind or password setup. Advanced Settings remains available for raw editing.';
  }
}

function linkSummaryValue(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.link_state) {
    case 'pending':
      return 'Queued for next start';
    case 'connected':
      return 'Connected';
    default:
      return 'No queued request';
  }
}

function linkSummaryBody(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.link_state) {
    case 'pending':
      return 'Connection Center already has a saved one-shot link request for the next successful This device start.';
    case 'connected':
      return 'This device is currently running with a valid remote control channel.';
    default:
      return snapshot.current_target_kind === 'external_local_ui'
        ? 'Switch back to This device to inspect or change the local Redeven link request.'
        : 'No one-shot link request is queued. You can add one below whenever you need it.';
  }
}

function currentTargetValue(snapshot: DesktopConnectionCenterSnapshot): string {
  return snapshot.current_target_kind === 'external_local_ui' ? 'Another device' : 'This device';
}

function currentTargetBody(snapshot: DesktopConnectionCenterSnapshot): string {
  if (snapshot.current_local_ui_url) {
    return snapshot.current_target_kind === 'external_local_ui'
      ? `Redeven Desktop is currently pointed at ${snapshot.current_local_ui_url}.`
      : `Redeven Desktop is currently serving This device from ${snapshot.current_local_ui_url}.`;
  }
  return snapshot.current_target_kind === 'external_local_ui'
    ? 'Open another machine inside this Desktop shell by pointing at its Redeven Local UI URL.'
    : 'Start or attach to the bundled Redeven runtime on this machine.';
}

function renderTargetChoice(id: string, value: 'managed_local' | 'external_local_ui', title: string, description: string): string {
  return `
    <label class="choice-option" for="${escapeHTML(id)}">
      <input id="${escapeHTML(id)}" type="radio" name="target_kind" value="${escapeHTML(value)}">
      <span>
        <span class="choice-title">${escapeHTML(title)}</span>
        <span class="choice-help">${escapeHTML(description)}</span>
      </span>
    </label>
  `;
}

function renderShareChoice(id: string, value: 'this_device' | 'local_network' | 'custom', title: string, description: string): string {
  return `
    <label class="choice-option" for="${escapeHTML(id)}">
      <input id="${escapeHTML(id)}" type="radio" name="share_preset" value="${escapeHTML(value)}">
      <span>
        <span class="choice-title">${escapeHTML(title)}</span>
        <span class="choice-help">${escapeHTML(description)}</span>
      </span>
    </label>
  `;
}

function renderRecentTarget(url: string): string {
  return `<button class="recent-target-chip" type="button" data-recent-url="${escapeHTML(url)}">${escapeHTML(url)}</button>`;
}

export function connectionCenterWindowTitle(): string {
  return 'Connection Center';
}

export function buildConnectionCenterPageHTML(
  snapshot: DesktopConnectionCenterSnapshot,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
): string {
  const error = String(errorMessage ?? '').trim();
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  const targetValue = currentTargetValue(snapshot);
  const targetBody = currentTargetBody(snapshot);
  const shareValue = shareSummaryValue(snapshot);
  const shareBody = shareSummaryBody(snapshot);
  const linkValue = linkSummaryValue(snapshot);
  const linkBody = linkSummaryBody(snapshot);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHTML(connectionCenterWindowTitle())}</title>
    <style>
      :root {
        color-scheme: light;
        --background: ${desktopLightTheme.pageBackground};
        --foreground: ${desktopLightTheme.text};
        --primary: ${desktopLightTheme.accent};
        --primary-foreground: ${desktopLightTheme.accentText};
        --secondary: ${desktopLightTheme.surfaceMuted};
        --secondary-foreground: ${desktopLightTheme.text};
        --accent: ${desktopLightTheme.accentSoft};
        --accent-foreground: ${desktopLightTheme.text};
        --card: ${desktopLightTheme.surface};
        --card-foreground: ${desktopLightTheme.text};
        --border: ${desktopLightTheme.border};
        --input: ${desktopLightTheme.border};
        --ring: ${desktopLightTheme.accent};
        --muted: ${desktopLightTheme.surfaceMuted};
        --muted-foreground: ${desktopLightTheme.muted};
        --success: ${desktopLightTheme.success};
        --warning: ${desktopLightTheme.warning};
        --error: ${desktopLightTheme.danger};
        --info: ${desktopLightTheme.info};
        --shadow: 0 18px 40px rgba(19, 30, 47, 0.08);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          color-scheme: dark;
          --background: ${desktopDarkTheme.pageBackground};
          --foreground: ${desktopDarkTheme.text};
          --primary: ${desktopDarkTheme.accent};
          --primary-foreground: ${desktopDarkTheme.accentText};
          --secondary: ${desktopDarkTheme.surfaceMuted};
          --secondary-foreground: ${desktopDarkTheme.text};
          --accent: ${desktopDarkTheme.accentSoft};
          --accent-foreground: ${desktopDarkTheme.text};
          --card: ${desktopDarkTheme.surface};
          --card-foreground: ${desktopDarkTheme.text};
          --border: ${desktopDarkTheme.border};
          --input: ${desktopDarkTheme.border};
          --ring: ${desktopDarkTheme.accent};
          --muted: ${desktopDarkTheme.surfaceMuted};
          --muted-foreground: ${desktopDarkTheme.muted};
          --success: ${desktopDarkTheme.success};
          --warning: ${desktopDarkTheme.warning};
          --error: ${desktopDarkTheme.danger};
          --info: ${desktopDarkTheme.info};
          --shadow: 0 22px 46px rgba(0, 0, 0, 0.28);
        }
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--background);
        color: var(--foreground);
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: calc(24px + ${titleBarInset}) 24px 24px;
      }
      input,
      button {
        font: inherit;
      }
      .skip-link {
        position: absolute;
        left: 24px;
        top: calc(8px + ${titleBarInset});
        z-index: 10;
        padding: 0.55rem 0.85rem;
        border-radius: 8px;
        background: var(--primary);
        color: var(--primary-foreground);
        text-decoration: none;
        transform: translateY(-220%);
      }
      .skip-link:focus-visible {
        transform: translateY(0);
        outline: 2px solid color-mix(in srgb, var(--ring) 35%, white);
        outline-offset: 3px;
      }
      main {
        width: min(980px, 100%);
        margin: 0 auto;
      }
      .shell {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: color-mix(in srgb, var(--card) 96%, transparent);
        box-shadow: var(--shadow);
      }
      .page-header {
        display: grid;
        gap: 10px;
        padding: 22px 24px 20px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--card) 72%, var(--background));
      }
      .eyebrow {
        margin: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 12px;
      }
      h1 {
        margin: 0;
        font-size: clamp(22px, 3vw, 30px);
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .lead {
        margin: 0;
        max-width: 72ch;
        color: var(--muted-foreground);
        font-size: 13px;
        line-height: 1.65;
      }
      .status-chip {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--secondary) 72%, transparent);
        color: var(--foreground);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .status-chip[data-tone="external"] {
        border-color: color-mix(in srgb, var(--info) 42%, var(--border));
        background: color-mix(in srgb, var(--info) 12%, transparent);
        color: color-mix(in srgb, var(--foreground) 84%, var(--info));
      }
      form {
        display: grid;
        gap: 18px;
        padding: 18px;
      }
      .summary-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .summary-item {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--background) 62%, var(--card));
      }
      .summary-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .summary-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--card-foreground);
      }
      .summary-copy {
        margin: 0;
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.55;
      }
      .inline-alert {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 14px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--info) 10%, var(--card));
      }
      .inline-alert-bar {
        width: 4px;
        min-height: 100%;
        border-radius: 999px;
        background: color-mix(in srgb, var(--info) 70%, var(--primary));
      }
      .inline-alert-copy {
        display: grid;
        gap: 4px;
      }
      .inline-alert-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .inline-alert-title {
        font-size: 16px;
        font-weight: 600;
        line-height: 1.2;
      }
      .inline-alert-body {
        margin: 0;
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.6;
      }
      .section-group {
        display: grid;
        gap: 12px;
      }
      .section-group-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .section-group-title {
        margin: 0;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .section-group-divider {
        height: 1px;
        flex: 1 1 auto;
        background: color-mix(in srgb, var(--border) 64%, transparent);
      }
      .settings-card {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--card);
      }
      .settings-card-header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--muted) 20%, var(--card));
      }
      .settings-card-header-copy {
        display: grid;
        gap: 6px;
      }
      .settings-card-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .settings-card-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .settings-card-title-row h2 {
        margin: 0;
        font-size: 16px;
        line-height: 1.2;
      }
      .settings-card-badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--background) 70%, var(--card));
        color: var(--muted-foreground);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .settings-card-description {
        margin: 0;
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.6;
      }
      .settings-card-body {
        display: grid;
        gap: 14px;
        padding: 16px;
      }
      .card-inline-note {
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--primary) 14%, var(--border));
        border-radius: 10px;
        background: color-mix(in srgb, var(--primary) 6%, var(--background));
        color: var(--foreground);
        font-size: 12px;
        line-height: 1.55;
      }
      .field {
        display: grid;
        gap: 6px;
      }
      fieldset {
        margin: 0;
        min-width: 0;
        padding: 0;
        border: 0;
      }
      .field-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: var(--foreground);
      }
      .field-help {
        color: var(--muted-foreground);
        font-size: 11px;
        line-height: 1.55;
      }
      input {
        width: 100%;
        min-height: 38px;
        border-radius: 10px;
        border: 1px solid var(--input);
        background: color-mix(in srgb, var(--background) 84%, transparent);
        color: var(--foreground);
        padding: 0 12px;
        font-size: 12px;
        box-shadow: 0 1px 2px rgba(19, 30, 47, 0.04);
      }
      input::placeholder {
        color: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
      }
      input:focus-visible,
      button:focus-visible,
      .choice-option:has(input:focus-visible) {
        outline: 2px solid color-mix(in srgb, var(--ring) 22%, transparent);
        outline-offset: 2px;
      }
      input:focus-visible,
      button:focus-visible {
        border-color: color-mix(in srgb, var(--ring) 48%, var(--border));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 14%, transparent);
      }
      .choice-grid {
        display: grid;
        gap: 10px;
      }
      .choice-option {
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr);
        gap: 8px 10px;
        align-items: start;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--background) 72%, var(--card));
        cursor: pointer;
        transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
      }
      .choice-option:hover {
        background: color-mix(in srgb, var(--accent) 34%, var(--background));
      }
      .choice-option:has(input:checked) {
        border-color: color-mix(in srgb, var(--ring) 38%, var(--border));
        background: color-mix(in srgb, var(--primary) 8%, var(--background));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ring) 12%, transparent);
      }
      .choice-option input {
        width: 16px;
        min-height: 16px;
        margin: 2px 0 0;
        padding: 0;
        accent-color: var(--primary);
      }
      .choice-title {
        display: block;
        font-size: 13px;
        font-weight: 600;
      }
      .choice-help {
        display: block;
        margin-top: 4px;
        color: var(--muted-foreground);
        font-size: 11px;
        line-height: 1.55;
      }
      .recent-targets {
        display: grid;
        gap: 8px;
      }
      .recent-target-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .recent-target-chip {
        min-height: 30px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        background: color-mix(in srgb, var(--muted) 26%, var(--background));
        color: var(--foreground);
        padding: 0 12px;
        cursor: pointer;
      }
      .recent-target-chip:hover {
        background: color-mix(in srgb, var(--accent) 48%, var(--background));
      }
      code {
        padding: 0 6px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--muted) 62%, var(--background));
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 11px;
      }
      .form-footer {
        display: grid;
        gap: 12px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--muted) 18%, var(--card));
      }
      .error {
        display: ${error ? 'block' : 'none'};
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--error) 26%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--error) 10%, transparent);
        color: var(--error);
        line-height: 1.55;
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        min-height: 34px;
        border-radius: 10px;
        border: 1px solid var(--input);
        background: color-mix(in srgb, var(--background) 84%, transparent);
        color: var(--foreground);
        padding: 0 14px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 1px 2px rgba(19, 30, 47, 0.04);
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
      }
      button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 54%, var(--background));
      }
      button.primary {
        border-color: var(--primary);
        background: var(--primary);
        color: var(--primary-foreground);
      }
      button.primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--primary) 92%, black);
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      [hidden] {
        display: none !important;
      }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
      }
      @media (max-width: 720px) {
        body { padding: calc(12px + ${titleBarInset}) 12px 12px; }
        .page-header { padding: 18px 18px 16px; }
        form { padding: 14px; }
        .summary-strip { grid-template-columns: 1fr; }
        .actions { flex-direction: column-reverse; }
        button { width: 100%; }
        .skip-link { left: 12px; }
        .recent-target-list {
          display: grid;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#connection-center-main">Skip to main content</a>
    <main id="connection-center-main" tabindex="-1">
      <div class="shell">
        <header class="page-header">
          <p class="eyebrow">Redeven Desktop</p>
          <div class="title-row">
            <h1>${escapeHTML(connectionCenterWindowTitle())}</h1>
            <span id="target-status-badge" class="status-chip" data-tone="${snapshot.current_target_kind === 'external_local_ui' ? 'external' : 'local'}">${escapeHTML(targetValue)}</span>
          </div>
          <p id="page-lead" class="lead">Open this device, open another device, share this device, or queue a Redeven link from one place. Advanced Settings stays available for raw troubleshooting inputs.</p>
        </header>

        <form id="connection-form" aria-describedby="page-lead connection-error">
          <section class="summary-strip" aria-label="Current connection summary">
            <article class="summary-item">
              <div class="summary-label">Current target</div>
              <div id="summary-target-value" class="summary-value">${escapeHTML(targetValue)}</div>
              <p id="summary-target-body" class="summary-copy">${escapeHTML(targetBody)}</p>
            </article>
            <article class="summary-item">
              <div class="summary-label">Sharing</div>
              <div id="summary-share-value" class="summary-value">${escapeHTML(shareValue)}</div>
              <p id="summary-share-body" class="summary-copy">${escapeHTML(shareBody)}</p>
            </article>
            <article class="summary-item">
              <div class="summary-label">Redeven link</div>
              <div id="summary-link-value" class="summary-value">${escapeHTML(linkValue)}</div>
              <p id="summary-link-body" class="summary-copy">${escapeHTML(linkBody)}</p>
            </article>
          </section>

          <section class="inline-alert">
            <div class="inline-alert-bar" aria-hidden="true"></div>
            <div class="inline-alert-copy">
              <div class="inline-alert-kicker">Shell-owned workflow</div>
              <div class="inline-alert-title">Connection Center keeps open, share, and link together</div>
              <p class="inline-alert-body">Use this page for the high-level workflow. Advanced Settings remains available when you need raw bind, password, or one-shot bootstrap editing.</p>
            </div>
          </section>

          <section class="section-group" aria-labelledby="connection-section-title">
            <div class="section-group-header">
              <h2 id="connection-section-title" class="section-group-title">Open</h2>
              <div class="section-group-divider" aria-hidden="true"></div>
            </div>
            <section class="settings-card" id="open-card">
              <div class="settings-card-header">
                <div class="settings-card-header-copy">
                  <div class="settings-card-kicker">Connection target</div>
                  <div class="settings-card-title-row">
                    <h2>Open a Redeven device</h2>
                    <span class="settings-card-badge">Connection Center</span>
                  </div>
                  <p class="settings-card-description">Choose whether Desktop opens this machine or another Redeven Local UI endpoint.</p>
                </div>
              </div>
              <div class="settings-card-body">
                <fieldset class="field">
                  <legend class="field-label">Target</legend>
                  <div class="choice-grid">
                    ${renderTargetChoice('target-kind-managed-local', 'managed_local', 'This device', 'Start or attach to the bundled Redeven runtime on this machine.')}
                    ${renderTargetChoice('target-kind-external-local-ui', 'external_local_ui', 'Another device', 'Open another machine’s Redeven Local UI directly inside this Desktop shell.')}
                  </div>
                </fieldset>

                <div id="external-url-row" class="field" hidden>
                  <label class="field-label" for="external-local-ui-url">Redeven URL</label>
                  <input id="external-local-ui-url" type="url" autocomplete="url" inputmode="url" spellcheck="false" aria-describedby="external-local-ui-url-help connection-error" placeholder="http://192.168.1.11:24000/">
                  <div id="external-local-ui-url-help" class="field-help">Paste a Local UI base URL using localhost or an IP literal. Desktop intentionally does not accept arbitrary hostnames here.</div>
                </div>

                <div id="recent-targets" class="recent-targets"${snapshot.recent_external_local_ui_urls.length > 0 ? '' : ' hidden'}>
                  <div class="field-label">Recent devices</div>
                  <div class="recent-target-list">
                    ${snapshot.recent_external_local_ui_urls.map(renderRecentTarget).join('')}
                  </div>
                  <div class="field-help">Choosing a recent device hydrates the URL field and switches the target to Another device.</div>
                </div>
              </div>
            </section>
          </section>

          <section class="section-group" aria-labelledby="share-section-title">
            <div class="section-group-header">
              <h2 id="share-section-title" class="section-group-title">Share</h2>
              <div class="section-group-divider" aria-hidden="true"></div>
            </div>
            <section class="settings-card" id="share-card">
              <div class="settings-card-header">
                <div class="settings-card-header-copy">
                  <div class="settings-card-kicker">Share This device</div>
                  <div class="settings-card-title-row">
                    <h2>Choose how This device is exposed</h2>
                    <span class="settings-card-badge">This device</span>
                  </div>
                  <p class="settings-card-description">Pick a privacy level first. Advanced Settings still owns the raw bind/password inputs when you need precise control.</p>
                </div>
              </div>
              <div class="settings-card-body">
                <fieldset class="field">
                  <legend class="field-label">Visibility</legend>
                  <div class="choice-grid">
                    ${renderShareChoice('share-preset-this-device', 'this_device', 'Only this device', 'Keep the Local UI on a loopback-only dynamic port.')}
                    ${renderShareChoice('share-preset-local-network', 'local_network', 'Local network', `Expose This device on ${DEFAULT_LOCAL_NETWORK_BIND} with an access password.`)}
                    ${renderShareChoice('share-preset-custom', 'custom', 'Custom', 'Use a raw bind/password combination instead of the recommended presets.')}
                  </div>
                </fieldset>

                <div id="local-network-password-row" class="field" hidden>
                  <label class="field-label" for="local-network-password">Access password</label>
                  <input id="local-network-password" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="local-network-password-help connection-error">
                  <div id="local-network-password-help" class="field-help">Desktop generates a strong password automatically if you leave this blank while choosing Local network.</div>
                </div>

                <div id="custom-bind-row" class="field" hidden>
                  <label class="field-label" for="custom-local-ui-bind">Local UI bind address</label>
                  <input id="custom-local-ui-bind" type="text" autocomplete="off" spellcheck="false" aria-describedby="custom-local-ui-bind-help connection-error">
                  <div id="custom-local-ui-bind-help" class="field-help">Examples: <code>127.0.0.1:0</code>, <code>0.0.0.0:24000</code>, <code>192.168.1.11:24000</code>.</div>
                </div>

                <div id="custom-password-row" class="field" hidden>
                  <label class="field-label" for="custom-local-ui-password">Access password</label>
                  <input id="custom-local-ui-password" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="custom-local-ui-password-help connection-error">
                  <div id="custom-local-ui-password-help" class="field-help">Non-loopback binds require a password. Desktop passes it through the runtime environment instead of argv.</div>
                </div>
              </div>
            </section>
          </section>

          <section class="section-group" aria-labelledby="link-section-title">
            <div class="section-group-header">
              <h2 id="link-section-title" class="section-group-title">Link</h2>
              <div class="section-group-divider" aria-hidden="true"></div>
            </div>
            <section class="settings-card" id="link-card">
              <div class="settings-card-header">
                <div class="settings-card-header-copy">
                  <div class="settings-card-kicker">Link This device</div>
                  <div class="settings-card-title-row">
                    <h2>Link This device to Redeven</h2>
                    <span class="settings-card-badge">One-shot request</span>
                  </div>
                  <p class="settings-card-description">These details affect This device only. Desktop saves them as a one-shot request for the next successful This device start.</p>
                </div>
              </div>
              <div class="settings-card-body">
                <div id="link-state-note" class="card-inline-note">${escapeHTML(linkBody)}</div>

                <div class="field">
                  <label class="field-label" for="controlplane-url">Redeven URL</label>
                  <input id="controlplane-url" type="url" autocomplete="url" inputmode="url" spellcheck="false" aria-describedby="connection-error">
                </div>

                <div class="field">
                  <label class="field-label" for="env-id">Environment ID</label>
                  <input id="env-id" type="text" autocomplete="off" spellcheck="false" aria-describedby="connection-error">
                </div>

                <div class="field">
                  <label class="field-label" for="env-token">Environment token</label>
                  <input id="env-token" type="password" autocomplete="off" spellcheck="false" aria-describedby="env-token-help connection-error">
                  <div id="env-token-help" class="field-help">Desktop stores this secret locally and passes it through <code>--env-token-env</code> when the next This device start is launched.</div>
                </div>
              </div>
            </section>
          </section>

          <div class="form-footer">
            <div id="connection-error" class="error" role="alert" aria-live="assertive" tabindex="-1">${escapeHTML(error)}</div>
            <div class="actions">
              <button id="cancel" type="button">Cancel</button>
              <button id="save" class="primary" type="submit">Open Selected Device</button>
            </div>
          </div>
        </form>
      </div>
    </main>

    <script id="redeven-connection-center-state" type="application/json">${serializeJSON(snapshot)}</script>
    <script>
      const snapshot = JSON.parse(document.getElementById('redeven-connection-center-state').textContent || '{}');
      const form = document.getElementById('connection-form');
      const errorEl = document.getElementById('connection-error');
      const cancelButton = document.getElementById('cancel');
      const saveButton = document.getElementById('save');
      const targetStatusBadge = document.getElementById('target-status-badge');
      const summaryTargetValue = document.getElementById('summary-target-value');
      const summaryTargetBody = document.getElementById('summary-target-body');
      const summaryShareValue = document.getElementById('summary-share-value');
      const summaryShareBody = document.getElementById('summary-share-body');
      const summaryLinkValue = document.getElementById('summary-link-value');
      const summaryLinkBody = document.getElementById('summary-link-body');
      const linkStateNote = document.getElementById('link-state-note');
      const externalURLRow = document.getElementById('external-url-row');
      const recentTargetsSection = document.getElementById('recent-targets');
      const localNetworkPasswordRow = document.getElementById('local-network-password-row');
      const customBindRow = document.getElementById('custom-bind-row');
      const customPasswordRow = document.getElementById('custom-password-row');
      const externalLocalUIURL = document.getElementById('external-local-ui-url');
      const localNetworkPassword = document.getElementById('local-network-password');
      const customLocalUIBind = document.getElementById('custom-local-ui-bind');
      const customLocalUIPassword = document.getElementById('custom-local-ui-password');
      const controlplaneURL = document.getElementById('controlplane-url');
      const envID = document.getElementById('env-id');
      const envToken = document.getElementById('env-token');
      const targetKindInputs = Array.from(document.querySelectorAll('input[name="target_kind"]'));
      const sharePresetInputs = Array.from(document.querySelectorAll('input[name="share_preset"]'));
      const recentTargetButtons = Array.from(document.querySelectorAll('[data-recent-url]'));
      const defaultDraft = snapshot.draft || {};
      const initialLocalNetworkBind = snapshot.share_preset === 'local_network' && typeof defaultDraft.local_ui_bind === 'string' && defaultDraft.local_ui_bind.trim() !== ''
        ? defaultDraft.local_ui_bind
        : ${serializeJSON(DEFAULT_LOCAL_NETWORK_BIND)};

      function selectedTargetKind() {
        const selected = targetKindInputs.find((input) => input.checked);
        return selected ? selected.value : (defaultDraft.target_kind || 'managed_local');
      }

      function selectedSharePreset() {
        const selected = sharePresetInputs.find((input) => input.checked);
        return selected ? selected.value : (snapshot.share_preset || 'this_device');
      }

      function generatePassword() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        const bytes = new Uint8Array(18);
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
          globalThis.crypto.getRandomValues(bytes);
          return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
        }
        return 'redeven-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      }

      function setError(text) {
        errorEl.textContent = text;
        errorEl.style.display = text ? 'block' : 'none';
        errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');
        if (text) {
          queueMicrotask(() => errorEl.focus());
        }
      }

      function ensureLocalNetworkPassword() {
        const clean = String(localNetworkPassword.value || '').trim();
        if (clean !== '') {
          return clean;
        }
        const generated = generatePassword();
        localNetworkPassword.value = generated;
        return generated;
      }

      function anyLinkFieldsFilled() {
        return [controlplaneURL, envID, envToken].some((input) => String(input.value || '').trim() !== '');
      }

      function syncTargetMode() {
        const targetKind = selectedTargetKind();
        const isExternal = targetKind === 'external_local_ui';
        externalURLRow.hidden = !isExternal;
        if (recentTargetsSection) {
          recentTargetsSection.hidden = !isExternal || recentTargetButtons.length === 0;
        }
        targetStatusBadge.textContent = isExternal ? 'Another device' : 'This device';
        targetStatusBadge.setAttribute('data-tone', isExternal ? 'external' : 'local');
        summaryTargetValue.textContent = isExternal ? 'Another device' : 'This device';
        summaryTargetBody.textContent = isExternal
          ? (snapshot.current_target_kind === 'external_local_ui' && snapshot.current_local_ui_url
            ? 'Redeven Desktop is currently pointed at ' + snapshot.current_local_ui_url + '.'
            : 'Open another machine inside this Desktop shell by pointing at its Redeven Local UI URL.')
          : (snapshot.current_target_kind === 'managed_local' && snapshot.current_local_ui_url
            ? 'Redeven Desktop is currently serving This device from ' + snapshot.current_local_ui_url + '.'
            : 'Start or attach to the bundled Redeven runtime on this machine.');
        saveButton.textContent = isExternal ? 'Open Another Device' : 'Open This Device';
      }

      function syncShareMode() {
        const sharePreset = selectedSharePreset();
        const isLocalNetwork = sharePreset === 'local_network';
        const isCustom = sharePreset === 'custom';
        localNetworkPasswordRow.hidden = !isLocalNetwork;
        customBindRow.hidden = !isCustom;
        customPasswordRow.hidden = !isCustom;
        if (isLocalNetwork) {
          ensureLocalNetworkPassword();
          summaryShareValue.textContent = 'Shared on your local network';
          summaryShareBody.textContent = snapshot.current_target_kind === 'managed_local' && snapshot.current_local_ui_url
            ? 'This device can be opened from another trusted machine through ' + snapshot.current_local_ui_url + '.'
            : 'Desktop will expose This device on ${DEFAULT_LOCAL_NETWORK_BIND} with an access password.';
          return;
        }
        if (isCustom) {
          summaryShareValue.textContent = 'Custom sharing';
          summaryShareBody.textContent = 'This device uses a custom Local UI bind or password setup. Advanced Settings remains available for raw editing.';
          return;
        }
        summaryShareValue.textContent = 'Private to this device';
        summaryShareBody.textContent = 'Desktop keeps This device on a loopback-only dynamic port until you choose to share it.';
      }

      function syncLinkPreview() {
        if (anyLinkFieldsFilled()) {
          summaryLinkValue.textContent = 'Queued for next start';
          summaryLinkBody.textContent = 'Desktop will queue a one-shot Redeven link request for the next successful This device start after all three fields are present.';
          linkStateNote.textContent = 'These values apply to This device only and stay saved until the next successful This device start consumes them.';
          return;
        }
        summaryLinkValue.textContent = ${serializeJSON(linkValue)};
        summaryLinkBody.textContent = ${serializeJSON(linkBody)};
        linkStateNote.textContent = ${serializeJSON(linkBody)};
      }

      function buildDraft() {
        const sharePreset = selectedSharePreset();
        let localUIBind = '127.0.0.1:0';
        let localUIPassword = '';
        if (sharePreset === 'local_network') {
          localUIBind = initialLocalNetworkBind;
          localUIPassword = ensureLocalNetworkPassword();
        } else if (sharePreset === 'custom') {
          localUIBind = String(customLocalUIBind.value || '').trim();
          localUIPassword = String(customLocalUIPassword.value || '');
        }

        return {
          target_kind: selectedTargetKind(),
          external_local_ui_url: String(externalLocalUIURL.value || '').trim(),
          local_ui_bind: localUIBind,
          local_ui_password: localUIPassword,
          controlplane_url: String(controlplaneURL.value || '').trim(),
          env_id: String(envID.value || '').trim(),
          env_token: String(envToken.value || '').trim(),
        };
      }

      targetKindInputs.forEach((input) => {
        input.checked = input.value === (defaultDraft.target_kind || snapshot.current_target_kind || 'managed_local');
        input.addEventListener('change', syncTargetMode);
      });
      sharePresetInputs.forEach((input) => {
        input.checked = input.value === (snapshot.share_preset || 'this_device');
        input.addEventListener('change', syncShareMode);
      });
      recentTargetButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const targetURL = button.getAttribute('data-recent-url') || '';
          const externalInput = targetKindInputs.find((input) => input.value === 'external_local_ui');
          if (externalInput) {
            externalInput.checked = true;
          }
          externalLocalUIURL.value = targetURL;
          syncTargetMode();
          externalLocalUIURL.focus();
        });
      });

      externalLocalUIURL.value = String(defaultDraft.external_local_ui_url || '');
      if (snapshot.share_preset === 'local_network') {
        localNetworkPassword.value = String(defaultDraft.local_ui_password || '');
      } else if (snapshot.share_preset === 'custom') {
        customLocalUIBind.value = String(defaultDraft.local_ui_bind || '');
        customLocalUIPassword.value = String(defaultDraft.local_ui_password || '');
      } else {
        customLocalUIBind.value = String(defaultDraft.local_ui_bind || '127.0.0.1:0');
      }
      controlplaneURL.value = String(defaultDraft.controlplane_url || '');
      envID.value = String(defaultDraft.env_id || '');
      envToken.value = String(defaultDraft.env_token || '');

      [controlplaneURL, envID, envToken].forEach((input) => input.addEventListener('input', syncLinkPreview));
      cancelButton.addEventListener('click', () => {
        window.redevenDesktopSettings.cancel();
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setError('');
        saveButton.disabled = true;
        try {
          const result = await window.redevenDesktopSettings.save(buildDraft());
          if (!result || !result.ok) {
            setError(result && result.error ? result.error : 'Failed to save connection settings.');
            return;
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          saveButton.disabled = false;
        }
      });

      syncTargetMode();
      syncShareMode();
      syncLinkPreview();
      if (errorEl.textContent.trim() !== '') {
        queueMicrotask(() => errorEl.focus());
      } else {
        queueMicrotask(() => document.getElementById('connection-center-main')?.focus());
      }
    </script>
  </body>
</html>`;
}

export function connectionCenterPageDataURL(
  snapshot: DesktopConnectionCenterSnapshot,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildConnectionCenterPageHTML(snapshot, errorMessage, platform))}`;
}
