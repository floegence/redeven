import { hostApplicationPreparationDocument, type HostApplicationPreparationView } from '../../../../../../desktop/src/shared/hostApplicationPreparation';

// Browser reservations share the preparation surface, including theme and motion
// preferences. Event handlers stay in the opener; the document permits no scripts.
export function renderHostApplicationLaunchDocument(
  popup: Window,
  view: HostApplicationPreparationView,
  recovery?: Readonly<{ retry: string; dismiss: string; onRetry: () => void }>,
): void {
  if (popup.closed) return;
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const target = popup.document;
  target.open();
  target.write(hostApplicationPreparationDocument(view, {
    background: color('--background', 'Canvas'), foreground: color('--foreground', 'CanvasText'),
    muted: color('--muted-foreground', 'GrayText'), border: color('--border', 'ButtonBorder'),
    primary: color('--primary', 'AccentColor'), colorScheme: style.colorScheme || 'light dark',
  }, null));
  target.close();
  // Browser tabs have native chrome; a Desktop titlebar would duplicate identity.
  target.querySelector('header')?.remove();
  if (!recovery) return;
  target.getElementById('progress')?.remove();
  target.getElementById('heading')?.setAttribute('role', 'alert');
  const css = target.createElement('style');
  css.textContent = `html,body{min-height:100%;height:auto;overflow:auto}body{min-height:100vh;padding:32px 0}main{width:min(380px,calc(100% - 40px))}#detail:empty{display:none}.actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:24px}button{font:inherit;font-size:var(--floe-type-control);min-height:40px;padding:9px 18px;border:1px solid ${color('--border', 'ButtonBorder')};border-radius:8px;background:transparent;color:inherit;cursor:pointer}button:first-child{background:${color('--primary', 'AccentColor')};color:${color('--primary-foreground', 'AccentColorText')};border-color:transparent}button:hover{filter:brightness(.94)}button:focus-visible{outline:2px solid ${color('--primary', 'AccentColor')};outline-offset:3px}button:disabled{opacity:.55;cursor:wait}`;
  target.head.append(css);
  const actions = target.createElement('div');
  actions.className = 'actions';
  const retry = target.createElement('button');
  retry.type = 'button'; retry.textContent = recovery.retry;
  retry.addEventListener('click', () => { retry.disabled = true; recovery.onRetry(); });
  const dismiss = target.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = recovery.dismiss;
  dismiss.addEventListener('click', () => popup.close());
  actions.append(retry, dismiss);
  target.querySelector('main')?.append(actions);
}
