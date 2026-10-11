import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { Plus, Minus, Maximize } from '@floegence/floe-webapp-core/icons';
import { TessivenGraph, type TessivenViewportControl, type GraphBrowseState, type TessivenViewOptions } from '../TessivenGraph';
import { attachTouchViewport } from './touchViewport';
import type { Version, Selection } from '../types';
import { supportedAPIVersions, canvasKind } from './contract';
import enUS from '../locales/en-US.json';
import '../tessiven.css';
import '../../native/native.css';

declare global {
  interface Window {
    webkit?: { messageHandlers?: { canvas?: { postMessage: (message: unknown) => void } } };
    serviceCanvas?: {
      update: (input: { render_id: string; version: Version; historical: boolean; dark: boolean; contrast: boolean; bottomInset?: number }) => void;
      command: (input: { canvas_id: string; version_id: number; action: 'expand' | 'collapse' | 'all' | 'group' | 'clearSelection' }) => void;
    };
  }
}

const renderID = new URLSearchParams(location.hash.slice(1)).get('render_id');
const notify = (type: string, version?: Version, selection?: Selection, options?: TessivenViewOptions) =>
  window.webkit?.messageHandlers?.canvas?.postMessage({
    type, render_id: renderID, canvas_id: version?.canvas_id, version_id: version?.number, selection, ...options,
  });
let currentVersion: Version | undefined;
const t = (key: string, values?: Record<string, string | number>) => {
  const template = enUS[key as keyof typeof enUS];
  if (template === undefined) throw new Error(`Unknown Tessiven message: ${key}`);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] === undefined ? match : String(values[name]));
};

function NativeCanvas() {
  const [input, setInput] = createSignal<{ version: Version; historical: boolean }>();
  const [scale, setScale] = createSignal(1);
  const browsing = new Map<string, GraphBrowseState>();
  let control: TessivenViewportControl | undefined;
  const zoom = (factor: number) => { touch?.reset(); control?.zoom(factor, window.innerWidth / 2, window.innerHeight / 2); };
  let host: HTMLElement | undefined;
  let touch: ReturnType<typeof attachTouchViewport> | undefined;
  onMount(() => {
    if (host) {
      touch = attachTouchViewport(host, () => control);
      onCleanup(touch.dispose);
    }
  });
  window.serviceCanvas = {
    command(value) {
      const version = input()?.version;
      if (!control || value.canvas_id !== version?.canvas_id || value.version_id !== version.number) return;
      touch?.reset();
      switch (value.action) {
        case 'clearSelection': control.clearSelection(); break;
        case 'expand': control.expandAll(); break;
        case 'collapse': control.collapseAll(); break;
        case 'all': case 'group': control.setServiceScope(value.action); break;
      }
    },
    update(value) {
      if (!renderID || value.render_id !== renderID) return;
      currentVersion = value.version;
      if (!supportedAPIVersions.includes(value.version.document.apiVersion) || value.version.document.kind !== canvasKind) {
        notify('error', value.version);
        return;
      }
      const inset = Number.isFinite(value.bottomInset) ? Math.max(0, Math.min(window.innerHeight / 2, value.bottomInset!)) : 0;
      document.documentElement.style.setProperty('--native-bottom-inset', `${inset}px`);
      document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', value.dark);
      document.documentElement.classList.toggle('high-contrast', value.contrast);
      const previous = input();
      if (previous?.version.canvas_id !== value.version.canvas_id || previous.version.number !== value.version.number || previous.historical !== value.historical) {
        touch?.reset();
        setInput({ version: value.version, historical: value.historical });
      }
    },
  };
  notify('ready');
  return <main class="tessiven" ref={host}><Show when={input()} keyed>{value => <TessivenGraph
    version={value.version} historical={value.historical} t={t} visible={true}
    onAsk={selection => notify('ask', value.version, selection)} onSelectionChange={selection => notify('selection', value.version, selection)}
    onInspect={() => undefined} onViewportControl={value => { control = value; }}
    tools="hidden" onZoomChange={setScale} onViewOptions={options => notify('viewOptions', value.version, undefined, options)}
    onRenderState={state => notify(state, value.version)}
    browseState={browsing.get(value.version.canvas_id)}
    onBrowseState={state => browsing.set(value.version.canvas_id, state)}
  />}</Show><nav class="native-canvas-tools" aria-label="Canvas view">
    <button aria-label="Zoom out" title="Zoom out" disabled={scale() <= 0.1} onClick={() => zoom(0.8)}><Minus /></button>
    <output aria-label="Zoom level">{Math.round(scale() * 100)}%</output>
    <button aria-label="Zoom in" title="Zoom in" disabled={scale() >= 3} onClick={() => zoom(1.25)}><Plus /></button>
    <button aria-label="Fit canvas" title="Fit canvas" onClick={() => { touch?.reset(); control?.fit(); }}><Maximize /></button>
  </nav></main>;
}

window.addEventListener('error', () => notify('error', currentVersion));
window.addEventListener('unhandledrejection', () => notify('error', currentVersion));
render(() => <NativeCanvas />, document.getElementById('root')!);
