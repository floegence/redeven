import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { TessivenGraph, type TessivenViewportControl, type GraphBrowseState } from '../TessivenGraph';
import type { Version, Selection } from '../types';
import enUS from '../locales/en-US.json';
import '../tessiven.css';
import '../../native/native.css';

declare global {
  interface Window {
    webkit?: { messageHandlers?: { canvas?: { postMessage: (message: unknown) => void } } };
    serviceCanvas?: { update: (input: { version: Version; historical: boolean; dark: boolean; contrast: boolean }) => void };
  }
}

const notify = (type: string, selection?: Selection) => window.webkit?.messageHandlers?.canvas?.postMessage({ type, selection });
const t = (key: string, values?: Record<string, string | number>) => {
  const template = enUS[key as keyof typeof enUS];
  if (template === undefined) throw new Error(`Unknown Tessiven message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] === undefined ? match : String(values[name]));
};

function NativeCanvas() {
  const [input, setInput] = createSignal<{ version: Version; historical: boolean }>();
  const browsing = new Map<string, GraphBrowseState>();
  let control: TessivenViewportControl | undefined;
  let pinch: { distance: number; x: number; y: number } | undefined;
  const touches = (event: TouchEvent) => {
    const a = event.touches[0], b = event.touches[1];
    return a && b ? { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } : undefined;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 2) return;
    pinch = touches(event);
    control?.setTouchZooming(true);
    event.preventDefault();
  };
  const move = (event: TouchEvent) => {
    const next = touches(event);
    if (!pinch || !next || !control) return;
    event.preventDefault();
    control.zoom(next.distance / Math.max(1, pinch.distance), pinch.x, pinch.y, next.x - pinch.x, next.y - pinch.y);
    pinch = next;
  };
  document.addEventListener('touchstart', start, { passive: false });
  document.addEventListener('touchmove', move, { passive: false });
  const end = (event: TouchEvent) => {
    if (event.touches.length < 2) pinch = undefined;
    if (event.touches.length === 0) control?.setTouchZooming(false);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
  window.serviceCanvas = {
    update(value) {
      document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', value.dark);
      document.documentElement.classList.toggle('high-contrast', value.contrast);
      const previous = input();
      if (previous?.version.canvas_id !== value.version.canvas_id || previous.version.number !== value.version.number || previous.historical !== value.historical) {
        setInput({ version: value.version, historical: value.historical });
      }
    },
  };
  notify('ready');
  return <main class="tessiven"><Show when={input()} keyed>{value => <TessivenGraph
    version={value.version} historical={value.historical} t={t} visible={true}
    onAsk={selection => notify('ask', selection)} onDetails={selection => notify('details', selection)}
    onInspect={() => undefined} onViewportControl={value => { control = value; }}
    onRenderState={state => notify(state)}
    browseState={browsing.get(value.version.canvas_id)}
    onBrowseState={state => browsing.set(value.version.canvas_id, state)}
  />}</Show></main>;
}

window.addEventListener('error', () => notify('error'));
window.addEventListener('unhandledrejection', () => notify('error'));
render(() => <NativeCanvas />, document.getElementById('root')!);
