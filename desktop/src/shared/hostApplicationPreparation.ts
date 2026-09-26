import { floeStandaloneStyleText } from './floeStandaloneStyles.generated';
import { buildDesktopWindowChromeStyleText, type DesktopWindowChromeSnapshot } from './windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from './windowChromePlatform';
export const HOST_APPLICATION_PREPARATION_CHANNEL = 'redeven-desktop:host-application-preparation';
export const HOST_APPLICATION_PREPARATION_CLOSED_CHANNEL = 'redeven-desktop:host-application-preparation-closed';

export type HostApplicationPreparationView = Readonly<{
  title: string;
  icon: string;
  locale: string;
  heading: string;
  detail: string;
  progress?: number;
  failed?: boolean;
}>;

export type HostApplicationPreparationRequest =
  | Readonly<{ action: 'create'; application_id: string; view: HostApplicationPreparationView }>
  | Readonly<{ action: 'update'; id: string; view: HostApplicationPreparationView }>
  | Readonly<{ action: 'close' | 'check'; id: string }>;

export type HostApplicationPreparationResult = Readonly<{ ok: boolean; id?: string }>;

export function validHostApplicationPreparationView(value: unknown): value is HostApplicationPreparationView {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['title', 'locale', 'heading', 'detail'].every(key => typeof v[key] === 'string' && (v[key] as string).length <= 2048)
    && typeof v.icon === 'string' && v.icon.length <= 100_000
    && (v.icon === '' || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(v.icon))
    && (v.progress === undefined || (typeof v.progress === 'number' && Number.isFinite(v.progress) && v.progress >= 0 && v.progress <= 1))
    && (v.failed === undefined || typeof v.failed === 'boolean');
}

export type HostApplicationPreparationPalette = Readonly<{ background: string; foreground: string; muted: string; primary: string; border: string; colorScheme: string }>;

const escapeHTML = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function hostApplicationPreparationDocument(view: HostApplicationPreparationView, palette: HostApplicationPreparationPalette, chrome: DesktopWindowChromeSnapshot | null = resolveDesktopWindowChromeSnapshot()): string {
  return `<!doctype html><html lang="${escapeHTML(view.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(view.title)}</title><style>
${floeStandaloneStyleText}
${chrome ? buildDesktopWindowChromeStyleText(chrome) : ''}
.host-application-loading-titlebar{position:fixed;inset:0 0 auto;display:flex;align-items:center;height:var(--redeven-desktop-titlebar-height);padding-inline:var(--redeven-desktop-titlebar-start-inset) var(--redeven-desktop-titlebar-end-inset);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;app-region:drag;user-select:none}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}body{font:var(--floe-type-body)/var(--floe-line-body) -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${escapeHTML(palette.background)};color:${escapeHTML(palette.foreground)};color-scheme:${escapeHTML(palette.colorScheme)};display:grid;place-items:center}
main{width:min(340px,calc(100% - 64px));text-align:center;animation:appear .2s ease-out}img{display:block;width:64px;height:64px;object-fit:contain;margin:0 auto 24px}img[hidden]{display:none}h1{font-size:20px;font-weight:600;letter-spacing:-.025em;margin:0 0 28px;overflow-wrap:anywhere}#heading{font-size:var(--floe-type-body);font-weight:500;margin:0 0 12px}#detail{color:${escapeHTML(palette.muted)};font-size:var(--floe-type-body);min-height:3.1em;margin:14px 0 0;overflow-wrap:anywhere}.track{height:2px;background:${escapeHTML(palette.border)};overflow:hidden;border-radius:1px}.fill{display:block;width:38%;height:100%;background:${escapeHTML(palette.primary)};animation:travel 1.5s ease-in-out infinite;transform-origin:left;transition:width .2s ease}.determinate .fill{animation:none}body[data-failed=true] .fill{animation:none;width:0!important}@keyframes travel{0%{transform:translateX(-110%)}100%{transform:translateX(365%)}}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){main,.fill{animation:none;transition:none}}
</style></head><body data-failed="${view.failed === true}"><header class="host-application-loading-titlebar">${escapeHTML(view.title)}</header><main><img id="icon" ${view.icon ? `src="${escapeHTML(view.icon)}"` : 'hidden'} alt=""><h1>${escapeHTML(view.title)}</h1><p id="heading" role="status" aria-live="polite">${escapeHTML(view.heading)}</p><div id="progress" class="track ${view.progress === undefined ? '' : 'determinate'}" role="progressbar" aria-label="${escapeHTML(view.heading)}" ${view.progress === undefined ? '' : `aria-valuenow="${Math.round(view.progress * 100)}" aria-valuemin="0" aria-valuemax="100"`}><span class="fill" ${view.progress === undefined ? '' : `style="width:${view.progress * 100}%"`}></span></div><p id="detail">${escapeHTML(view.detail)}</p></main></body></html>`;
}

// This function is serialized into the trusted preparation document only. Keep it self-contained.
export function updateHostApplicationPreparationDocument(view: HostApplicationPreparationView, target: Document = document): void {
  const heading = target.getElementById('heading');
  const detail = target.getElementById('detail');
  const progress = target.getElementById('progress');
  if (!heading || !detail || !progress) return;
  heading.textContent = view.heading;
  detail.textContent = view.detail;
  target.body.dataset.failed = String(view.failed === true);
  progress.classList.toggle('determinate', view.progress !== undefined);
  progress.setAttribute('aria-label', view.heading);
  if (view.progress === undefined) progress.removeAttribute('aria-valuenow');
  else progress.setAttribute('aria-valuenow', String(Math.round(view.progress * 100)));
  const fill = progress.firstElementChild as HTMLElement | null;
  if (fill) fill.style.width = view.progress === undefined ? '' : `${view.progress * 100}%`;
}
