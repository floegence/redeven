import { windowStatusIllustrationSvg } from '@floegence/floe-webapp-core/window-status';
import { createDesktopI18n, normalizeRedevenLocale } from '../shared/i18n';
import { windowStatusDocumentStyleText } from './windowStatusDocument';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

export type CodespaceLoadingWindowCopy = Readonly<{
  state?: 'loading' | 'error';
  locale?: string;
  title?: string;
  detail?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function htmlEscape(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCodespaceLoadingDocumentURL(
  codeSpaceID: string,
  theme: DesktopThemeSnapshot,
  copy: CodespaceLoadingWindowCopy = {},
): string {
  const state = copy.state === 'error' ? 'error' : 'loading';
  const title = htmlEscape(compact(copy.title) || 'Opening Codespace');
  const detail = htmlEscape(compact(copy.detail) || 'Redeven is preparing the browser editor.');
  const codeSpaceLabel = htmlEscape(compact(codeSpaceID) || 'codespace');
  const i18n = createDesktopI18n(normalizeRedevenLocale(copy.locale) || 'en-US');
  const palette = theme.semantic;
  const html = `<!doctype html>
<html lang="${htmlEscape(i18n.locale)}" data-floe-shell-theme="${htmlEscape(theme.activeShellTheme)}" data-theme-palette-version="${palette.version}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
  <title>${title}</title>
  <style>${windowStatusDocumentStyleText(theme)}</style>
</head>
<body>
  <main class="floe-window-status">
    <section class="floe-window-status__content" aria-labelledby="window-title" aria-busy="${state === 'loading'}">
      ${windowStatusIllustrationSvg('editor')}
      <p class="floe-window-status__identity">Codespaces / ${codeSpaceLabel}</p>
      <h1 id="window-title" class="floe-window-status__title">${title}</h1>
      <p class="floe-window-status__description">${state === 'error' ? htmlEscape(i18n.t('windowStatus.editorUnavailableDetail')) : detail}</p>
      ${state === 'loading' ? `<div class="floe-window-status__activity" role="status" aria-live="polite"><span data-floe-progress-shimmer="text">${htmlEscape(i18n.t('windowStatus.preparingEditor'))}</span></div>` : `<details class="floe-window-status__details"><summary>${htmlEscape(i18n.t('windowStatus.technicalDetails'))}</summary><pre>${detail}</pre></details>`}
    </section>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
