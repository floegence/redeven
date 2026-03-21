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

function modeCalloutHTML(mode: DesktopPageMode, externalMode: boolean): string {
  if (mode === 'connect') {
    return `
      <section class="surface surface-compact">
        <div class="surface-kicker">Separate Responsibilities</div>
        <h2>Desktop Settings stay separate</h2>
        <p class="section-note">
          Host This Device and Register to Redeven on next start live in Desktop Settings. Agent runtime configuration appears later inside Agent Settings after Local UI opens.
        </p>
      </section>
    `;
  }

  const detail = externalMode
    ? 'Desktop is currently targeting External Redeven, so the values below are stored for the next time you switch back to This device.'
    : 'Use Connect to Redeven... from the app menu when you want to switch between This device and External Redeven.';

  return `
    <section class="surface surface-compact">
      <div class="surface-kicker">Connection Target</div>
      <h2>Connection target is managed separately</h2>
      <p class="section-note">${escapeHTML(detail)}</p>
    </section>
  `;
}

function targetSectionHTML(): string {
  return `
    <section class="surface">
      <div class="surface-kicker">Connection</div>
      <h2>Connect to Redeven</h2>
      <p class="section-note">
        Switch between this machine and another Redeven Local UI endpoint without mixing that choice into Desktop startup settings.
      </p>
      <div class="grid">
        <div class="field">
          <label class="field-label">Target</label>
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
        </div>
        <div id="external-local-ui-url-row" class="field">
          <label class="field-label" for="external-local-ui-url">Redeven URL</label>
          <input id="external-local-ui-url" name="external_local_ui_url" autocomplete="off" spellcheck="false" placeholder="http://192.168.1.11:24000/">
          <div class="field-help">Paste the Local UI base URL. Hostnames are intentionally not supported; use localhost or an IP literal.</div>
        </div>
      </div>
    </section>
  `;
}

function desktopSettingsSectionsHTML(hostThisDeviceStateNote: string, bootstrapStateNote: string): string {
  return `
    <section class="surface">
      <div class="surface-kicker">Desktop Startup</div>
      <h2>Host This Device</h2>
      <p class="section-note">
        Use <code>127.0.0.1:0</code> for the default loopback-only dynamic port, or an explicit address such as <code>0.0.0.0:24000</code> to make this Desktop reachable on your LAN.
        <span id="host-this-device-state-note" class="state-note">${escapeHTML(hostThisDeviceStateNote)}</span>
      </p>
      <div class="grid">
        <div class="field">
          <label class="field-label" for="local-ui-bind">Local UI bind address</label>
          <input id="local-ui-bind" name="local_ui_bind" autocomplete="off" spellcheck="false">
          <div class="field-help">Non-loopback Local UI binds require a Local UI password.</div>
        </div>
        <div class="field">
          <label class="field-label" for="local-ui-password">Local UI password</label>
          <input id="local-ui-password" name="local_ui_password" type="password" autocomplete="new-password" spellcheck="false">
          <div class="field-help">Desktop stores this secret locally and passes it through <code>--password-env</code>.</div>
        </div>
      </div>
    </section>

    <section class="surface">
      <div class="surface-kicker">Next Start</div>
      <h2>Register to Redeven on next start</h2>
      <p class="section-note">
        These values are treated as a one-shot bootstrap request for the next successful desktop-managed start on this device, then cleared automatically.
        <span id="bootstrap-state-note" class="state-note">${escapeHTML(bootstrapStateNote)}</span>
      </p>
      <div class="grid two">
        <div class="field">
          <label class="field-label" for="controlplane-url">Control plane URL</label>
          <input id="controlplane-url" name="controlplane_url" autocomplete="off" spellcheck="false">
        </div>
        <div class="field">
          <label class="field-label" for="env-id">Environment ID</label>
          <input id="env-id" name="env_id" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="grid">
        <div class="field">
          <label class="field-label" for="env-token">Environment token</label>
          <input id="env-token" name="env_token" type="password" autocomplete="off" spellcheck="false">
          <div class="field-help">Desktop passes this secret through <code>--env-token-env</code> instead of putting it in the process arguments.</div>
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
        --bg: ${desktopTheme.pageBackground};
        --surface: ${desktopTheme.surface};
        --surface-muted: ${desktopTheme.surfaceMuted};
        --border: ${desktopTheme.border};
        --text: ${desktopTheme.text};
        --muted: ${desktopTheme.muted};
        --accent: ${desktopTheme.accent};
        --accent-text: ${desktopTheme.accentText};
        --accent-soft: ${desktopTheme.accentSoft};
        --danger: ${desktopTheme.danger};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: calc(24px + ${titleBarInset}) 24px 24px;
      }
      main {
        width: min(880px, 100%);
        margin: 0 auto;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: 0 18px 48px rgba(19, 30, 47, 0.08);
        padding: 30px;
      }
      .hero {
        display: grid;
        gap: 10px;
      }
      .eyebrow {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 36px);
        line-height: 1.05;
      }
      p.lead {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
        max-width: 64ch;
        font-size: 15px;
      }
      form {
        margin-top: 24px;
      }
      .surface {
        margin-top: 18px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: color-mix(in srgb, var(--surface-muted) 58%, var(--surface));
      }
      .surface-compact {
        margin-top: 0;
      }
      .surface-kicker {
        margin-bottom: 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h2 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
      }
      p.section-note {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.65;
        font-size: 14px;
      }
      .grid {
        margin-top: 18px;
        display: grid;
        gap: 16px;
      }
      .grid.two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .field {
        display: grid;
        gap: 8px;
      }
      .field-label {
        display: block;
        font-size: 13px;
        font-weight: 700;
      }
      .field-help {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }
      input {
        width: 100%;
        min-height: 46px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0 14px;
        font-size: 14px;
      }
      .choice-grid {
        display: grid;
        gap: 12px;
      }
      .choice-option {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 10px 12px;
        align-items: start;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--surface);
        cursor: pointer;
      }
      .choice-option input {
        width: 18px;
        min-height: 18px;
        margin: 2px 0 0;
        padding: 0;
      }
      .choice-title {
        display: block;
        font-size: 14px;
        font-weight: 700;
      }
      .choice-help {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }
      code {
        padding: 0 6px;
        border-radius: 8px;
        background: var(--accent-soft);
        font-size: 12px;
      }
      .error {
        display: ${error ? 'block' : 'none'};
        margin-top: 20px;
        padding: 14px 16px;
        border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
        border-radius: 16px;
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        color: var(--danger);
        line-height: 1.55;
        font-size: 13px;
      }
      .actions {
        margin-top: 24px;
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      .state-note {
        display: block;
        margin-top: 8px;
        font-weight: 600;
      }
      button {
        min-height: 44px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }
      button.primary {
        border-color: transparent;
        background: var(--accent);
        color: var(--accent-text);
      }
      button:disabled {
        opacity: 0.65;
        cursor: wait;
      }
      @media (max-width: 720px) {
        body { padding: calc(12px + ${titleBarInset}) 12px 12px; }
        main { padding: 22px; border-radius: 18px; }
        .grid.two { grid-template-columns: 1fr; }
        .actions { flex-direction: column-reverse; }
        button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="hero">
        <p class="eyebrow">Redeven Desktop</p>
        <h1>${escapeHTML(pageTitle)}</h1>
        <p class="lead">${escapeHTML(pageLead(mode))}</p>
      </div>
      <form id="settings-form">
        ${modeCalloutHTML(mode, externalMode)}
        ${bodyHTML}

        <div id="error" class="error">${escapeHTML(error)}</div>

        <div class="actions">
          <button id="cancel" type="button">Cancel</button>
          <button id="save" class="primary" type="submit">${escapeHTML(saveButtonLabel)}</button>
        </div>
      </form>
    </main>

    <script id="redeven-settings-state" type="application/json">${serializeDraft(draft)}</script>
    <script id="redeven-settings-mode" type="application/json">${serializeMode(mode)}</script>
    <script>
      const state = JSON.parse(document.getElementById('redeven-settings-state').textContent || '{}');
      const mode = JSON.parse(document.getElementById('redeven-settings-mode').textContent || '"desktop_settings"');
      const form = document.getElementById('settings-form');
      const errorEl = document.getElementById('error');
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
        if (externalLocalUIURLRow) {
          externalLocalUIURLRow.style.display = externalMode ? 'grid' : 'none';
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
        if (bootstrapStateNote) {
          bootstrapStateNote.textContent = externalMode
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
