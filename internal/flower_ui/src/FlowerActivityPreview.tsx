import { createEffect, createMemo, createSignal, createUniqueId, Index, onCleanup, onMount, Show, type Component } from 'solid-js';
import type { FlowerActivityDetailBlock } from './flowerActivityPresentation';
import type { FlowerSurfaceCopy } from './copy';

// Only the explicitly missing detail presenters use this compact preview.
export const FlowerActivityPreview: Component<{
  block: Extract<FlowerActivityDetailBlock, { kind: 'structured_rows' }>;
  copy: FlowerSurfaceCopy['chat'];
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [clipped, setClipped] = createSignal(false);
  let content!: HTMLDivElement;
  const results = () => props.block.section === 'results';
  const visible = createMemo(() => results() && !expanded() ? props.block.rows.slice(0, 3) : props.block.rows);
  const canExpand = () => clipped() || props.block.rows.length > 3 || props.block.rows.some(row => row.content.length > 220 || row.content.split('\n').length > 2);
  const measure = () => {
    if (!expanded()) setClipped([...content.querySelectorAll<HTMLElement>('.flower-activity-preview-text')].some(node => node.scrollHeight > node.clientHeight + 1));
  };
  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    visible();
    expanded();
    queueMicrotask(measure);
  });
  const contentID = createUniqueId();
  return <section class="flower-activity-preview" data-activity-section={props.block.section} data-expanded={expanded()}>
    <Show when={props.block.notice}><p class="flower-activity-detail-notice">{props.block.notice}</p></Show>
    <div ref={content} id={contentID}>
      <Index each={visible()}>{row => <div class="flower-activity-preview-row">
        <Show when={results() && row().title}><div class="flower-activity-preview-title">{row().title}</div></Show>
        <Show when={results() && props.block.previewMeta && row().meta}><span class="flower-activity-preview-meta">{row().meta}</span></Show>
        <Show when={row().content}><p class="flower-activity-preview-text" data-format={row().format}>{row().content}</p></Show>
        <Show when={row().truncated}><p class="flower-activity-detail-notice">{props.copy.toolActivity.truncated}</p></Show>
      </div>}</Index>
    </div>
    <Show when={canExpand()}>
      <button type="button" class="flower-activity-detail-expand" aria-expanded={expanded()} aria-controls={contentID} onClick={() => setExpanded(value => !value)}>
        {expanded() ? props.copy.toolActivity.showLess : props.copy.toolActivity.showAll}
        <Show when={!expanded() && props.block.rows.length > 3}><span class="flower-activity-preview-count">{props.block.rows.length}</span></Show>
      </button>
    </Show>
  </section>;
};
