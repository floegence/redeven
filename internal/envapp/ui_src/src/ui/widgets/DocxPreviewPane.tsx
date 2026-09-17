import { Show, createEffect, createSignal, on, onCleanup, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { FilePreviewZoomControls } from './FilePreviewZoomControls';
import { createPreviewZoom } from './createPreviewZoom';
import type { FilePreviewSurface } from '../utils/filePreview';

type DocxLayout = { width: number; height: number; pageWidth: number; pageHeight: number };
const CLASS_NAME = 'docx-preview-container';

function DocxDocument(props: {
  bytes: Uint8Array<ArrayBuffer>;
  onLayout: (layout: DocxLayout) => void;
  onError: (error: string) => void;
}) {
  let body!: HTMLDivElement;
  let styles!: HTMLDivElement;
  createEffect(on(() => props.bytes, bytes => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (disposed) return;
        await renderAsync(bytes, body, styles, {
          className: CLASS_NAME, inWrapper: true, breakPages: true, ignoreWidth: false,
          ignoreLastRenderedPageBreak: true, useBase64URL: false,
        });
        if (disposed) return;
        const wrapper = body.querySelector<HTMLElement>(`.${CLASS_NAME}-wrapper`);
        if (!wrapper) throw new Error('DOCX page layout is unavailable.');
        Object.assign(wrapper.style, { width: 'max-content', padding: '0', gap: '16px', background: 'transparent' });
        const pages = [...wrapper.querySelectorAll<HTMLElement>(`:scope > section.${CLASS_NAME}`)];
        for (const page of pages) page.style.margin = '0';
        const measure = () => {
          if (disposed) return;
          const width = Math.max(wrapper.offsetWidth, wrapper.scrollWidth);
          const height = Math.max(wrapper.offsetHeight, wrapper.scrollHeight);
          const pageWidth = Math.max(0, ...pages.map(page => Math.max(page.offsetWidth, page.scrollWidth)));
          const pageHeight = Math.max(0, ...pages.map(page => Math.max(page.offsetHeight, page.scrollHeight)));
          if (width > 0 && height > 0 && pageWidth > 0 && pageHeight > 0) props.onLayout({ width, height, pageWidth, pageHeight });
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure);
          observer.observe(wrapper);
          for (const page of pages) observer.observe(page);
        }
      } catch (reason) {
        if (!disposed) props.onError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    onCleanup(() => { disposed = true; observer?.disconnect(); body.replaceChildren(); styles.replaceChildren(); });
  }));
  return <><div ref={styles} class="hidden" aria-hidden="true" /><div ref={body} class="docx-preview-pane__document" /></>;
}

export interface DocxPreviewPaneProps { surface?: FilePreviewSurface; bytes?: Uint8Array<ArrayBuffer> | null }

export function DocxPreviewPane(props: DocxPreviewPaneProps) {
  const [error, setError] = createSignal('');
  const [layout, setLayout] = createSignal<DocxLayout | null>(null);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const zoom = createPreviewZoom({ viewport, content: () => {
    const value = layout(); return value ? { width: value.pageWidth, height: value.pageHeight } : null;
  }, min: 0.1, max: 3, step: 0.1 });
  createEffect(on(() => props.bytes, () => {
    setError(''); setLayout(null); zoom.reset();
    const el = untrack(viewport); if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
  }));
  const width = () => (layout()?.width ?? 0) * (zoom.scale() ?? 0);
  const height = () => (layout()?.height ?? 0) * (zoom.scale() ?? 0);
  return (
    <div class={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', props.surface === 'window' ? 'redeven-file-preview-surface-window' : redevenSurfaceRoleClass('main'))}>
      <div class="docx-preview-controls flex shrink-0 justify-end border-b border-border/60 px-3 py-2"><FilePreviewZoomControls zoom={zoom} kind="Docx" /></div>
      <div ref={setViewport} {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS} class="docx-preview-pane relative min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-anchor:none]">
        <Show when={!error()} fallback={<FilePreviewErrorState errorType="render_error" message={error()} />}>
          <div class="relative grid place-items-center" style={{ width: `${Math.max(width(), zoom.viewportSize()?.width ?? 0)}px`, height: `${Math.max(height(), zoom.viewportSize()?.height ?? 0)}px` }}>
            <div data-preview-zoom-content class="docx-preview-pane__frame relative" style={{ width: `${width()}px`, height: `${height()}px` }}>
              <div class="docx-preview-pane__content absolute left-0 top-0 origin-top-left" style={{ width: layout() ? `${layout()!.width}px` : 'max-content', transform: `scale(${zoom.scale() ?? 1})`, visibility: layout() && zoom.scale() !== null ? 'visible' : 'hidden' }}>
                <Show when={props.bytes} keyed>{bytes => <DocxDocument bytes={bytes} onLayout={setLayout} onError={setError} />}</Show>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
