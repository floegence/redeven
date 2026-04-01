import { desktopDarkTheme, desktopLightTheme } from './desktopTheme';
import {
  buildSettingsPageViewModel,
  pageWindowTitle,
  type DesktopPageAlertModel,
  type DesktopPageCardModel,
  type DesktopPageFieldModel,
  type DesktopPageMode,
  type DesktopPageSectionModel,
  type DesktopSummaryItem,
} from './settingsPageContent';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

export type { DesktopPageMode } from './settingsPageContent';

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

function renderSummaryItem(item: DesktopSummaryItem): string {
  const valueID = item.valueId ? ` id="${escapeHTML(item.valueId)}"` : '';
  const bodyID = item.bodyId ? ` id="${escapeHTML(item.bodyId)}"` : '';
  return `
    <article class="summary-item">
      <div class="summary-label">${escapeHTML(item.label)}</div>
      <div${valueID} class="summary-value">${escapeHTML(item.value)}</div>
      <p${bodyID} class="summary-copy">${escapeHTML(item.body)}</p>
    </article>
  `;
}

function renderField(field: DesktopPageFieldModel): string {
  const typeAttr = field.type ? ` type="${escapeHTML(field.type)}"` : '';
  const autocompleteAttr = field.autocomplete ? ` autocomplete="${escapeHTML(field.autocomplete)}"` : '';
  const inputModeAttr = field.inputMode ? ` inputmode="${escapeHTML(field.inputMode)}"` : '';
  const placeholderAttr = field.placeholder ? ` placeholder="${escapeHTML(field.placeholder)}"` : '';
  const describedByAttr = field.describedBy?.length
    ? ` aria-describedby="${escapeHTML(field.describedBy.join(' '))}"`
    : '';
  const hiddenAttr = field.hidden ? ' hidden' : '';
  const spellcheckAttr = ' spellcheck="false"';
  const helpHTML = field.helpHTML && field.helpId
    ? `<div id="${escapeHTML(field.helpId)}" class="field-help">${field.helpHTML}</div>`
    : '';

  return `
    <div class="field"${hiddenAttr}>
      <label class="field-label" for="${escapeHTML(field.id)}">${escapeHTML(field.label)}</label>
      <input
        id="${escapeHTML(field.id)}"
        name="${escapeHTML(field.name)}"${typeAttr}${autocompleteAttr}${inputModeAttr}${spellcheckAttr}${describedByAttr}${placeholderAttr}
      >
      ${helpHTML}
    </div>
  `;
}

function renderCard(card: DesktopPageCardModel): string {
  const badgeHTML = card.badge ? `<span class="settings-card-badge">${escapeHTML(card.badge)}</span>` : '';
  const stateNoteHTML = card.stateNote
    ? `<div id="${escapeHTML(card.stateNote.id)}" class="card-inline-note" aria-live="polite">${escapeHTML(card.stateNote.text)}</div>`
    : '';

  return `
    <section class="settings-card" id="${escapeHTML(card.id)}">
      <div class="settings-card-header">
        <div class="settings-card-header-copy">
          <div class="settings-card-kicker">${escapeHTML(card.kicker)}</div>
          <div class="settings-card-title-row">
            <h3>${escapeHTML(card.title)}</h3>
            ${badgeHTML}
          </div>
          <p class="settings-card-description">${card.descriptionHTML}</p>
        </div>
      </div>
      <div class="settings-card-body">
        ${stateNoteHTML}
        ${card.fields.map(renderField).join('')}
      </div>
    </section>
  `;
}

function renderSection(section: DesktopPageSectionModel): string {
  return `
    <section class="section-group" aria-labelledby="${escapeHTML(`${section.id}-title`)}">
      <div class="section-group-header">
        <h2 id="${escapeHTML(`${section.id}-title`)}" class="section-group-title">${escapeHTML(section.title)}</h2>
        <div class="section-group-divider" aria-hidden="true"></div>
      </div>
      <div class="section-group-body">
        ${section.cards.map(renderCard).join('')}
      </div>
    </section>
  `;
}

function renderAlert(alert: DesktopPageAlertModel): string {
  const bodyID = alert.bodyId ? ` id="${escapeHTML(alert.bodyId)}"` : '';
  return `
    <section class="inline-alert" data-tone="${escapeHTML(alert.tone ?? 'default')}">
      <div class="inline-alert-bar" aria-hidden="true"></div>
      <div class="inline-alert-copy">
        <div class="inline-alert-kicker">${escapeHTML(alert.kicker)}</div>
        <div class="inline-alert-title">${escapeHTML(alert.title)}</div>
        <p${bodyID} class="inline-alert-body">${escapeHTML(alert.body)}</p>
      </div>
    </section>
  `;
}

export { pageWindowTitle };

export function buildSettingsPageHTML(
  draft: DesktopSettingsDraft,
  errorMessage = '',
  platform: NodeJS.Platform = process.platform,
  mode: DesktopPageMode = 'advanced_settings',
): string {
  const error = String(errorMessage ?? '').trim();
  const titleBarInset = desktopWindowTitleBarInsetCSSValue(platform);
  const pageModel = buildSettingsPageViewModel(mode);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHTML(pageModel.windowTitle)}</title>
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
      .settings-shell {
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
        background: color-mix(in srgb, var(--muted) 22%, var(--card));
      }
      .inline-alert[data-tone="info"] {
        border-color: color-mix(in srgb, var(--info) 24%, var(--border));
        background: color-mix(in srgb, var(--info) 10%, var(--card));
      }
      .inline-alert-bar {
        width: 4px;
        min-height: 100%;
        border-radius: 999px;
        background: var(--primary);
      }
      .inline-alert[data-tone="info"] .inline-alert-bar {
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
      .section-group-body {
        display: grid;
        gap: 14px;
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
      .settings-card-title-row h3 {
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
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#settings-main">Skip to main content</a>
    <main id="settings-main" tabindex="-1">
      <div class="settings-shell">
        <header class="page-header">
          <p class="eyebrow">Redeven Desktop</p>
          <div class="title-row">
            <h1>${escapeHTML(pageModel.windowTitle)}</h1>
            <span id="page-status-badge" class="status-chip" data-tone="${escapeHTML(pageModel.statusTone)}">${escapeHTML(pageModel.statusLabel)}</span>
          </div>
          <p id="page-lead" class="lead">${escapeHTML(pageModel.lead)}</p>
        </header>
        <form id="settings-form" aria-describedby="page-lead settings-error">
          <section class="summary-strip" aria-label="Current configuration summary">
            ${pageModel.summaryItems.map(renderSummaryItem).join('')}
          </section>
          ${renderAlert(pageModel.alert)}
          ${pageModel.sections.map(renderSection).join('')}

          <div class="form-footer">
            <div id="settings-error" class="error" role="alert" aria-live="assertive" tabindex="-1">${escapeHTML(error)}</div>

            <div class="actions">
              <button id="cancel" type="button">Cancel</button>
              <button id="save" class="primary" type="submit">${escapeHTML(pageModel.saveLabel)}</button>
            </div>
          </div>
        </form>
      </div>
    </main>

    <script id="redeven-settings-state" type="application/json">${serializeJSON(draft)}</script>
    <script>
      const state = JSON.parse(document.getElementById('redeven-settings-state').textContent || '{}');
      const form = document.getElementById('settings-form');
      const errorEl = document.getElementById('settings-error');
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
        if (!element) continue;
        element.value = state[key] || '';
      }

      function setBusy(busy) {
        form.setAttribute('aria-busy', busy ? 'true' : 'false');
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
          local_ui_bind: state.local_ui_bind || '',
          local_ui_password: state.local_ui_password || '',
          controlplane_url: state.controlplane_url || '',
          env_id: state.env_id || '',
          env_token: state.env_token || '',
        };
        for (const [key, element] of Object.entries(fields)) {
          if (!element) continue;
          payload[key] = element.value || '';
        }
        try {
          const result = await window.redevenDesktopSettings.save(payload);
          if (!result || result.ok !== true) {
            setBusy(false);
            setError(result && result.error ? result.error : 'Failed to save settings.');
          }
        } catch (error) {
          setBusy(false);
          setError(error instanceof Error ? error.message : String(error));
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
  mode: DesktopPageMode = 'advanced_settings',
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildSettingsPageHTML(draft, errorMessage, platform, mode))}`;
}
