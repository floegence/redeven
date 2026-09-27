import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button, Dropdown } from '@floegence/floe-webapp-core/ui';
import { Search, ArrowUp, ArrowDown, X, Highlighter, History } from '@floegence/floe-webapp-core/icons';
import { PdfDocumentSurface, type PdfPageRenderer, type PdfEditorState, type PdfSearchState } from '@floegence/floe-webapp-core/pdf';
import '@floegence/floe-webapp-core/pdf.css';
import { createPdfPreviewLocalization } from './pdfPreviewLocalization';
import type { BindPdfPreviewEditor, PdfPreviewEditorBinding } from './pdfPreviewEditor';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { loadPDFDocument, pdfAssetsUrl, type PDFDocumentProxy } from './pdfPreviewRuntime';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { FilePreviewZoomControls } from './FilePreviewZoomControls';
import { createPreviewZoom } from './createPreviewZoom';
import { useI18n } from '../i18n';
import type { FilePreviewSurface } from '../utils/filePreview';

const PAGE_LABEL_SPACE = 24;
const PAGE_GAP = 16;
type PageMetric = { pageNumber: number; width: number; height: number };
type PageLayout = PageMetric & { top: number; width: number; height: number };
type LoadedDocument = { document: PDFDocumentProxy; pages: PageMetric[] };

function PdfPreviewPage(props: { document: PDFDocumentProxy; session: PdfDocumentSurface; layout: PageLayout; scale: number; pixelRatio: number }) {
  const i18n = useI18n();
  const [rendered, setRendered] = createSignal(false);
  const [error, setError] = createSignal('');
  const [retry, setRetry] = createSignal(0);
  let holder!: HTMLDivElement;
  let disposed = false;
  let revision = 0;
  let renderer: PdfPageRenderer | null = null;
  let acquiring: Promise<PdfPageRenderer | null> | null = null;
  const acquire = () => acquiring ??= props.document.getPage(props.layout.pageNumber).then(page => {
    if (disposed) { page.cleanup(); return null; }
    return renderer = props.session.mountPage(page, holder);
  }).catch(reason => { acquiring = null; throw reason; });
  createEffect(on(() => [props.scale, props.pixelRatio, retry()] as const, ([scale]) => {
    const request = ++revision;
    setError('');
    void (async () => {
      try {
        const owner = await acquire();
        if (!owner || disposed || request !== revision) return;
        await owner.render(scale);
        if (!disposed && request === revision) setRendered(true);
      } catch (reason) {
        if (!disposed && request === revision) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
  }));
  onCleanup(() => { disposed = true; revision++; renderer?.dispose(); });
  return (
    <div data-page-number={props.layout.pageNumber} class="pdf-preview-pane__page absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: `${props.layout.top}px`, width: `${props.layout.width}px` }}>
      <div class="h-4 text-[11px] leading-4 text-muted-foreground">{i18n.t('uiCopy.preview.pageLabel', { number: props.layout.pageNumber })}</div>
      <div class="pdf-preview-pane__page-frame relative rounded-lg bg-white shadow-sm ring-1 ring-border/60"
        style={{ width: `${props.layout.width}px`, height: `${props.layout.height}px` }}>
        <div ref={holder} class="floe-pdf-page h-full w-full" />
        <Show when={error()} fallback={(
          <Show when={!rendered()}>
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/20 p-2 text-xs text-muted-foreground">{i18n.t('uiCopy.preview.renderingPage')}</div>
          </Show>
        )}>
          <div class="absolute inset-0 overflow-auto bg-background/95 p-3 text-center text-xs">
            <p class="text-error">{i18n.t('uiCopy.preview.pageRenderFailed', { number: props.layout.pageNumber })}</p>
            <Button size="sm" variant="outline" class="mt-2" onClick={() => setRetry(value => value + 1)}>{i18n.t('chatChrome.retry')}</Button>
            <details class="mt-2 text-muted-foreground"><summary class="cursor-pointer">{i18n.t('filePreview.technicalDetails')}</summary><pre class="whitespace-pre-wrap break-all text-left">{error()}</pre></details>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface PdfPreviewPaneProps {
  surface?: FilePreviewSurface;
  bytes?: Uint8Array<ArrayBuffer> | null;
  editing?: boolean;
  saving?: boolean;
  bindPdfEditor?: BindPdfPreviewEditor;
  onSelectionChange?: (value: string) => void;
}

export function PdfPreviewPane(props: PdfPreviewPaneProps) {
  const i18n = useI18n();
  const [loaded, setLoaded] = createSignal<LoadedDocument | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [scrollTop, setScrollTop] = createSignal(0);
  const [session, setSession] = createSignal<PdfDocumentSurface>();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [searchState, setSearchState] = createSignal<PdfSearchState>({ current: 0, total: 0, pending: false });
  const [editorState, setEditorState] = createSignal<PdfEditorState>({ canUndo: false, canRedo: false, hasSelectedAnnotation: false });
  const [canHighlight, setCanHighlight] = createSignal(false);
  let viewer!: HTMLDivElement;
  let searchInput: HTMLInputElement | undefined;
  let localization: ReturnType<typeof createPdfPreviewLocalization> | undefined;
  const [pixelRatio, setPixelRatio] = createSignal(Math.max(1, globalThis.devicePixelRatio || 1));
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const dimensions = createMemo(() => {
    const pages = loaded()?.pages;
    return pages?.length ? {
      width: Math.max(...pages.map(page => page.width)), height: Math.max(...pages.map(page => page.height)),
    } : null;
  });
  const zoom = createPreviewZoom({ viewport, content: dimensions, step: 0.1, min: 0.25, max: 3, labelHeight: PAGE_LABEL_SPACE, pageLayouts: () => layouts() });
  const layouts = createMemo<PageLayout[]>(() => {
    const scale = zoom.scale();
    if (scale === null) return [];
    let top = 0;
    return (loaded()?.pages ?? []).map(page => {
      const layout = { ...page, top, width: page.width * scale, height: page.height * scale };
      top += layout.height + PAGE_LABEL_SPACE + PAGE_GAP;
      return layout;
    });
  });
  const contentHeight = () => { const last = layouts().at(-1); return last ? last.top + last.height + PAGE_LABEL_SPACE : 0; };
  const contentWidth = () => (dimensions()?.width ?? 0) * (zoom.scale() ?? 0);
  const visiblePages = createMemo(() => {
    const height = zoom.viewportSize()?.height ?? 0;
    const overscan = Math.max(height, 800);
    return layouts().filter(page => page.top + page.height + PAGE_LABEL_SPACE >= scrollTop() - overscan
      && page.top <= scrollTop() + height + overscan).map(page => page.pageNumber);
  });
  createEffect(on(() => props.bytes, (bytes) => {
    setLoaded(null); setError(''); setLoading(!!bytes); zoom.reset();
    setSearchOpen(false); setQuery(''); setCanHighlight(false);
    setScrollTop(0);
    const el = untrack(viewport);
    if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
    if (!bytes) return;
    let disposed = false;
    // PDF.js transfers its input buffer to the worker; the controller owns bytes.
    const loadingTask = loadPDFDocument(bytes);
    void (async () => {
      try {
        const document = await loadingTask.promise;
        if (disposed) return;
        const pages: PageMetric[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          if (disposed) return;
          const natural = page.getViewport({ scale: 1 });
          pages.push({ pageNumber, width: natural.width, height: natural.height });
          page.cleanup();
        }
        if (!disposed) setLoaded({ document, pages });
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      } finally { if (!disposed) setLoading(false); }
    })();
    onCleanup(() => {
      disposed = true;
      void Promise.resolve(loadingTask.destroy()).catch(() => {});
    });
  }));
  createEffect(() => {
    const resolution = window.matchMedia?.(`(resolution: ${pixelRatio()}dppx)`);
    const updatePixelRatio = () => setPixelRatio(Math.max(1, globalThis.devicePixelRatio || 1));
    resolution?.addEventListener('change', updatePixelRatio);
    window.addEventListener('resize', updatePixelRatio);
    onCleanup(() => {
      resolution?.removeEventListener('change', updatePixelRatio);
      window.removeEventListener('resize', updatePixelRatio);
    });
  });
  createEffect(on(() => [loaded(), !!props.editing] as const, ([loadedDocument, editable]) => {
    setSession(undefined);
    setEditorState({ canUndo: false, canRedo: false, hasSelectedAnnotation: false });
    const container = untrack(viewport);
    if (!loadedDocument || !container) return;
    const sourceBytes = props.bytes!;
    let binding: PdfPreviewEditorBinding | undefined;
    const l10n = createPdfPreviewLocalization(viewer, i18n);
    localization = l10n;
    const active = new PdfDocumentSurface({ document: loadedDocument.document, container, viewer, assetsUrl: pdfAssetsUrl,
      editable, l10n, onEditorState: setEditorState, onSearchState: setSearchState,
      onDirty: () => binding?.markDirty(),
      onNavigate: pageNumber => {
        const layout = layouts()[pageNumber - 1];
        if (layout) { container.scrollTop = layout.top; setScrollTop(container.scrollTop); }
      },
    });
    if (editable) binding = props.bindPdfEditor?.({ sourceBytes, save: () => active.save() });
    setSession(active);
    if (query()) active.search(query());
    onCleanup(() => { binding?.dispose(); active.destroy(); void l10n.destroy(); localization = undefined; });
  }));
  createEffect(() => { session()?.setScale(zoom.scale() ?? 1); });
  createEffect(() => { i18n.locale(); session(); if (viewer) void localization?.translate(viewer); });
  createEffect(() => {
    const container = viewport();
    if (!container) return;
    const update = () => {
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const local = !!range && viewer.contains(range.startContainer) && viewer.contains(range.endContainer);
      props.onSelectionChange?.(local ? selection!.toString() : '');
      const element = (node: Node) => node instanceof Element ? node : node.parentElement;
      const start = range ? element(range.startContainer)?.closest('.textLayer') : null;
      setCanHighlight(!!local && !selection?.isCollapsed && !!start && start === element(range!.endContainer)?.closest('.textLayer'));
    };
    document.addEventListener('selectionchange', update);
    onCleanup(() => document.removeEventListener('selectionchange', update));
  });
  const openSearch = () => {
    setSearchOpen(true);
    queueMicrotask(() => { searchInput?.focus(); searchInput?.select(); });
  };
  const closeSearch = () => { setSearchOpen(false); session()?.clearSearch(); viewport()?.focus({ preventScroll: true }); };
  return (
    <div class={cn('floe-pdf-surface relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden', props.surface === 'window' ? 'redeven-file-preview-surface-window' : redevenSurfaceRoleClass('main'))}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault(); event.stopPropagation(); openSearch();
        }
      }}>
      <FilePreviewZoomControls zoom={zoom} kind="Pdf" metadata={<><span>PDF</span> · {loaded()?.pages.length ? i18n.tn('uiCopy.preview.pageCount', loaded()!.pages.length) : i18n.t('uiCopy.preview.noPages')}</>} />
      <div class="pdf-document-controls absolute left-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur-sm">
        <Button size="sm" variant="ghost" class="h-8 w-7 px-0" aria-label={i18n.t('filePreview.pdf.search')} title={i18n.t('filePreview.pdf.search')} disabled={!session()} onClick={openSearch}><Search class="size-3.5" /></Button>
        <Show when={props.editing}>
          <Button size="sm" variant="ghost" class="h-8 w-7 px-0" aria-label={i18n.t('filePreview.pdf.highlight')} title={i18n.t(canHighlight() ? 'filePreview.pdf.highlight' : 'filePreview.pdf.selectText')} disabled={!canHighlight() || props.saving} onPointerDown={event => event.preventDefault()} onClick={() => void session()?.highlightSelection()}><Highlighter class="size-3.5" /></Button>
          <Dropdown align="start" triggerClass="flex h-8 w-7 cursor-pointer items-center justify-center rounded hover:bg-accent" triggerAriaLabel={i18n.t('filePreview.pdf.history')}
            trigger={<History class="size-3.5" />} disabled={props.saving}
            items={[
              { id: 'undo', label: i18n.t('filePreview.pdf.undo'), disabled: !editorState().canUndo },
              { id: 'redo', label: i18n.t('filePreview.pdf.redo'), disabled: !editorState().canRedo },
            ]}
            onSelect={action => { if (action === 'undo') session()?.undo(); else if (action === 'redo') session()?.redo(); }} />
        </Show>
      </div>
      <Show when={searchOpen()}>
        <div class="pdf-search-panel absolute inset-x-2 bottom-2 z-20 mx-auto max-w-xl rounded-lg border border-border/60 bg-background/95 p-2 shadow-sm backdrop-blur-sm">
          <Show when={searchOpen()}>
            <div class="flex items-center gap-1">
              <input ref={searchInput} type="search" aria-label={i18n.t('filePreview.pdf.search')} placeholder={i18n.t('filePreview.pdf.search')} value={query()} class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                onInput={event => { setQuery(event.currentTarget.value); session()?.search(query()); }}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
                  else if (event.key === 'Enter') { event.preventDefault(); session()?.search(query(), event.shiftKey, true); }
                }} />
              <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground" role="status">{query() ? searchState().pending ? i18n.t('filePreview.pdf.searching') : searchState().total ? i18n.t('filePreview.pdf.matches', { current: searchState().current, total: searchState().total }) : i18n.t('filePreview.pdf.noMatches') : ''}</span>
              <Button size="sm" variant="ghost" class="h-8 w-7 px-0" aria-label={i18n.t('filePreview.pdf.previous')} disabled={!searchState().total} onClick={() => session()?.search(query(), true, true)}><ArrowUp class="size-3.5" /></Button>
              <Button size="sm" variant="ghost" class="h-8 w-7 px-0" aria-label={i18n.t('filePreview.pdf.next')} disabled={!searchState().total} onClick={() => session()?.search(query(), false, true)}><ArrowDown class="size-3.5" /></Button>
              <Button size="sm" variant="ghost" class="h-8 w-7 px-0" aria-label={i18n.t('common.actions.close')} onClick={closeSearch}><X class="size-3.5" /></Button>
            </div>
          </Show>
        </div>
      </Show>
      <div ref={setViewport} {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS} tabIndex={0} inert={props.saving}
        onScroll={event => {
          const top = event.currentTarget.scrollTop;
          setScrollTop(top);
          const current = layouts().find(page => page.top + page.height + PAGE_LABEL_SPACE > top);
          if (current) session()?.setCurrentPage(current.pageNumber);
        }}
        class="pdf-preview-pane relative min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-anchor:none]">
        <Show when={!error()} fallback={<FilePreviewErrorState errorType="render_error" message={error()} />}>
          <div class="relative grid place-items-center" style={{ width: `${Math.max(contentWidth(), zoom.viewportSize()?.width ?? 0)}px`, height: `${Math.max(contentHeight(), zoom.viewportSize()?.height ?? 0)}px` }}>
            <div ref={viewer} data-preview-zoom-content class="pdfViewer pdf-preview-pane__content relative" style={{ width: `${contentWidth()}px`, height: `${contentHeight()}px` }}>
              <Show when={session()} keyed>{active => (
                <For each={visiblePages()}>{pageNumber => (
                  <PdfPreviewPage document={active.options.document} session={active} layout={layouts()[pageNumber - 1]!} scale={zoom.scale()!} pixelRatio={pixelRatio()} />
                )}</For>
              )}</Show>
            </div>
          </div>
        </Show>
        <RedevenLoadingCurtain visible={loading()} eyebrow={i18n.t('uiCopy.preview.eyebrow')} message={i18n.t('uiCopy.preview.loadingPdf')} />
      </div>
    </div>
  );
}
