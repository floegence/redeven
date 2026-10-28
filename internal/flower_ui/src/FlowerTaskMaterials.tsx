import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { FileText } from '@floegence/floe-webapp-core/icons';
import type { FlowerSurfaceAdapter, FlowerTaskMaterial } from './contracts/flowerSurfaceContracts';
import type { TaskFilesCopy } from './taskFilesCopy';
import { FlowerAttachmentPreviewWindow, type FlowerAttachmentPreviewSource } from './attachments/FlowerAttachmentPreviewWindow';

export function FlowerTaskMaterials(props: {
  threadID: string; adapter: FlowerSurfaceAdapter; copy: TaskFilesCopy; refresh: number;
  onSource?: (itemID: string) => void;
}) {
  const [items, setItems] = createSignal<readonly FlowerTaskMaterial[]>([]);
  const [cursor, setCursor] = createSignal<string>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [preview, setPreview] = createSignal<FlowerAttachmentPreviewSource | null>(null);
  const [downloading, setDownloading] = createSignal(false);
  let epoch = 0, downloadController: AbortController | undefined;
  const load = async (more = false) => {
    const thread = props.threadID, current = ++epoch;
    setLoading(true); setError('');
    try {
      const page = await props.adapter.loadTaskMaterials!(thread, more ? cursor() : undefined);
      if (current !== epoch || thread !== props.threadID) return;
      setItems(previous => {
        const distinct = new Map((more ? previous : []).map(item => [item.id, item]));
        for (const item of page.items) if (!distinct.has(item.id)) distinct.set(item.id, item);
        return [...distinct.values()];
      });
      setCursor(page.next_cursor);
    } catch { if (current === epoch) setError(props.copy.failed); }
    finally { if (current === epoch) setLoading(false); }
  };
  createEffect(() => {
    const thread = props.threadID;
    void props.refresh;
    ++epoch; downloadController?.abort(); setDownloading(false); setPreview(null); setItems([]); setCursor(undefined);
    if (thread && props.adapter.loadTaskMaterials) void load();
  });
  onCleanup(() => { ++epoch; downloadController?.abort(); });
  const open = (item: FlowerTaskMaterial) => setPreview({ id: props.threadID + ':' + item.id, name: item.name,
    mimeType: item.mime, load: signal => props.adapter.loadMessageAttachment!({ url: item.url, signal }) });
  const download = async (item: FlowerTaskMaterial) => {
    const controller = new AbortController(), current = epoch;
    downloadController?.abort(); downloadController = controller; setDownloading(true); setError('');
    let url = '';
    try {
      const blob = await props.adapter.loadMessageAttachment!({ url: item.url, signal: controller.signal });
      controller.signal.throwIfAborted();
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.name;
      document.body.append(anchor); anchor.click(); anchor.remove();
    } catch { if (!controller.signal.aborted && current === epoch) setError(props.copy.unavailable); }
    finally { if (url) URL.revokeObjectURL(url); if (downloadController === controller) setDownloading(false); }
  };
  const rows = (kind: 'input' | 'media') => <For each={items().filter(item => item.kind === kind)}>{item => (
    <article class="flower-task-file-card flower-task-material-card">
      <FileText class="size-5 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="font-medium break-words">{item.name}</div>
        <div class="text-xs text-muted-foreground">{item.mime} · {item.size.toLocaleString()} B · {new Date(item.created_at).toLocaleString()}</div>
        <div class="flower-task-file-actions">
          <Show when={props.adapter.loadMessageAttachment && item.url}>
            <Button size="sm" variant="outline" onClick={() => open(item)}>{props.copy.preview}</Button>
            <Button size="sm" variant="outline" disabled={downloading()} onClick={() => void download(item)}>{props.copy.download}</Button>
          </Show>
          <Show when={props.onSource}><Button size="sm" variant="ghost" onClick={() => props.onSource?.(item.item_id)}>{props.copy.source}</Button></Show>
        </div>
      </div>
    </article>
  )}</For>;
  return <section class="flower-task-materials" aria-label={props.copy.materials}>
    <h3 class="font-medium mt-4">{props.copy.materials}</h3>
    <Show when={loading()}><p role="status">{props.copy.loading}</p></Show>
    <Show when={error()}><p role="alert" class="text-destructive">{error()}</p><Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load()}>{props.copy.refresh}</Button></Show>
    <Show when={!loading() && !error() && items().length === 0}><p class="text-muted-foreground py-2">{cursor() ? props.copy.materialsEarlier : props.copy.materialsEmpty}</p></Show>
    <div class="flower-task-files-list">{rows('input')}</div>
    <Show when={items().some(item => item.kind === 'media')}><details class="flower-task-media"><summary>{props.copy.media}</summary><div class="flower-task-files-list">{rows('media')}</div></details></Show>
    <Show when={cursor()}><Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load(true)}>{props.copy.more}</Button></Show>
    <FlowerAttachmentPreviewWindow source={preview()} loadingLabel={props.copy.loading} unavailableLabel={props.copy.unavailable} onClose={() => setPreview(null)} zIndex={100} />
  </section>;
}
