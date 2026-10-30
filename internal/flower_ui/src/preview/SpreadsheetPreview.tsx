import './preview.css';
import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Search, Info, ChevronDown, X } from '@floegence/floe-webapp-core/icons';
import { useOverlayMask } from '@floegence/floe-webapp-core';
import { Button, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import type { XlsxSheetViewer, XlsxWorkbook } from '@silurus/ooxml/xlsx';
import type { TaskFilesCopy } from '../taskFilesCopy';

/** Product adapter: the published engine owns parsing, layout, and worksheet content. */
export function SpreadsheetPreview(props: {
  bytes: Uint8Array<ArrayBuffer>; format: 'xlsx' | 'csv' | 'tsv'; copy: TaskFilesCopy;
  source?: JSX.Element; editing?: boolean; truncated?: boolean; allowLocalWheel?: boolean;
}) {
  const [source, setSource] = createSignal(false);
  const [encoding, setEncoding] = createSignal('utf-8');
  const [revision, setRevision] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [scale, setScale] = createSignal(1);
  const [panel, setPanel] = createSignal<'find' | 'info' | 'selection'>();
  const [panelPosition, setPanelPosition] = createSignal({ x: 0, y: 0 });
  const [panelWidth, setPanelWidth] = createSignal(360);
  let panelRoot: HTMLDivElement | undefined;
  let panelAnchor: HTMLElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  const closePanel = () => setPanel(undefined);
  const positionPanel = () => {
    if (!panelAnchor) return;
    const bounds = panelAnchor.getBoundingClientRect();
    const width = Math.min(panel() === 'info' ? 280 : 360, window.innerWidth - 24);
    setPanelWidth(width); setPanelPosition({ x: bounds.right - width, y: bounds.bottom + 6 });
  };
  const openPanel = (kind: 'find' | 'info' | 'selection', anchor: HTMLElement) => {
    if (panel() === kind) { closePanel(); return; }
    panelAnchor = anchor; setPanel(kind); positionPanel();
  };
  useOverlayMask({ open: () => !!panel(), root: () => panelRoot, onClose: closePanel, onInteractOutside: closePanel,
    containsTarget: target => target instanceof Node && !!(panelRoot?.contains(target) || panelAnchor?.contains(target)),
    lockBodyScroll: false, trapFocus: false, blockHotkeys: false, closeOnEscape: 'inside', escapeKeyPhase: 'capture',
    autoFocus: false, restoreFocus: true });
  createEffect(() => {
    if (!panel()) return;
    window.addEventListener('resize', positionPanel); window.addEventListener('scroll', positionPanel, true);
    onCleanup(() => { window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true); });
  });
  const [query, setQuery] = createSignal('');
  const [matches, setMatches] = createSignal<number>();
  const [sheets, setSheets] = createSignal<Array<{ name: string; index: number }>>([]);
  const [sheetIndex, setSheetIndex] = createSignal(0);
  const [selection, setSelection] = createSignal('');
  const isWorkbook = () => props.format === 'xlsx';
  const showSource = () => !isWorkbook() && (source() || props.editing || props.truncated);
  let host!: HTMLDivElement;
  let viewer: Omit<XlsxSheetViewer, 'load'> | undefined;
  let workbook: XlsxWorkbook | undefined;
  let searchRequest = 0;
  const encodings = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be', 'windows-1252'] as const;
  const encodingLabels = ['UTF-8', 'GB18030', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1252'] as const;
  createEffect(on(() => props.bytes, () => { setSource(false); setEncoding('utf-8'); setQuery(''); closePanel(); }));
  createEffect(on(() => [props.bytes, props.format, encoding(), showSource(), revision()] as const, ([bytes, format, codec, textMode]) => {
    setReady(false); setFailed(false); setMatches(undefined); setSelection(''); setSheets([]); setSheetIndex(0);
    if (textMode) return;
    let disposed = false;
    let active: Omit<XlsxSheetViewer, 'load'> | undefined;
    let book: XlsxWorkbook | undefined;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', props.copy.grid);
    // The viewer captures this responsive mount before owning the canvas. Its
    // internal observer follows layout changes without measuring CSS transforms.
    canvas.style.width = '100%'; canvas.style.height = '100%';
    host.replaceChildren(canvas);
    const fail = () => { if (!disposed) { setFailed(true); setReady(false); } };
    void (async () => {
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Spreadsheet preview exceeds 20 MiB');
      const { XlsxSheetViewer: Viewer, XlsxWorkbook: Workbook } = await import('@silurus/ooxml/xlsx');
      if (disposed) return;
      const limits = { maxRows: 100000, maxCells: 1000000, maxOwnedUtf8Bytes: 64 * 1024 * 1024, maxJsonBytes: 128 * 1024 * 1024 };
      const options = {
        useGoogleFonts: false, enableHyperlinks: false, comments: format === 'xlsx', hiddenSheetMode: 'skip' as const,
        zoomMin: 0.25, zoomMax: 3, xlsxWorksheetLimits: limits,
        onError: fail, onSheetChange: (index: number) => { if (!disposed) setSheetIndex(index); },
        onScaleChange: (value: number) => { if (!disposed) setScale(value); },
        onSelectionContextChange: (value: import('@silurus/ooxml/xlsx').XlsxSelectionContext | null) => {
          if (!disposed) setSelection(value?.kind === 'range' ? value.cells.map(cell => cell.formula ? '=' + cell.formula + ' · ' + cell.displayText : cell.displayText).join('\t') : '');
        },
      };
      if (format === 'xlsx') {
        book = await Workbook.load(bytes.slice().buffer, { useGoogleFonts: false, xlsxWorksheetLimits: limits });
        if (disposed) { book.destroy(); return; }
        const visible = book.sheetNames.map((name, index) => ({ name, index })).filter(sheet => !book!.isHidden(sheet.index));
        if (!visible.length) throw new Error('Workbook has no visible worksheet');
        // Public reads surface parse errors that the viewer can otherwise absorb.
        await book.getWorksheet(visible[0].index);
        if (disposed) return;
        workbook = book;
        setSheets(visible);
        active = Viewer.fromWorkbook(canvas, book, options);
        viewer = active;
        await active.goToSheet(visible[0].index);
      } else {
        const delimited = new Viewer(canvas, options);
        active = delimited; viewer = active;
        await delimited.load(bytes.slice().buffer, { format, encoding: codec });
      }
      if (disposed) return;
      for (const element of host.querySelectorAll<HTMLElement>('[tabindex]')) {
        if (getComputedStyle(element).overflowY !== 'auto') continue;
        element.setAttribute('data-floe-canvas-wheel-interactive', 'true');
        element.setAttribute('data-redeven-workbench-wheel-role', 'local-scroll-viewport');
      }
      if (failed() || !active) return;
      if (!active.sheetCount) throw new Error('Workbook has no worksheet');
      setSheetIndex(active.sheetIndex);
      setScale(active.getScale()); setReady(true);
    })().catch(fail);
    onCleanup(() => {
      disposed = true; searchRequest++; active?.destroy(); book?.destroy();
      if (workbook === book) workbook = undefined;
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
    } catch { if (request === searchRequest && viewer === active) { setFailed(true); setReady(false); } }
  };
  const nextMatch = async () => {
    const active = viewer, request = ++searchRequest;
    try { await active?.findNext(); }
    catch { if (request === searchRequest && viewer === active) { setFailed(true); setReady(false); } }
  };
  const selectSheet = async (index: number) => {
    const active = viewer;
    if (!active) return;
    setReady(false); setSelection(''); setMatches(undefined); searchRequest++; active.clearFind();
    try { await workbook?.getWorksheet(index); if (viewer !== active) return; await active.goToSheet(index); if (viewer === active && !failed()) { setSheetIndex(active.sheetIndex); setReady(true); } }
    catch { if (viewer === active) { setFailed(true); setReady(false); } }
  };
  const searchControls = () => <div class="flower-delimited-search">
    <input ref={element => { searchInput = element; if (isWorkbook()) queueMicrotask(() => { if (element.isConnected) element.focus(); }); }} type="search" aria-label={props.copy.findText} placeholder={props.copy.findText} value={query()} disabled={!ready()}
      onInput={event => { searchRequest++; setQuery(event.currentTarget.value); setMatches(undefined); viewer?.clearFind(); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void (matches() ? nextMatch() : search()); } }} />
    <Button size="sm" variant="ghost" aria-label={props.copy.findText} title={props.copy.findText} disabled={!ready()} onClick={() => void search()}><Search class="size-3.5" aria-hidden="true" /></Button>
    <Button size="sm" variant="ghost" aria-label={props.copy.nextMatch} title={props.copy.nextMatch} disabled={!matches()} onClick={() => void nextMatch()}><ChevronDown class="size-3.5" aria-hidden="true" /></Button>
    <Show when={matches() !== undefined}><output aria-live="polite">{matches()}</output></Show>
    <Show when={isWorkbook()}><Button size="sm" variant="ghost" aria-label={props.copy.close} title={props.copy.close} onClick={closePanel}><X class="size-3.5" aria-hidden="true" /></Button></Show>
  </div>;
  return <div class="flower-delimited-preview" data-spreadsheet-format={props.format} onKeyDown={event => {
    if (isWorkbook() && ready() && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation(); if (panel() !== 'find' && searchButton) openPanel('find', searchButton); else searchInput?.focus();
    }
  }}>
    <div class="flower-delimited-toolbar" classList={{ 'flower-spreadsheet-toolbar': isWorkbook() }}>
      <Show when={!isWorkbook()}><div role="group" aria-label={props.copy.preview}>
        <Button size="sm" variant={!showSource() ? 'secondary' : 'ghost'} disabled={!!props.editing || !!props.truncated} aria-pressed={!showSource()} onClick={() => setSource(false)}>{props.copy.grid}</Button>
        <Button size="sm" variant={showSource() ? 'secondary' : 'ghost'} aria-pressed={!!showSource()} onClick={() => setSource(true)}>{props.copy.sourceText}</Button>
      </div></Show>
      <Show when={!showSource()}>
        <Show when={!isWorkbook()}><select aria-label={props.copy.encoding} value={encoding()} onChange={event => setEncoding(event.currentTarget.value)}>
          <For each={encodings}>{(codec, index) => <option value={codec}>{encodingLabels[index()]}</option>}</For>
        </select></Show>
        <Show when={isWorkbook()}><select class="flower-spreadsheet-sheet" aria-label={props.copy.worksheet} title={sheets().find(sheet => sheet.index === sheetIndex())?.name} disabled={!ready()} value={sheetIndex()} onChange={event => void selectSheet(Number(event.currentTarget.value))}>
          <For each={sheets()}>{sheet => <option value={sheet.index}>{sheet.name}</option>}</For>
        </select></Show>
        <Show when={isWorkbook()} fallback={searchControls()}>
          <div class="flower-spreadsheet-selection">
            <Show when={selection()}><button type="button" class="flower-delimited-value" aria-label={props.copy.cellValue} title={selection()} aria-haspopup="dialog" aria-expanded={panel() === 'selection'} onClick={event => openPanel('selection', event.currentTarget)}>{selection()}</button></Show>
          </div>
          <Button ref={searchButton} size="sm" variant="ghost" class="flower-spreadsheet-icon" aria-label={props.copy.findText} title={props.copy.findText} aria-haspopup="dialog" aria-expanded={panel() === 'find'} disabled={!ready()} onClick={event => openPanel('find', event.currentTarget)}><Search class="size-3.5" aria-hidden="true" /></Button>
        </Show>
        <div role="group" aria-label={props.copy.zoom}>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomOut} title={props.copy.zoomOut} disabled={!ready() || scale() <= 0.25} onClick={() => viewer?.setScale(Math.max(0.25, scale() - 0.1))}>−</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.resetZoom} title={props.copy.resetZoom} disabled={!ready()} onClick={() => viewer?.setScale(1)}>{Math.round(scale() * 100)}%</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomIn} title={props.copy.zoomIn} disabled={!ready() || scale() >= 3} onClick={() => viewer?.setScale(Math.min(3, scale() + 0.1))}>+</Button>
        </div>
        <Show when={isWorkbook()}><Button size="sm" variant="ghost" class="flower-spreadsheet-icon" aria-label={props.copy.previewInfo} title={props.copy.previewInfo} aria-haspopup="dialog" aria-expanded={panel() === 'info'} onClick={event => openPanel('info', event.currentTarget)}><Info class="size-3.5" aria-hidden="true" /></Button></Show>
      </Show>
    </div>
    <Show when={panel()}><SurfaceFloatingLayer owner={panelAnchor} position={panelPosition()} estimatedSize={{ width: panelWidth(), height: panel() === 'find' ? 44 : 120 }}
      layerRef={element => { panelRoot = element; queueMicrotask(() => { if (element.isConnected && panel() !== 'find') element.focus(); }); }} role="dialog" aria-modal="false" tabindex={-1} data-spreadsheet-panel
      aria-label={panel() === 'find' ? props.copy.findText : panel() === 'info' ? props.copy.previewInfo : props.copy.cellValue}
      class="flower-spreadsheet-popover bg-popover text-popover-foreground rounded-panel border border-[var(--floe-line)] shadow-[var(--floe-window-shadow)]" style={{ width: panelWidth() + 'px' }}>
      <Show when={panel() === 'find'} fallback={<div class="flower-spreadsheet-detail">{panel() === 'info' ? props.copy.spreadsheetNotice : selection()}</div>}>
        <div class="flower-spreadsheet-find">{searchControls()}</div>
      </Show>
    </SurfaceFloatingLayer></Show>
    <Show when={showSource()}>{props.source}</Show>
    <Show when={!showSource() && !isWorkbook()}>
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
