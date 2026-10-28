import { FlowerTaskFileIdentity, taskFileSize as size } from './FlowerTaskFileIdentity';
import { FlowerTaskMaterials } from './FlowerTaskMaterials';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, Download, Folder, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
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
      class="flower-task-files-dialog w-[min(40rem,94vw)] max-w-3xl"
      contentClass="flower-task-files-content"
    >
      <div class="flower-task-section-heading">
        <h3>{props.copy.results}</h3>
        <Show when={data()}>{value => <span class="flower-task-count">{value().files.length}{value().next_cursor ? '+' : ''}</span>}</Show>
        <Button size="icon" variant="ghost" class="flower-task-refresh" icon={Refresh} aria-label={props.copy.refresh}
          title={props.copy.refresh} loading={loading()} onClick={() => void load()} />
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
              <Show when={value().files.length} fallback={<p class="flower-task-files-empty">{props.copy.empty}</p>}>
                <div class="flower-task-files-list">
                  <For each={value().files}>
                    {(file) => (
                      <article class="flower-task-file-row">
                        <FlowerTaskFileIdentity name={file.name} title={file.title} mime={file.mime} size={file.size}
                          onPreview={props.onPreview || props.adapter.openLinkedFilePreview ? () => void openPath(file.file_path) : undefined}
                          previewLabel={props.copy.preview} previewDisabled={file.status === 'missing' || file.status === 'unavailable'}
                          status={<Show when={file.status !== 'available'}><span class="flower-task-file-status" data-status={file.status}>{props.copy[file.status]}</span></Show>}
                        />
                        <div class="flower-task-file-actions">
                          <Show when={props.adapter.downloadTaskFile}>
                            <Button
                              size="icon"
                              variant="ghost"
                              icon={Download}
                              aria-label={props.copy.download}
                              title={props.copy.download}
                              loading={downloading() === file.file_path}
                              disabled={Boolean(downloading()) || file.status === 'missing' || file.status === 'unavailable'}
                              onClick={() => void download(file.file_path, false)}
                            />
                          </Show>
                          <Show when={props.onOpenFolder || props.adapter.openLinkedDirectoryBrowser}>
                            <Button
                              size="icon"
                              variant="ghost"
                              icon={Folder}
                              aria-label={props.copy.folder}
                              title={props.copy.folder}
                              onClick={() => void openPath(file.file_path.replace(/[/\\][^/\\]+$/, ''), true)}
                            />
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
                <span class="flower-task-disclosure-title">{props.copy.working}</span>
                <span class="flower-task-count">{value().working_files}{value().working_truncated ? '+' : ''}</span>
                <span class="flower-task-disclosure-size">{size(value().working_bytes)}{value().working_truncated ? '+' : ''}</span>
                <ChevronRight class="flower-task-disclosure-chevron size-4" aria-hidden="true" />
              </summary>
              <div class="flower-task-disclosure-body">
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
