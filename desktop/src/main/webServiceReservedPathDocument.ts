import { windowStatusIllustrationSvg } from '@floegence/floe-webapp-core/window-status';
import { createDesktopI18n, type RedevenLocale } from '../shared/i18n';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';
import { windowStatusDocumentStyleText } from './windowStatusDocument';

const intentBase = 'https://redeven.invalid/window-status/';

function escapeHTML(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Only the current host-owned document can request these local actions. */
export function performWebServiceReservedPathIntent(
  targetURL: string, currentURL: string, documentURL: string,
  actions: Readonly<{ editAddress: () => void; copyAddress: () => void }>,
): boolean {
  if (!documentURL || currentURL !== documentURL) return false;
  if (targetURL === `${intentBase}edit-address`) actions.editAddress();
  else if (targetURL === `${intentBase}copy-address`) actions.copyAddress();
  else return false;
  return true;
}

export const webServiceAddressCopiedCSS = '.floe-window-status .copy-label { display: none; } .floe-window-status .copied-label { display: inline; }';

export function buildWebServiceReservedPathDocumentURL(
  locale: RedevenLocale, address: string, theme: DesktopThemeSnapshot,
): string {
  const i18n = createDesktopI18n(locale);
  const title = escapeHTML(i18n.t('webServiceBrowser.reservedPathTitle'));
  const document = `<!doctype html>
<html lang="${locale}" data-floe-shell-theme="${escapeHTML(theme.activeShellTheme)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${title}</title>
  <style>${windowStatusDocumentStyleText(theme)}
    .copied-label { display: none; }
  </style>
</head>
<body>
  <main class="floe-window-status">
    <section class="floe-window-status__content" aria-labelledby="window-title">
      ${windowStatusIllustrationSvg('service')}
      <h1 id="window-title" class="floe-window-status__title">${title}</h1>
      <p class="floe-window-status__description">${escapeHTML(i18n.t('webServiceBrowser.reservedPathSummary'))}</p>
      <div class="floe-window-status__activity"><code>${escapeHTML(address)}</code></div>
      <div class="floe-window-status__actions">
        <a id="edit-address" class="floe-window-status__button" href="${intentBase}edit-address">${escapeHTML(i18n.t('webServiceBrowser.editAddress'))}</a>
        <a id="copy-address" class="floe-window-status__button" data-variant="secondary" href="${intentBase}copy-address"><span aria-live="polite"><span class="copy-label">${escapeHTML(i18n.t('webServiceBrowser.copyAddress'))}</span><span class="copied-label">${escapeHTML(i18n.t('webServiceBrowser.addressCopied'))}</span></span></a>
      </div>
    </section>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}
