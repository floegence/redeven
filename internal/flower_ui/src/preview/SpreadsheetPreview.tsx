import './preview.css';
import type { RegisterPreviewSearch } from './previewSearch';
import { Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { Search, Info, ChevronDown, X } from '@floegence/floe-webapp-core/icons';
import { useOverlayMask } from '@floegence/floe-webapp-core';
import { Button, Select, SurfaceFloatingLayer, createFloatingPresence } from '@floegence/floe-webapp-core/ui';
import type { XlsxSheetViewer, XlsxWorkbook } from '@silurus/ooxml/xlsx';
import type { TaskFilesCopy } from '../taskFilesCopy';

/** Product adapter: the published engine owns parsing, layout, and worksheet content. */
export function SpreadsheetPreview(props: {
  bytes: Uint8Array<ArrayBuffer>; format: 'xlsx' | 'csv' | 'tsv'; copy: TaskFilesCopy;
  active?: boolean; registerSearch?: RegisterPreviewSearch;
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
  const [panelRoot, setPanelRoot] = createSignal<HTMLDivElement>();
  const panelPresence = createFloatingPresence({ open: () => Boolean(panel()), element: panelRoot });
  const presentedPanel = createMemo<ReturnType<typeof panel>>(previous => panel()
    ?? (panelPresence.mounted() ? previous : undefined));
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
  useOverlayMask({ open: () => !!panel(), root: panelRoot, onClose: closePanel, onInteractOutside: closePanel,
    containsTarget: target => target instanceof Node && !!(panelRoot()?.contains(target) || panelAnchor?.contains(target)),
    lockBodyScroll: false, trapFocus: false, blockHotkeys: false, closeOnEscape: 'inside', escapeKeyPhase: 'capture',
    autoFocus: false, restoreFocus: true });
  createEffect(() => {
    if (!panel()) return;
    window.addEventListener('resize', positionPanel); window.addEventListener('scroll', positionPanel, true);
    onCleanup(() => { window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true); });
  });
  const [query, setQuery] = createSignal('');
  const [matches, setMatches] = createSignal<{ total: number; current: number }>();
  const [searching, setSearching] = createSignal(false);
  const [sheets, setSheets] = createSignal<Array<{ name: string; index: number }>>([]);
  const [sheetIndex, setSheetIndex] = createSignal(0);
  const [selection, setSelection] = createSignal('');
  const isWorkbook = () => props.format === 'xlsx';
  const showSource = () => !isWorkbook() && (source() || props.editing || props.truncated);
  const openSearch = (trigger?: HTMLElement) => {
    if (props.active === false || !ready() || showSource()) return;
    if (isWorkbook() || hostedSearch) {
      const anchor = trigger ?? searchButton;
      if (panel() !== 'find' && anchor) openPanel('find', anchor);
      else searchInput?.focus();
    } else { searchInput?.focus(); searchInput?.select(); }
  };
  const hostedSearch = props.registerSearch?.({ show: openSearch, enabled: () => props.active !== false && ready(), expanded: () => panel() === 'find' }, () => !showSource());
  createEffect(() => { if (props.active === false || showSource()) closePanel(); });
  let host!: HTMLDivElement;
  let viewer: Omit<XlsxSheetViewer, 'load'> | undefined;
  let workbook: XlsxWorkbook | undefined;
  let searchRequest = 0;
  const encodings = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be', 'windows-1252'] as const;
  const encodingLabels = ['UTF-8', 'GB18030', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1252'] as const;
  createEffect(on(() => props.bytes, () => { setSource(false); setEncoding('utf-8'); setQuery(''); closePanel(); }));
  createEffect(on(() => [props.bytes, props.format, encoding(), showSource(), revision()] as const, ([bytes, format, codec, textMode]) => {
    setReady(false); setFailed(false); setMatches(undefined); setSearching(false); setSelection(''); setSheets([]); setSheetIndex(0);
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
        // Keep text readable and the current cell distinct from other matches.
        findHighlightColors: { match: 'rgba(255, 179, 0, 0.12)', active: 'rgba(26, 115, 232, 0.24)' },
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
    const active = viewer;
    if (!active || searching()) return;
    const request = ++searchRequest;
    setSearching(true);
    try {
      if (!query()) { active.clearFind(); setMatches(undefined); return; }
      const found = await active.findText(query());
      if (request !== searchRequest || viewer !== active) return;
      // findText collects matches; navigation activates and reveals a result.
      const current = found.length ? await active.findNext() : null;
      if (request !== searchRequest || viewer !== active) return;
      if (current) active.setSelection(current.location.ref);
      setMatches({ total: found.length, current: current ? current.matchIndex + 1 : 0 });
    } catch { if (request === searchRequest && viewer === active) { setFailed(true); setReady(false); } }
    finally { if (request === searchRequest && viewer === active) setSearching(false); }
  };
  const nextMatch = async (previous = false) => {
    const active = viewer;
    if (!active || searching() || !matches()?.total) return;
    const request = ++searchRequest;
    setSearching(true);
    try {
      const current = await (previous ? active.findPrev() : active.findNext());
      if (request !== searchRequest || viewer !== active) return;
      if (current) active.setSelection(current.location.ref);
      setMatches(value => value && { ...value, current: current ? current.matchIndex + 1 : 0 });
    }
    catch { if (request === searchRequest && viewer === active) { setFailed(true); setReady(false); } }
    finally { if (request === searchRequest && viewer === active) setSearching(false); }
  };
  const selectSheet = async (index: number) => {
    const active = viewer;
    if (!active) return;
    setReady(false); setSelection(''); setMatches(undefined); setSearching(false); searchRequest++; active.clearFind();
    try { await workbook?.getWorksheet(index); if (viewer !== active) return; await active.goToSheet(index); if (viewer === active && !failed()) { setSheetIndex(active.sheetIndex); setReady(true); } }
    catch { if (viewer === active) { setFailed(true); setReady(false); } }
  };
  const searchControls = () => <div class="flower-delimited-search">
    <input ref={element => { searchInput = element; if (isWorkbook() || hostedSearch) queueMicrotask(() => { if (element.isConnected && props.active !== false && panel() === 'find') element.focus(); }); }} type="search" aria-label={props.copy.findText} placeholder={props.copy.findText} value={query()} disabled={!ready()}
      onInput={event => { searchRequest++; setQuery(event.currentTarget.value); setMatches(undefined); setSearching(false); viewer?.clearFind(); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void (matches()?.total ? nextMatch(event.shiftKey) : search()); } }} />
    <Button size="sm" variant="ghost" aria-label={props.copy.findText} title={props.copy.findText} disabled={!ready() || searching()} onClick={() => void search()}><Search class="size-3.5" aria-hidden="true" /></Button>
    <Button size="sm" variant="ghost" aria-label={props.copy.nextMatch} title={props.copy.nextMatch} disabled={!matches()?.total || searching()} onClick={() => void nextMatch()}><ChevronDown class="size-3.5" aria-hidden="true" /></Button>
    <Show when={matches()}>{result => <output aria-live="polite" aria-atomic="true">{result().current} / {result().total}</output>}</Show>
    <Show when={isWorkbook() || hostedSearch}><Button size="sm" variant="ghost" aria-label={props.copy.close} title={props.copy.close} onClick={closePanel}><X class="size-3.5" aria-hidden="true" /></Button></Show>
  </div>;
  return <div class="flower-delimited-preview" data-spreadsheet-format={props.format} onKeyDown={event => {
    if (!hostedSearch && props.active !== false && !showSource() && ready() && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation(); openSearch();
    }
  }}>
    <div class="flower-delimited-toolbar" classList={{ 'flower-spreadsheet-toolbar': isWorkbook() }}>
      <Show when={!isWorkbook()}><div role="group" aria-label={props.copy.preview}>
        <Button size="sm" variant={!showSource() ? 'secondary' : 'ghost'} disabled={!!props.editing || !!props.truncated} aria-pressed={!showSource()} onClick={() => setSource(false)}>{props.copy.grid}</Button>
        <Button size="sm" variant={showSource() ? 'secondary' : 'ghost'} aria-pressed={!!showSource()} onClick={() => setSource(true)}>{props.copy.sourceText}</Button>
      </div></Show>
      <Show when={!showSource()}>
        <Show when={!isWorkbook()}><div class="flower-spreadsheet-encoding"><Select class="h-7 text-xs" ariaLabel={props.copy.encoding} value={encoding()} onChange={setEncoding}
          options={encodings.map((codec, index) => ({ value: codec, label: encodingLabels[index] }))} /></div></Show>
        <Show when={isWorkbook()}><div class="flower-spreadsheet-sheet"><Select class="h-7 text-xs" ariaLabel={props.copy.worksheet} disabled={!ready()} value={String(sheetIndex())} onChange={value => void selectSheet(Number(value))}
          options={sheets().map(sheet => ({ value: String(sheet.index), label: sheet.name }))} /></div></Show>
        <Show when={isWorkbook()} fallback={<Show when={!hostedSearch}>{searchControls()}</Show>}>
          <div class="flower-spreadsheet-selection">
            <Show when={selection()}><button type="button" class="flower-delimited-value" aria-label={props.copy.cellValue} title={selection()} aria-haspopup="dialog" aria-expanded={panel() === 'selection'} onClick={event => openPanel('selection', event.currentTarget)}>{selection()}</button></Show>
          </div>
          <Show when={!hostedSearch}><Button ref={searchButton} size="sm" variant="ghost" class="flower-spreadsheet-icon" aria-label={props.copy.findText} title={props.copy.findText} aria-haspopup="dialog" aria-expanded={panel() === 'find'} disabled={!ready()} onClick={event => openSearch(event.currentTarget)}><Search class="size-3.5" aria-hidden="true" /></Button></Show>
        </Show>
        <div role="group" aria-label={props.copy.zoom}>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomOut} title={props.copy.zoomOut} disabled={!ready() || scale() <= 0.25} onClick={() => viewer?.setScale(Math.max(0.25, scale() - 0.1))}>−</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.resetZoom} title={props.copy.resetZoom} disabled={!ready()} onClick={() => viewer?.setScale(1)}>{Math.round(scale() * 100)}%</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomIn} title={props.copy.zoomIn} disabled={!ready() || scale() >= 3} onClick={() => viewer?.setScale(Math.min(3, scale() + 0.1))}>+</Button>
        </div>
        <Show when={isWorkbook()}><Button size="sm" variant="ghost" class="flower-spreadsheet-icon" aria-label={props.copy.previewInfo} title={props.copy.previewInfo} aria-haspopup="dialog" aria-expanded={panel() === 'info'} onClick={event => openPanel('info', event.currentTarget)}><Info class="size-3.5" aria-hidden="true" /></Button></Show>
      </Show>
    </div>
    <Show when={panelPresence.mounted() && props.active !== false}><SurfaceFloatingLayer owner={panelAnchor} position={panelPosition()} estimatedSize={{ width: panelWidth(), height: presentedPanel() === 'find' ? 44 : 120 }}>
      <div ref={element => { setPanelRoot(element); onCleanup(() => setPanelRoot(undefined)); queueMicrotask(() => { if (element.isConnected && panel() && panel() !== 'find') element.focus(); }); }}
        role="dialog" aria-modal="false" tabindex={-1} data-spreadsheet-panel data-floe-surface="floating"
        data-floating-presence={panelPresence.state()} inert={panelPresence.exiting()} aria-hidden={panelPresence.exiting() ? 'true' : undefined}
        aria-label={presentedPanel() === 'find' ? props.copy.findText : presentedPanel() === 'info' ? props.copy.previewInfo : props.copy.cellValue}
        class="flower-spreadsheet-popover floe-floating-presence floe-floating-menu bg-popover text-popover-foreground rounded-panel border border-[var(--floe-line)]" style={{ width: panelWidth() + 'px' }}>
      <Show when={presentedPanel() === 'find'} fallback={<div class="flower-spreadsheet-detail">{presentedPanel() === 'info' ? props.copy.spreadsheetNotice : selection()}</div>}>
        <div class="flower-spreadsheet-find">{searchControls()}</div>
      </Show>
      </div>
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
