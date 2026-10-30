import './preview.css';
import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { XlsxSheetViewer } from '@silurus/ooxml/xlsx';
import type { TaskFilesCopy } from '../taskFilesCopy';

export function delimitedFormat(name: string): 'csv' | 'tsv' | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension === 'csv' || extension === 'tsv' ? extension : undefined;
}

/** Product adapter: original bytes go directly to the published parser; cells remain text. */
export function DelimitedTextPreview(props: {
  bytes: Uint8Array<ArrayBuffer>; format: 'csv' | 'tsv'; copy: TaskFilesCopy;
  source: JSX.Element; editing?: boolean; truncated?: boolean; allowLocalWheel?: boolean;
}) {
  const [source, setSource] = createSignal(false);
  const [encoding, setEncoding] = createSignal('utf-8');
  const [revision, setRevision] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [scale, setScale] = createSignal(1);
  const [query, setQuery] = createSignal('');
  const [matches, setMatches] = createSignal<number>();
  const [selection, setSelection] = createSignal('');
  const showSource = () => source() || props.editing || props.truncated;
  let host!: HTMLDivElement;
  let viewer: XlsxSheetViewer | undefined;
  let searchRequest = 0;
  const encodings = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be', 'windows-1252'] as const;
  const encodingLabels = ['UTF-8', 'GB18030', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1252'] as const;
  createEffect(on(() => props.bytes, () => { setSource(false); setEncoding('utf-8'); setQuery(''); }));
  createEffect(on(() => [props.bytes, props.format, encoding(), showSource(), revision()] as const, ([bytes, format, codec, textMode]) => {
    setReady(false); setFailed(false); setMatches(undefined); setSelection('');
    if (textMode) return;
    let disposed = false;
    let active: XlsxSheetViewer | undefined;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', props.copy.grid);
    // The viewer captures this responsive mount before owning the canvas. Its
    // internal observer follows layout changes without measuring CSS transforms.
    canvas.style.width = '100%'; canvas.style.height = '100%';
    host.replaceChildren(canvas);
    const fail = () => { if (!disposed) { setFailed(true); setReady(false); } };
    void (async () => {
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Delimited preview exceeds 20 MiB');
      const { XlsxSheetViewer: Viewer } = await import('@silurus/ooxml/xlsx');
      if (disposed) return;
      active = new Viewer(canvas, {
        useGoogleFonts: false, enableHyperlinks: false, comments: false,
        zoomMin: 0.25, zoomMax: 3, xlsxWorksheetLimits: { maxRows: 100000, maxCells: 1000000, maxOwnedUtf8Bytes: 64 * 1024 * 1024, maxJsonBytes: 128 * 1024 * 1024 },
        onError: fail, onScaleChange: value => { if (!disposed) setScale(value); },
        onSelectionContextChange: value => {
          if (!disposed) setSelection(value?.kind === 'range' ? value.cells.map(cell => cell.displayText).join('\t') : '');
        },
      });
      viewer = active;
      await active.load(bytes.slice().buffer, { format, encoding: codec });
      if (disposed) return;
      for (const element of host.querySelectorAll<HTMLElement>('[tabindex]')) {
        if (getComputedStyle(element).overflowY !== 'auto') continue;
        element.setAttribute('data-floe-canvas-wheel-interactive', 'true');
        element.setAttribute('data-redeven-workbench-wheel-role', 'local-scroll-viewport');
      }
      setScale(active.getScale()); setReady(true);
    })().catch(fail);
    onCleanup(() => {
      disposed = true; searchRequest++; active?.destroy();
      if (viewer === active) viewer = undefined;
      host.replaceChildren();
    });
  }));
  const search = async () => {
    const active = viewer, request = ++searchRequest;
    if (!active) return;
    try {
      if (!query()) { active.clearFind(); setMatches(undefined); return; }
      const found = await active.findText(query());
      if (request === searchRequest && viewer === active) setMatches(found.length);
    } catch { if (request === searchRequest) setFailed(true); }
  };
  const nextMatch = async () => {
    const active = viewer, request = ++searchRequest;
    try { await active?.findNext(); }
    catch { if (request === searchRequest && viewer === active) setFailed(true); }
  };
  return <div class="flower-delimited-preview">
    <div class="flower-delimited-toolbar">
      <div role="group" aria-label={props.copy.preview}>
        <Button size="sm" variant={!showSource() ? 'secondary' : 'ghost'} disabled={!!props.editing || !!props.truncated} aria-pressed={!showSource()} onClick={() => setSource(false)}>{props.copy.grid}</Button>
        <Button size="sm" variant={showSource() ? 'secondary' : 'ghost'} aria-pressed={!!showSource()} onClick={() => setSource(true)}>{props.copy.sourceText}</Button>
      </div>
      <Show when={!showSource()}>
        <select aria-label={props.copy.encoding} value={encoding()} onChange={event => setEncoding(event.currentTarget.value)}>
          <For each={encodings}>{(codec, index) => <option value={codec}>{encodingLabels[index()]}</option>}</For>
        </select>
        <div class="flower-delimited-search">
          <input type="search" aria-label={props.copy.findText} placeholder={props.copy.findText} value={query()} disabled={!ready()} onInput={event => { searchRequest++; setQuery(event.currentTarget.value); setMatches(undefined); viewer?.clearFind(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
          <Button size="sm" variant="ghost" disabled={!ready()} onClick={() => void search()}>{props.copy.findText}</Button>
          <Button size="sm" variant="ghost" disabled={!matches()} onClick={() => void nextMatch()}>{props.copy.nextMatch}</Button>
          <Show when={matches() !== undefined}><output aria-live="polite">{matches()}</output></Show>
        </div>
        <div role="group" aria-label={props.copy.zoom}>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomOut} disabled={!ready() || scale() <= 0.25} onClick={() => viewer?.setScale(Math.max(0.25, scale() - 0.1))}>−</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.resetZoom} disabled={!ready()} onClick={() => viewer?.setScale(1)}>{Math.round(scale() * 100)}%</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomIn} disabled={!ready() || scale() >= 3} onClick={() => viewer?.setScale(Math.min(3, scale() + 0.1))}>+</Button>
        </div>
      </Show>
    </div>
    <Show when={!showSource()} fallback={props.source}>
      <div class="flower-delimited-value" aria-label={props.copy.cellValue} title={selection()}>{selection() || ' '}</div>
    </Show>
    <div class="flower-delimited-body" style={{ display: showSource() ? 'none' : undefined }}>
      <div ref={host} class="flower-delimited-canvas" inert={props.allowLocalWheel === false} style={{ 'pointer-events': props.allowLocalWheel === false ? 'none' : undefined }} />
      <Show when={!ready() || failed()}><div class="flower-delimited-state" role={failed() ? 'alert' : 'status'}>
        <span>{failed() ? props.copy.previewFailed : props.copy.loading}</span>
        <Show when={failed()}><Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}>{props.copy.retry}</Button></Show>
      </div></Show>
    </div>
  </div>;
}
