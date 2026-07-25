import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import {
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  Link,
  Loader2,
  Package,
  Shield,
  Upload,
  X,
} from '@floegence/floe-webapp-core/icons';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import {
  PluginPlatformRequestError,
  PluginTransportError,
  pluginMutationOutcome,
} from '@floegence/redevplugin-ui';

import { useI18n } from '../i18n';
import { ExternalPackageInspectionTerminalError } from './pluginApi';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  ExternalPluginSourcePreset,
  ExternalPluginSourceKind,
  PluginExternalPackageSecuritySummary,
  PluginInventoryItem,
} from './pluginTypes';

type ExternalPluginInstallDialogProps = {
  open: boolean;
  updateItem?: PluginInventoryItem;
  sourcePreset?: ExternalPluginSourcePreset;
  onOpenChange: (open: boolean) => void;
  onInspect: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommit: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onCommitted: (result: ExternalPluginCommitResult) => Promise<unknown> | unknown;
  onViewPermissions?: (result: ExternalPluginCommitResult) => void;
};

type InstallStage = 'source' | 'review' | 'committing' | 'complete';

type PluginInstallError = {
  summary: string;
  recovery?: string;
  code?: string;
  technical?: string;
};

export function ExternalPluginInstallDialog(props: ExternalPluginInstallDialogProps): JSX.Element {
  const i18n = useI18n();
  const [stage, setStage] = createSignal<InstallStage>('source');
  const [sourceKind, setSourceKind] = createSignal<ExternalPluginSourceKind>('package_url');
  const [url, setURL] = createSignal('');
  const [tag, setTag] = createSignal('');
  const [file, setFile] = createSignal<File | null>(null);
  const [inspection, setInspection] = createSignal<ExternalPluginInspection | null>(null);
  const [committed, setCommitted] = createSignal<ExternalPluginCommitResult | null>(null);
  const [confirmed, setConfirmed] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<PluginInstallError | null>(null);
  const [commitNeedsReconciliation, setCommitNeedsReconciliation] = createSignal(false);
  const [refreshPending, setRefreshPending] = createSignal(false);
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  let operation: AbortController | undefined;

  const isUpdate = () => Boolean(props.updateItem?.pluginInstanceID);
  const dialogTitle = () => isUpdate()
    ? i18n.t('uiCopy.plugin.external.updateTitle', { plugin: props.updateItem?.displayName ?? '' })
    : i18n.t('uiCopy.plugin.external.installTitle');

  createEffect(() => {
    if (!props.open) return;
    operation?.abort('External plugin dialog reset');
    const provenance = props.updateItem?.externalPackage?.sourceProvenance;
    const preset = props.sourcePreset;
    setStage('source');
    setSourceKind(preset?.sourceKind ?? (provenance?.kind === 'github_repository' ? 'github_repository' : provenance?.kind === 'package_upload' ? 'package_upload' : 'package_url'));
    // Package provenance intentionally omits query strings and credentials, so it
    // cannot safely reconstruct the source URL for a later update.
    setURL(preset?.url ?? (provenance?.kind === 'github_repository' ? provenance.repository_url : ''));
    setTag(preset?.sourceKind === 'github_repository' ? preset.tag ?? '' : '');
    setFile(null);
    setInspection(null);
    setCommitted(null);
    setConfirmed(false);
    setPending(false);
    setError(null);
    setCommitNeedsReconciliation(false);
    setRefreshPending(false);
    setRefreshFailed(false);
  });

  onCleanup(() => operation?.abort('External plugin dialog disposed'));

  const canInspect = createMemo(() => {
    if (pending()) return false;
    return validateExternalSource(sourceKind(), url(), file()).valid;
  });

  const inspect = async () => {
    if (!canInspect()) return;
    const controller = new AbortController();
    operation?.abort('External package inspection superseded');
    operation = controller;
    setPending(true);
    setError(null);
    try {
      const intent = isUpdate()
        ? {
            action: 'update' as const,
            plugin_instance_id: props.updateItem!.pluginInstanceID!,
            expected_management_revision: props.updateItem!.managementRevision!,
          }
        : { action: 'install' as const };
      const request: ExternalPluginInspectionRequest = sourceKind() === 'package_upload'
        ? { sourceKind: 'package_upload', file: file()!, intent }
        : sourceKind() === 'github_repository'
          ? { sourceKind: 'github_repository', url: url().trim(), tag: tag().trim() || undefined, intent }
          : { sourceKind: 'package_url', url: url().trim(), intent };
      const next = await props.onInspect(request, controller.signal);
      setInspection(next);
      setConfirmed(false);
      setCommitNeedsReconciliation(false);
      setStage('review');
    } catch (error) {
      if (!controller.signal.aborted) setError(inspectErrorFromUnknown(error, i18n));
    } finally {
      if (operation === controller) {
        operation = undefined;
        setPending(false);
      }
    }
  };

  const commit = async () => {
    const current = inspection();
    if (!current || !confirmed() || pending()) return;
    const controller = new AbortController();
    operation?.abort('External package commit superseded');
    operation = controller;
    setPending(true);
    setStage('committing');
    setError(null);
    setCommitNeedsReconciliation(false);
    try {
      const result = await props.onCommit(current, controller.signal);
      setCommitted(result);
      setStage('complete');
      await refreshCommitted(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError({ summary: i18n.t('uiCopy.plugin.external.commitFailed') });
        if (error instanceof ExternalPackageInspectionTerminalError) {
          setInspection(null);
          setConfirmed(false);
          setCommitNeedsReconciliation(false);
          setStage('source');
        } else if (pluginMutationOutcome(error) === 'not_committed') {
          setCommitNeedsReconciliation(false);
          setStage('review');
        } else {
          setCommitNeedsReconciliation(true);
          setError({ summary: i18n.t('uiCopy.plugin.external.commitOutcomeUnknown') });
          setStage('review');
        }
      }
    } finally {
      if (operation === controller) {
        operation = undefined;
        setPending(false);
      }
    }
  };

  const refreshCommitted = async (result: ExternalPluginCommitResult) => {
    if (refreshPending()) return;
    setRefreshPending(true);
    setError(null);
    try {
      await props.onCommitted(result);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
      setError({ summary: i18n.t('uiCopy.plugin.external.refreshFailed') });
    } finally {
      setRefreshPending(false);
    }
  };

  const close = () => {
    if (stage() === 'committing' || commitNeedsReconciliation()) return;
    operation?.abort('External plugin dialog closed');
    props.onOpenChange(false);
  };

  const viewPermissions = () => {
    const result = committed();
    if (!result || refreshFailed()) return;
    props.onViewPermissions?.(result);
    props.onOpenChange(false);
  };

  const reviewBlocked = createMemo(() => {
    const current = inspection();
    return current ? inspectionBlocked(current) : false;
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={dialogTitle()}
      description={i18n.t('uiCopy.plugin.external.dialogDescription')}
      class={cn(
        'w-[min(54rem,calc(100%-1rem))] max-w-[54rem] max-h-[80vh] bg-background text-foreground sm:w-[min(54rem,calc(100%-2rem))]',
        commitNeedsReconciliation() && '[&>div:first-child>button]:hidden',
      )}
      footer={(
        <div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Show when={stage() === 'review' && inspection() && !reviewBlocked() && !commitNeedsReconciliation()} fallback={<span />}>
            <label data-external-plugin-confirmation class={cn(PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'flex cursor-pointer items-center gap-2 text-xs text-foreground sm:max-w-[30rem] sm:items-start')}>
              <input
                type="checkbox"
                checked={confirmed()}
                class="mt-0.5 h-4 w-4 shrink-0 rounded border"
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>{i18n.t('uiCopy.plugin.external.confirmDigest')}</span>
            </label>
          </Show>
          <div class="flex shrink-0 flex-wrap justify-end gap-2">
            <Show when={stage() === 'review' && !commitNeedsReconciliation()}>
              <button type="button" class="min-h-[46px] cursor-pointer rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9" disabled={pending()} onClick={() => setStage('source')}>
                {i18n.t('uiCopy.plugin.external.back')}
              </button>
            </Show>
            <Show when={stage() !== 'committing' && !commitNeedsReconciliation()}>
              <button type="button" class="min-h-[46px] cursor-pointer rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted sm:min-h-9" onClick={close}>
                {stage() === 'complete' ? i18n.t('common.actions.close') : i18n.t('common.actions.cancel')}
              </button>
            </Show>
            <Show when={stage() === 'complete' && committed()}>
              {(result) => (
                <Show
                  when={refreshFailed()}
                  fallback={(
                    <button type="button" class="min-h-[46px] cursor-pointer rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground sm:min-h-9" onClick={viewPermissions}>
                      {i18n.t('uiCopy.plugin.reviewPermissions')}
                    </button>
                  )}
                >
                  <button
                    type="button"
                    data-external-plugin-refresh-inventory
                    class="min-h-[46px] cursor-pointer rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                    disabled={refreshPending()}
                    onClick={() => void refreshCommitted(result())}
                  >
                    {i18n.t('uiCopy.plugin.refreshOfficial')}
                  </button>
                </Show>
              )}
            </Show>
            <Show when={stage() === 'source'}>
              <button data-external-plugin-inspect type="button" class="min-h-[46px] cursor-pointer rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9" disabled={!canInspect()} onClick={() => void inspect()}>
                {pending() ? i18n.t('uiCopy.plugin.external.inspecting') : i18n.t('uiCopy.plugin.external.inspect')}
              </button>
            </Show>
            <Show when={stage() === 'review' && !reviewBlocked()}>
              <button type="button" class="min-h-[46px] cursor-pointer rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9" disabled={!confirmed() || pending()} onClick={() => void commit()}>
                {commitNeedsReconciliation()
                  ? i18n.t('common.actions.retry')
                  : isUpdate()
                    ? i18n.t('uiCopy.plugin.external.confirmUpdate')
                    : i18n.t('uiCopy.plugin.external.confirmInstall')}
              </button>
            </Show>
          </div>
        </div>
      )}
    >
      <div data-external-plugin-dialog class="space-y-5">
        <InstallProgress stage={stage()} isUpdate={isUpdate()} />
        <Show when={error()}>
          {(currentError) => (
            <div role="alert" class="flex gap-2 rounded-md border border-destructive bg-background px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="font-medium">{currentError().summary}</div>
                <Show when={currentError().recovery}>
                  {(recovery) => <div class="mt-1 text-xs leading-5 text-muted-foreground">{recovery()}</div>}
                </Show>
                <Show when={currentError().code || currentError().technical}>
                  <details class="mt-2 text-xs text-muted-foreground">
                    <summary class="cursor-pointer font-medium text-foreground">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
                    <Show when={currentError().code}>
                      {(code) => <code class="mt-2 block break-all">{code()}</code>}
                    </Show>
                    <Show when={currentError().technical}>
                      {(technical) => <code class="mt-1 block break-all">{technical()}</code>}
                    </Show>
                  </details>
                </Show>
              </div>
            </div>
          )}
        </Show>
        <Show when={stage() === 'source'}>
          <SourceForm
            sourceKind={sourceKind()}
            url={url()}
            tag={tag()}
            file={file()}
            pending={pending()}
            onSourceKind={setSourceKind}
            onURL={setURL}
            onTag={setTag}
            onFile={setFile}
          />
        </Show>
        <Show when={stage() === 'review' && inspection()}>
          {(current) => (
            <InspectionReview
              inspection={current()}
              previousSummary={props.updateItem?.externalPackage?.securitySummary}
            />
          )}
        </Show>
        <Show when={stage() === 'committing'}>
          <CommitProgress inspection={inspection()} />
        </Show>
        <Show when={stage() === 'complete' && committed()}>
          {(result) => (
            <div role="status" class="space-y-4 rounded-md border bg-background p-5">
              <div class="flex items-start gap-3">
                <CheckCircle class="mt-0.5 h-5 w-5 shrink-0 text-[var(--redeven-status-success-foreground)]" />
                <div>
                  <div class="font-semibold">{i18n.t('uiCopy.plugin.external.complete', { plugin: result().plugin.manifest.plugin.display_name })}</div>
                  <div class="mt-1 text-sm text-muted-foreground">{result().plugin.publisher_id} · v{result().plugin.version}</div>
                </div>
              </div>
              <PostInstallFacts updateEligibility={result().update_eligibility.state} />
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

function InstallProgress(props: { stage: InstallStage; isUpdate: boolean }): JSX.Element {
  const i18n = useI18n();
  const activeIndex = () => ({ source: 0, review: 1, committing: 2, complete: 3 })[props.stage];
  const steps = () => [
    i18n.t('uiCopy.plugin.external.source'),
    i18n.t('uiCopy.plugin.external.inspect'),
    props.isUpdate ? i18n.t('uiCopy.plugin.external.confirmUpdate') : i18n.t('uiCopy.plugin.external.confirmInstall'),
    i18n.t('common.status.ready'),
  ];
  return (
    <ol class="grid grid-cols-4 border-b pb-4" aria-label={i18n.t('uiCopy.plugin.external.dialogDescription')}>
      <For each={steps()}>
        {(label, index) => {
          const complete = () => index() < activeIndex();
          const active = () => index() === activeIndex();
          return (
            <li
              class={cn(
                'relative flex min-w-0 flex-col items-center gap-2 px-1 text-center text-[11px] font-medium sm:text-xs',
                active() || complete() ? 'text-foreground' : 'text-muted-foreground',
              )}
              aria-current={active() ? 'step' : undefined}
            >
              <Show when={index() > 0}>
                <span
                  data-install-progress-connector
                  class={cn('absolute top-3 h-px -translate-y-1/2', complete() || active() ? 'bg-primary' : 'bg-border')}
                  style={{ right: 'calc(50% + 1.25rem)', width: 'calc(100% - 2.5rem)' }}
                  aria-hidden="true"
                />
              </Show>
              <span data-install-progress-marker class={cn(
                'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-[10px]',
                complete() ? 'border-primary bg-primary text-primary-foreground' : active() ? 'border-primary text-primary' : 'border-border',
              )}>
                {complete() ? <Check class="h-3.5 w-3.5" /> : index() + 1}
              </span>
              <span data-install-progress-label class="min-h-8 max-w-full px-0.5 leading-4">{label}</span>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

type SourceValidation = { valid: boolean; error?: 'url' };

function validateExternalSource(
  sourceKind: ExternalPluginSourceKind,
  rawURL: string,
  file: File | null,
): SourceValidation {
  if (sourceKind === 'package_upload') return { valid: Boolean(file) };
  let parsed: URL;
  try {
    parsed = new URL(rawURL.trim());
  } catch {
    return { valid: false, error: 'url' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { valid: false, error: 'url' };
  }
  if (sourceKind === 'github_repository') {
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parsed.hostname.toLowerCase() !== 'github.com' || path.length !== 2 || parsed.search || parsed.hash) {
      return { valid: false, error: 'url' };
    }
  }
  return { valid: true };
}

function inspectErrorFromUnknown(error: unknown, i18n: ReturnType<typeof useI18n>): PluginInstallError {
  const authoritative = error instanceof PluginTransportError && error.cause instanceof PluginPlatformRequestError
    ? error.cause
    : error;
  const rawCode = authoritative instanceof PluginPlatformRequestError
    ? authoritative.errorCode
    : readSafeErrorField(authoritative, 'errorCode') ?? readSafeErrorField(authoritative, 'code');
  const code = rawCode && /^[A-Z][A-Z0-9_]{2,127}$/.test(rawCode) ? rawCode : undefined;
  const rawMessage = authoritative instanceof Error
    ? authoritative.message
    : readSafeErrorField(authoritative, 'message');
  const message = sanitizePluginErrorText(rawMessage ?? '');
  const transportFailure = error instanceof PluginTransportError || (!code && authoritative instanceof TypeError);
  return {
    summary: message || i18n.t('uiCopy.plugin.external.inspectFailed'),
    recovery: inspectionRecovery(code, transportFailure, i18n),
    code,
    technical: message && message !== i18n.t('uiCopy.plugin.external.inspectFailed') ? message : undefined,
  };
}

function inspectionRecovery(
  code: string | undefined,
  transportFailure: boolean,
  i18n: ReturnType<typeof useI18n>,
): string {
  if (transportFailure) return i18n.t('uiCopy.plugin.external.inspectNetworkRecovery');
  if (!code) return i18n.t('uiCopy.plugin.external.inspectGeneralRecovery');
  if (
    code === 'PLUGIN_MANIFEST_INVALID'
    || code === 'PLUGIN_PACKAGE_INVALID'
    || code === 'PLUGIN_PACKAGE_TOO_LARGE'
    || code === 'PLUGIN_PACKAGE_PATH_FORBIDDEN'
    || code === 'PLUGIN_CONTRACT_MISMATCH'
    || code === 'PLUGIN_INVALID_REQUEST'
  ) return i18n.t('uiCopy.plugin.external.inspectPackageRecovery');
  if (
    code === 'PLUGIN_SIGNATURE_INVALID'
    || code === 'PLUGIN_TRUST_STATE_DENIED'
    || code === 'PLUGIN_TRUST_VERIFICATION_REQUIRED'
    || code === 'PLUGIN_TRUST_VERIFICATION_INVALID'
    || code === 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED'
    || code === 'PLUGIN_RELEASE_REF_POLICY_DENIED'
    || code === 'PLUGIN_ORIGIN_DENIED'
    || code === 'PLUGIN_DISABLED_BY_POLICY'
  ) return i18n.t('uiCopy.plugin.external.inspectPolicyRecovery');
  if (code === 'PLUGIN_RUNTIME_UNAVAILABLE' || code === 'PLUGIN_FEATURE_NOT_CONFIGURED') {
    return i18n.t('uiCopy.plugin.external.inspectRuntimeRecovery');
  }
  return i18n.t('uiCopy.plugin.external.inspectGeneralRecovery');
}

function readSafeErrorField(error: unknown, field: 'code' | 'errorCode' | 'message'): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizePluginErrorText(value: string): string {
  const withoutSensitiveURLs = value.replace(/https?:\/\/[^\s<>"']+/gi, (rawURL) => {
    const trailing = rawURL.match(/[),.;:!?]+$/)?.[0] ?? '';
    const candidate = trailing ? rawURL.slice(0, -trailing.length) : rawURL;
    try {
      const parsed = new URL(candidate);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return `${parsed.origin}${parsed.pathname}${trailing}`;
    } catch {
      return `[redacted URL]${trailing}`;
    }
  });
  return withoutSensitiveURLs
    .replace(/([?&](?:access_?token|api_?key|key|secret|password|authorization)=)[^&\s]+/gi, '$1[redacted]')
    .trim()
    .slice(0, 512);
}

function SourceForm(props: {
  sourceKind: ExternalPluginSourceKind;
  url: string;
  tag: string;
  file: File | null;
  pending: boolean;
  onSourceKind: (kind: ExternalPluginSourceKind) => void;
  onURL: (value: string) => void;
  onTag: (value: string) => void;
  onFile: (file: File | null) => void;
}): JSX.Element {
  const i18n = useI18n();
  const [validationVisible, setValidationVisible] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  const validation = createMemo(() => validateExternalSource(props.sourceKind, props.url, props.file));
  const choices: readonly { kind: ExternalPluginSourceKind; label: string; icon: typeof Link }[] = [
    { kind: 'package_url', label: i18n.t('uiCopy.plugin.external.packageURL'), icon: Link },
    { kind: 'github_repository', label: i18n.t('uiCopy.plugin.external.githubRepository'), icon: Link },
    { kind: 'package_upload', label: i18n.t('uiCopy.plugin.external.packageFile'), icon: Upload },
  ];
  const sourceTabID = (kind: ExternalPluginSourceKind) => `external-plugin-source-tab-${kind}`;
  const selectSource = (kind: ExternalPluginSourceKind, focus = false) => {
    props.onSourceKind(kind);
    setValidationVisible(false);
    if (focus) queueMicrotask(() => document.getElementById(sourceTabID(kind))?.focus());
  };
  const selectAdjacentSource = (event: KeyboardEvent, kind: ExternalPluginSourceKind) => {
    const index = choices.findIndex((choice) => choice.kind === kind);
    const next = event.key === 'Home'
      ? choices[0]
      : event.key === 'End'
        ? choices[choices.length - 1]
        : event.key === 'ArrowLeft'
          ? choices[(index + choices.length - 1) % choices.length]
          : event.key === 'ArrowRight'
            ? choices[(index + 1) % choices.length]
            : undefined;
    if (!next) return;
    event.preventDefault();
    selectSource(next.kind, true);
  };
  return (
    <>
      <div class="grid grid-cols-3 gap-1 rounded-md bg-muted p-1" role="tablist" aria-label={i18n.t('uiCopy.plugin.external.source')}>
        <For each={choices}>
          {(choice) => (
            <button
              type="button"
              id={sourceTabID(choice.kind)}
              role="tab"
              aria-selected={props.sourceKind === choice.kind}
              aria-controls="external-plugin-source-panel"
              tabIndex={props.sourceKind === choice.kind ? 0 : -1}
              class={cn(
                'flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1 rounded px-1 py-2 text-xs font-medium transition sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-2 sm:py-0',
                props.sourceKind === choice.kind ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              disabled={props.pending}
              onClick={() => selectSource(choice.kind)}
              onKeyDown={(event) => selectAdjacentSource(event, choice.kind)}
            >
              <choice.icon class="h-3.5 w-3.5 shrink-0" />
              <span data-external-plugin-source-label class="max-w-full text-center leading-4">{choice.label}</span>
            </button>
          )}
        </For>
      </div>
      <div
        id="external-plugin-source-panel"
        role="tabpanel"
        aria-labelledby={sourceTabID(props.sourceKind)}
        class="space-y-4 pt-1"
      >
      <Show when={props.sourceKind !== 'package_upload'}>
        <label class="block space-y-1.5 text-sm font-medium">
          <span>{props.sourceKind === 'github_repository' ? i18n.t('uiCopy.plugin.external.repositoryURL') : i18n.t('uiCopy.plugin.external.packageURL')}</span>
          <input
            type="url"
            value={props.url}
            disabled={props.pending}
            placeholder={props.sourceKind === 'github_repository'
              ? i18n.t('uiCopy.plugin.external.repositoryURLPlaceholder')
              : i18n.t('uiCopy.plugin.external.packageURLPlaceholder')}
            aria-invalid={validationVisible() && !validation().valid ? 'true' : undefined}
            aria-describedby={validationVisible() && !validation().valid ? 'external-plugin-source-error' : undefined}
            class={cn(
              'h-[46px] w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-10',
              validationVisible() && !validation().valid && 'border-destructive focus:border-destructive focus:ring-destructive/20',
            )}
            onInput={(event) => props.onURL(event.currentTarget.value)}
            onBlur={() => setValidationVisible(props.url.trim().length > 0)}
          />
          <Show when={validationVisible() && !validation().valid}>
            <span id="external-plugin-source-error" role="alert" class="block text-xs font-normal text-destructive">
              {i18n.t('uiCopy.plugin.external.sourceInvalid')}
            </span>
          </Show>
        </label>
      </Show>
      <Show when={props.sourceKind === 'github_repository'}>
        <label class="block space-y-1.5 text-sm font-medium">
          <span>{i18n.t('uiCopy.plugin.external.releaseTag')}</span>
          <input
            type="text"
            value={props.tag}
            disabled={props.pending}
            placeholder={i18n.t('uiCopy.plugin.external.latestRelease')}
            class="h-[46px] w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-10"
            onInput={(event) => props.onTag(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={props.sourceKind === 'package_upload'}>
        <div class="space-y-2">
          <input
            ref={fileInput}
            id="external-plugin-package-file"
            type="file"
            accept=".redevplugin,application/vnd.redevplugin.package+zip,application/zip"
            disabled={props.pending}
            class="peer sr-only"
            onChange={(event) => props.onFile(event.currentTarget.files?.[0] ?? null)}
          />
          <label
            for="external-plugin-package-file"
            class="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background px-4 py-5 text-center transition-colors hover:border-primary hover:bg-muted peer-focus-visible:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/20"
          >
            <Upload class="h-5 w-5 text-muted-foreground" />
            <span class="text-sm font-medium">{i18n.t('uiCopy.plugin.external.packageFile')}</span>
            <span class="text-xs text-muted-foreground">{i18n.t('common.actions.open')}</span>
          </label>
          <Show when={props.file}>
            {(selectedFile) => (
              <div data-external-plugin-selected-file class="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5">
                <Package class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{selectedFile().name}</div>
                  <div class="text-xs text-muted-foreground">{formatFileSize(selectedFile().size)}</div>
                </div>
                <button
                  type="button"
                  class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
                  aria-label={i18n.t('common.actions.delete')}
                  title={i18n.t('common.actions.delete')}
                  onClick={() => {
                    if (fileInput) fileInput.value = '';
                    props.onFile(null);
                  }}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            )}
          </Show>
        </div>
      </Show>
      </div>
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InspectionReview(props: {
  inspection: ExternalPluginInspection;
  previousSummary?: PluginExternalPackageSecuritySummary;
}): JSX.Element {
  const i18n = useI18n();
  const summary = () => props.inspection.security_summary;
  const signature = () => props.inspection.signature_assessment.state;
  const blocked = () => inspectionBlocked(props.inspection);
  const categorySummaries = () => securityCategorySummaries(summary(), i18n);
  const declarations = createMemo(() => securityDeclarations(summary(), props.previousSummary));
  const accessChanged = createMemo(() => declarations().some((declaration) => Boolean(declaration.change)));
  return (
    <div class="space-y-4">
      <div class="flex items-start gap-3 border-b pb-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-background"><Package class="h-5 w-5" /></div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-base font-semibold">{props.inspection.plugin_id}</div>
          <div class="mt-1 text-sm text-muted-foreground">{props.inspection.publisher_id} · v{props.inspection.version}</div>
          <code class="mt-1.5 block truncate text-[11px] text-muted-foreground" title={props.inspection.inspected_hashes.package_sha256}>
            {props.inspection.inspected_hashes.package_sha256}
          </code>
        </div>
      </div>
      <SourceProvenanceReview provenance={props.inspection.source_provenance} />
      <div class="grid gap-2 sm:grid-cols-3" data-external-plugin-trust-review>
        <DecisionFact
          icon={<Shield class="h-4 w-4" />}
          primary={signatureReviewLabel(signature(), i18n)}
          technical={[
            `signature=${signature()}`,
            ...props.inspection.signature_assessment.reason_codes,
          ]}
          tone={blocked() ? 'blocked' : signature() === 'verified' ? 'positive' : 'caution'}
        />
        <DecisionFact
          icon={blocked() ? <AlertTriangle class="h-4 w-4" /> : <Check class="h-4 w-4" />}
          primary={executionApprovalReviewLabel(props.inspection.execution_approval.state, i18n)}
          technical={[
            `execution_approval=${props.inspection.execution_approval.state}`,
            ...props.inspection.execution_approval.reason_codes,
          ]}
          tone={blocked() ? 'blocked' : 'neutral'}
        />
        <DecisionFact
          icon={<Link class="h-4 w-4" />}
          primary={props.inspection.update_eligibility.state === 'automatic_eligible'
            ? i18n.t('uiCopy.plugin.external.automaticUpdates')
            : i18n.t('uiCopy.plugin.external.manualUpdates')}
          technical={[
            `update_eligibility=${props.inspection.update_eligibility.state}`,
            ...props.inspection.update_eligibility.reason_codes,
          ]}
          tone={props.inspection.update_eligibility.state === 'automatic_eligible' ? 'positive' : 'neutral'}
        />
      </div>
      <PostInstallFacts updateEligibility={props.inspection.update_eligibility.state} />
      <Show when={props.previousSummary && accessChanged()}>
        <div class="rounded-md border border-[var(--redeven-status-warning-foreground)] bg-background px-3 py-2 text-sm">
          {i18n.t('uiCopy.plugin.external.accessChanged')}
        </div>
      </Show>
      <div class="space-y-3 border-t pt-4" data-external-plugin-security-declarations>
        <div class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.declaredAccess')}</div>
        <p class="text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.external.declaredAccessGuidance')}</p>
        <Show
          when={categorySummaries().length > 0}
          fallback={<div class="rounded-md border bg-background px-3 py-2.5 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.external.noDeclaredAccess')}</div>}
        >
          <div class="grid gap-2 sm:grid-cols-2" data-external-plugin-purpose-summary>
            <For each={categorySummaries()}>
              {(category) => (
                <div class="rounded-md border bg-background px-3 py-2.5">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase text-muted-foreground">{securityCategoryLabel(category.category, i18n)}</div>
                    <div class="flex items-center gap-1.5">
                      <span class={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        category.risk === 'sensitive'
                          ? 'bg-[var(--redeven-status-warning-soft)] text-[var(--redeven-status-warning-foreground)]'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {category.risk === 'sensitive'
                          ? i18n.t('uiCopy.plugin.external.reviewCarefully')
                          : i18n.t('uiCopy.plugin.external.declaredCapability')}
                      </span>
                      <span class="text-sm font-semibold">{category.count}</span>
                    </div>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{category.purpose}</p>
                </div>
              )}
            </For>
          </div>
        </Show>
        <For each={declarations()}>
          {(declaration) => (
            <details class={cn(
              'group rounded-md border border-l-2 bg-background',
              declaration.change === 'added' || declaration.change === 'changed'
                ? 'border-l-[var(--redeven-status-warning-foreground)]'
                : declaration.change === 'removed'
                  ? 'border-l-muted-foreground/35 opacity-75'
                  : 'border-l-border',
            )}>
              <summary class="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
                <span class="text-[10px] font-semibold uppercase text-muted-foreground">{securityCategoryLabel(declaration.category, i18n)}</span>
                <span class="min-w-0 flex-1 text-xs font-semibold">{humanizeTechnicalIdentifier(declaration.identity)}</span>
                <Show when={declaration.change}>
                  {(change) => (
                    <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                      {i18n.t(`uiCopy.plugin.external.${change()}`)}
                    </span>
                  )}
                </Show>
                <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div class="border-t px-3 py-2">
                <code class="block break-all text-[11px] text-foreground">{declaration.identity}</code>
                <For each={declaration.facts}>
                  {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground">{fact}</code>}
                </For>
                <Show when={declaration.previousFacts}>
                  {(previousFacts) => (
                    <div class="mt-2 border-t pt-2 opacity-75">
                      <span class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.previous')}</span>
                      <For each={previousFacts()}>
                        {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground line-through">{fact}</code>}
                      </For>
                    </div>
                  )}
                </Show>
              </div>
            </details>
          )}
        </For>
      </div>
      <Show when={blocked()}>
        <div role="alert" class="rounded-md border border-destructive bg-background px-3 py-2.5 text-sm text-destructive">
          <div class="font-medium">{signatureReviewLabel(signature(), i18n)}</div>
          <Show when={props.inspection.execution_approval.state === 'policy_blocked'}>
            <div class="mt-1 font-medium">{i18n.t('uiCopy.plugin.managedByPolicy')}</div>
          </Show>
          <details class="mt-2 text-xs">
            <summary class="cursor-pointer font-medium">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
            <For each={[
              ...props.inspection.signature_assessment.reason_codes,
              ...props.inspection.execution_approval.reason_codes,
            ]}>
              {(reason) => <code class="mt-1 block break-all text-[11px]">{reason}</code>}
            </For>
          </details>
        </div>
      </Show>
      <details class="group border-t pt-3 text-xs">
        <summary class="flex min-h-[44px] cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground sm:min-h-9">
          <span class="flex-1">{i18n.t('uiCopy.plugin.external.packageHash')}</span>
          <ChevronDown class="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div class="space-y-3 pb-1 pt-2">
          <div>
            <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.packageHash')}</div>
            <code class="mt-1 block break-all text-[11px]">{props.inspection.inspected_hashes.package_sha256}</code>
          </div>
          <div>
            <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.securitySummaryHash')}</div>
            <code class="mt-1 block break-all text-[11px]">{summary().summary_sha256}</code>
          </div>
          <div>
            <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.confirmationDigest')}</div>
            <code class="mt-1 block break-all text-[11px]">{props.inspection.confirmation_digest}</code>
          </div>
        </div>
      </details>
    </div>
  );
}

function inspectionBlocked(inspection: ExternalPluginInspection): boolean {
  return inspection.signature_assessment.state === 'invalid'
    || inspection.signature_assessment.state === 'revoked'
    || inspection.execution_approval.state === 'policy_blocked';
}

function executionApprovalReviewLabel(
  state: ExternalPluginInspection['execution_approval']['state'],
  i18n: ReturnType<typeof useI18n>,
): string {
  switch (state) {
    case 'pending': return i18n.t('uiCopy.plugin.external.executionApprovalPending');
    case 'user_approved': return i18n.t('uiCopy.plugin.external.executionApprovalUserApproved');
    case 'policy_approved': return i18n.t('uiCopy.plugin.external.executionApprovalPolicyApproved');
    case 'policy_blocked': return i18n.t('uiCopy.plugin.external.executionApprovalPolicyBlocked');
  }
}

function DecisionFact(props: {
  icon: JSX.Element;
  primary: string;
  technical?: readonly string[];
  tone: 'positive' | 'caution' | 'blocked' | 'neutral';
}): JSX.Element {
  const i18n = useI18n();
  return (
    <div class={cn(
      'flex min-h-20 items-start gap-2 rounded-md border bg-background p-3 text-sm',
      props.tone === 'blocked' && 'border-destructive text-destructive',
      props.tone === 'positive' && 'border-[var(--redeven-status-success-foreground)]',
      props.tone === 'caution' && 'border-[var(--redeven-status-warning-foreground)]',
    )}>
      <span class="mt-0.5 shrink-0">{props.icon}</span>
      <span class="min-w-0">
        <span class="block font-medium leading-5">{props.primary}</span>
        <Show when={props.technical && props.technical.length > 0}>
          <details data-decision-technical-details class="mt-1 text-[10px] text-muted-foreground">
            <summary class="cursor-pointer font-medium text-foreground">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
            <For each={props.technical}>
              {(fact) => <code class="mt-1 block break-all">{fact}</code>}
            </For>
          </details>
        </Show>
      </span>
    </div>
  );
}

function PostInstallFacts(props: { updateEligibility: ExternalPluginInspection['update_eligibility']['state'] }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="grid gap-2 sm:grid-cols-3" data-external-plugin-install-outcome>
      <div class="rounded-md border bg-background px-3 py-2.5">
        <div class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.lifecycle')}</div>
        <div class="mt-1 text-sm font-semibold">{i18n.t('uiCopy.plugin.disabled')}</div>
      </div>
      <div class="rounded-md border bg-background px-3 py-2.5">
        <div class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.permissions')}</div>
        <div class="mt-1 text-sm font-semibold">0 · {i18n.t('uiCopy.plugin.permissionNotGranted')}</div>
      </div>
      <div class="rounded-md border bg-background px-3 py-2.5">
        <div class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.confirmUpdate')}</div>
        <div class="mt-1 text-sm font-semibold">
          {props.updateEligibility === 'automatic_eligible'
            ? i18n.t('uiCopy.plugin.external.automaticUpdates')
            : i18n.t('uiCopy.plugin.external.manualUpdates')}
        </div>
      </div>
    </div>
  );
}

function CommitProgress(props: { inspection: ExternalPluginInspection | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <div role="status" class="space-y-4 rounded-md border bg-background p-5">
      <div class="flex items-center gap-3">
        <Loader2 class="h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <div>
          <div class="font-semibold">{i18n.t('uiCopy.plugin.external.committing')}</div>
          <Show when={props.inspection}>
            {(current) => <div class="mt-1 text-sm text-muted-foreground">{current().plugin_id} · v{current().version}</div>}
          </Show>
        </div>
      </div>
      <Show when={props.inspection}>
        {(current) => (
          <div class="grid gap-2 sm:grid-cols-2">
            <DecisionFact
              icon={<Shield class="h-4 w-4" />}
              primary={signatureReviewLabel(current().signature_assessment.state, i18n)}
              technical={[`signature=${current().signature_assessment.state}`]}
              tone={current().signature_assessment.state === 'verified' ? 'positive' : 'caution'}
            />
            <DecisionFact
              icon={<Link class="h-4 w-4" />}
              primary={current().update_eligibility.state === 'automatic_eligible'
                ? i18n.t('uiCopy.plugin.external.automaticUpdates')
                : i18n.t('uiCopy.plugin.external.manualUpdates')}
              technical={[`update_eligibility=${current().update_eligibility.state}`]}
              tone="neutral"
            />
          </div>
        )}
      </Show>
    </div>
  );
}

function SourceProvenanceReview(props: { provenance: ExternalPluginInspection['source_provenance'] }): JSX.Element {
  const i18n = useI18n();
  const facts = () => {
    const provenance = props.provenance;
    if (provenance.kind === 'package_url') {
      return [
        `${provenance.source_origin}${provenance.source_path}`,
        ...provenance.redirect_chain.map((hop) => `${hop.origin}${hop.path}`),
      ];
    }
    if (provenance.kind === 'github_repository') {
      return [
        provenance.repository_url,
        provenance.release_tag ?? '',
        provenance.asset_name ?? '',
        provenance.resolved_commit_sha,
      ].filter(Boolean);
    }
    return [provenance.upload_id];
  };
  return (
    <div class="border-t pt-3" data-external-plugin-source-provenance>
      <div class="text-xs font-semibold uppercase text-muted-foreground">
        {i18n.t('uiCopy.plugin.external.source')}
      </div>
      <div class="mt-1 space-y-1">
        <For each={facts()}>
          {(fact, index) => (
            <code class="block break-all text-[11px] text-foreground">
              {index() === 0 ? fact : `-> ${fact}`}
            </code>
          )}
        </For>
      </div>
    </div>
  );
}

type SecurityCategory = keyof Pick<
  PluginExternalPackageSecuritySummary,
  'permissions' | 'methods' | 'capability_contracts' | 'workers' | 'network' | 'storage' | 'secret_refs' | 'core_actions' | 'intents' | 'surfaces'
>;

type SecurityDeclaration = {
  key: string;
  category: SecurityCategory;
  identity: string;
  facts: readonly string[];
  previousFacts?: readonly string[];
  value: unknown;
  change?: 'added' | 'changed' | 'removed';
};

function securityDeclarations(
  current: PluginExternalPackageSecuritySummary,
  previous?: PluginExternalPackageSecuritySummary,
): readonly SecurityDeclaration[] {
  const currentRows = projectSecurityDeclarations(current);
  if (!previous) return currentRows;
  const previousRows = projectSecurityDeclarations(previous);
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));
  const currentKeys = new Set(currentRows.map((row) => row.key));
  return [
    ...currentRows.map((row) => {
      const before = previousByKey.get(row.key);
      return {
        ...row,
        ...(!before
          ? { change: 'added' as const }
          : JSON.stringify(before.value) !== JSON.stringify(row.value)
            ? { change: 'changed' as const, previousFacts: before.facts }
            : {}),
      };
    }),
    ...previousRows.filter((row) => !currentKeys.has(row.key)).map((row) => ({ ...row, change: 'removed' as const })),
  ];
}

function projectSecurityDeclarations(summary: PluginExternalPackageSecuritySummary): SecurityDeclaration[] {
  const rows: SecurityDeclaration[] = [];
  const add = (category: SecurityCategory, identity: string, facts: readonly string[], value: unknown) => {
    rows.push({ key: `${category}:${identity}`, category, identity, facts, value });
  };
  for (const value of summary.permissions) {
    add('permissions', value.permission_id, [`methods=${list(value.methods)}`], value);
  }
  for (const value of summary.methods) {
    add('methods', value.method, [
      `route=${fields(value.route)}`,
      `effect=${value.effect}; execution=${value.execution}; dangerous=${value.dangerous}; preflight_only=${value.preflight_only}`,
      `required_permissions=${list(value.required_permissions)}`,
      `confirmation=${fields(value.confirmation)}`,
      ...(value.cancel ? [`cancel=${fields(value.cancel)}`] : []),
    ], value);
  }
  for (const value of summary.capability_contracts) {
    add('capability_contracts', `${value.capability_id}@${value.capability_version}`, [
      `binding_id=${value.binding_id}`,
      `contract_sha256=${value.contract_sha256}`,
    ], value);
  }
  for (const value of summary.workers) {
    add('workers', value.worker_id, [
      `artifact=${value.artifact}; abi=${value.abi}; mode=${value.mode}; scope=${value.scope}`,
      `memory_limit_bytes=${value.memory_limit_bytes}; idle_timeout_ms=${value.idle_timeout_ms}`,
    ], value);
  }
  for (const value of summary.network) {
    add('network', value.connector_id, [
      `transport=${value.transport}; scope=${value.scope}; auth_declared=${value.auth_declared}; tls_declared=${value.tls_declared}`,
      `destinations=${list(value.destinations)}`,
      ...value.method_access.map((access) => (
        `method=${access.method}; operations=${list(access.operations)}; http_methods=${list(access.http_methods)}`
      )),
    ], value);
  }
  for (const value of summary.storage) {
    add('storage', value.store_id, [
      `kind=${value.kind}; scope=${value.scope}; schema_version=${value.schema_version}`,
      `quota_bytes=${value.quota_bytes}; quota_files=${value.quota_files ?? '-'}`,
      ...value.method_access.map((access) => `method=${access.method}; operations=${list(access.operations)}`),
    ], value);
  }
  for (const value of summary.secret_refs) {
    add('secret_refs', value.setting_key, [`secret_ref=${value.secret_ref}; scope=${value.scope}`], value);
  }
  for (const value of summary.core_actions) {
    add('core_actions', value.action_id, [`method=${value.method}; effect=${value.effect}`], value);
  }
  for (const value of summary.intents) {
    add('intents', value.intent_id, [`method=${value.method}`], value);
  }
  for (const value of summary.surfaces) {
    add('surfaces', value.surface_id, [
      `label=${value.label}; kind=${value.kind}; intent=${value.intent}`,
      `entry=${value.entry}; icon=${value.icon ?? '-'}; default_size=${value.default_size ? `${value.default_size.width}x${value.default_size.height}` : '-'}`,
    ], value);
  }
  return rows;
}

function securityCategoryLabel(category: SecurityCategory, i18n: ReturnType<typeof useI18n>): string {
  const keys: Record<SecurityCategory, Parameters<typeof i18n.t>[0]> = {
    permissions: 'uiCopy.plugin.external.permissions',
    methods: 'uiCopy.plugin.external.methods',
    capability_contracts: 'uiCopy.plugin.external.capabilityContracts',
    workers: 'uiCopy.plugin.external.workers',
    network: 'uiCopy.plugin.external.network',
    storage: 'uiCopy.plugin.external.storage',
    secret_refs: 'uiCopy.plugin.external.secretRefs',
    core_actions: 'uiCopy.plugin.external.coreActions',
    intents: 'uiCopy.plugin.external.intents',
    surfaces: 'uiCopy.plugin.external.surfaces',
  };
  return i18n.t(keys[category]);
}

function securityCategorySummaries(
  summary: PluginExternalPackageSecuritySummary,
  i18n: ReturnType<typeof useI18n>,
): readonly { category: SecurityCategory; count: number; purpose: string; risk: 'standard' | 'sensitive' }[] {
  const categories: readonly { category: SecurityCategory; count: number }[] = [
    { category: 'permissions', count: summary.permissions.length },
    { category: 'methods', count: summary.methods.length },
    { category: 'capability_contracts', count: summary.capability_contracts.length },
    { category: 'workers', count: summary.workers.length },
    { category: 'network', count: summary.network.length },
    { category: 'storage', count: summary.storage.length },
    { category: 'secret_refs', count: summary.secret_refs.length },
    { category: 'core_actions', count: summary.core_actions.length },
    { category: 'intents', count: summary.intents.length },
    { category: 'surfaces', count: summary.surfaces.length },
  ];
  return categories
    .filter((category) => category.count > 0)
    .map((category) => ({
      ...category,
      purpose: securityCategoryPurpose(category.category, i18n),
      risk: securityCategoryIsSensitive(category.category, summary) ? 'sensitive' as const : 'standard' as const,
    }))
    .sort((left, right) => Number(right.risk === 'sensitive') - Number(left.risk === 'sensitive'));
}

function securityCategoryPurpose(category: SecurityCategory, i18n: ReturnType<typeof useI18n>): string {
  const keys: Record<SecurityCategory, Parameters<typeof i18n.t>[0]> = {
    permissions: 'uiCopy.plugin.external.purpose.permissions',
    methods: 'uiCopy.plugin.external.purpose.methods',
    capability_contracts: 'uiCopy.plugin.external.purpose.capabilityContracts',
    workers: 'uiCopy.plugin.external.purpose.workers',
    network: 'uiCopy.plugin.external.purpose.network',
    storage: 'uiCopy.plugin.external.purpose.storage',
    secret_refs: 'uiCopy.plugin.external.purpose.secretRefs',
    core_actions: 'uiCopy.plugin.external.purpose.coreActions',
    intents: 'uiCopy.plugin.external.purpose.intents',
    surfaces: 'uiCopy.plugin.external.purpose.surfaces',
  };
  return i18n.t(keys[category]);
}

function securityCategoryIsSensitive(
  category: SecurityCategory,
  summary: PluginExternalPackageSecuritySummary,
): boolean {
  if (category === 'methods') return summary.methods.some((method) => method.dangerous || method.effect !== 'read');
  return category === 'workers'
    || category === 'network'
    || category === 'secret_refs'
    || category === 'core_actions';
}

function humanizeTechnicalIdentifier(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._:/@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return value;
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

function fields(value: object): string {
  return Object.entries(value).map(([key, field]) => (
    `${key}=${Array.isArray(field) ? list(field.map(String)) : String(field)}`
  )).join('; ');
}

function signatureReviewLabel(state: ExternalPluginInspection['signature_assessment']['state'], i18n: ReturnType<typeof useI18n>): string {
  switch (state) {
    case 'verified': return i18n.t('uiCopy.plugin.external.signatureVerified');
    case 'absent': return i18n.t('uiCopy.plugin.external.signatureAbsent');
    case 'unknown_signer': return i18n.t('uiCopy.plugin.external.signatureUnknown');
    case 'unavailable': return i18n.t('uiCopy.plugin.external.signatureUnavailable');
    case 'invalid': return i18n.t('uiCopy.plugin.external.signatureInvalid');
    case 'revoked': return i18n.t('uiCopy.plugin.external.signatureRevoked');
    default: return i18n.t('uiCopy.plugin.external.signatureUnavailable');
  }
}
