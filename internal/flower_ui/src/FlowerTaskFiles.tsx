import { FlowerTaskFileIdentity, taskFileSize as size } from './FlowerTaskFileIdentity';
import { FlowerTaskMaterials } from './FlowerTaskMaterials';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { Check, ChevronRight, Download, Eye, FileText, Folder, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import type { FlowerSurfaceAdapter, FlowerTaskFiles as TaskFiles } from './contracts/flowerSurfaceContracts';
import type { TaskFilesCopy } from './taskFilesCopy';

export function FlowerTaskFiles(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadID: string;
  adapter: FlowerSurfaceAdapter;
  copy: TaskFilesCopy;
  onSource?: (itemID: string) => void;
  onPreview?: (path: string) => Promise<void>;
  onOpenFolder?: (path: string) => Promise<void>;
}) {
  const [materialsRefresh, setMaterialsRefresh] = createSignal(0);
  const [data, setData] = createSignal<TaskFiles>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [confirm, setConfirm] = createSignal(false);
  const [downloading, setDownloading] = createSignal<string>();
  let downloadController: AbortController | undefined;
  let generation = 0;
  onCleanup(() => {
    generation++;
    downloadController?.abort();
  });
  const load = async (more = false) => {
    if (!more) setMaterialsRefresh(value => value + 1);
    const id = props.threadID,
      epoch = ++generation;
    setLoading(true);
    setError('');
    try {
      const value = await props.adapter.loadTaskFiles!(id, more ? data()?.next_cursor : undefined);
      if (epoch !== generation || id !== props.threadID) return;
      setData((previous) => ({ ...value, files: more ? [...(previous?.files ?? []), ...value.files] : value.files }));
    } catch {
      if (epoch === generation) setError(props.copy.failed);
    } finally {
      if (epoch === generation) setLoading(false);
    }
  };
  createEffect(() => {
    const open = props.open,
      id = props.threadID;
    downloadController?.abort();
    setDownloading(undefined);
    generation++;
    setData(undefined);
    setConfirm(false);
    setError('');
    setLoading(false);
    if (open && id && props.adapter.loadTaskFiles) void load();
  });
  const clean = async () => {
    const id = props.threadID,
      epoch = ++generation;
    setLoading(true);
    setError('');
    try {
      await props.adapter.cleanTaskFiles!(id);
      if (epoch === generation && id === props.threadID) {
        setConfirm(false);
        await load();
      }
    } catch {
      if (epoch === generation) {
        setError(props.copy.failed);
        setLoading(false);
      }
    }
  };
  const openPath = async (path: string, directory = false) => {
    const id = props.threadID;
    try {
      const open = directory ? props.onOpenFolder : props.onPreview;
      if (open) { await open(path); return; }
      const request = {
        path,
        thread_id: props.threadID,
        message_id: '',
        context_index: 0,
        source_surface: 'flower_composer' as const,
        target: props.adapter.runtime?.runtime_id ?? '',
      };
      if (directory) await props.adapter.openLinkedDirectoryBrowser?.(request);
      else await props.adapter.openLinkedFilePreview?.(request);
    } catch {
      if (id === props.threadID && props.open) setError(props.copy.unavailable);
    }
  };
  const download = async (path: string, working: boolean) => {
    const controller = new AbortController();
    downloadController = controller;
    setDownloading(path);
    setError('');
    try {
      await props.adapter.downloadTaskFile!(props.threadID, path, working, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError'))
        setError(props.copy.unavailable);
    } finally {
      if (downloadController === controller) {
        setDownloading(undefined);
        downloadController = undefined;
      }
    }
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.copy.title}
      closeLabel={props.copy.close}
      class="flower-task-files-dialog w-[min(44rem,94vw)] max-w-3xl"
      contentClass="flower-task-files-content"
      footer={
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>
          {props.copy.close}
        </Button>
      }
    >
      <div class="flower-task-files-toolbar">
        <span class="flower-task-files-context"><Folder class="size-4" aria-hidden="true" />{props.adapter.runtime?.display_name || props.copy.title}</span>
        <Button size="sm" variant="ghost" icon={Refresh} loading={loading()} onClick={() => void load()}>
          {props.copy.refresh}
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-destructive">
          {error()}
        </p>
      </Show>
      <Show when={loading() && !data()}>
        <p class="flower-task-files-empty" role="status">{props.copy.loading}</p>
      </Show>
      <Show when={data()}>
        {(value) => (
          <>
            <Show when={value().state_in_workspace}>
              <p class="flower-task-files-notice">{props.copy.warning}</p>
            </Show>
            <section class="flower-task-files-section" aria-label={props.copy.results}>
              <div class="flower-task-section-heading"><h3>{props.copy.results}</h3><span class="flower-task-count">{value().files.length}{value().next_cursor ? '+' : ''}</span></div>
              <Show when={value().files.length} fallback={<div class="flower-task-files-empty"><FileText class="size-6" aria-hidden="true" /><p>{props.copy.empty}</p></div>}>
                <div class="flower-task-files-list">
                  <For each={value().files}>
                    {(file) => (
                      <article class="flower-task-file-card">
                        <FlowerTaskFileIdentity name={file.name} title={file.title} mime={file.mime} size={file.size}
                          status={<span class="flower-task-file-status" data-status={file.status}><Show when={file.status === 'available'}><Check class="size-3" aria-hidden="true" /></Show>{props.copy[file.status]}</span>}
                          path={file.file_path} />
                        <div class="flower-task-file-actions">
                          <Show when={props.onPreview || props.adapter.openLinkedFilePreview}>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={Eye}
                              disabled={file.status === 'missing' || file.status === 'unavailable'}
                              onClick={() => void openPath(file.file_path)}
                            >
                              {props.copy.preview}
                            </Button>
                          </Show>
                          <Show when={props.adapter.downloadTaskFile}>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Download}
                              loading={downloading() === file.file_path}
                              disabled={Boolean(downloading()) || file.status === 'missing' || file.status === 'unavailable'}
                              onClick={() => void download(file.file_path, false)}
                            >
                              {props.copy.download}
                            </Button>
                          </Show>
                          <Show when={props.onOpenFolder || props.adapter.openLinkedDirectoryBrowser}>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Folder}
                              onClick={() => void openPath(file.file_path.replace(/[/\\][^/\\]+$/, ''), true)}
                            >
                              {props.copy.folder}
                            </Button>
                          </Show>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={value().next_cursor}>
                <Button size="sm" variant="ghost" class="flower-task-load-more" loading={loading()} onClick={() => void load(true)}>
                  {props.copy.more}
                </Button>
              </Show>
            </section>
            <Show when={props.adapter.loadTaskMaterials}><FlowerTaskMaterials threadID={props.threadID} adapter={props.adapter} copy={props.copy} refresh={materialsRefresh()} onSource={props.onSource} /></Show>
            <details class="flower-task-working">
              <summary>
                <span class="flower-task-disclosure-icon"><Folder class="size-4" aria-hidden="true" /></span>
                <span class="flower-task-disclosure-title">{props.copy.working}</span>
                <span class="flower-task-count">{value().working_files}{value().working_truncated ? '+' : ''}</span>
                <span class="flower-task-disclosure-size">{size(value().working_bytes)}{value().working_truncated ? '+' : ''}</span>
                <ChevronRight class="flower-task-disclosure-chevron size-4" aria-hidden="true" />
              </summary>
              <div class="flower-task-disclosure-body">
                <p class="flower-task-file-path" title={value().working_path}>{value().working_path}</p>
                <div class="flower-task-working-list">
                  <For each={value().working ?? []}>
                    {(file) => (
                      <div>
                        <span class="break-all">{file.name}</span>
                        <span>{size(file.size)}</span>
                        <Show when={props.adapter.downloadTaskFile}>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Download}
                            loading={downloading() === file.path}
                            disabled={Boolean(downloading())}
                            onClick={() => void download(file.path, true)}
                          >
                            {props.copy.download}
                          </Button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={value().working_truncated}>
                  <p>{props.copy.truncated}</p>
                </Show>
                <Show when={!value().can_clean}>
                  <p class="text-xs text-muted-foreground">{props.copy.busy}</p>
                </Show>
                <Show when={props.adapter.cleanTaskFiles && props.adapter.canMutate !== false}>
                  <Show
                    when={confirm()}
                    fallback={
                      <Button
                        size="sm"
                        variant="ghost-destructive"
                        icon={Trash}
                        disabled={loading() || Boolean(downloading()) || !value().can_clean || !value().working_files}
                        onClick={() => setConfirm(true)}
                      >
                        {props.copy.clean}
                      </Button>
                    }
                  >
                    <div role="alert" class="flower-task-files-notice">
                      <p>{props.copy.confirm}</p>
                      <div class="flower-task-file-actions">
                        <Button size="sm" variant="destructive" icon={Trash} loading={loading()} onClick={() => void clean()}>
                          {props.copy.clean}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={loading()} onClick={() => setConfirm(false)}>
                          {props.copy.cancel}
                        </Button>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </details>
          </>
        )}
      </Show>
    </Dialog>
  );
}
