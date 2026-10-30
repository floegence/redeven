import './preview.css';
import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { createPreviewZoom } from './createPreviewZoom';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { PptxDocumentSurface, PptxPageHandle } from '@floegence/floe-webapp-core/pptx';
import type { FlowerTaskFilePreviewContentProps } from '../FlowerTaskFilePreview';
import type { TaskFilesCopy } from '../taskFilesCopy';
import { DelimitedTextPreview, delimitedFormat } from './DelimitedTextPreview';
import { readSpreadsheetPreview } from './readSpreadsheetPreview';

/** Host-independent product adapter. Office formats retain their accepted renderers. */
export function FlowerRichFilePreview(props: FlowerTaskFilePreviewContentProps & { copy: TaskFilesCopy }) {
  const [bytes, setBytes] = createSignal<Uint8Array<ArrayBuffer>>();
  const [failed, setFailed] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [sheet, setSheet] = createSignal<Awaited<ReturnType<typeof readSpreadsheetPreview>>>();
  const [slides, setSlides] = createSignal<PptxDocumentSurface>();
  const [page, setPage] = createSignal(0);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [dimensions, setDimensions] = createSignal<{ width: number; height: number } | null>(null);
  const zoom = createPreviewZoom({ viewport, content: dimensions, min: 0.1, max: 3, step: 0.1 });
  const [partial, setPartial] = createSignal(false);
  let body!: HTMLDivElement;
  let styles!: HTMLDivElement;
  const format = () => delimitedFormat(props.name);
  createEffect(on(() => [props.blob, props.name, revision()] as const, ([blob, name]) => {
    let disposed = false;
    const controller = new AbortController();
    let presentation: PptxDocumentSurface | undefined;
    setBytes(undefined); setFailed(false); setLoaded(false); setSheet(undefined); setSlides(undefined); setPage(0); setDimensions(null); zoom.reset(); setPartial(false);
    void (async () => {
      if (blob.size > 20 * 1024 * 1024) throw new Error('Preview exceeds 20 MiB');
      const data = new Uint8Array(await blob.arrayBuffer());
      if (disposed) return;
      setBytes(data);
      if (/\.xlsx$/i.test(name)) {
        const value = await readSpreadsheetPreview(data);
        if (disposed) return;
        if (!value) throw new Error('Workbook has no worksheet');
        setSheet(value);
      } else if (/\.docx$/i.test(name)) {
        const { renderAsync } = await import('docx-preview');
        if (disposed) return;
        // Detached containers prevent an obsolete async render from touching its successor.
        const documentBody = document.createElement('div'), documentStyles = document.createElement('div');
        await renderAsync(data, documentBody, documentStyles, { className: 'flower-docx', inWrapper: true, breakPages: true, ignoreWidth: false, ignoreLastRenderedPageBreak: true });
        if (disposed) return;
        body.replaceChildren(documentBody); styles.replaceChildren(documentStyles);
      } else if (/\.pptx$/i.test(name)) {
        const { PptxDocumentSurface: Surface } = await import('@floegence/floe-webapp-core/pptx');
        if (disposed) return;
        presentation = await Surface.open(data, { signal: controller.signal, onNodeError: () => { if (!disposed) setPartial(true); } });
        if (disposed) { presentation.dispose(); return; }
        setSlides(presentation);
      }
      setLoaded(true);
      if (presentation) setDimensions({ width: presentation.pageWidth, height: presentation.pageHeight });
    })().catch(() => { if (!disposed) setFailed(true); });
    onCleanup(() => { disposed = true; controller.abort(); presentation?.dispose(); body.replaceChildren(); styles.replaceChildren(); });
  }));
  createEffect(on(() => [slides(), page()] as const, ([document, index]) => {
    if (!document) return;
    let active = true, handle: PptxPageHandle | undefined;
    void (async () => {
      const container = window.document.createElement('div');
      container.style.width = document.pageWidth + 'px';
      container.style.height = document.pageHeight + 'px';

      handle = document.renderPage(index, container);
      if (!active) { handle.dispose(); return; }
      body.replaceChildren(container);
      await handle.ready;
    })().catch(() => { if (active) setFailed(true); });
    onCleanup(() => { active = false; handle?.dispose(); });
  }));
  createEffect(() => {
    if (!loaded() || slides() || format() || sheet()) return;
    const section = body.querySelector<HTMLElement>('section.flower-docx');
    if (!section) return;
    let frame = 0;
    const measure = () => {
      const width = section.offsetWidth, height = section.offsetHeight;
      setDimensions(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);
    });
    observer.observe(section); measure();
    onCleanup(() => { observer.disconnect(); cancelAnimationFrame(frame); });
  });
  return <div class="flower-rich-preview">
    <Show when={!failed()} fallback={<div class="flower-task-preview-state" role="alert"><p>{props.copy.previewFailed}</p><Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}>{props.copy.retry}</Button></div>}>
      <Show when={loaded()} fallback={<div class="flower-task-preview-state" role="status">{props.copy.loading}</div>}>
        <Show when={format()}>{kind => <DelimitedTextPreview format={kind()} bytes={bytes()!} copy={props.copy} source={<pre class="flower-delimited-source">{new TextDecoder().decode(bytes())}</pre>} />}</Show>
        <Show when={sheet()}>{value => <><div class="flower-rich-notice">{value().sheetName} · {props.copy.basicSpreadsheet}</div><div class="flower-rich-scroll" data-floe-scroll-viewport><table class="flower-basic-table"><tbody><For each={value().rows}>{row => <tr><For each={row}>{cell => <td>{cell}</td>}</For></tr>}</For></tbody></table></div></>}</Show>
        <Show when={slides()}>{document => <><div class="flower-delimited-toolbar">
          <Button size="sm" variant="ghost" disabled={page() === 0} aria-label={props.copy.previousPage} onClick={() => setPage(value => value - 1)}>‹</Button>
          <span>{page() + 1} / {document().pageCount}</span>
          <Button size="sm" variant="ghost" disabled={page() + 1 >= document().pageCount} aria-label={props.copy.nextPage} onClick={() => setPage(value => value + 1)}>›</Button>
        </div><Show when={partial() || document().hasExternalLinks}><div role="status" class="flower-rich-notice">{props.copy.presentationIncomplete}</div></Show></>}</Show>
        <Show when={dimensions()}><div class="flower-delimited-toolbar" role="group" aria-label={props.copy.zoom}>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomOut} disabled={!zoom.canZoomOut()} onClick={zoom.zoomOut}>−</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.resetZoom} onClick={() => zoom.selectMode('actual')}>{zoom.percent()}</Button>
          <Button size="sm" variant="ghost" aria-label={props.copy.zoomIn} disabled={!zoom.canZoomIn()} onClick={zoom.zoomIn}>+</Button>
          <Button size="sm" variant="ghost" onClick={() => zoom.selectMode('contain')}>{props.copy.fitWindow}</Button>
        </div></Show>
      </Show>
    </Show>
    <div ref={styles} hidden />
    <div ref={setViewport} class="flower-rich-scroll" data-floe-scroll-viewport style={{ display: loaded() && !failed() && !format() && !sheet() ? undefined : 'none' }}>
      <div ref={body} data-preview-zoom-content class="flower-rich-document" style={{ zoom: zoom.scale() ?? 1 }} />
    </div>
  </div>;
}
