import { For, Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { Button, Dialog, Input } from '@floegence/floe-webapp-core/ui';
import type { GitSource, Snapshot, SourceCatalog } from '@floegence/redeven-service-templates';
import { useI18n } from '../i18n';
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';
import type { ManagedCatalogTemplate } from './EnvPortForwardsPage';

type SourcePreview = {
  candidate_id: string;
  sha256: string;
  expected_sha256: string;
  changed: boolean;
  template: ManagedCatalogTemplate;
  previous_template?: ManagedCatalogTemplate;
  files: Array<{ path: string; change: 'added' | 'modified' | 'removed'; mode?: string }>;
  affected_service_ids: string[];
  source_document_version: number;
  source_spec_version: number;
};
type SourceFileContent = { mode: string; sha256: string; binary: boolean; text?: string };
type SourceFilePreview = { path: string; before?: SourceFileContent; after?: SourceFileContent };
type DesktopSourceBridge = {
  acquire(request: {
    operation_id: string;
    action: 'discover' | 'capture';
    source: GitSource;
    token?: string;
  }): Promise<{ ok: boolean; catalog?: SourceCatalog; snapshot?: Snapshot; error_code?: string }>;
  cancel(operationID: string): Promise<void>;
};
declare global {
  interface Window {
    redevenDesktopTemplateSources?: DesktopSourceBridge;
  }
}

const base = '/_redeven_proxy/api/managed-web-service-templates';

export function GitTemplateImport(props: {
  open: boolean;
  template?: ManagedCatalogTemplate;
  onClose: () => void;
  onImported: () => void;
  serviceName: (id: string) => string;
}) {
  const i18n = useI18n();
  const [repository, setRepository] = createSignal('');
  const [ref, setRef] = createSignal('');
  const [path, setPath] = createSignal('');
  const [token, setToken] = createSignal('');
  const [mode, setMode] = createSignal<'desktop_transfer' | 'remote_download'>('remote_download');
  const [catalog, setCatalog] = createSignal<SourceCatalog>();
  const [preview, setPreview] = createSignal<SourcePreview>();
  const [busy, setBusy] = createSignal(false);
  const [phase, setPhase] = createSignal<'checking' | 'transferring' | 'confirming'>('checking');
  const [error, setError] = createSignal('');
  const [filePreview, setFilePreview] = createSignal<SourceFilePreview>();
  const [fileLoading, setFileLoading] = createSignal(false);
  let fileController: AbortController | undefined;
  let fileListDetails: HTMLDetailsElement | undefined;
  let filePreviewPanel: HTMLDivElement | undefined;
  let controller: AbortController | undefined;
  let operationID = '';
  let confirmationID = '';
  const desktop = () => window.redevenDesktopTemplateSources;
  const discard = () => {
    fileController?.abort();
    setFilePreview(undefined);
    setFileLoading(false);
    const item = preview();
    if (item)
      void fetchLocalApiJSON(`${base}/source-previews/${encodeURIComponent(item.candidate_id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    setPreview(undefined);
  };
  const cancel = () => {
    controller?.abort();
    if (operationID) void desktop()?.cancel(operationID);
  };
  createEffect(() => {
    if (!props.open) {
      cancel();
      setToken('');
      untrack(discard);
      return;
    }
    const source = props.template?.git_source;
    setRepository(source?.repository ?? '');
    setRef(source?.ref ?? '');
    setPath(source?.path ?? '');
    setMode(desktop() ? 'desktop_transfer' : 'remote_download');
    setCatalog(undefined);
    setError('');
    setToken('');
  });
  onCleanup(() => {
    cancel();
    discard();
  });

  const run = async (action: 'discover' | 'inspect', chosen?: GitSource) => {
    if (busy()) return;
    setBusy(true);
    setError('');
    setPhase('checking');
    discard();
    controller = new AbortController();
    operationID = crypto.randomUUID();
    const signal = controller.signal;
    const source: GitSource = chosen ?? { repository: repository().trim(), ref: ref().trim(), path: path().trim() };
    try {
      let snapshot: Snapshot | undefined;
      if (mode() === 'desktop_transfer' && desktop()) {
        const response = await desktop()!.acquire({
          operation_id: operationID,
          action: action === 'discover' ? 'discover' : 'capture',
          source,
          token: token(),
        });
        if (signal.aborted) return;
        if (!response.ok) throw new LocalApiError({ message: '', code: response.error_code });
        if (action === 'discover') {
          setCatalog(response.catalog);
          return;
        }
        snapshot = response.snapshot;
        if (!snapshot) throw new LocalApiError({ message: '', code: 'TEMPLATE_SOURCE_RESPONSE_INVALID' });
        setPhase('transferring');
      }
      if (action === 'discover') {
        const result = await fetchLocalApiJSON<SourceCatalog>(`${base}/source-discovery`, {
          method: 'POST',
          body: JSON.stringify({ source, token: token() }),
          signal,
        });
        setCatalog(result);
      } else {
        const result = await fetchLocalApiJSON<SourcePreview>(`${base}/source-previews`, {
          method: 'POST',
          body: JSON.stringify({
            template_id: props.template?.template_id,
            source,
            ...(snapshot ? { snapshot } : { token: token() }),
          }),
          signal,
        });
        if (signal.aborted) return;
        setPreview(result);
        setToken('');
        confirmationID = crypto.randomUUID();
      }
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof LocalApiError ? failure.code : 'TEMPLATE_SOURCE_UNAVAILABLE');
    } finally {
      setBusy(false);
      operationID = '';
      controller = undefined;
    }
  };
  const confirm = async () => {
    const item = preview();
    if (!item || busy()) return;
    setBusy(true);
    setError('');
    setPhase('confirming');
    try {
      await fetchLocalApiJSON(`${base}/source-confirmations`, {
        method: 'POST',
        body: JSON.stringify({
          request_id: confirmationID,
          candidate_id: item.candidate_id,
          sha256: item.sha256,
          expected_sha256: item.expected_sha256,
        }),
      });
      setPreview(undefined);
      props.onImported();
      props.onClose();
    } catch (failure) {
      setError(failure instanceof LocalApiError ? failure.code : 'TEMPLATE_SOURCE_UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  };
  const inspectFile = async (path: string) => {
    const item = preview();
    if (!item) return;
    fileController?.abort();
    fileController = new AbortController();
    const signal = fileController.signal;
    setFileLoading(true);
    setError('');
    setFilePreview(undefined);
    try {
      const file = await fetchLocalApiJSON<SourceFilePreview>(
        `${base}/source-previews/${encodeURIComponent(item.candidate_id)}/file`,
        { method: 'POST', body: JSON.stringify({ path }), signal },
      );
      if (!signal.aborted && preview()?.candidate_id === item.candidate_id) {
        setFilePreview(file);
        if (fileListDetails) fileListDetails.open = false;
        filePreviewPanel?.scrollIntoView?.({ block: 'nearest' });
      }
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof LocalApiError ? failure.code : 'TEMPLATE_SOURCE_UNAVAILABLE');
    } finally {
      if (!signal.aborted) setFileLoading(false);
    }
  };
  return (
    <Dialog
      class="max-w-3xl"
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !(busy() && phase() === 'confirming')) {
          cancel();
          props.onClose();
        }
      }}
      title={i18n.t(props.template ? 'webServices.sources.checkUpdates' : 'webServices.sources.import')}
      footer={
        <div class="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy() && phase() === 'confirming'}
            onClick={() => {
              cancel();
              props.onClose();
            }}
          >
            {i18n.t('webServices.actions.cancel')}
          </Button>
          <Show
            when={preview()}
            fallback={
              <Button
                size="sm"
                disabled={busy() || !repository().trim()}
                onClick={() => void run(props.template ? 'inspect' : 'discover')}
              >
                {i18n.t(props.template ? 'webServices.sources.checkUpdates' : 'webServices.sources.findTemplates')}
              </Button>
            }
          >
            <Button size="sm" disabled={busy() || fileLoading() || !preview()?.changed} onClick={() => void confirm()}>
              {i18n.t(
                preview()?.expected_sha256 ? 'webServices.sources.confirmUpdate' : 'webServices.sources.confirmImport',
              )}
            </Button>
          </Show>
        </div>
      }
    >
      <div class="max-h-[65vh] space-y-4 overflow-y-auto p-1">
        <p class="text-sm text-muted-foreground">{i18n.t('webServices.sources.description')}</p>
        <Show when={!preview()}>
          <label class="block space-y-1 text-xs font-medium">
            <span>{i18n.t('webServices.sources.repository')}</span>
            <Input
              value={repository()}
              disabled={busy() || !!props.template}
              onInput={(event) => {
                setRepository(event.currentTarget.value);
                setCatalog(undefined);
              }}
              placeholder="https://github.com/owner/repository"
            />
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block space-y-1 text-xs font-medium">
              <span>{i18n.t('webServices.sources.ref')}</span>
              <Input
                value={ref()}
                disabled={busy() || !!props.template}
                onInput={(event) => {
                  setRef(event.currentTarget.value);
                  setCatalog(undefined);
                }}
              />
            </label>
            <label class="block space-y-1 text-xs font-medium">
              <span>{i18n.t('webServices.sources.path')}</span>
              <Input
                value={path()}
                disabled={busy() || !!props.template}
                onInput={(event) => {
                  setPath(event.currentTarget.value);
                  setCatalog(undefined);
                }}
              />
            </label>
          </div>
          <Show when={desktop()}>
            <fieldset class="flex flex-wrap gap-2">
              <legend class="mb-1 text-xs font-medium">{i18n.t('webServices.sources.downloadMode')}</legend>
              <For each={['desktop_transfer', 'remote_download'] as const}>
                {(value) => (
                  <Button
                    size="sm"
                    variant={mode() === value ? 'default' : 'outline'}
                    aria-pressed={mode() === value}
                    disabled={busy()}
                    onClick={() => {
                      setMode(value);
                      setCatalog(undefined);
                    }}
                  >
                    {i18n.t(`webServices.sources.${value}`)}
                  </Button>
                )}
              </For>
            </fieldset>
          </Show>
          <label class="block space-y-1 text-xs font-medium">
            <span>{i18n.t('webServices.sources.token')}</span>
            <Input
              type="password"
              autocomplete="off"
              value={token()}
              disabled={busy()}
              onInput={(event) => setToken(event.currentTarget.value)}
            />
          </label>
          <p class="text-xs text-muted-foreground">
            {i18n.t(
              mode() === 'desktop_transfer'
                ? 'webServices.sources.desktopCredential'
                : 'webServices.sources.remoteCredential',
            )}
          </p>
          <Show when={catalog()} keyed>
            {(result) => (
              <div class="space-y-2">
                <Show
                  when={result.templates.length > 0}
                  fallback={<p class="text-sm">{i18n.t('webServices.sources.noTemplates')}</p>}
                >
                  <For each={result.templates}>
                    {(entry) => (
                      <Button
                        variant="outline"
                        class="h-auto w-full justify-start py-3 text-left"
                        disabled={busy()}
                        onClick={() =>
                          void run('inspect', {
                            repository: result.source.repository,
                            ref: result.source.ref,
                            path: entry.path,
                          })
                        }
                      >
                        <span class="break-all font-mono text-xs">
                          {entry.path ? `${entry.path}/` : ''}
                          {entry.entrypoint}
                        </span>
                      </Button>
                    )}
                  </For>
                </Show>
              </div>
            )}
          </Show>
        </Show>
        <Show when={preview()} keyed>
          {(item) => (
            <div class="space-y-3">
              <div class="rounded-lg border p-3">
                <p class="text-sm font-semibold">{item.template.name}</p>
                <p class="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {item.template.git_source?.repository} · {item.template.git_source?.path || '/'}
                </p>
                <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt>{i18n.t('webServices.sources.commit')}</dt>
                  <dd class="break-all font-mono">{item.template.git_source?.commit_sha}</dd>
                  <dt>{i18n.t('webServices.managed.details.templateRevision')}</dt>
                  <dd>
                    {item.previous_template ? `${item.previous_template.revision} → ` : ''}
                    {item.template.revision}
                  </dd>
                  <dt>{i18n.t('webServices.sources.format')}</dt>
                  <dd>
                    {item.source_document_version} → 3 / {item.source_spec_version} → 6
                  </dd>
                </dl>
              </div>
              <p role="status" class="text-sm">
                {i18n.t(item.changed ? 'webServices.sources.reviewHint' : 'webServices.sources.upToDate')}
              </p>
              <Show when={item.affected_service_ids.length}>
                <div>
                  <p class="text-xs font-medium">{i18n.t('webServices.sources.affectedServices')}</p>
                  <For each={item.affected_service_ids}>
                    {(id) => <p class="mt-1 text-xs">{props.serviceName(id)}</p>}
                  </For>
                </div>
              </Show>
              <details ref={fileListDetails} class="rounded-lg border p-3">
                <summary class="cursor-pointer text-xs font-medium">
                  {i18n.t('webServices.sources.changedFiles')} ({item.files.length})
                </summary>
                <div class="mt-2 space-y-1">
                  <For each={item.files}>
                    {(file) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-auto w-full justify-start py-2 text-left"
                        disabled={busy()}
                        onClick={() => void inspectFile(file.path)}
                        aria-label={`${i18n.t(`webServices.sources.${file.change}`)} ${file.path}`}
                      >
                        <span class="break-all text-xs">
                          <span class="mr-2 text-muted-foreground">{i18n.t(`webServices.sources.${file.change}`)}</span>
                          <code>{file.path}</code>
                        </span>
                      </Button>
                    )}
                  </For>
                </div>
              </details>
              <Show when={fileLoading()}>
                <p role="status" class="text-xs">
                  {i18n.t('webServices.sources.loadingFile')}
                </p>
              </Show>
              <Show when={filePreview()} keyed>
                {(file) => (
                  <div ref={filePreviewPanel} class="space-y-2 rounded-lg border p-3">
                    <p class="break-all font-mono text-xs">{file.path}</p>
                    <For each={['before', 'after'] as const}>
                      {(side) => (
                        <Show when={file[side]} keyed>
                          {(content) => (
                            <div class="space-y-1">
                              <p class="text-xs font-medium">
                                {i18n.t(
                                  side === 'before' ? 'webServices.sources.previous' : 'webServices.sources.candidate',
                                )}{' '}
                                · <code>{content.mode}</code>
                              </p>
                              <p class="break-all font-mono text-[10px] text-muted-foreground">
                                SHA-256: {content.sha256}
                              </p>
                              <Show
                                when={!content.binary}
                                fallback={
                                  <p class="text-xs text-muted-foreground">
                                    {i18n.t('webServices.sources.binaryFile')}
                                  </p>
                                }
                              >
                                <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                                  {content.text}
                                </pre>
                              </Show>
                            </div>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                )}
              </Show>
              <details class="rounded-lg border p-3">
                <summary class="cursor-pointer text-xs font-medium">
                  {i18n.t('webServices.sources.executionChanges')}
                </summary>
                <div class="mt-2 space-y-3">
                  <Show when={item.previous_template}>
                    <p class="text-xs font-medium">{i18n.t('webServices.sources.previous')}</p>
                    <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                      {JSON.stringify(item.previous_template?.spec, null, 2)}
                    </pre>
                  </Show>
                  <p class="text-xs font-medium">{i18n.t('webServices.sources.candidate')}</p>
                  <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(item.template.spec, null, 2)}
                  </pre>
                </div>
              </details>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy()}
                onClick={() => {
                  discard();
                  setCatalog(undefined);
                }}
              >
                {i18n.t('webServices.sources.checkAgain')}
              </Button>
            </div>
          )}
        </Show>
        <Show when={busy()}>
          <p role="status" class="text-sm text-muted-foreground">
            {i18n.t(`webServices.sources.${phase()}`)}
          </p>
        </Show>
        <Show when={error()}>
          <div role="alert" class="rounded-md border border-destructive/30 p-3 text-sm">
            <p>
              {i18n.t(
                error() === 'TEMPLATE_SOURCE_REVIEW_STALE'
                  ? 'webServices.sources.stale'
                  : error() === 'TEMPLATE_SCHEMA_UNSUPPORTED'
                    ? 'webServices.sources.upgradeRequired'
                    : 'webServices.sources.failed',
              )}
            </p>
            <code class="mt-1 block break-all text-xs text-muted-foreground">{error()}</code>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
