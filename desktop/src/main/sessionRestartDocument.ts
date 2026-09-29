import { windowStatusIllustrationSvg, windowStatusRefreshSvg } from '@floegence/floe-webapp-core/window-status';
import { createDesktopI18n, type RedevenLocale } from '../shared/i18n';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';
import { windowStatusDocumentStyleText } from './windowStatusDocument';

export const SESSION_RESTART_REOPEN_URL = 'https://redeven.invalid/session-restart/reopen';
export const SESSION_RESTART_CENTER_URL = 'https://redeven.invalid/session-restart/connection-center';
const escapeHTML = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function sessionRestartDocumentURL(input: Readonly<{
  label: string; stage: 'restarting' | 'restoring' | 'failed';
  locale: RedevenLocale; theme: DesktopThemeSnapshot;
}>): string {
  const i18n = createDesktopI18n(input.locale);
  const title = escapeHTML(i18n.t(`sessionRestart.${input.stage}`));
  const html = `<!doctype html><html lang="${i18n.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>${title}</title><style>${windowStatusDocumentStyleText(input.theme)}
.titlebar { position: fixed; inset: 0 0 auto; height: 36px; app-region: drag; z-index: 1; }
</style></head><body><div class="titlebar"></div><main class="floe-window-status" data-testid="session-restart-status">
<section class="floe-window-status__content">${windowStatusIllustrationSvg('service')}
<p class="floe-window-status__identity">${escapeHTML(input.label)}</p><h1 class="floe-window-status__title">${title}</h1>
<p class="floe-window-status__description">${escapeHTML(i18n.t('sessionRestart.detail'))}</p>
${input.stage === 'failed' ? `<div class="floe-window-status__actions"><a class="floe-window-status__button" href="${SESSION_RESTART_REOPEN_URL}">${windowStatusRefreshSvg}${escapeHTML(i18n.t('sessionRestart.reopen'))}</a><a class="floe-window-status__button" data-variant="secondary" href="${SESSION_RESTART_CENTER_URL}">${escapeHTML(i18n.t('sessionRestart.connectionCenter'))}</a></div>`
    : `<div class="floe-window-status__activity" role="status"><span data-floe-progress-shimmer="text">${title}</span></div>`}
</section></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
