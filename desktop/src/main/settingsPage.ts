import { desktopTheme } from './desktopTheme';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

export type DesktopPageMode = 'desktop_settings' | 'connect';

function escapeHTML(value: string): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializeDraft(draft: DesktopSettingsDraft): string {
  return JSON.stringify(draft)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function serializeMode(mode: DesktopPageMode): string {
  return JSON.stringify(mode)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function desktopHostThisDeviceStateNote(externalMode: boolean): string {
  return externalMode
    ? 'Desktop is currently targeting External Redeven. These values stay saved for the next This device start.'
    : 'These values apply to desktop-managed starts on this machine.';
}

function desktopBootstrapStateNote(externalMode: boolean): string {
  return externalMode
    ? 'Desktop is currently targeting External Redeven. This request stays saved for the next This device start and is never sent to the external target.'
    : 'If saved, the next successful desktop-managed start on this device will consume and clear them automatically.';
}

function desktopSaveButtonLabel(externalMode: boolean): string {
  return externalMode ? 'Save for this device' : 'Save and apply';
}

function connectSaveButtonLabel(externalMode: boolean): string {
  return externalMode ? 'Connect' : 'Use this device';
}

export function pageWindowTitle(mode: DesktopPageMode): string {
  return mode === 'connect' ? 'Connect to Redeven' : 'Desktop Settings';
}

function pageLead(mode: DesktopPageMode): string {
  return mode === 'connect'
    ? 'Choose whether Desktop opens this machine or another Redeven Local UI endpoint.'
    : 'Configure how Desktop starts, exposes, and bootstraps the bundled Redeven runtime when this app is targeting this device.';
}

function currentTargetLabel(externalMode: boolean): string {
  return externalMode ? 'External Redeven' : 'This device';
}

function currentTargetSummary(externalMode: boolean): string {
  return externalMode
    ? 'Desktop opens another machine\'s Local UI inside this shell.'
    : 'Desktop starts the bundled runtime on this machine.';
}

function summaryCardsHTML(
  mode: DesktopPageMode,
  externalMode: boolean,
  hostThisDeviceStateNote: string,
  bootstrapStateNote: string,
): string {
  if (mode === 'connect') {
    return `
      <section class="summary-grid" aria-label="Current configuration summary">
        <article class="summary-card">
          <div class="summary-label">Current target</div>
          <div id="target-summary-value" class="summary-value">${escapeHTML(currentTargetLabel(externalMode))}</div>
          <p id="target-summary-note" class="summary-copy">${escapeHTML(currentTargetSummary(externalMode))}</p>
        </article>
        <article class="summary-card">
          <div class="summary-label">Desktop settings</div>
          <div class="summary-value">Stay separate</div>
          <p class="summary-copy">
            Host This Device and Register to Redeven on next start stay in Desktop Settings. Agent runtime configuration appears later inside Agent Settings after Local UI opens.
          </p>
        </article>
        <article class="summary-card">
          <div class="summary-label">External URLs</div>
          <div class="summary-value">IP or localhost only</div>
          <p class="summary-copy">
            Paste a Local UI base URL using localhost or an IP literal. Hostnames are intentionally not supported.
          </p>
        </article>
      </section>
    `;
  }

  return `
    <section class="summary-grid" aria-label="Current configuration summary">
      <article class="summary-card">
        <div class="summary-label">Current target</div>
        <div id="target-summary-value" class="summary-value">${escapeHTML(currentTargetLabel(externalMode))}</div>
        <p id="target-summary-note" class="summary-copy">${escapeHTML(currentTargetSummary(externalMode))}</p>
      </article>
      <article class="summary-card">
        <div class="summary-label">Host This Device</div>
        <div class="summary-value">Desktop-managed Local UI</div>
        <p id="host-summary-note" class="summary-copy">${escapeHTML(hostThisDeviceStateNote)}</p>
      </article>
      <article class="summary-card">
        <div class="summary-label">Next start</div>
        <div class="summary-value">One-shot bootstrap</div>
        <p id="bootstrap-summary-note" class="summary-copy">${escapeHTML(bootstrapStateNote)}</p>
      </article>
    </section>
  `;
}

function modeCalloutHTML(mode: DesktopPageMode, externalMode: boolean): string {
  if (mode === 'connect') {
    return `
      <section class="notice-panel">
        <div class="notice-mark" aria-hidden="true"></div>
        <div class="notice-content">
          <div class="notice-kicker">Separate Responsibilities</div>
          <h2>Desktop Settings stay separate</h2>
          <p class="section-note">
            Host This Device and Register to Redeven on next start live in Desktop Settings. Agent runtime configuration appears later inside Agent Settings after Local UI opens.
          </p>
        </div>
      </section>
    `;
  }

  const detail = externalMode
    ? 'Desktop is currently targeting External Redeven, so the values below are stored for the next time you switch back to This device.'
    : 'Use Connect to Redeven... from the app menu when you want to switch between This device and External Redeven.';

  return `
    <section class="notice-panel">
      <div class="notice-mark" aria-hidden="true"></div>
      <div class="notice-content">
        <div class="notice-kicker">Connection Target</div>
        <h2>Connection target is managed separately</h2>
        <p class="section-note">${escapeHTML(detail)}</p>
      </div>
    </section>
  `;
}

function targetSectionHTML(): string {
  return `
    <section class="panel">
      <div class="panel-header">
        <div class="panel-heading">
          <div class="panel-kicker">Connection</div>
          <div class="panel-title-row">
            <div class="panel-mark" aria-hidden="true"></div>
            <h2>Connect to Redeven</h2>
          </div>
          <p class="section-note">
            Switch between this machine and another Redeven Local UI endpoint without mixing that choice into Desktop startup settings.
          </p>
        </div>
        <div class="panel-pill">Connection target</div>
      </div>
      <div class="panel-body">
        <fieldset class="field">
          <legend class="field-label">Target</legend>
          <div class="choice-grid">
            <label class="choice-option" for="target-kind-managed-local">
              <input id="target-kind-managed-local" type="radio" name="target_kind" value="managed_local">
              <span class="choice-title">This device</span>
              <span class="choice-help">Use the bundled Desktop-managed Redeven runtime on this machine.</span>
            </label>
            <label class="choice-option" for="target-kind-external-local-ui">
              <input id="target-kind-external-local-ui" type="radio" name="target_kind" value="external_local_ui">
              <span class="choice-title">External Redeven</span>
              <span class="choice-help">Open another machine’s Redeven Local UI directly inside this Desktop shell.</span>
            </label>
          </div>
          <div id="target-kind-help" class="field-help">Choose where Desktop opens the Redeven Local UI.</div>
        </fieldset>
        <div id="external-local-ui-url-row" class="field">
          <label class="field-label" for="external-local-ui-url">Redeven URL</label>
          <input id="external-local-ui-url" name="external_local_ui_url" autocomplete="url" inputmode="url" spellcheck="false" aria-describedby="external-local-ui-url-help settings-error" placeholder="http://192.168.1.11:24000/">
          <div id="external-local-ui-url-help" class="field-help">Paste the Local UI base URL. Hostnames are intentionally not supported; use localhost or an IP literal.</div>
        </div>
      </div>
    </section>
  `;
}

function desktopSettingsSectionsHTML(hostThisDeviceStateNote: string, bootstrapStateNote: string): string {
  return `
    <section class="panel">
      <div class="panel-header">
        <div class="panel-heading">
          <div class="panel-kicker">Desktop Startup</div>
          <div class="panel-title-row">
            <div class="panel-mark" aria-hidden="true"></div>
            <h2>Host This Device</h2>
          </div>
          <p class="section-note">
            Use <code>127.0.0.1:0</code> for the default loopback-only dynamic port, or an explicit address such as <code>0.0.0.0:24000</code> to make this Desktop reachable on your LAN.
            <span id="host-this-device-state-note" class="state-note" aria-live="polite">${escapeHTML(hostThisDeviceStateNote)}</span>
          </p>
        </div>
        <div class="panel-pill">Desktop shell</div>
      </div>
      <div class="panel-body">
        <div class="field">
          <label class="field-label" for="local-ui-bind">Local UI bind address</label>
          <input id="local-ui-bind" name="local_ui_bind" autocomplete="off" spellcheck="false" aria-describedby="local-ui-bind-help settings-error">
          <div id="local-ui-bind-help" class="field-help">Non-loopback Local UI binds require a Local UI password.</div>
        </div>
        <div class="field">
          <label class="field-label" for="local-ui-password">Local UI password</label>
          <input id="local-ui-password" name="local_ui_password" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="local-ui-password-help settings-error">
          <div id="local-ui-password-help" class="field-help">Desktop stores this secret locally and passes it through <code>--password-env</code>.</div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div class="panel-heading">
          <div class="panel-kicker">Next Start</div>
          <div class="panel-title-row">
            <div class="panel-mark" aria-hidden="true"></div>
            <h2>Register to Redeven on next start</h2>
          </div>
          <p class="section-note">
            These values are treated as a one-shot bootstrap request for the next successful desktop-managed start on this device, then cleared automatically.
            <span id="bootstrap-state-note" class="state-note" aria-live="polite">${escapeHTML(bootstrapStateNote)}</span>
          </p>
        </div>
        <div class="panel-pill">One-shot request</div>
      </div>
      <div class="panel-body">
        <div class="field">
          <label class="field-label" for="controlplane-url">Control plane URL</label>
          <input id="controlplane-url" name="controlplane_url" autocomplete="url" inputmode="url" spellcheck="false" aria-describedby="settings-error">
        </div>
        <div class="field">
          <label class="field-label" for="env-id">Environment ID</label>
          <input id="env-id" name="env_id" autocomplete="off" spellcheck="false" aria-describedby="settings-error">
        </div>
        <div class="field">
          <label class="field-label" for="env-token">Environment token</label>
          <input id="env-token" name="env_token" type="password" autocomplete="off" spellcheck="false" aria-describedby="env-token-help settings-error">
          <div id="env-token-help" class="field-help">Desktop passes this secret through <code>--env-token-env</code> instead of putting it in the process arguments.</div>
        </div>
      </div>
    </section>
  `;
}

export function buildSettingsPageHTML(
  draft: DesktopSettingsDraft,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
  mode: DesktopPageMode = 'desktop_settings',
): string {
  const error = String(errorMessage ?? '').trim();
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  const externalMode = draft.target_kind === 'external_local_ui';
  const hostThisDeviceStateNote = desktopHostThisDeviceStateNote(externalMode);
  const bootstrapStateNote = desktopBootstrapStateNote(externalMode);
  const saveButtonLabel = mode === 'connect' ? connectSaveButtonLabel(externalMode) : desktopSaveButtonLabel(externalMode);
  const pageTitle = pageWindowTitle(mode);
  const pageStatusLabel = currentTargetLabel(externalMode);
  const bodyHTML = mode === 'connect'
    ? targetSectionHTML()
    : desktopSettingsSectionsHTML(hostThisDeviceStateNote, bootstrapStateNote);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHTML(pageTitle)}</title>
    <style>
      :root {
        color-scheme: light;
        --background: ${desktopTheme.pageBackground};
        --foreground: ${desktopTheme.text};
        --primary: ${desktopTheme.accent};
        --primary-foreground: ${desktopTheme.accentText};
        --secondary: ${desktopTheme.surfaceMuted};
        --accent: ${desktopTheme.accentSoft};
        --accent-foreground: ${desktopTheme.text};
        --card: ${desktopTheme.surface};
        --card-foreground: ${desktopTheme.text};
        --border: ${desktopTheme.border};
        --input: ${desktopTheme.border};
        --ring: ${desktopTheme.accent};
        --muted: ${desktopTheme.surfaceMuted};
        --muted-foreground: ${desktopTheme.muted};
        --info: oklch(0.65 0.13 250);
        --danger: ${desktopTheme.danger};
        --shadow: 0 18px 40px rgba(19, 30, 47, 0.08);
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
        width: min(1040px, 100%);
        margin: 0 auto;
      }
      .workspace-shell {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: color-mix(in srgb, var(--card) 96%, white);
        box-shadow: var(--shadow);
      }
      .workspace-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        padding: 20px 22px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--card) 75%, var(--background));
      }
      .workspace-heading {
        display: grid;
        gap: 8px;
        min-width: 0;
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
        font-size: clamp(21px, 3vw, 27px);
        line-height: 1.15;
        letter-spacing: -0.02em;
      }
      p.lead {
        margin: 0;
        color: var(--muted-foreground);
        line-height: 1.65;
        max-width: 70ch;
        font-size: 13px;
      }
      .status-chip {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--secondary) 72%, white);
        color: var(--foreground);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .status-chip[data-tone="external"] {
        border-color: color-mix(in srgb, var(--info) 35%, var(--border));
        background: color-mix(in srgb, var(--info) 10%, var(--background));
        color: color-mix(in srgb, var(--foreground) 86%, var(--info));
      }
      .workspace-side {
        width: min(300px, 100%);
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--background) 80%, white);
      }
      .side-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .side-copy {
        margin: 0;
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.6;
      }
      form {
        display: grid;
        gap: 14px;
        padding: 18px;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .summary-card {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--card);
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
      .notice-panel {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 14px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--muted) 28%, var(--card));
      }
      .notice-mark {
        width: 4px;
        min-height: 100%;
        border-radius: 999px;
        background: var(--primary);
      }
      .notice-content {
        display: grid;
        gap: 4px;
      }
      .notice-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      h2 {
        margin: 0;
        font-size: 16px;
        line-height: 1.2;
      }
      p.section-note {
        margin: 0;
        color: var(--muted-foreground);
        line-height: 1.6;
        font-size: 12px;
      }
      .panel {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--card);
      }
      .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--muted) 24%, var(--card));
      }
      .panel-heading {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .panel-kicker {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
      }
      .panel-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .panel-mark {
        width: 3px;
        height: 18px;
        border-radius: 999px;
        background: var(--primary);
      }
      .panel-pill {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--background);
        color: var(--muted-foreground);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .panel-body {
        padding: 16px;
        display: grid;
        gap: 14px;
      }
      .field {
        display: grid;
        gap: 6px;
      }
      .field-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
      }
      .field-help {
        color: var(--muted-foreground);
        font-size: 11px;
        line-height: 1.55;
      }
      input {
        width: 100%;
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--input);
        background: var(--background);
        color: var(--foreground);
        padding: 0 12px;
        font-size: 12px;
        box-shadow: 0 1px 2px rgba(19, 30, 47, 0.04);
      }
      input::placeholder {
        color: color-mix(in srgb, var(--muted-foreground) 72%, transparent);
      }
      input:focus-visible,
      button:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--ring) 18%, transparent);
        outline-offset: 0;
        border-color: var(--ring);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 14%, transparent);
      }
      .choice-grid {
        display: grid;
        gap: 10px;
      }
      fieldset {
        margin: 0;
        min-width: 0;
        padding: 0;
        border: 0;
      }
      .choice-option {
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr);
        gap: 8px 10px;
        align-items: start;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--background);
        cursor: pointer;
        transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
      }
      .choice-option:has(input:checked) {
        border-color: color-mix(in srgb, var(--ring) 35%, var(--border));
        background: color-mix(in srgb, var(--accent) 60%, var(--background));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ring) 12%, transparent);
      }
      .choice-option:has(input:focus-visible) {
        outline: 2px solid color-mix(in srgb, var(--ring) 18%, transparent);
        outline-offset: 2px;
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
      code {
        padding: 0 6px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--muted) 62%, var(--background));
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 11px;
      }
      .state-note {
        display: block;
        margin-top: 8px;
        font-weight: 600;
        color: var(--foreground);
      }
      .form-footer {
        display: grid;
        gap: 12px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--muted) 22%, var(--card));
      }
      .error {
        display: ${error ? 'block' : 'none'};
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: var(--danger);
        line-height: 1.55;
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        min-height: 32px;
        border-radius: 8px;
        border: 1px solid var(--input);
        background: var(--background);
        color: var(--foreground);
        padding: 0 12px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 1px 2px rgba(19, 30, 47, 0.04);
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
      }
      button.primary {
        border-color: var(--primary);
        background: var(--primary);
        color: var(--primary-foreground);
      }
      button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 88%, white);
      }
      button.primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--primary) 92%, black);
      }
      button:disabled {
        opacity: 0.65;
        cursor: wait;
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
        .workspace-header { padding: 16px; }
        form { padding: 14px; }
        .workspace-side { width: 100%; }
        .summary-grid { grid-template-columns: 1fr; }
        .panel-header { flex-direction: column; }
        .panel-pill { align-self: flex-start; }
        .actions { flex-direction: column-reverse; }
        button { width: 100%; }
        .skip-link { left: 12px; }
      }
      @media (max-width: 900px) {
        .workspace-header { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#settings-main">Skip to main content</a>
    <main id="settings-main" tabindex="-1">
      <div class="workspace-shell">
        <header class="workspace-header">
          <div class="workspace-heading">
            <p class="eyebrow">Redeven Desktop</p>
            <div class="title-row">
              <h1>${escapeHTML(pageTitle)}</h1>
              <span id="page-status-badge" class="status-chip" data-tone="${externalMode ? 'external' : 'local'}">${escapeHTML(pageStatusLabel)}</span>
            </div>
            <p id="page-lead" class="lead">${escapeHTML(pageLead(mode))}</p>
          </div>
          <aside class="workspace-side" aria-label="Desktop shell note">
            <div class="side-kicker">Desktop shell</div>
            <p class="side-copy">
              Target selection stays here. Agent runtime configuration appears later inside Agent Settings after Local UI opens.
            </p>
          </aside>
        </header>
        <form id="settings-form" aria-describedby="page-lead settings-error">
          ${summaryCardsHTML(mode, externalMode, hostThisDeviceStateNote, bootstrapStateNote)}
          ${modeCalloutHTML(mode, externalMode)}
          ${bodyHTML}

          <div class="form-footer">
            <div id="settings-error" class="error" role="alert" aria-live="assertive" tabindex="-1">${escapeHTML(error)}</div>

            <div class="actions">
              <button id="cancel" type="button">Cancel</button>
              <button id="save" class="primary" type="submit">${escapeHTML(saveButtonLabel)}</button>
            </div>
          </div>
        </form>
      </div>
    </main>

    <script id="redeven-settings-state" type="application/json">${serializeDraft(draft)}</script>
    <script id="redeven-settings-mode" type="application/json">${serializeMode(mode)}</script>
    <script>
      const state = JSON.parse(document.getElementById('redeven-settings-state').textContent || '{}');
      const mode = JSON.parse(document.getElementById('redeven-settings-mode').textContent || '"desktop_settings"');
      const form = document.getElementById('settings-form');
      const errorEl = document.getElementById('settings-error');
      const cancelButton = document.getElementById('cancel');
      const saveButton = document.getElementById('save');
      const fields = {
        external_local_ui_url: document.getElementById('external-local-ui-url'),
        local_ui_bind: document.getElementById('local-ui-bind'),
        local_ui_password: document.getElementById('local-ui-password'),
        controlplane_url: document.getElementById('controlplane-url'),
        env_id: document.getElementById('env-id'),
        env_token: document.getElementById('env-token'),
      };
      const targetKindInputs = Array.from(document.querySelectorAll('input[name="target_kind"]'));
      const externalLocalUIURLRow = document.getElementById('external-local-ui-url-row');
      const hostThisDeviceStateNote = document.getElementById('host-this-device-state-note');
      const bootstrapStateNote = document.getElementById('bootstrap-state-note');
      const pageStatusBadge = document.getElementById('page-status-badge');
      const targetSummaryValue = document.getElementById('target-summary-value');
      const targetSummaryNote = document.getElementById('target-summary-note');
      const hostSummaryNote = document.getElementById('host-summary-note');
      const bootstrapSummaryNote = document.getElementById('bootstrap-summary-note');

      function selectedTargetKind() {
        if (targetKindInputs.length === 0) {
          return state.target_kind || 'managed_local';
        }
        const selected = targetKindInputs.find((input) => input.checked);
        return selected ? selected.value : (state.target_kind || 'managed_local');
      }

      function currentSaveLabel(externalMode) {
        if (mode === 'connect') {
          return externalMode ? 'Connect' : 'Use this device';
        }
        return externalMode ? 'Save for this device' : 'Save and apply';
      }

      function syncTargetMode() {
        const externalMode = selectedTargetKind() === 'external_local_ui';
        if (pageStatusBadge) {
          pageStatusBadge.textContent = externalMode ? 'External Redeven' : 'This device';
          pageStatusBadge.setAttribute('data-tone', externalMode ? 'external' : 'local');
        }
        if (targetSummaryValue) {
          targetSummaryValue.textContent = externalMode ? 'External Redeven' : 'This device';
        }
        if (targetSummaryNote) {
          targetSummaryNote.textContent = externalMode
            ? 'Desktop opens another machine\\'s Local UI inside this shell.'
            : 'Desktop starts the bundled runtime on this machine.';
        }
        if (externalLocalUIURLRow) {
          externalLocalUIURLRow.hidden = !externalMode;
        }
        if (fields.external_local_ui_url) {
          fields.external_local_ui_url.disabled = !externalMode;
          fields.external_local_ui_url.placeholder = 'http://192.168.1.11:24000/';
        }
        if (hostThisDeviceStateNote) {
          hostThisDeviceStateNote.textContent = externalMode
            ? 'Desktop is currently targeting External Redeven. These values stay saved for the next This device start.'
            : 'These values apply to desktop-managed starts on this machine.';
        }
        if (hostSummaryNote) {
          hostSummaryNote.textContent = externalMode
            ? 'Desktop is currently targeting External Redeven. These values stay saved for the next This device start.'
            : 'These values apply to desktop-managed starts on this machine.';
        }
        if (bootstrapStateNote) {
          bootstrapStateNote.textContent = externalMode
            ? 'Desktop is currently targeting External Redeven. This request stays saved for the next This device start and is never sent to the external target.'
            : 'If saved, the next successful desktop-managed start on this device will consume and clear them automatically.';
        }
        if (bootstrapSummaryNote) {
          bootstrapSummaryNote.textContent = externalMode
            ? 'Desktop is currently targeting External Redeven. This request stays saved for the next This device start and is never sent to the external target.'
            : 'If saved, the next successful desktop-managed start on this device will consume and clear them automatically.';
        }
        saveButton.textContent = currentSaveLabel(externalMode);
      }

      for (const [key, element] of Object.entries(fields)) {
        if (!element) continue;
        element.value = state[key] || '';
      }
      for (const input of targetKindInputs) {
        input.checked = input.value === (state.target_kind || 'managed_local');
        input.addEventListener('change', syncTargetMode);
      }
      syncTargetMode();

      function setBusy(busy) {
        saveButton.disabled = busy;
        cancelButton.disabled = busy;
      }

      function setError(message) {
        const text = String(message || '').trim();
        errorEl.textContent = text;
        errorEl.style.display = text ? 'block' : 'none';
        errorEl.setAttribute('aria-hidden', text ? 'false' : 'true');
        if (text) {
          queueMicrotask(() => errorEl.focus());
        }
      }

      cancelButton.addEventListener('click', () => {
        window.redevenDesktopSettings.cancel();
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        const payload = {
          target_kind: state.target_kind || 'managed_local',
          external_local_ui_url: state.external_local_ui_url || '',
          local_ui_bind: state.local_ui_bind || '',
          local_ui_password: state.local_ui_password || '',
          controlplane_url: state.controlplane_url || '',
          env_id: state.env_id || '',
          env_token: state.env_token || '',
        };
        payload.target_kind = selectedTargetKind();
        for (const [key, element] of Object.entries(fields)) {
          if (!element) continue;
          payload[key] = element.value || '';
        }
        const result = await window.redevenDesktopSettings.save(payload);
        if (!result || result.ok !== true) {
          setBusy(false);
          setError(result && result.error ? result.error : 'Failed to save settings.');
          return;
        }
      });

      if (errorEl.textContent.trim()) {
        errorEl.setAttribute('aria-hidden', 'false');
        queueMicrotask(() => errorEl.focus());
      } else {
        errorEl.setAttribute('aria-hidden', 'true');
      }
    </script>
  </body>
</html>`;
}

export function settingsPageDataURL(
  draft: DesktopSettingsDraft,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
  mode: DesktopPageMode = 'desktop_settings',
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildSettingsPageHTML(draft, errorMessage, platform, mode))}`;
}
