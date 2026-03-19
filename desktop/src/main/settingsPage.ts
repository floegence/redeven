import { desktopTheme } from './desktopTheme';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

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

export function buildSettingsPageHTML(
  draft: DesktopSettingsDraft,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
): string {
  const error = String(errorMessage ?? '').trim();
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Redeven Desktop Settings</title>
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
        padding: 28px;
      }
      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.1;
      }
      p.lead {
        margin: 12px 0 0;
        color: var(--muted);
        line-height: 1.7;
        max-width: 64ch;
      }
      section {
        margin-top: 24px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--surface-muted);
      }
      h2 {
        margin: 0;
        font-size: 18px;
      }
      p.section-note {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .grid {
        margin-top: 16px;
        display: grid;
        gap: 16px;
      }
      .grid.two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .help {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
        font-weight: 400;
      }
      input {
        width: 100%;
        min-height: 44px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0 14px;
        font-size: 14px;
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
        border: 1px solid rgba(164, 63, 47, 0.24);
        border-radius: 14px;
        background: rgba(164, 63, 47, 0.08);
        color: var(--danger);
        line-height: 1.5;
      }
      .actions {
        margin-top: 24px;
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      button {
        min-height: 44px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0 18px;
        font-size: 14px;
        font-weight: 600;
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
        main { padding: 20px; border-radius: 18px; }
        .grid.two { grid-template-columns: 1fr; }
        .actions { flex-direction: column-reverse; }
        button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Redeven Desktop Settings</h1>
      <p class="lead">
        Configure how Desktop starts the bundled Redeven runtime. Startup settings stay in Desktop; the agent still starts through a single desktop-managed runtime entrypoint.
      </p>
      <form id="settings-form">
        <section>
          <h2>Local UI startup</h2>
          <p class="section-note">
            Use <code>127.0.0.1:0</code> for the default loopback-only dynamic port, or an explicit address such as <code>0.0.0.0:24000</code> to make Local UI reachable on your LAN.
          </p>
          <div class="grid">
            <label>
              <span>Local UI bind address</span>
              <input id="local-ui-bind" name="local_ui_bind" autocomplete="off" spellcheck="false">
              <span class="help">Non-loopback binds require a Local UI password.</span>
            </label>
            <label>
              <span>Local UI password</span>
              <input id="local-ui-password" name="local_ui_password" type="password" autocomplete="new-password" spellcheck="false">
              <span class="help">Desktop stores this secret locally and passes it through <code>--password-env</code>.</span>
            </label>
          </div>
        </section>

        <section>
          <h2>Register to Redeven on next start</h2>
          <p class="section-note">
            These values are treated as a one-shot bootstrap request for the next successful Desktop-managed start, then cleared automatically.
          </p>
          <div class="grid two">
            <label>
              <span>Control plane URL</span>
              <input id="controlplane-url" name="controlplane_url" autocomplete="off" spellcheck="false">
            </label>
            <label>
              <span>Environment ID</span>
              <input id="env-id" name="env_id" autocomplete="off" spellcheck="false">
            </label>
          </div>
          <div class="grid">
            <label>
              <span>Environment token</span>
              <input id="env-token" name="env_token" type="password" autocomplete="off" spellcheck="false">
              <span class="help">Desktop passes this secret through <code>--env-token-env</code> instead of putting it in the process arguments.</span>
            </label>
          </div>
        </section>

        <div id="error" class="error">${escapeHTML(error)}</div>

        <div class="actions">
          <button id="cancel" type="button">Cancel</button>
          <button id="save" class="primary" type="submit">Save and apply</button>
        </div>
      </form>
    </main>

    <script id="redeven-settings-state" type="application/json">${serializeDraft(draft)}</script>
    <script>
      const state = JSON.parse(document.getElementById('redeven-settings-state').textContent || '{}');
      const form = document.getElementById('settings-form');
      const errorEl = document.getElementById('error');
      const cancelButton = document.getElementById('cancel');
      const saveButton = document.getElementById('save');
      const fields = {
        local_ui_bind: document.getElementById('local-ui-bind'),
        local_ui_password: document.getElementById('local-ui-password'),
        controlplane_url: document.getElementById('controlplane-url'),
        env_id: document.getElementById('env-id'),
        env_token: document.getElementById('env-token'),
      };

      for (const [key, element] of Object.entries(fields)) {
        element.value = state[key] || '';
      }

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
        const payload = {};
        for (const [key, element] of Object.entries(fields)) {
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
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildSettingsPageHTML(draft, errorMessage, platform))}`;
}
