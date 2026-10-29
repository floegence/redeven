import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { Button, Dialog, FeedbackIndicator, Input, StableText } from '@floegence/floe-webapp-core/ui';
import { ArrowLeft, ChevronRight, Download, Folder, FolderOpen, MessageSquare, Refresh, Search, Trash } from '@floegence/floe-webapp-core/icons';
import { FlowerTaskFileIdentity, taskFileSize } from './FlowerTaskFileIdentity';
import { FlowerMessageImage } from './chat/FlowerMessageImage';
import { FlowerAttachmentPreviewWindow, type FlowerAttachmentPreviewSource } from './attachments/FlowerAttachmentPreviewWindow';
import { createTaskFileListing, type TaskFileFilter } from './createTaskFileListing';
import type { FlowerSurfaceAdapter, FlowerTaskMaterial } from './contracts/flowerSurfaceContracts';
import type { TaskFilesCopy } from './taskFilesCopy';

export function FlowerTaskFiles(props: {
  open: boolean; onOpenChange: (open: boolean) => void; threadID: string;
  adapter: FlowerSurfaceAdapter; copy: TaskFilesCopy;
  onSource?: (itemID: string) => void;
  onPreview?: (path: string) => Promise<void>;
  onOpenFolder?: (path: string) => Promise<void>;
}) {
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal<TaskFileFilter>('all');
  const [nearEnd, setNearEnd] = createSignal(true);
  const [working, setWorking] = createSignal(false);
  const [confirm, setConfirm] = createSignal(false);
  const [cleaning, setCleaning] = createSignal(false);
  const [downloading, setDownloading] = createSignal<string>();
  const [error, setError] = createSignal('');
  const [preview, setPreview] = createSignal<FlowerAttachmentPreviewSource | null>(null);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const listing = createTaskFileListing(props, query, filter, nearEnd, () => !working());
  let operation: AbortController | undefined;
  let epoch = 0;
  let searchInput: HTMLInputElement | undefined;
  let workingTrigger: HTMLButtonElement | undefined;
  let filesScrollTop = 0;
  createEffect(() => {
    void props.open; void listing.owner();
    untrack(() => {
      epoch++; operation?.abort(); setDownloading(undefined); setError(''); setPreview(null); setCleaning(false);
      setConfirm(false); setWorking(false); setQuery(''); setFilter('all'); setNearEnd(true);
    });
  });
  onCleanup(() => { epoch++; operation?.abort(); });
  createEffect(() => {
    const root = viewport(), target = sentinel();
    if (!props.open || !root || !target) return;
    const observer = new IntersectionObserver(entries => setNearEnd(entries.some(entry => entry.isIntersecting)), { root, rootMargin: '100px' });
    observer.observe(target);
    onCleanup(() => observer.disconnect());
  });
  const filters = createMemo<TaskFileFilter[]>(() => [
    'all', ...(listing.data()?.files.length ? ['results' as const] : []),
    ...(listing.materials().some(item => item.kind === 'input') ? ['uploads' as const] : []),
    ...(listing.materials().some(item => item.kind === 'media') ? ['media' as const] : []),
  ]);
  createEffect(() => {
    if (!listing.loading() && !filters().includes(filter())) setFilter('all');
  });
  const anyFiles = () => Boolean(listing.data()?.files.length || listing.materials().length);
  const empty = () => listing.files().length + listing.visibleMaterials().length === 0;
  const canPreview = () => props.onPreview || props.adapter.openLinkedFilePreview;
  const canFolder = () => props.onOpenFolder || props.adapter.openLinkedDirectoryBrowser;
  const openPath = async (path: string, directory = false) => {
    const generation = epoch;
    try {
      const open = directory ? props.onOpenFolder : props.onPreview;
      if (open) { await open(path); return; }
      const request = { path, thread_id: props.threadID, message_id: '', context_index: 0,
        source_surface: 'flower_composer' as const, target: props.adapter.runtime?.runtime_id ?? '' };
      if (directory) await props.adapter.openLinkedDirectoryBrowser?.(request);
      else await props.adapter.openLinkedFilePreview?.(request);
    } catch { if (generation === epoch) setError(props.copy.unavailable); }
  };
  const download = async (key: string, read: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController(), generation = epoch;
    operation?.abort(); operation = controller; setDownloading(key); setError('');
    try { await read(controller.signal); }
    catch { if (!controller.signal.aborted && generation === epoch) setError(props.copy.unavailable); }
    finally { if (operation === controller) { setDownloading(undefined); operation = undefined; } }
  };
  const downloadMaterial = (item: FlowerTaskMaterial) => download(item.id, async signal => {
    const blob = await props.adapter.loadMessageAttachment!({ url: item.url, signal });
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    try { anchor.href = url; anchor.download = item.name; document.body.append(anchor); anchor.click(); }
    finally { anchor.remove(); URL.revokeObjectURL(url); }
  });
  const openMaterial = (item: FlowerTaskMaterial) => setPreview({ id: props.threadID + ':' + item.id,
    name: item.name, mimeType: item.mime, load: signal => props.adapter.loadMessageAttachment!({ url: item.url, signal }) });
  const clean = async () => {
    const generation = epoch;
    setCleaning(true); setError('');
    try {
      await props.adapter.cleanTaskFiles!(props.threadID);
      if (generation === epoch) { setConfirm(false); listing.refresh(); }
    } catch { if (generation === epoch) setError(props.copy.failed); }
    finally { if (generation === epoch) setCleaning(false); }
  };
  const openWorking = () => { filesScrollTop = viewport()?.scrollTop ?? 0; setWorking(true); viewport()?.scrollTo({ top: 0 }); };
  const returnToFiles = () => {
    setWorking(false); setConfirm(false);
    queueMicrotask(() => { viewport()?.scrollTo({ top: filesScrollTop }); (workingTrigger ?? searchInput)?.focus({ preventScroll: true }); });
  };
  return <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={working() ? props.copy.working : props.copy.title}
      closeLabel={props.copy.close} class="flower-task-files-dialog w-[min(40rem,94vw)] max-w-3xl" contentClass="flower-task-files-content">
      <Show when={!working()} fallback={<div class="flower-task-files-toolbar">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={returnToFiles}>{props.copy.back}</Button>
        <Button size="icon" variant="ghost" icon={Refresh} loading={listing.loading()} aria-label={props.copy.refresh} title={props.copy.refresh} onClick={listing.refresh} />
      </div>}>
        <div class="flower-task-files-toolbar">
          <Input ref={searchInput} type="search" value={query()} placeholder={props.copy.search} aria-label={props.copy.search}
            leftIcon={<Search class="size-4" />} onInput={event => { setQuery(event.currentTarget.value); viewport()?.scrollTo({ top: 0 }); }} />
          <Button size="icon" variant="ghost" icon={Refresh} loading={listing.loading()} aria-label={props.copy.refresh} title={props.copy.refresh} onClick={listing.refresh} />
          <FeedbackIndicator entries={error() ? [{ id: 'file-action', severity: 'error', summary: error() }] : []}
            label={props.copy.failed} closeLabel={props.copy.close} restoreFocus={() => searchInput} />
        </div>
        <Show when={filters().length > 2}>
          <div class="flower-task-file-filters" role="group" aria-label={props.copy.filter}>
            <For each={filters()}>{kind => <Button size="sm" variant={filter() === kind ? 'primary' : 'ghost'}
              aria-pressed={filter() === kind} onClick={() => { setFilter(kind); viewport()?.scrollTo({ top: 0 }); }}>{props.copy[kind]}</Button>}</For>
          </div>
        </Show>
      </Show>
      <Show when={listing.data()?.state_in_workspace}><p class="flower-task-files-notice">{props.copy.warning}</p></Show>
      <div ref={setViewport} class="flower-task-files-viewport" data-floe-scroll-viewport role="region" aria-label={working() ? props.copy.working : props.copy.title}>
        <Show when={!working()} fallback={<section class="flower-task-working">
          <p class="flower-task-working-description">{props.copy.workingDescription}</p>
          <For each={listing.data()?.working ?? []}>{file => <article class="flower-task-file-row">
            <FlowerTaskFileIdentity name={file.name} mime="" size={file.size} previewLabel={props.copy.preview} />
            <Show when={props.adapter.downloadTaskFile}><Button size="icon" variant="ghost" icon={Download} aria-label={props.copy.download} title={props.copy.download}
              loading={downloading() === file.path} disabled={Boolean(downloading())} onClick={() => void download(file.path, signal => props.adapter.downloadTaskFile!(props.threadID, file.path, true, signal))} /></Show>
          </article>}</For>
          <Show when={listing.data()?.working_truncated}><p class="flower-task-files-notice">{props.copy.truncated}</p></Show>
          <Show when={!listing.data()?.can_clean}><p class="flower-task-working-description">{props.copy.busy}</p></Show>
          <Show when={!listing.data()?.working_files}><p class="flower-task-files-empty">{props.copy.workingEmpty}</p></Show>
          <Show when={error()}><p role="alert" class="flower-task-files-notice text-destructive">{error()}</p></Show>
          <Show when={props.adapter.cleanTaskFiles && props.adapter.canMutate !== false && listing.data()?.working_files}>
            <Show when={confirm()} fallback={<Button size="sm" variant="ghost-destructive" icon={Trash} disabled={cleaning() || listing.loading() || Boolean(downloading()) || !listing.data()?.can_clean}
              onClick={() => setConfirm(true)}>{props.copy.clean}</Button>}>
              <div role="alert" class="flower-task-files-notice"><p>{props.copy.confirm}</p><div class="flower-task-file-actions">
                <Button size="sm" variant="destructive" icon={Trash} loading={cleaning()} disabled={listing.loading() || Boolean(downloading()) || !listing.data()?.can_clean} onClick={() => void clean()}>{props.copy.clean}</Button>
                <Button size="sm" variant="ghost" disabled={cleaning()} onClick={() => setConfirm(false)}>{props.copy.cancel}</Button>
              </div></div>
            </Show>
          </Show>
        </section>}>
          <div class="flower-task-files-list">
            <For each={listing.files()}>{file => <article class="flower-task-file-row">
              <FlowerTaskFileIdentity name={file.name} title={file.title} mime={file.mime} size={file.size} origin={props.copy.generated}
                onPreview={canPreview() ? () => void openPath(file.file_path) : undefined} previewLabel={props.copy.preview}
                previewDisabled={file.status === 'missing' || file.status === 'unavailable'}
                status={<Show when={file.status !== 'available'}><span class="flower-task-file-status" data-status={file.status}>{props.copy[file.status]}</span></Show>} />
              <div class="flower-task-file-actions">
                <Show when={canFolder()}><Button size="icon" variant="ghost" icon={Folder} aria-label={props.copy.folder} title={props.copy.folder}
                  onClick={() => void openPath(file.file_path.replace(/[/\\][^/\\]+$/, ''), true)} /></Show>
                <Show when={props.adapter.downloadTaskFile}><Button size="icon" variant="ghost" icon={Download} aria-label={props.copy.download} title={props.copy.download}
                  loading={downloading() === file.file_path} disabled={Boolean(downloading()) || file.status === 'missing' || file.status === 'unavailable'}
                  onClick={() => void download(file.file_path, signal => props.adapter.downloadTaskFile!(props.threadID, file.file_path, false, signal))} /></Show>
              </div>
            </article>}</For>
            <For each={listing.visibleMaterials()}>{item => <article class="flower-task-file-row flower-task-material-row">
              <FlowerTaskFileIdentity name={item.name} mime={item.mime} size={item.size} origin={item.kind === 'input' ? props.copy.uploaded : props.copy.media}
                onPreview={props.adapter.loadMessageAttachment && item.url ? () => openMaterial(item) : undefined} previewLabel={props.copy.preview}
                thumbnail={props.adapter.loadMessageAttachment && item.url && item.mime.startsWith('image/') ?
                  <FlowerMessageImage src={item.url} alt="" name={item.name} unavailableLabel={props.copy.unavailable} thumbnail
                    load={(url, signal) => props.adapter.loadMessageAttachment!({ url, signal })} onOpen={() => openMaterial(item)} /> : undefined} />
              <div class="flower-task-file-actions">
                <Show when={props.onSource}><Button size="icon" variant="ghost" icon={MessageSquare} aria-label={props.copy.source} title={props.copy.source} onClick={() => props.onSource?.(item.item_id)} /></Show>
                <Show when={props.adapter.loadMessageAttachment && item.url}><Button size="icon" variant="ghost" icon={Download} aria-label={props.copy.download} title={props.copy.download}
                  loading={downloading() === item.id} disabled={Boolean(downloading())} onClick={() => void downloadMaterial(item)} /></Show>
              </div>
            </article>}</For>
          </div>
          <Show when={!listing.ready() && empty()}><div class="flower-loading-rows" role="status" aria-label={props.copy.loading}><span /><span /><span /></div></Show>
          <Show when={listing.ready() && empty() && !listing.failed() && !listing.hasMore()}>
            <div class="flower-task-files-empty"><FolderOpen class="size-7" /><strong>{anyFiles() ? props.copy.noResults : props.copy.empty}</strong>
              <p>{anyFiles() ? props.copy.noResultsHint : props.copy.emptyHint}</p></div>
          </Show>
          <div ref={setSentinel} class="flower-task-files-sentinel" aria-hidden="true" />
        </Show>
        <Show when={listing.failed()}><div class="flower-task-files-notice" role="alert"><p>{props.copy.failed}</p>
          <Button size="sm" variant="ghost" icon={Refresh} onClick={listing.refresh}>{props.copy.retry}</Button></div></Show>
      </div>
      <Show when={!working() && Boolean(listing.data()?.working_files)}><div class="flower-task-files-footer">
        <Button ref={workingTrigger} size="sm" variant="ghost" icon={Folder} onClick={openWorking}>{props.copy.working}<ChevronRight class="size-3.5" /></Button>
      </div></Show>
      <Show when={working() && listing.data()?.working_files}><div class="flower-task-files-footer"><span>{taskFileSize(listing.data()!.working_bytes)}{listing.data()?.working_truncated ? '+' : ''}</span></div></Show>
      <span class="flower-visually-hidden" role="status"><StableText reserve={[props.copy.loading]}>{listing.loading() ? props.copy.loading : ''}</StableText></span>
    </Dialog>
    <FlowerAttachmentPreviewWindow source={preview()} loadingLabel={props.copy.loading} unavailableLabel={props.copy.unavailable} onClose={() => setPreview(null)} zIndex={100} />
  </>;
}
