import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, Download, MessageSquare } from '@floegence/floe-webapp-core/icons';
import { retainKeyedItems } from './presentationIdentity';
import { FlowerTaskFileIdentity } from './FlowerTaskFileIdentity';
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
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const [preview, setPreview] = createSignal<FlowerAttachmentPreviewSource | null>(null);
  const [downloading, setDownloading] = createSignal(false);
  let epoch = 0, downloadController: AbortController | undefined;
  let ownerThread: string | undefined;
  let ownerRuntime: string | undefined;
  const load = async (more = false) => {
    const thread = props.threadID, current = ++epoch;
    setLoading(true); setError('');
    try {
      const page = await props.adapter.loadTaskMaterials!(thread, more ? cursor() : undefined);
      if (current !== epoch || thread !== props.threadID) return;
      setItems(previous => {
        const distinct = new Map((more ? previous : []).map(item => [item.id, item]));
        for (const item of page.items) if (!distinct.has(item.id)) distinct.set(item.id, item);
        return retainKeyedItems(previous, [...distinct.values()], item => item.id);
      });
      setCursor(page.next_cursor);
      setLoaded(true);
    } catch { if (current === epoch) setError(props.copy.failed); }
    finally { if (current === epoch) setLoading(false); }
  };
  createEffect(() => {
    const thread = props.threadID;
    void props.refresh;
    ++epoch;
    if (thread !== ownerThread || props.adapter.runtime?.runtime_id !== ownerRuntime) {
      ownerThread = thread; ownerRuntime = props.adapter.runtime?.runtime_id; setLoaded(false);
      downloadController?.abort(); setDownloading(false); setPreview(null); setItems([]); setCursor(undefined);
    }
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
    <article class="flower-task-file-row flower-task-material-row">
      <FlowerTaskFileIdentity name={item.name} mime={item.mime} size={item.size}
        onPreview={props.adapter.loadMessageAttachment && item.url ? () => open(item) : undefined} previewLabel={props.copy.preview}
        detail={<time class="flower-task-file-date" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>} />
      <div class="flower-task-file-actions">
        <Show when={props.adapter.loadMessageAttachment && item.url}>
          <Button size="icon" variant="ghost" icon={Download} aria-label={props.copy.download} title={props.copy.download} disabled={downloading()} onClick={() => void download(item)} />
        </Show>
        <Show when={props.onSource}><Button size="icon" variant="ghost" icon={MessageSquare} aria-label={props.copy.source} title={props.copy.source} onClick={() => props.onSource?.(item.item_id)} /></Show>
      </div>
    </article>
  )}</For>;
  return <section class="flower-task-materials flower-task-files-section" aria-label={props.copy.materials} aria-busy={loading()}>
    <div class="flower-task-section-heading"><h3>{props.copy.materials}</h3><span class="flower-task-count">{items().length}{cursor() ? '+' : ''}</span></div>
    <Show when={loading()}><span class="flower-visually-hidden" role="status">{props.copy.loading}</span></Show>
    <Show when={loading() && !loaded()}><div class="flower-loading-rows" aria-hidden="true"><span /><span /><span /></div></Show>
    <Show when={error()}><p role="alert" class="text-destructive">{error()}</p><Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load()}>{props.copy.refresh}</Button></Show>
    <Show when={loaded() && !error() && items().length === 0}><p class="flower-task-files-empty">{cursor() ? props.copy.materialsEarlier : props.copy.materialsEmpty}</p></Show>
    <Show when={items().some(item => item.kind === 'input')}><div class="flower-task-files-list">{rows('input')}</div></Show>
    <Show when={items().some(item => item.kind === 'media')}><details class="flower-task-media"><summary><span class="flower-task-disclosure-title">{props.copy.media}</span><span class="flower-task-count">{items().filter(item => item.kind === 'media').length}</span><ChevronRight class="flower-task-disclosure-chevron size-4" aria-hidden="true" /></summary><div class="flower-task-files-list">{rows('media')}</div></details></Show>
    <Show when={cursor()}><Button size="sm" variant="ghost" class="flower-task-load-more" loading={loading()} onClick={() => void load(true)}>{props.copy.more}</Button></Show>
    <FlowerAttachmentPreviewWindow source={preview()} loadingLabel={props.copy.loading} unavailableLabel={props.copy.unavailable} onClose={() => setPreview(null)} zIndex={100} />
  </section>;
}
