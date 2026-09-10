import { For, Show, createEffect, createSignal, onCleanup, untrack, createUniqueId } from 'solid-js';
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle,
  ChevronDown,
  Cloud,
  Folder,
  GitBranch,
  Loader2,
  Lock,
  Package,
} from '@floegence/floe-webapp-core/icons';
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
  files: Array<{
    path: string;
    change: 'added' | 'modified' | 'removed';
    mode?: string;
  }>;
  affected_service_ids: string[];
  source_document_version: number;
  source_spec_version: number;
};
type SourceFileContent = {
  mode: string;
  sha256: string;
  binary: boolean;
  text?: string;
};
type SourceFilePreview = {
  path: string;
  before?: SourceFileContent;
  after?: SourceFileContent;
};
type DesktopSourceBridge = {
  acquire(request: {
    operation_id: string;
    action: 'discover' | 'capture';
    source: GitSource;
    token?: string;
  }): Promise<{
    ok: boolean;
    catalog?: SourceCatalog;
    snapshot?: Snapshot;
    error_code?: string;
  }>;
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
  environmentName?: string;
  template?: ManagedCatalogTemplate;
  onClose: () => void;
  onImported: () => void;
  serviceName: (id: string) => string;
}) {
  const i18n = useI18n();
  const controlId = createUniqueId();
  const [selectedPath, setSelectedPath] = createSignal<string>();
  let stepHeading: HTMLHeadingElement | undefined;
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
    controller = undefined;
    operationID = '';
    setBusy(false);
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
    setSelectedPath(undefined);
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
    const activeController = new AbortController();
    controller = activeController;
    operationID = crypto.randomUUID();
    const signal = activeController.signal;
    const source: GitSource = chosen ?? {
      repository: repository().trim(),
      ref: ref().trim(),
      path: path().trim(),
    };
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
          if (!response.catalog)
            throw new LocalApiError({
              message: '',
              code: 'TEMPLATE_SOURCE_RESPONSE_INVALID',
            });
          setSelectedPath(response.catalog.templates[0]?.path);
          setCatalog(response.catalog);
          return;
        }
        snapshot = response.snapshot;
        if (!snapshot)
          throw new LocalApiError({
            message: '',
            code: 'TEMPLATE_SOURCE_RESPONSE_INVALID',
          });
        setPhase('transferring');
      }
      if (action === 'discover') {
        const result = await fetchLocalApiJSON<SourceCatalog>(`${base}/source-discovery`, {
          method: 'POST',
          body: JSON.stringify({ source, token: token() }),
          signal,
        });
        if (signal.aborted) return;
        setSelectedPath(result.templates[0]?.path);
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
      if (controller === activeController) {
        setBusy(false);
        operationID = '';
        controller = undefined;
      }
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
  const steps = () =>
    props.template ? (['sourceStep', 'reviewStep'] as const) : (['sourceStep', 'templateStep', 'reviewStep'] as const);
  const currentStep = () => (preview() ? steps().length - 1 : catalog() ? 1 : 0);
  const targetName = () => props.environmentName || i18n.t('webServices.sources.targetEnvironment');
  const editSource = () => {
    discard();
    setCatalog(undefined);
    setError('');
  };
  const advance = () => {
    if (preview()) return void confirm();
    const result = catalog();
    if (result) {
      const entry = result.templates.find((item) => item.path === selectedPath());
      if (entry)
        void run('inspect', {
          repository: result.source.repository,
          ref: result.source.ref,
          path: entry.path,
        });
    } else {
      void run(props.template ? 'inspect' : 'discover');
    }
  };
  createEffect(() => {
    const step = currentStep();
    if (props.open && step > 0)
      queueMicrotask(() => {
        if (props.open && currentStep() === step) stepHeading?.focus({ preventScroll: false });
      });
  });
  return (
    <Dialog
      class="h-[min(44rem,85dvh)] max-w-2xl rounded-xl [&>div]:[scrollbar-gutter:stable]"
      open={props.open}
      closeLabel={i18n.t('webServices.actions.cancel')}
      onOpenChange={(open) => {
        if (!open && !(busy() && phase() === 'confirming')) {
          cancel();
          props.onClose();
        }
      }}
      title={
        <span class="flex items-center gap-2">
          <Package class="size-4 text-muted-foreground" />
          {i18n.t(props.template ? 'webServices.sources.checkUpdates' : 'webServices.sources.import')}
        </span>
      }
      footer={
        <div class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div class="min-w-0">
            <Show when={currentStep() > 0}>
              <Button
                size="sm"
                variant="ghost"
                class="h-auto min-h-8 max-w-full whitespace-normal text-left"
                disabled={busy()}
                onClick={editSource}
              >
                <ArrowLeft class="size-3.5 shrink-0" />
                {i18n.t(preview() && !props.template ? 'webServices.sources.editSource' : 'webServices.sources.back')}
              </Button>
            </Show>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy() && phase() === 'confirming'}
              onClick={() => {
                cancel();
                props.onClose();
              }}
            >
              {i18n.t('webServices.actions.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={
                busy() ||
                !repository().trim() ||
                (preview() ? fileLoading() || !preview()?.changed : !!catalog() && selectedPath() === undefined)
              }
              onClick={advance}
            >
              <Show when={busy()}>
                <Loader2 class="size-3.5 animate-spin" />
              </Show>
              {i18n.t(
                preview()
                  ? preview()?.expected_sha256
                    ? 'webServices.sources.confirmUpdate'
                    : 'webServices.sources.confirmImport'
                  : catalog()
                    ? 'webServices.sources.reviewTemplate'
                    : props.template
                      ? 'webServices.sources.check'
                      : 'webServices.sources.findTemplates',
              )}
              <Show when={!preview() && !busy()}>
                <ArrowRight class="size-3.5 shrink-0" />
              </Show>
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-5 p-1 sm:p-2">
        <ol aria-label={i18n.t(props.template ? 'webServices.sources.checkUpdates' : 'webServices.sources.progress')} class="flex items-center gap-2">
          <For each={steps()}>
            {(step, index) => (
              <li
                class="flex min-w-0 flex-1 items-center gap-2 text-xs last:flex-none"
                aria-current={currentStep() === index() ? 'step' : undefined}
              >
                <span
                  class={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${currentStep() >= index() ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  <Show when={currentStep() > index()} fallback={index() + 1}>
                    <Check class="size-3" />
                  </Show>
                </span>
                <span class={currentStep() === index() ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                  {i18n.t(`webServices.sources.${step}`)}
                </span>
                <Show when={index() < steps().length - 1}>
                  <span aria-hidden="true" class="mx-1 h-px min-w-2 flex-1 bg-border" />
                </Show>
              </li>
            )}
          </For>
        </ol>
        <div>
          <h3 ref={stepHeading} tabIndex={-1} class="text-base font-semibold tracking-tight outline-none">
            {i18n.t(
              preview()
                ? 'webServices.sources.reviewTitle'
                : catalog()
                  ? 'webServices.sources.chooseTemplate'
                  : 'webServices.sources.sourceTitle',
            )}
          </h3>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            {i18n.t(
              preview()
                ? 'webServices.sources.reviewDescription'
                : catalog()
                  ? 'webServices.sources.selectionHint'
                  : 'webServices.sources.description',
            )}
          </p>
        </div>
        <Show when={!preview() && !catalog()}>
          <form
            class="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy() && repository().trim()) advance();
            }}
          >
            <Show
              when={!props.template}
              fallback={
                <div class="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
                  <p class="break-all font-medium">{repository()}</p>
                  <p class="flex items-center gap-2 text-muted-foreground">
                    <GitBranch class="size-3.5 shrink-0" />
                    <span class="break-all">
                      {ref()} · {path() || '/'}
                    </span>
                  </p>
                </div>
              }
            >
              <label class="block space-y-2 text-xs font-medium">
                <span>{i18n.t('webServices.sources.repository')}</span>
                <Input
                  class="h-10 bg-background"
                  value={repository()}
                  disabled={busy()}
                  onInput={(event) => setRepository(event.currentTarget.value)}
                  placeholder="https://github.com/owner/repository"
                />
              </label>
              <details data-source-options class="group rounded-lg border border-border/70">
                <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  <GitBranch class="size-3.5 text-muted-foreground" />
                  {i18n.t('webServices.sources.sourceOptions')}
                  <ChevronDown class="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div class="grid gap-3 border-t border-border/70 p-3 sm:grid-cols-2">
                  <label class="block space-y-1.5 text-xs font-medium">
                    <span>{i18n.t('webServices.sources.ref')}</span>
                    <Input
                      value={ref()}
                      disabled={busy()}
                      placeholder={i18n.t('webServices.sources.defaultBranch')}
                      onInput={(event) => setRef(event.currentTarget.value)}
                    />
                  </label>
                  <label class="block space-y-1.5 text-xs font-medium">
                    <span>{i18n.t('webServices.sources.path')}</span>
                    <Input
                      value={path()}
                      disabled={busy()}
                      placeholder={i18n.t('webServices.sources.autoDiscover')}
                      onInput={(event) => setPath(event.currentTarget.value)}
                    />
                  </label>
                </div>
              </details>
            </Show>
            <fieldset class="min-w-0 space-y-3">
              <legend class="mb-2 text-xs font-medium">{i18n.t('webServices.sources.downloadMode')}</legend>
              <Show when={desktop()}>
                <div class="grid grid-cols-2 gap-1 rounded-lg bg-muted/70 p-1">
                  <For each={['desktop_transfer', 'remote_download'] as const}>
                    {(value) => (
                      <label class="relative min-w-0 cursor-pointer">
                        <input
                          class="peer sr-only"
                          type="radio"
                          name={`${controlId}-transfer`}
                          value={value}
                          checked={mode() === value}
                          disabled={busy()}
                          onChange={() => setMode(value)}
                          aria-describedby={`${controlId}-route-description`}
                        />
                        <span
                          class={`flex min-h-9 items-center justify-center gap-2 rounded-md border px-2 py-2 text-center text-xs font-medium transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-default peer-disabled:opacity-60 ${mode() === value ? 'border-border bg-card text-foreground shadow-sm' : 'border-transparent text-muted-foreground'}`}
                        >
                          <Show
                            when={mode() === value}
                            fallback={
                              <Show when={value === 'desktop_transfer'} fallback={<Cloud class="size-3.5 shrink-0" />}>
                                <ArrowRightLeft class="size-3.5 shrink-0" />
                              </Show>
                            }
                          >
                            <Check class="size-3.5 shrink-0" />
                          </Show>
                          {i18n.t(`webServices.sources.${value}`)}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
              <div class="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div class="flex items-center gap-2 text-xs">
                  <span class="shrink-0 font-medium">{i18n.t('webServices.sources.githubName')}</span>
                  <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
                  <Show when={mode() === 'desktop_transfer'}>
                    <span class="shrink-0 font-medium">{i18n.t('webServices.sources.desktopName')}</span>
                    <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
                  </Show>
                  <span class="min-w-0 truncate font-medium" title={targetName()}>
                    {targetName()}
                  </span>
                </div>
                <p id={`${controlId}-route-description`} class="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {i18n.t(
                    mode() === 'desktop_transfer'
                      ? 'webServices.sources.desktopRoute'
                      : 'webServices.sources.remoteRoute',
                  )}
                </p>
              </div>
            </fieldset>
            <details data-private-repository class="group rounded-lg border border-border/70">
              <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                <Lock class="size-3.5 text-muted-foreground" />
                {i18n.t('webServices.sources.privateRepository')}
                <ChevronDown class="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div class="space-y-2 border-t border-border/70 p-3">
                <label class="block space-y-1.5 text-xs font-medium">
                  <span>{i18n.t('webServices.sources.token')}</span>
                  <Input
                    type="password"
                    autocomplete="off"
                    value={token()}
                    disabled={busy()}
                    aria-describedby={`${controlId}-credential`}
                    onInput={(event) => setToken(event.currentTarget.value)}
                  />
                </label>
                <p id={`${controlId}-credential`} class="text-xs leading-relaxed text-muted-foreground">
                  {i18n.t(
                    mode() === 'desktop_transfer'
                      ? 'webServices.sources.desktopCredential'
                      : 'webServices.sources.remoteCredential',
                  )}
                </p>
              </div>
            </details>
            <button type="submit" class="hidden" tabIndex={-1} aria-hidden="true" />
          </form>
        </Show>
        <Show when={catalog() && !preview()}>
          <div class="space-y-3">
            <div class="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              <GitBranch class="mt-0.5 size-3.5 shrink-0" />
              <span class="min-w-0 break-all">
                {catalog()?.source.repository} · {catalog()?.source.ref}
              </span>
            </div>
            <Show
              when={catalog()!.templates.length > 0}
              fallback={
                <p class="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                  {i18n.t('webServices.sources.noTemplates')}
                </p>
              }
            >
              <fieldset class="space-y-2" aria-label={i18n.t('webServices.sources.chooseTemplate')}>
                <For each={catalog()!.templates}>
                  {(entry) => (
                    <label class="relative block cursor-pointer">
                      <input
                        class="peer sr-only"
                        type="radio"
                        name={`${controlId}-template`}
                        value={entry.path}
                        checked={selectedPath() === entry.path}
                        disabled={busy()}
                        onChange={() => setSelectedPath(entry.path)}
                      />
                      <span class="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 peer-checked:border-primary/50 peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-60">
                        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                          <Folder class="size-4 text-muted-foreground" />
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block break-all text-sm font-medium">
                            {entry.path.split('/').filter(Boolean).at(-1) ||
                              catalog()?.source.repository.split('/').at(-1)}
                          </span>
                          <span class="mt-1 block break-all font-mono text-[11px] text-muted-foreground">
                            {entry.path ? `${entry.path}/` : ''}
                            {entry.entrypoint}
                          </span>
                        </span>
                        <span
                          class={`flex size-4 shrink-0 items-center justify-center rounded-full border ${selectedPath() === entry.path ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}
                        >
                          <Show when={selectedPath() === entry.path}>
                            <Check class="size-2.5" />
                          </Show>
                        </span>
                      </span>
                    </label>
                  )}
                </For>
              </fieldset>
            </Show>
          </div>
        </Show>
        <Show when={preview()} keyed>
          {(item) => (
            <div class="space-y-4">
              <div class="overflow-hidden rounded-xl border">
                <div class="flex items-start gap-3 p-4">
                  <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50">
                    <Package class="size-5 text-muted-foreground" />
                  </span>
                  <div class="min-w-0">
                    <p class="break-words text-sm font-semibold">{item.template.name}</p>
                    <p class="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                      {item.template.description}
                    </p>
                    <p class="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <GitBranch class="mt-0.5 size-3 shrink-0" />
                      <span class="break-all">
                        {item.template.git_source?.repository} · {item.template.git_source?.path || '/'}
                      </span>
                    </p>
                  </div>
                </div>
                <dl class="grid grid-cols-2 gap-3 border-t bg-muted/20 px-4 py-3 text-xs">
                  <div class="col-span-2">
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.targetEnvironment')}</dt>
                    <dd class="mt-1 break-all font-medium">{targetName()}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.managed.details.templateRevision')}</dt>
                    <dd class="mt-1 font-medium">
                      {item.previous_template ? `${item.previous_template.revision} → ` : ''}
                      {item.template.revision}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.commit')}</dt>
                    <dd class="mt-1 font-mono" title={item.template.git_source?.commit_sha}>
                      {item.template.git_source?.commit_sha.slice(0, 12)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div role="status" class="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs leading-relaxed">
                <CheckCircle class="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  {i18n.t(
                    item.changed
                      ? item.expected_sha256
                        ? 'webServices.sources.reviewHint'
                        : 'webServices.sources.importHint'
                      : 'webServices.sources.upToDate',
                  )}
                </p>
              </div>
              <Show when={item.affected_service_ids.length}>
                <div class="space-y-2">
                  <p class="text-xs font-medium">{i18n.t('webServices.sources.affectedServices')}</p>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={item.affected_service_ids}>
                      {(id) => (
                        <span class="max-w-full break-all rounded-md border bg-muted/30 px-2 py-1 text-xs">
                          {props.serviceName(id)}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <details class="group rounded-lg border">
                <summary class="flex cursor-pointer list-none items-center gap-2 p-3 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  {i18n.t('webServices.sources.sourceDetails')}
                  <ChevronDown class="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <dl class="space-y-3 border-t p-3 text-xs">
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.repository')}</dt>
                    <dd class="mt-1 break-all font-mono">{item.template.git_source?.repository}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.ref')}</dt>
                    <dd class="mt-1 break-all font-mono">{item.template.git_source?.ref}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.path')}</dt>
                    <dd class="mt-1 break-all font-mono">{item.template.git_source?.path || '/'}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">{i18n.t('webServices.sources.commit')}</dt>
                    <dd class="mt-1 break-all font-mono">{item.template.git_source?.commit_sha}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <dt class="text-muted-foreground">{i18n.t('webServices.sources.documentVersion')}</dt>
                      <dd class="mt-1">{item.source_document_version} → 3</dd>
                    </div>
                    <div>
                      <dt class="text-muted-foreground">{i18n.t('webServices.sources.executionVersion')}</dt>
                      <dd class="mt-1">{item.source_spec_version} → 6</dd>
                    </div>
                  </div>
                </dl>
              </details>
              <details ref={fileListDetails} class="group rounded-lg border">
                <summary class="flex cursor-pointer list-none items-center gap-2 p-3 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  {i18n.t('webServices.sources.changedFiles')} ({item.files.length})
                  <ChevronDown class="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div class="space-y-1 border-t p-2">
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
                <p role="status" class="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 class="size-3 animate-spin" />
                  {i18n.t('webServices.sources.loadingFile')}
                </p>
              </Show>
              <Show when={filePreview()} keyed>
                {(file) => (
                  <div ref={filePreviewPanel} class="space-y-3 rounded-lg border p-3">
                    <p class="break-all font-mono text-xs font-medium">{file.path}</p>
                    <For each={['before', 'after'] as const}>
                      {(side) => (
                        <Show when={file[side]} keyed>
                          {(content) => (
                            <div class="space-y-1.5">
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
              <details class="group rounded-lg border">
                <summary class="flex cursor-pointer list-none items-center gap-2 p-3 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                  {i18n.t('webServices.sources.executionChanges')}
                  <ChevronDown class="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div class="space-y-3 border-t p-3">
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
            </div>
          )}
        </Show>
        <Show when={busy()}>
          <div role="status" class="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <Loader2 class="size-4 shrink-0 animate-spin" />
            {i18n.t(`webServices.sources.${phase()}`)}
          </div>
        </Show>
        <Show when={error()}>
          <div
            role="alert"
            class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed"
          >
            <p>
              {i18n.t(
                error() === 'TEMPLATE_SOURCE_REVIEW_STALE'
                  ? 'webServices.sources.stale'
                  : error() === 'TEMPLATE_SCHEMA_UNSUPPORTED'
                    ? 'webServices.sources.upgradeRequired'
                    : 'webServices.sources.failed',
              )}
            </p>
            <code class="mt-1 block break-all text-[11px] text-muted-foreground">{error()}</code>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
