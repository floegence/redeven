import type { WebContents } from 'electron';
import { windowStatusIllustrationSvg, windowStatusRefreshSvg } from '@floegence/floe-webapp-core/window-status';
import { createDesktopI18n, normalizeRedevenLocale } from '../shared/i18n';
import { windowStatusDocumentStyleText } from './windowStatusDocument';
import { buildDesktopWindowChromeStyleText } from '../shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

// A scriptless data document cannot navigate its own data URL from Chromium.
// The host intercepts this reserved intent before network access, only from its exact status document.
export const WEB_SERVICE_RETRY_INTENT_URL = 'https://redeven.invalid/window-status/retry';

export function isWebServiceUnavailableRetryIntent(targetURL: string, currentURL: string, documentURL: string): boolean {
  return Boolean(documentURL && currentURL === documentURL && targetURL === WEB_SERVICE_RETRY_INTENT_URL);
}

const retryFeedbackCSS = `
  .floe-window-status .retry { visibility: hidden; pointer-events: none; }
  .floe-window-status .retrying-label { display: inline; }
  .floe-window-status .idle-status { display: none; }
`;

/** Switch the trusted status document to working feedback without another navigation. */
export async function showWebServiceRetryFeedback(
  contents: Pick<WebContents, 'insertCSS' | 'removeInsertedCSS' | 'getURL' | 'isDestroyed'>,
  documentURL: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (contents.isDestroyed() || !isCurrent() || contents.getURL() !== documentURL) return false;
  const styleKey = await contents.insertCSS(retryFeedbackCSS);
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
  const current = !contents.isDestroyed() && isCurrent() && contents.getURL() === documentURL;
  // Keep working feedback until the service replaces this document; navigation discards its CSS.
  if (!current && !contents.isDestroyed()) await contents.removeInsertedCSS(styleKey);
  return current;
}

export type WebServiceUnavailableCopy = Readonly<{
  locale: string;
  documentTitle: string;
  eyebrow: string;
  title: string;
  summary: string;
  targetLabel: string;
  checksTitle: string;
  serviceCheck: string;
  portCheck: string;
  retryLabel: string;
  retryingLabel: string;
}>;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWebServiceUnavailableDocumentURL(
  copy: WebServiceUnavailableCopy,
  targetAddress: string,
  theme: DesktopThemeSnapshot,
  presentation: 'browser' | 'application' = 'browser',
): string {
  const palette = theme.semantic;
  const i18n = createDesktopI18n(normalizeRedevenLocale(copy.locale) || 'en-US');
  const document = `<!doctype html>
<html lang="${htmlEscape(copy.locale)}" data-floe-shell-theme="${htmlEscape(theme.activeShellTheme)}" data-theme-palette-version="${palette.version}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(copy.documentTitle)}</title>
  <style>
${presentation === 'application' ? buildDesktopWindowChromeStyleText(resolveDesktopWindowChromeSnapshot()) : ''}
.host-application-loading-titlebar{position:fixed;inset:0 0 auto;display:flex;align-items:center;height:var(--redeven-desktop-titlebar-height);padding-inline:var(--redeven-desktop-titlebar-start-inset) var(--redeven-desktop-titlebar-end-inset);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;app-region:drag;user-select:none}
    ${windowStatusDocumentStyleText(theme)}
    .host-application-loading-titlebar { z-index: 1; }
    .application .floe-window-status { top: var(--redeven-desktop-titlebar-height); }
    .retrying-label { display: none; }
  </style>
</head>
<body class="${presentation}">
${presentation === 'application' ? `<header class="host-application-loading-titlebar">${htmlEscape(copy.documentTitle)}</header>` : ''}  <main class="floe-window-status">
    <section class="floe-window-status__content" aria-labelledby="window-title">
      ${windowStatusIllustrationSvg('service')}
      <p class="floe-window-status__identity">${htmlEscape(copy.eyebrow)}</p>
      <h1 id="window-title" class="floe-window-status__title">${htmlEscape(copy.title)}</h1>
      <p class="floe-window-status__description">${htmlEscape(copy.summary)}</p>
      <div class="floe-window-status__activity" role="status" aria-live="polite">
        <div class="idle-status">${presentation === 'browser' ? `<p class="floe-window-status__label">${htmlEscape(copy.targetLabel)}</p><code title="${htmlEscape(targetAddress)}">${htmlEscape(targetAddress)}</code>` : htmlEscape(copy.documentTitle)}</div>
        <div class="retrying-label"><p class="floe-window-status__label">${htmlEscape(copy.retryingLabel)}</p><span data-floe-progress-shimmer="text">${htmlEscape(i18n.t('windowStatus.checkingService'))}</span></div>
      </div>
      <div class="floe-window-status__actions">
        <a id="retry" class="retry floe-window-status__button" href="${WEB_SERVICE_RETRY_INTENT_URL}">
          ${windowStatusRefreshSvg}
          <span class="retry-label">${htmlEscape(copy.retryLabel)}</span>
        </a>
      </div>
      ${presentation === 'browser' ? `<details class="floe-window-status__details"><summary>${htmlEscape(i18n.t('windowStatus.technicalDetails'))}</summary><h2 class="floe-window-status__label">${htmlEscape(copy.checksTitle)}</h2><p>${htmlEscape(copy.serviceCheck)}</p><p>${htmlEscape(copy.portCheck)}</p></details>` : ''}
    </section>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}
