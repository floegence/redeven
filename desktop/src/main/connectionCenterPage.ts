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

function pageLead(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.entry_reason) {
    case 'switch_device':
      return 'Choose which machine to open next. Your current session stays available until you confirm another device.';
    case 'connect_failed':
      return 'Choose a device to recover from the failed connection without leaving the main window.';
    case 'blocked':
      return 'Choose a recovery path for this session. Troubleshooting stays on the same page as device selection.';
    default:
      return 'Choose which machine to open in this Desktop session.';
  }
}

function activeSessionLabel(snapshot: DesktopConnectionCenterSnapshot): string {
  if (snapshot.active_session_target_kind === 'external_local_ui') {
    return 'Another device';
  }
  if (snapshot.active_session_target_kind === 'managed_local') {
    return 'This device';
  }
  return 'No device opened';
}

function activeSessionBody(snapshot: DesktopConnectionCenterSnapshot): string {
  if (snapshot.active_session_target_kind === 'external_local_ui') {
    return snapshot.active_session_local_ui_url
      ? `Current session: ${snapshot.active_session_local_ui_url}`
      : 'Current session is connected to another Redeven device.';
  }
  if (snapshot.active_session_target_kind === 'managed_local') {
    return snapshot.this_device_local_ui_url
      ? `Current session: ${snapshot.this_device_local_ui_url}`
      : 'Current session is attached to This device.';
  }
  return 'Nothing is opened yet.';
}

function thisDeviceStatusValue(snapshot: DesktopConnectionCenterSnapshot): string {
  return snapshot.this_device_local_ui_url ? 'Ready on this machine' : 'Ready to start';
}

function thisDeviceStatusBody(snapshot: DesktopConnectionCenterSnapshot): string {
  if (snapshot.this_device_local_ui_url) {
    return `Redeven can open This device from ${snapshot.this_device_local_ui_url}.`;
  }
  return 'Desktop can start or attach to the bundled runtime on this machine when you choose This device.';
}

function thisDeviceShareValue(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.this_device_share_preset) {
    case 'local_network':
      return 'Shared on your local network';
    case 'custom':
      return 'Custom exposure';
    default:
      return 'Private to this device';
  }
}

function thisDeviceShareBody(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.this_device_share_preset) {
    case 'local_network':
      return snapshot.this_device_local_ui_url
        ? `This device can be opened from another trusted machine through ${snapshot.this_device_local_ui_url}.`
        : `Desktop will expose This device on ${DEFAULT_LOCAL_NETWORK_BIND} with an access password.`;
    case 'custom':
      return 'This device uses a custom Local UI bind or password setup.';
    default:
      return 'Desktop keeps This device on a loopback-only Local UI bind until you choose to share it.';
  }
}

function thisDeviceLinkValue(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.this_device_link_state) {
    case 'pending':
      return 'Queued for next start';
    case 'connected':
      return 'Remote control connected';
    default:
      return 'No queued request';
  }
}

function thisDeviceLinkBody(snapshot: DesktopConnectionCenterSnapshot): string {
  switch (snapshot.this_device_link_state) {
    case 'pending':
      return 'Desktop already has a saved one-shot Redeven link request for the next successful This device start.';
    case 'connected':
      return 'This device is currently running with a valid remote control channel.';
    default:
      return 'Add a one-shot Redeven link request only when you need the next This device start to register itself remotely.';
  }
}

function renderRecentDeviceCard(snapshot: DesktopConnectionCenterSnapshot, localUIURL: string, index: number): string {
  const recentDevice = snapshot.recent_devices.find((item) => item.local_ui_url === localUIURL);
  if (!recentDevice) {
    return '';
  }
  const badges: string[] = [];
  if (recentDevice.is_remembered_target) {
    badges.push('<span class="device-badge">Remembered</span>');
  }
  if (recentDevice.is_active_session) {
    badges.push('<span class="device-badge">Current session</span>');
  }

  return `
    <article class="device-card">
      <div class="device-card-copy">
        <div class="device-card-kicker">Recent device ${index + 1}</div>
        <h3>${escapeHTML(localUIURL)}</h3>
        <p>Open this Redeven Local UI in the same Desktop shell.</p>
      </div>
      <div class="device-card-actions">
        ${badges.join('')}
        <button type="button" class="button subtle recent-device-button" data-recent-url="${escapeHTML(localUIURL)}">Open</button>
      </div>
    </article>
  `;
}

export function connectionCenterWindowTitle(): string {
  return 'Choose a device';
}

export function buildConnectionCenterPageHTML(
  snapshot: DesktopConnectionCenterSnapshot,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
): string {
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  const initialError = String(errorMessage ?? '').trim();
  const issue = snapshot.issue;
  const issueTitle = issue?.title ?? '';
  const issueMessage = issue?.message ?? '';
  const issueDiagnostics = issue?.diagnostics_copy ?? '';
  const issueTargetURL = issue?.target_url ?? '';
  const advancedOpen = snapshot.advanced_section_open || Boolean(issueDiagnostics);
  const canSaveAndReturn = snapshot.active_session_target_kind !== null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHTML(connectionCenterWindowTitle())}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: ${desktopLightTheme.pageBackground};
        --bg-elevated: color-mix(in srgb, ${desktopLightTheme.surface} 94%, white);
        --panel: ${desktopLightTheme.surface};
        --panel-soft: color-mix(in srgb, ${desktopLightTheme.surfaceMuted} 72%, white);
        --text: ${desktopLightTheme.text};
        --muted: ${desktopLightTheme.muted};
        --border: ${desktopLightTheme.border};
        --accent: ${desktopLightTheme.accent};
        --accent-soft: ${desktopLightTheme.accentSoft};
        --accent-text: ${desktopLightTheme.accentText};
        --danger: ${desktopLightTheme.danger};
        --warning: ${desktopLightTheme.warning};
        --shadow: 0 28px 60px rgba(22, 30, 43, 0.12);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          color-scheme: dark;
          --bg: ${desktopDarkTheme.pageBackground};
          --bg-elevated: color-mix(in srgb, ${desktopDarkTheme.surface} 92%, black);
          --panel: ${desktopDarkTheme.surface};
          --panel-soft: color-mix(in srgb, ${desktopDarkTheme.surfaceMuted} 72%, black);
          --text: ${desktopDarkTheme.text};
          --muted: ${desktopDarkTheme.muted};
          --border: ${desktopDarkTheme.border};
          --accent: ${desktopDarkTheme.accent};
          --accent-soft: ${desktopDarkTheme.accentSoft};
          --accent-text: ${desktopDarkTheme.accentText};
          --danger: ${desktopDarkTheme.danger};
          --warning: ${desktopDarkTheme.warning};
          --shadow: 0 30px 72px rgba(0, 0, 0, 0.36);
        }
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: calc(26px + ${titleBarInset}) 24px 28px;
        background:
          radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 16%, transparent), transparent 32%),
          linear-gradient(180deg, color-mix(in srgb, var(--bg) 84%, var(--panel-soft)) 0%, var(--bg) 100%);
        color: var(--text);
        font-family: "Aptos", "Avenir Next", "Segoe UI Variable", sans-serif;
      }
      button,
      input,
      summary {
        font: inherit;
      }
      button,
      summary,
      label[for] {
        cursor: pointer;
      }
      .skip-link {
        position: absolute;
        left: 24px;
        top: calc(8px + ${titleBarInset});
        z-index: 10;
        padding: 0.55rem 0.9rem;
        border-radius: 999px;
        background: var(--accent);
        color: var(--accent-text);
        text-decoration: none;
        transform: translateY(-220%);
      }
      .skip-link:focus-visible {
        transform: translateY(0);
        outline: 2px solid color-mix(in srgb, var(--accent) 30%, white);
        outline-offset: 3px;
      }
      main {
        width: min(1080px, 100%);
        margin: 0 auto;
      }
      .shell {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 26px;
        background: color-mix(in srgb, var(--panel) 96%, transparent);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }
      .hero {
        padding: 28px;
        border-bottom: 1px solid var(--border);
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--accent-soft) 58%, transparent), transparent 56%),
          color-mix(in srgb, var(--panel) 92%, transparent);
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted) 80%, transparent);
      }
      .hero-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }
      h1 {
        margin: 0;
        font-size: clamp(30px, 5vw, 46px);
        line-height: 1;
        letter-spacing: -0.03em;
      }
      .hero-badge {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
        background: color-mix(in srgb, var(--accent-soft) 54%, transparent);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .lead {
        margin: 0;
        max-width: 72ch;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.7;
      }
      .hero-meta {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .summary-card {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
      }
      .summary-label {
        margin-bottom: 6px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted) 80%, transparent);
      }
      .summary-value {
        font-size: 15px;
        font-weight: 700;
      }
      .summary-body {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .content {
        display: grid;
        gap: 18px;
        padding: 20px;
      }
      .inline-error {
        display: grid;
        gap: 6px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, var(--panel));
      }
      .inline-error[hidden] {
        display: none;
      }
      .inline-error-kicker {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--danger) 78%, var(--text));
      }
      .inline-error-title {
        font-size: 18px;
        font-weight: 700;
      }
      .inline-error-body {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.95fr);
        gap: 18px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: color-mix(in srgb, var(--panel) 94%, transparent);
        overflow: hidden;
      }
      .panel-header {
        padding: 18px 18px 0;
      }
      .panel-kicker {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted) 80%, transparent);
      }
      .panel-title {
        margin: 0;
        font-size: 22px;
        line-height: 1.15;
      }
      .panel-description {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.7;
      }
      .panel-body {
        display: grid;
        gap: 16px;
        padding: 18px;
      }
      .this-device-summary {
        display: grid;
        gap: 10px;
      }
      .this-device-summary-card {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--panel-soft);
      }
      .this-device-summary-title {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 700;
      }
      .this-device-summary-copy {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .button-row {
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
        background: var(--panel);
        color: var(--text);
        font-weight: 700;
        text-decoration: none;
        transition: transform 150ms ease, background-color 150ms ease, border-color 150ms ease;
      }
      .button:hover {
        transform: translateY(-1px);
      }
      .button.primary {
        border-color: transparent;
        background: var(--accent);
        color: var(--accent-text);
      }
      .button.subtle {
        background: color-mix(in srgb, var(--panel-soft) 78%, transparent);
      }
      .button.danger {
        border-color: color-mix(in srgb, var(--danger) 34%, var(--border));
        background: color-mix(in srgb, var(--danger) 8%, var(--panel));
      }
      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.65;
        transform: none;
      }
      .device-list {
        display: grid;
        gap: 12px;
      }
      .device-card {
        display: grid;
        gap: 12px;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--panel-soft);
      }
      .device-card h3 {
        margin: 0;
        font-size: 16px;
        line-height: 1.4;
        word-break: break-word;
      }
      .device-card p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .device-card-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .device-card-kicker,
      .device-badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .field {
        display: grid;
        gap: 7px;
      }
      .field-label {
        font-size: 12px;
        font-weight: 700;
      }
      .field-help {
        color: var(--muted);
        font-size: 11px;
        line-height: 1.6;
      }
      .field-row {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      input {
        width: 100%;
        min-height: 42px;
        padding: 0 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
        color: var(--text);
      }
      input::placeholder {
        color: color-mix(in srgb, var(--muted) 82%, transparent);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      .choice-grid {
        display: grid;
        gap: 10px;
      }
      .choice-option {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-soft) 82%, transparent);
      }
      .choice-option:hover {
        border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
      }
      .choice-option:has(input:checked) {
        border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
        background: color-mix(in srgb, var(--accent-soft) 52%, transparent);
      }
      .choice-option input {
        width: 18px;
        min-height: 18px;
        margin: 2px 0 0;
        accent-color: var(--accent);
      }
      .choice-title {
        display: block;
        font-size: 13px;
        font-weight: 700;
      }
      .choice-help {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      details {
        border: 1px solid var(--border);
        border-radius: 18px;
        background: color-mix(in srgb, var(--panel) 94%, transparent);
        overflow: hidden;
      }
      summary {
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        font-size: 15px;
        font-weight: 700;
      }
      summary::-webkit-details-marker {
        display: none;
      }
      .summary-meta {
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
      }
      .details-body {
        display: grid;
        gap: 16px;
        padding: 0 18px 18px;
        border-top: 1px solid var(--border);
      }
      .details-note {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.7;
      }
      .diagnostics {
        display: grid;
        gap: 12px;
      }
      .diagnostics pre {
        margin: 0;
        padding: 14px;
        border-radius: 16px;
        background: #181d24;
        color: #f4f6fb;
        overflow: auto;
        font-size: 12px;
        line-height: 1.65;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding-top: 4px;
      }
      .footer-copy {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      :focus-visible {
        outline: 2px solid color-mix(in srgb, var(--accent) 38%, white);
        outline-offset: 3px;
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
      @media (max-width: 900px) {
        .layout,
        .hero-meta,
        .field-row {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 640px) {
        body {
          padding-inline: 16px;
        }
        .hero,
        .content,
        .panel-body {
          padding-inline: 16px;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#connection-center-main">Skip to main content</a>
    <main id="connection-center-main">
      <section class="shell">
        <header class="hero">
          <p class="eyebrow">Redeven Desktop</p>
          <div class="hero-row">
            <h1>Choose a device</h1>
            <span class="hero-badge">${escapeHTML(snapshot.active_session_target_kind ? activeSessionLabel(snapshot) : 'Startup')}</span>
          </div>
          <p class="lead">${escapeHTML(pageLead(snapshot))}</p>
          <div class="hero-meta">
            <article class="summary-card">
              <div class="summary-label">Current session</div>
              <div class="summary-value">${escapeHTML(activeSessionLabel(snapshot))}</div>
              <p class="summary-body">${escapeHTML(activeSessionBody(snapshot))}</p>
            </article>
            <article class="summary-card">
              <div class="summary-label">Remembered target</div>
              <div class="summary-value">${escapeHTML(snapshot.remembered_target_kind === 'external_local_ui' ? 'Another device' : 'This device')}</div>
              <p class="summary-body">Desktop suggests the remembered target, but it never opens it automatically on launch.</p>
            </article>
            <article class="summary-card">
              <div class="summary-label">Recovery model</div>
              <div class="summary-value">Same-window flow</div>
              <p class="summary-body">Selection, recovery, and advanced troubleshooting stay in one main-window surface.</p>
            </article>
          </div>
        </header>

        <section class="content">
          <section id="connection-error" class="inline-error" role="alert" aria-live="assertive" aria-hidden="${initialError ? 'false' : 'true'}"${initialError ? '' : ' hidden'} tabindex="-1">
            <div class="inline-error-kicker">Validation</div>
            <div class="inline-error-title">Check these fields</div>
            <p class="inline-error-body">${escapeHTML(initialError)}</p>
          </section>

          <section id="chooser-issue" class="inline-error" role="alert" aria-live="polite" aria-hidden="${issue ? 'false' : 'true'}"${issue ? '' : ' hidden'} tabindex="-1">
            <div class="inline-error-kicker">${escapeHTML(issue?.scope === 'remote_device' ? 'Remote device' : issue?.scope === 'this_device' ? 'This device' : 'Desktop startup')}</div>
            <div id="chooser-issue-title" class="inline-error-title">${escapeHTML(issueTitle)}</div>
            <p id="chooser-issue-message" class="inline-error-body">${escapeHTML(issueMessage)}</p>
          </section>

          <div class="layout">
            <div class="stack">
              <section class="panel">
                <div class="panel-header">
                  <p class="panel-kicker">Recommended first step</p>
                  <h2 class="panel-title">This device</h2>
                  <p class="panel-description">Open the Redeven runtime on this machine, with sharing and one-shot remote control options available below when you need them.</p>
                </div>
                <div class="panel-body">
                  <div class="this-device-summary">
                    <article class="this-device-summary-card">
                      <h3 class="this-device-summary-title">${escapeHTML(thisDeviceStatusValue(snapshot))}</h3>
                      <p class="this-device-summary-copy">${escapeHTML(thisDeviceStatusBody(snapshot))}</p>
                    </article>
                    <article class="this-device-summary-card">
                      <h3 class="this-device-summary-title">${escapeHTML(thisDeviceShareValue(snapshot))}</h3>
                      <p class="this-device-summary-copy">${escapeHTML(thisDeviceShareBody(snapshot))}</p>
                    </article>
                    <article class="this-device-summary-card">
                      <h3 class="this-device-summary-title">${escapeHTML(thisDeviceLinkValue(snapshot))}</h3>
                      <p class="this-device-summary-copy">${escapeHTML(thisDeviceLinkBody(snapshot))}</p>
                    </article>
                  </div>
                  <div class="button-row">
                    <button id="open-this-device" type="button" class="button primary">Open This Device</button>
                    ${canSaveAndReturn ? '<button id="save-and-return" type="button" class="button subtle">Save and return</button>' : ''}
                  </div>
                </div>
              </section>

              <section class="panel">
                <div class="panel-header">
                  <p class="panel-kicker">Recent devices</p>
                  <h2 class="panel-title">Open another machine</h2>
                  <p class="panel-description">Choose a recent Redeven Local UI target or paste a new Redeven URL below.</p>
                </div>
                <div class="panel-body">
                  <section id="recent-devices-section"${snapshot.recent_devices.length > 0 ? '' : ' hidden'}>
                    <div class="device-list">
                      ${snapshot.recent_devices.map((item, index) => renderRecentDeviceCard(snapshot, item.local_ui_url, index)).join('')}
                    </div>
                  </section>
                  <section class="device-card">
                    <div class="device-card-copy">
                      <div class="device-card-kicker">Paste a Redeven URL</div>
                      <h3>Open another device</h3>
                      <p>Enter the base Redeven Local UI URL from another machine on your network.</p>
                    </div>
                    <div class="field">
                      <label class="field-label" for="external-local-ui-url">Redeven URL</label>
                      <input id="external-local-ui-url" type="url" autocomplete="url" spellcheck="false" placeholder="http://192.168.1.11:24000/" value="${escapeHTML(snapshot.draft.external_local_ui_url)}">
                      <div class="field-help">Desktop normalizes Local UI URLs to their base path before opening them.</div>
                    </div>
                    <div class="button-row">
                      <button id="open-remote-device" type="button" class="button subtle">Open Device</button>
                    </div>
                  </section>
                </div>
              </section>
            </div>

            <div class="stack">
              <details id="this-device-options"${snapshot.advanced_section_open ? ' open' : ''}>
                <summary>
                  <span>This device options</span>
                  <span class="summary-meta">Sharing, raw bind, password, and one-shot link request</span>
                </summary>
                <div class="details-body">
                  <p class="details-note">These inputs configure This device. They are applied whenever you open This device from this chooser.</p>
                  <fieldset class="field">
                    <legend class="field-label">How should This device be exposed?</legend>
                    <div class="choice-grid">
                      <label class="choice-option" for="share-this-device">
                        <input id="share-this-device" type="radio" name="share_preset" value="this_device">
                        <span>
                          <span class="choice-title">Only this device</span>
                          <span class="choice-help">Keep Local UI private on a loopback-only dynamic port.</span>
                        </span>
                      </label>
                      <label class="choice-option" for="share-local-network">
                        <input id="share-local-network" type="radio" name="share_preset" value="local_network">
                        <span>
                          <span class="choice-title">Local network</span>
                          <span class="choice-help">Expose This device on ${escapeHTML(DEFAULT_LOCAL_NETWORK_BIND)} with a generated password.</span>
                        </span>
                      </label>
                      <label class="choice-option" for="share-custom">
                        <input id="share-custom" type="radio" name="share_preset" value="custom">
                        <span>
                          <span class="choice-title">Custom</span>
                          <span class="choice-help">Set the raw bind and password manually.</span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  <div id="local-network-password-row" class="field" hidden>
                    <label class="field-label" for="local-network-password">Local network password</label>
                    <input id="local-network-password" type="password" autocomplete="new-password" spellcheck="false">
                    <div class="field-help">Desktop generates a password automatically if you leave this blank.</div>
                  </div>

                  <div id="custom-bind-row" class="field-row" hidden>
                    <div class="field">
                      <label class="field-label" for="custom-local-ui-bind">Local UI bind address</label>
                      <input id="custom-local-ui-bind" type="text" autocomplete="off" spellcheck="false">
                    </div>
                    <div class="field">
                      <label class="field-label" for="custom-local-ui-password">Local UI password</label>
                      <input id="custom-local-ui-password" type="password" autocomplete="new-password" spellcheck="false">
                    </div>
                  </div>

                  <div class="field-row">
                    <div class="field">
                      <label class="field-label" for="controlplane-url">Control plane URL</label>
                      <input id="controlplane-url" type="url" autocomplete="url" spellcheck="false" placeholder="https://region.example.invalid">
                    </div>
                    <div class="field">
                      <label class="field-label" for="env-id">Environment ID</label>
                      <input id="env-id" type="text" autocomplete="off" spellcheck="false">
                    </div>
                  </div>
                  <div class="field">
                    <label class="field-label" for="env-token">Environment token</label>
                    <input id="env-token" type="password" autocomplete="off" spellcheck="false">
                    <div class="field-help">These link fields are stored locally and only sent on the next successful This device start.</div>
                  </div>
                </div>
              </details>

              <details id="advanced-troubleshooting"${advancedOpen ? ' open' : ''}>
                <summary>
                  <span>Advanced troubleshooting</span>
                  <span class="summary-meta">Diagnostics and same-surface recovery</span>
                </summary>
                <div class="details-body">
                  <p class="details-note">Use this section when This device startup or a remote device connection needs more context. The normal machine-selection flow still stays above.</p>
                  <div id="diagnostics-panel" class="diagnostics"${issueDiagnostics ? '' : ' hidden'}>
                    <div class="field">
                      <label class="field-label" for="diagnostics-copy">Diagnostics</label>
                      <input id="issue-target-url" type="text" value="${escapeHTML(issueTargetURL)}" hidden>
                      <pre id="diagnostics-copy">${escapeHTML(issueDiagnostics)}</pre>
                    </div>
                    <div class="button-row">
                      <button id="copy-diagnostics" type="button" class="button subtle">Copy diagnostics</button>
                    </div>
                  </div>
                  <p class="details-note">If you opened this screen from a legacy desktop command, you can still use it as the expert fallback without splitting the primary startup flow into another window.</p>
                </div>
              </details>
            </div>
          </div>

          <footer class="footer">
            <div class="footer-copy">Desktop treats machine selection as the primary decision. Advanced fields stay secondary so startup always begins with the user’s intent.</div>
            <button id="cancel" type="button" class="button danger">${escapeHTML(snapshot.cancel_label)}</button>
          </footer>
        </section>
      </section>
    </main>

    <script id="redeven-connection-center-state" type="application/json">${serializeJSON(snapshot)}</script>
    <script>
      const snapshot = JSON.parse(document.getElementById('redeven-connection-center-state').textContent || '{}');
      const defaultDraft = snapshot.draft || {};
      const errorEl = document.getElementById('connection-error');
      const issueEl = document.getElementById('chooser-issue');
      const diagnosticsPanel = document.getElementById('diagnostics-panel');
      const diagnosticsCopyEl = document.getElementById('diagnostics-copy');
      const externalLocalUIURL = document.getElementById('external-local-ui-url');
      const localNetworkPassword = document.getElementById('local-network-password');
      const customLocalUIBind = document.getElementById('custom-local-ui-bind');
      const customLocalUIPassword = document.getElementById('custom-local-ui-password');
      const controlplaneURL = document.getElementById('controlplane-url');
      const envID = document.getElementById('env-id');
      const envToken = document.getElementById('env-token');
      const sharePresetInputs = Array.from(document.querySelectorAll('input[name="share_preset"]'));
      const openThisDeviceButton = document.getElementById('open-this-device');
      const openRemoteDeviceButton = document.getElementById('open-remote-device');
      const cancelButton = document.getElementById('cancel');
      const saveAndReturnButton = document.getElementById('save-and-return');
      const recentDeviceButtons = Array.from(document.querySelectorAll('.recent-device-button'));
      const localNetworkPasswordRow = document.getElementById('local-network-password-row');
      const customBindRow = document.getElementById('custom-bind-row');
      const copyDiagnosticsButton = document.getElementById('copy-diagnostics');
      const initialLocalNetworkBind = snapshot.this_device_share_preset === 'local_network' && typeof defaultDraft.local_ui_bind === 'string' && defaultDraft.local_ui_bind.trim() !== ''
        ? defaultDraft.local_ui_bind
        : '${DEFAULT_LOCAL_NETWORK_BIND}';

      function selectedSharePreset() {
        const selected = sharePresetInputs.find((input) => input.checked);
        return selected ? selected.value : (snapshot.this_device_share_preset || 'this_device');
      }

      function generatePassword() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        const bytes = new Uint8Array(18);
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
          globalThis.crypto.getRandomValues(bytes);
        } else {
          for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 255);
          }
        }
        return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
      }

      function setError(text) {
        errorEl.querySelector('.inline-error-body').textContent = text;
        errorEl.hidden = !text;
        errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');
        if (text) {
          queueMicrotask(() => errorEl.focus());
        }
      }

      function syncShareMode() {
        const preset = selectedSharePreset();
        localNetworkPasswordRow.hidden = preset !== 'local_network';
        customBindRow.hidden = preset !== 'custom';
      }

      function ensureLocalNetworkPassword() {
        const clean = String(localNetworkPassword.value || '').trim();
        if (clean) {
          return clean;
        }
        const generated = generatePassword();
        localNetworkPassword.value = generated;
        return generated;
      }

      function buildDraft(targetKind, explicitExternalURL) {
        const sharePreset = selectedSharePreset();
        let localUIBind = String(defaultDraft.local_ui_bind || '127.0.0.1:0');
        let localUIPassword = String(defaultDraft.local_ui_password || '');
        if (sharePreset === 'this_device') {
          localUIBind = '127.0.0.1:0';
          localUIPassword = '';
        } else if (sharePreset === 'local_network') {
          localUIBind = initialLocalNetworkBind;
          localUIPassword = ensureLocalNetworkPassword();
        } else {
          localUIBind = String(customLocalUIBind.value || '').trim();
          localUIPassword = String(customLocalUIPassword.value || '');
        }

        return {
          target_kind: targetKind,
          external_local_ui_url: String(explicitExternalURL || '').trim(),
          local_ui_bind: localUIBind,
          local_ui_password: localUIPassword,
          controlplane_url: String(controlplaneURL.value || '').trim(),
          env_id: String(envID.value || '').trim(),
          env_token: String(envToken.value || ''),
        };
      }

      async function persistDraft(draft) {
        if (!window.redevenDesktopSettings || typeof window.redevenDesktopSettings.save !== 'function') {
          setError('Redeven Desktop settings bridge is unavailable in this window.');
          return;
        }
        setError('');
        const result = await window.redevenDesktopSettings.save(draft);
        if (!result || result.ok !== true) {
          setError(result && result.error ? result.error : 'Redeven Desktop could not save this request.');
        }
      }

      async function saveAndReturn() {
        if (!snapshot.active_session_target_kind) {
          return;
        }
        const externalURL = snapshot.active_session_target_kind === 'external_local_ui'
          ? (snapshot.active_session_local_ui_url || defaultDraft.external_local_ui_url || '')
          : '';
        await persistDraft(buildDraft(snapshot.active_session_target_kind, externalURL));
      }

      async function copyDiagnostics() {
        const diagnosticsText = String(diagnosticsCopyEl ? diagnosticsCopyEl.textContent || '' : '').trim();
        if (!diagnosticsText) {
          return;
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(diagnosticsText);
          return;
        }
        const selection = document.getSelection();
        const range = document.createRange();
        range.selectNodeContents(diagnosticsCopyEl);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
      }

      sharePresetInputs.forEach((input) => {
        input.checked = input.value === (snapshot.this_device_share_preset || 'this_device');
        input.addEventListener('change', syncShareMode);
      });

      localNetworkPassword.value = snapshot.this_device_share_preset === 'local_network'
        ? String(defaultDraft.local_ui_password || '')
        : '';
      customLocalUIBind.value = snapshot.this_device_share_preset === 'custom'
        ? String(defaultDraft.local_ui_bind || '')
        : '';
      customLocalUIPassword.value = snapshot.this_device_share_preset === 'custom'
        ? String(defaultDraft.local_ui_password || '')
        : '';
      controlplaneURL.value = String(defaultDraft.controlplane_url || '');
      envID.value = String(defaultDraft.env_id || '');
      envToken.value = String(defaultDraft.env_token || '');

      syncShareMode();

      openThisDeviceButton.addEventListener('click', () => {
        void persistDraft(buildDraft('managed_local', ''));
      });
      openRemoteDeviceButton.addEventListener('click', () => {
        void persistDraft(buildDraft('external_local_ui', externalLocalUIURL.value));
      });
      if (saveAndReturnButton) {
        saveAndReturnButton.addEventListener('click', () => {
          void saveAndReturn();
        });
      }
      recentDeviceButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const recentURL = button.getAttribute('data-recent-url') || '';
          externalLocalUIURL.value = recentURL;
          void persistDraft(buildDraft('external_local_ui', recentURL));
        });
      });
      cancelButton.addEventListener('click', () => {
        window.redevenDesktopSettings.cancel();
      });
      if (copyDiagnosticsButton) {
        copyDiagnosticsButton.addEventListener('click', () => {
          void copyDiagnostics();
        });
      }

      if (!diagnosticsPanel.hidden) {
        document.getElementById('advanced-troubleshooting').open = true;
      }
      if (issueEl && !issueEl.hidden && issueEl.textContent.trim() !== '') {
        queueMicrotask(() => issueEl.focus());
      } else if (!errorEl.hidden && errorEl.textContent.trim() !== '') {
        queueMicrotask(() => errorEl.focus());
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
  return `data:text/html;charset=UTF-8,${encodeURIComponent(buildConnectionCenterPageHTML(snapshot, errorMessage, platform))}`;
}
