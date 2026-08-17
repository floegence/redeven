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
import {
  PluginPlatformRequestError,
  PluginTransportError,
  pluginMutationOutcome,
} from '@floegence/redevplugin-ui';

import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
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
import {
  operationImpactGroups,
  securityCategoryOrder,
  securityDeclarationHighlight,
  securityDeclarationIsSensitive,
  securityDeclarations,
  type OperationEffectGroup,
  type SecurityCategory,
  type SecurityDeclaration,
  type StandardChangeSummary,
} from './externalPluginSecurityProjection';

type ExternalPluginInstallDialogProps = {
  open: boolean;
  updateItem?: PluginInventoryItem;
  sourcePreset?: ExternalPluginSourcePreset;
  onOpenChange: (open: boolean) => void;
  onInspect: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommit: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onCommitted: (result: ExternalPluginCommitResult) => Promise<unknown> | unknown;
};

type InstallStage = 'source' | 'review' | 'committing' | 'complete';
type ExternalReviewOperation = 'install' | 'update' | 'reinstall' | 'replace' | 'install_checked';

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
  let dialogContent: HTMLDivElement | undefined;
  let reviewHeading: HTMLElement | undefined;

  const isUpdate = () => Boolean(props.updateItem?.pluginInstanceID);
  const reviewOperation = createMemo<ExternalReviewOperation>(() => resolveReviewOperation(inspection(), props.updateItem));
  const dialogTitle = () => {
    const plugin = props.updateItem?.displayName ?? '';
    switch (reviewOperation()) {
      case 'install': return i18n.t('uiCopy.plugin.external.installTitle');
      case 'reinstall': return i18n.t('uiCopy.plugin.external.reinstallTitle', { plugin });
      case 'replace': return i18n.t('uiCopy.plugin.external.replaceTitle', { plugin });
      case 'install_checked': return i18n.t('uiCopy.plugin.external.installCheckedTitle', { plugin });
      case 'update': return i18n.t('uiCopy.plugin.external.updateTitle', { plugin });
    }
  };

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
      queueMicrotask(() => reviewHeading?.focus({ preventScroll: true }));
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
        setError({ summary: i18n.t(isUpdate() ? 'uiCopy.plugin.external.updateFailed' : 'uiCopy.plugin.external.commitFailed') });
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
          setError({ summary: i18n.t(isUpdate() ? 'uiCopy.plugin.external.updateOutcomeUnknown' : 'uiCopy.plugin.external.commitOutcomeUnknown') });
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
      setError({ summary: i18n.t(isUpdate() ? 'uiCopy.plugin.external.updateRefreshFailed' : 'uiCopy.plugin.external.refreshFailed') });
    } finally {
      setRefreshPending(false);
    }
  };

  const close = () => {
    if (stage() === 'committing' || commitNeedsReconciliation()) return;
    operation?.abort('External plugin dialog closed');
    props.onOpenChange(false);
  };

  const reviewBlocked = createMemo(() => {
    const current = inspection();
    return current ? inspectionBlocked(current) : false;
  });

  const returnToSource = () => {
    setStage('source');
    queueMicrotask(() => {
      dialogContent
        ?.querySelector<HTMLInputElement>('[data-external-plugin-source-input]')
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={dialogTitle()}
      description={i18n.t('uiCopy.plugin.external.dialogDescription')}
      class={cn(
        'w-[min(54rem,calc(100%-1rem))] max-w-[54rem] max-h-[calc(100dvh-1rem)] bg-background text-foreground sm:max-h-[80vh] sm:w-[min(54rem,calc(100%-2rem))]',
        commitNeedsReconciliation() && '[&>div:first-child>button]:hidden',
      )}
      footer={(
        <div
          data-external-plugin-footer
          class={cn(
            'flex w-full flex-col gap-3',
            stage() === 'review' && !reviewBlocked() && 'sm:flex-row sm:items-center sm:justify-between',
            stage() !== 'review' || reviewBlocked() ? 'items-end' : 'items-stretch',
          )}
        >
          <Show when={stage() === 'review' && inspection() && !reviewBlocked()}>
            <InspectionConfirmation
              operation={reviewOperation()}
              checked={confirmed()}
              onChecked={setConfirmed}
            />
          </Show>
          <div class="flex shrink-0 flex-wrap justify-end gap-2">
            <Show when={stage() === 'review' && !commitNeedsReconciliation()}>
              <button type="button" class="min-h-[46px] cursor-pointer rounded-md border bg-background px-3 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9" disabled={pending()} onClick={returnToSource}>
                {i18n.t('uiCopy.plugin.external.back')}
              </button>
            </Show>
            <Show when={stage() !== 'committing' && !commitNeedsReconciliation()}>
              <button type="button" class="min-h-[46px] cursor-pointer rounded-md border bg-background px-3 text-sm font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.98] sm:min-h-9 motion-reduce:transform-none motion-reduce:transition-none" onClick={close}>
                {stage() === 'complete' ? i18n.t('common.actions.close') : i18n.t('common.actions.cancel')}
              </button>
            </Show>
            <Show when={stage() === 'complete' && committed()}>
              {(result) => (
                <Show
                  when={refreshFailed()}
                  fallback={null}
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
                  : reviewOperationActionLabel(reviewOperation(), i18n)}
              </button>
            </Show>
          </div>
        </div>
      )}
    >
      <div ref={dialogContent} data-external-plugin-dialog class="space-y-4 overflow-hidden">
        <InstallProgress stage={stage()} operation={reviewOperation()} />
        <Show when={error()}>
          {(currentError) => (
            <div role="alert" class="flex gap-2 rounded-md border border-destructive bg-background px-3 py-2.5 text-sm text-destructive animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
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
              displayName={props.updateItem?.displayName}
              previousVersion={props.updateItem?.version}
              previousSummary={props.updateItem?.externalPackage?.securitySummary}
              operation={reviewOperation()}
              focusTargetRef={(element) => { reviewHeading = element; }}
            />
          )}
        </Show>
        <Show when={stage() === 'committing'}>
          <CommitProgress inspection={inspection()} operation={reviewOperation()} />
        </Show>
        <Show when={stage() === 'complete' && committed()}>
          {(result) => (
            <div role="status" class="space-y-4 rounded-md border bg-background p-5 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
              <div class="flex items-start gap-3">
                <CheckCircle class="mt-0.5 h-5 w-5 shrink-0 text-[var(--redeven-status-success-foreground)]" />
                <div>
                  <div class="font-semibold">{i18n.t(
                    reviewOperationCompletionKey(reviewOperation()),
                    { plugin: result().plugin.manifest.plugin.display_name },
                  )}</div>
                  <div class="mt-1 text-sm text-muted-foreground">{result().plugin.publisher_id} · v{result().plugin.version}</div>
                </div>
              </div>
              <PostInstallFacts
                operation={reviewOperation()}
                updateEligibility={result().update_eligibility.state}
                committedEnableState={result().plugin.enable_state}
              />
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

function InstallProgress(props: { stage: InstallStage; operation: ExternalReviewOperation }): JSX.Element {
  const i18n = useI18n();
  const activeIndex = () => ({ source: 0, review: 1, committing: 2, complete: 3 })[props.stage];
  const steps = () => [
    i18n.t('uiCopy.plugin.external.source'),
    i18n.t('uiCopy.plugin.external.inspect'),
    reviewOperationActionLabel(props.operation, i18n),
    i18n.t('common.status.ready'),
  ];
  return (
    <div data-install-progress class="overflow-hidden border-b pb-4 pt-1">
      <span class="sr-only">
        {i18n.t('uiCopy.plugin.external.stepProgress', { current: activeIndex() + 1, total: steps().length })}
      </span>
      <div class="relative">
        <div aria-hidden="true" data-install-progress-track class="absolute left-[12.5%] right-[12.5%] top-[9px] h-px bg-border">
          <div
            data-install-progress-track-active
            class="h-full bg-primary/50 transition-[width] duration-200 motion-reduce:transition-none"
            style={`width: ${activeIndex() / (steps().length - 1) * 100}%`}
          />
        </div>
        <ol
          class="relative grid gap-0"
          style={`grid-template-columns: repeat(${steps().length}, 1fr)`}
          aria-label={i18n.t('uiCopy.plugin.external.dialogDescription')}
        >
          <For each={steps()}>
            {(label, index) => {
              const complete = () => index() < activeIndex();
              const active = () => index() === activeIndex();
              return (
                <li
                  data-install-progress-segment
                  class="relative flex min-w-0 flex-col items-center gap-1.5"
                  aria-current={active() ? 'step' : undefined}
                >
                  <div
                    data-install-progress-node
                    class={cn(
                      'relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none',
                      complete()
                        ? 'scale-105 border-[var(--success,var(--primary))] bg-[var(--success,var(--primary))] text-[var(--success-foreground,var(--primary-foreground))] shadow-sm'
                        : active()
                          ? 'scale-110 border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-background text-muted-foreground',
                    )}
                  >
                    {complete() ? '✓' : index() + 1}
                  </div>
                  <span
                    data-install-progress-current={active() ? 'true' : undefined}
                    class={cn(
                      'max-w-full truncate px-1 text-center text-[10px] font-medium leading-tight transition-colors duration-200 motion-reduce:transition-none',
                      active() ? 'text-foreground' : complete() ? 'text-muted-foreground' : 'text-muted-foreground/60',
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            }}
          </For>
        </ol>
      </div>
    </div>
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
                'flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1 rounded px-1 py-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-2 sm:py-0 motion-reduce:transition-none',
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
        <label class="redeven-plugin-enter-up block space-y-1.5 text-sm font-medium animate-in fade-in duration-200 motion-reduce:animate-none">
          <span>{props.sourceKind === 'github_repository' ? i18n.t('uiCopy.plugin.external.repositoryURL') : i18n.t('uiCopy.plugin.external.packageURL')}</span>
          <input
            data-external-plugin-source-input
            type="url"
            value={props.url}
            disabled={props.pending}
            placeholder={props.sourceKind === 'github_repository'
              ? i18n.t('uiCopy.plugin.external.repositoryURLPlaceholder')
              : i18n.t('uiCopy.plugin.external.packageURLPlaceholder')}
            aria-invalid={validationVisible() && !validation().valid ? 'true' : undefined}
            aria-describedby={validationVisible() && !validation().valid ? 'external-plugin-source-error' : undefined}
            class={cn(
              'h-[46px] w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-10 motion-reduce:transition-none',
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
        <label class="redeven-plugin-enter-up block space-y-1.5 text-sm font-medium animate-in fade-in duration-200 motion-reduce:animate-none">
          <span>{i18n.t('uiCopy.plugin.external.releaseTag')}</span>
          <input
            type="text"
            value={props.tag}
            disabled={props.pending}
            placeholder={i18n.t('uiCopy.plugin.external.latestRelease')}
            class="h-[46px] w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-10 motion-reduce:transition-none"
            onInput={(event) => props.onTag(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={props.sourceKind === 'package_upload'}>
        <div class="redeven-plugin-enter-up space-y-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          <input
            ref={fileInput}
            data-external-plugin-source-input
            id="external-plugin-package-file"
            type="file"
            accept=".redevplugin,application/vnd.redevplugin.package+zip,application/zip"
            disabled={props.pending}
            class="peer sr-only"
            onChange={(event) => props.onFile(event.currentTarget.files?.[0] ?? null)}
          />
          <label
            for="external-plugin-package-file"
            class="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background px-4 py-5 text-center transition-colors duration-150 hover:border-primary hover:bg-muted peer-focus-visible:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/20 motion-reduce:transition-none"
          >
            <Upload class="h-5 w-5 text-muted-foreground" />
            <span class="text-sm font-medium">{i18n.t('uiCopy.plugin.external.packageFile')}</span>
            <span class="text-xs text-muted-foreground">{i18n.t('common.actions.open')}</span>
          </label>
          <Show when={props.file}>
            {(selectedFile) => (
              <div data-external-plugin-selected-file class="redeven-plugin-enter-up flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 animate-in fade-in duration-200 motion-reduce:animate-none">
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
  displayName?: string;
  previousVersion?: string;
  previousSummary?: PluginExternalPackageSecuritySummary;
  operation: ExternalReviewOperation;
  focusTargetRef?: (element: HTMLElement) => void;
}): JSX.Element {
  const i18n = useI18n();
  const summary = () => props.inspection.security_summary;
  const signature = () => props.inspection.signature_assessment.state;
  const blocked = () => inspectionBlocked(props.inspection);
  const declarations = createMemo(() => securityDeclarations(summary(), props.previousSummary));
  const changes = createMemo(() => declarations().filter((declaration) => Boolean(declaration.change)));
  const accessChanged = () => changes().length > 0;
  const highlights = createMemo(() => declarations().filter((declaration) => (
    declaration.change !== 'removed' && securityDeclarationIsSensitive(declaration)
  )));
  const currentDeclarations = createMemo(() => declarations().filter((declaration) => declaration.change !== 'removed'));
  const standardChanges = createMemo(() => securityCategoryOrder.flatMap((category) => (
    (['added', 'changed'] as const).flatMap((change) => {
      const count = changes().filter((declaration) => (
        declaration.category === category
        && declaration.category !== 'methods'
        && declaration.change === change
        && !securityDeclarationIsSensitive(declaration)
      )).length;
      return count > 0 ? [{ category, change, count }] : [];
    })
  )));
  const hiddenStandardDeclarationCount = createMemo(() => currentDeclarations()
    .filter((declaration) => (
      !securityDeclarationIsSensitive(declaration)
      && declaration.category !== 'permissions'
      && declaration.category !== 'methods'
      && declaration.change !== 'added'
      && declaration.change !== 'changed'
    )).length);
  const reportCategories = createMemo(() => securityCategoryOrder.filter((category) => (
    declarations().some((declaration) => declaration.category === category)
  )));
  const tone = () => blocked() ? 'blocked' : signature() === 'verified' ? 'positive' : 'caution';
  const decisionTitle = () => trustDecisionTitle(props.inspection, i18n);
  const decisionGuidance = () => trustDecisionGuidance(props.inspection, i18n);
  const sourceSummary = () => {
    const provenance = props.inspection.source_provenance;
    if (provenance.kind === 'package_url') return provenance.source_origin;
    if (provenance.kind === 'github_repository') return provenance.repository_url;
    return i18n.t('uiCopy.plugin.external.packageFile');
  };
  return (
    <div class="redeven-plugin-enter-up space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
      <div data-external-plugin-identity class="flex items-start gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-muted/30"><Package class="h-5 w-5" /></div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-base font-semibold">{props.displayName ?? props.inspection.plugin_id}</div>
          <Show when={props.displayName && props.displayName !== props.inspection.plugin_id}>
            <div class="mt-0.5 truncate text-xs text-muted-foreground">{props.inspection.plugin_id}</div>
          </Show>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{props.inspection.publisher_id}</span>
            <span aria-hidden="true">·</span>
            <VersionReview
              operation={props.operation}
              previousVersion={props.previousVersion}
              inspectedVersion={props.inspection.version}
            />
          </div>
          <code class="mt-1 block max-w-full truncate text-[11px] text-muted-foreground">{sourceSummary()}</code>
        </div>
      </div>
      <section
        ref={props.focusTargetRef}
        tabIndex={-1}
        data-external-plugin-trust-review
        role={blocked() ? 'alert' : undefined}
        class={cn(
          'rounded-md border px-4 py-3.5 outline-none',
          tone() === 'blocked' && 'border-destructive bg-destructive/5',
          tone() === 'caution' && 'border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)]',
          tone() === 'positive' && 'border-[var(--redeven-status-success-foreground)] bg-[var(--redeven-status-success-soft)]',
        )}
      >
        <div class="flex items-start gap-3">
          <span class={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background',
            tone() === 'blocked' && 'border-destructive text-destructive',
            tone() === 'caution' && 'border-[var(--redeven-status-warning-foreground)] text-[var(--redeven-status-warning-foreground)]',
            tone() === 'positive' && 'border-[var(--redeven-status-success-foreground)] text-[var(--redeven-status-success-foreground)]',
          )}>
            {blocked() ? <AlertTriangle class="h-4 w-4" /> : tone() === 'positive' ? <Check class="h-4 w-4" /> : <Shield class="h-4 w-4" />}
          </span>
          <div class="min-w-0 flex-1">
            <h2
              data-external-plugin-review-heading
              class="text-sm font-semibold"
            >
              {decisionTitle()}
            </h2>
            <div class="mt-1 text-sm leading-6 text-muted-foreground">{decisionGuidance()}</div>
          </div>
        </div>
      </section>
      <PostInstallFacts operation={props.operation} updateEligibility={props.inspection.update_eligibility.state} />
      <InspectionHighlights
        permissions={currentDeclarations().filter((declaration) => declaration.category === 'permissions')}
        methods={summary().methods}
        changes={changes()}
        highlights={highlights()}
        standardChanges={standardChanges()}
        currentDeclarationCount={currentDeclarations().length}
        hiddenStandardDeclarationCount={hiddenStandardDeclarationCount()}
        hasPreviousSummary={Boolean(props.previousSummary)}
        showAccessChanged={Boolean(props.previousSummary && accessChanged())}
      />
      <InspectionReport
        inspection={props.inspection}
        operation={props.operation}
        declarations={declarations()}
        changes={changes()}
        categories={reportCategories()}
      />
    </div>
  );
}

function InspectionHighlights(props: {
  permissions: readonly SecurityDeclaration[];
  methods: PluginExternalPackageSecuritySummary['methods'];
  changes: readonly SecurityDeclaration[];
  highlights: readonly SecurityDeclaration[];
  standardChanges: readonly StandardChangeSummary[];
  currentDeclarationCount: number;
  hiddenStandardDeclarationCount: number;
  hasPreviousSummary: boolean;
  showAccessChanged: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const operationGroups = createMemo(() => operationImpactGroups(props.methods));
  const otherHighlights = createMemo(() => props.highlights.filter((declaration) => declaration.category !== 'methods'));
  const dangerousMethodCount = createMemo(() => props.methods.filter((method) => method.dangerous).length);
  return (
    <section data-external-plugin-review-highlights data-external-plugin-access-review class="space-y-3 border-t pt-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.external.requestedAccessTitle')}</h3>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.external.requestedAccessGuidance')}</p>
        </div>
        <Show when={props.changes.length > 0}>
          <span class="rounded-full bg-[var(--redeven-status-warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--redeven-status-warning-foreground)]">
            {i18n.tn('uiCopy.plugin.external.reportChanges', props.changes.length)}
          </span>
        </Show>
      </div>
      <Show when={props.showAccessChanged} fallback={(
        <Show when={props.hasPreviousSummary && props.currentDeclarationCount > 0 && props.changes.length === 0}>
          <p class="text-sm leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.external.accessUnchanged')}</p>
        </Show>
      )}>
        <p class="text-sm leading-5 text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.external.accessChanged')}</p>
      </Show>

      <div data-external-plugin-access-summary class="grid gap-2 sm:grid-cols-2">
        <Show when={props.permissions.length > 0}>
          <div data-external-plugin-requested-permissions class="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:bg-muted/20 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none">
            <Shield class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 text-sm font-medium">{i18n.t('uiCopy.plugin.external.requestedPermissions')}</span>
            <span class="shrink-0 text-xs font-semibold tabular-nums">{props.permissions.length}</span>
          </div>
        </Show>
        <div data-external-plugin-declared-operations class="contents">
          <For each={operationGroups()}>
            {(group, index) => (
              <div class={cn(
                'redeven-plugin-enter-up flex min-w-0 items-center gap-2 rounded-md border px-3 py-2.5 animate-in fade-in duration-200 ease-out transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:bg-muted/20 hover:shadow-sm motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none',
                (group.dangerousCount > 0 || group.effect === 'delete' || group.effect === 'admin' || group.effect === 'other')
                  && 'border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)]',
              )} style={`animation-delay: ${index() * 20}ms`}>
                <span class="min-w-0 flex-1 text-sm font-medium">{operationEffectLabel(group.effect, i18n)}</span>
                <Show when={group.preflightOnlyCount > 0}>
                  <span class="text-[10px] text-muted-foreground">
                    {i18n.tn('uiCopy.plugin.external.preflightOnlyOperations', group.preflightOnlyCount)}
                  </span>
                </Show>
                <span class="shrink-0 text-xs font-semibold tabular-nums">{group.count}</span>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={props.currentDeclarationCount === 0}>
        <p class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.external.noDeclaredAccess')}</p>
      </Show>
      <Show when={dangerousMethodCount() > 0}>
        <p class="text-xs font-medium text-[var(--redeven-status-warning-foreground)]">
          {i18n.tn('uiCopy.plugin.external.dangerousOperations', dangerousMethodCount())}
        </p>
      </Show>

      <Show when={otherHighlights().length > 0}>
        <div data-external-plugin-other-attention>
          <h4 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.otherDeclaredAccess')}</h4>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <For each={otherHighlights()}>
              {(declaration) => (
                <div class="min-w-0 rounded-md border px-3 py-2.5">
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">{securityCategoryLabel(declaration.category, i18n)}</span>
                    <Show when={declaration.change}>{(change) => <ChangeBadge change={change()} />}</Show>
                  </div>
                  <div class="mt-1 text-sm font-medium">{humanizeTechnicalIdentifier(declaration.identity)}</div>
                  <Show when={securityDeclarationHighlight(declaration)}>
                    {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground">{fact()}</code>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={props.standardChanges.length > 0}>
        <div data-external-plugin-standard-changes class="grid gap-1.5 sm:grid-cols-2">
          <For each={props.standardChanges}>
            {(summary) => (
              <div class="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-medium">{securityCategoryLabel(summary.category, i18n)}</span>
                <span class="shrink-0 font-semibold tabular-nums">{summary.count}</span>
                <ChangeBadge change={summary.change} />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.hiddenStandardDeclarationCount > 0}>
        <p class="text-xs text-muted-foreground">
          {i18n.tn('uiCopy.plugin.external.additionalDeclarations', props.hiddenStandardDeclarationCount)}
        </p>
      </Show>
    </section>
  );
}

function InspectionReport(props: {
  inspection: ExternalPluginInspection;
  operation: ExternalReviewOperation;
  declarations: readonly SecurityDeclaration[];
  changes: readonly SecurityDeclaration[];
  categories: readonly SecurityCategory[];
}): JSX.Element {
  const i18n = useI18n();
  return (
    <details data-external-plugin-report class="group border-t pt-1">
      <summary class="flex min-h-[44px] cursor-pointer list-none items-center gap-3 rounded-md px-1 text-sm font-semibold transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        <span class="min-w-0 flex-1">{i18n.t('uiCopy.plugin.external.fullInspectionReport')}</span>
        <Show when={props.changes.length > 0}>
          <span class="shrink-0 text-xs font-medium text-[var(--redeven-status-warning-foreground)]">
            {i18n.tn('uiCopy.plugin.external.reportChanges', props.changes.length)}
          </span>
        </Show>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div class="redeven-plugin-disclosure-content space-y-5 pb-1 pt-3">
        <section class="space-y-3" data-external-plugin-report-trust>
          <h3 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.trust')}</h3>
          <ReportFact
            primary={signatureReviewLabel(props.inspection.signature_assessment.state, i18n)}
            technical={[
              `signature=${props.inspection.signature_assessment.state}`,
              ...(props.inspection.signature_assessment.algorithm !== undefined
                ? [`algorithm=${props.inspection.signature_assessment.algorithm}`]
                : []),
              ...(props.inspection.signature_assessment.key_id !== undefined
                ? [`key_id=${props.inspection.signature_assessment.key_id}`]
                : []),
              `assessed_at=${props.inspection.signature_assessment.assessed_at}`,
              ...(props.inspection.signature_assessment.assessment_epoch !== undefined
                ? [`assessment_epoch=${props.inspection.signature_assessment.assessment_epoch}`]
                : []),
              `assessed_package_sha256=${props.inspection.signature_assessment.assessed_hashes.package_sha256}`,
              `assessed_manifest_sha256=${props.inspection.signature_assessment.assessed_hashes.manifest_sha256}`,
              `assessed_entries_sha256=${props.inspection.signature_assessment.assessed_hashes.entries_sha256}`,
              ...props.inspection.signature_assessment.reason_codes,
            ]}
          />
          <ReportFact
            primary={executionApprovalReviewLabel(props.inspection.execution_approval.state, i18n)}
            technical={[
              `execution_approval=${props.inspection.execution_approval.state}`,
              `assessed_at=${props.inspection.execution_approval.assessed_at}`,
              ...(props.inspection.execution_approval.approved_at !== undefined
                ? [`approved_at=${props.inspection.execution_approval.approved_at}`]
                : []),
              ...props.inspection.execution_approval.reason_codes,
            ]}
          />
          <ReportFact
            primary={props.inspection.update_eligibility.state === 'automatic_eligible'
              ? i18n.t('uiCopy.plugin.external.automaticUpdates')
              : i18n.t('uiCopy.plugin.external.manualUpdates')}
            technical={[
              `update_eligibility=${props.inspection.update_eligibility.state}`,
              `assessed_at=${props.inspection.update_eligibility.assessed_at}`,
              ...props.inspection.update_eligibility.reason_codes,
            ]}
          />
        </section>

        <section class="space-y-3 border-t pt-4" data-external-plugin-report-source>
          <h3 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.sourceAndIdentity')}</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <AuditFact label={i18n.t('uiCopy.plugin.external.inspectionID')} value={props.inspection.inspection_id} />
            <AuditFact label={i18n.t('uiCopy.plugin.external.expiresAt')} value={props.inspection.expires_at} />
            <AuditFact label={i18n.t('uiCopy.plugin.external.intent')} value={fields(props.inspection.intent)} />
            <AuditFact label={i18n.t('uiCopy.plugin.publisher')} value={props.inspection.publisher_id} />
          </div>
          <SourceProvenanceReview provenance={props.inspection.source_provenance} />
        </section>

        <section class="space-y-3 border-t pt-4" data-external-plugin-security-declarations>
          <div>
            <h3 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.declaredAccess')}</h3>
            <p class="mt-1 text-sm leading-6 text-muted-foreground">
              {i18n.t(props.operation === 'install'
                ? 'uiCopy.plugin.external.declaredAccessGuidance'
                : 'uiCopy.plugin.external.declaredAccessUpdateGuidance')}
            </p>
          </div>
          <Show when={props.categories.length > 0} fallback={<p class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.external.noDeclaredAccess')}</p>}>
            <For each={props.categories}>
              {(category) => {
                const rows = () => props.declarations.filter((declaration) => declaration.category === category);
                const changed = () => rows().some((declaration) => declaration.change === 'added' || declaration.change === 'changed');
                return (
                  <details open={changed()} class="group/category border-b last:border-b-0">
                    <summary class="flex min-h-[44px] cursor-pointer list-none items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm font-medium">{securityCategoryLabel(category, i18n)} · {rows().length}</span>
                        <span class="mt-0.5 block text-xs leading-5 text-muted-foreground">{securityCategoryPurpose(category, i18n)}</span>
                      </span>
                      <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/category:rotate-180 motion-reduce:transition-none" />
                    </summary>
                    <div class="divide-y border-t">
                      <For each={rows()}>
                        {(declaration) => (
                          <div class="py-3">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="min-w-0 flex-1 text-xs font-semibold">{humanizeTechnicalIdentifier(declaration.identity)}</span>
                              <Show when={declaration.change}>
                                {(change) => <ChangeBadge change={change()} />}
                              </Show>
                            </div>
                            <code class="mt-1 block break-all text-[11px] text-foreground">{declaration.identity}</code>
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
                        )}
                      </For>
                    </div>
                  </details>
                );
              }}
            </For>
          </Show>
        </section>

        <section data-external-plugin-hashes class="space-y-3 border-t pt-4">
          <h3 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.integrity')}</h3>
          <AuditFact label={i18n.t('uiCopy.plugin.external.packageHash')} value={props.inspection.inspected_hashes.package_sha256} />
          <AuditFact label={i18n.t('uiCopy.plugin.external.manifestHash')} value={props.inspection.inspected_hashes.manifest_sha256} />
          <AuditFact label={i18n.t('uiCopy.plugin.external.entriesHash')} value={props.inspection.inspected_hashes.entries_sha256} />
          <AuditFact label={i18n.t('uiCopy.plugin.external.securitySummaryHash')} value={props.inspection.security_summary.summary_sha256} />
        </section>
      </div>
    </details>
  );
}

function InspectionConfirmation(props: {
  operation: ExternalReviewOperation;
  checked: boolean;
  onChecked: (checked: boolean) => void;
}): JSX.Element {
  const i18n = useI18n();
  const update = () => props.operation !== 'install';
  return (
    <div data-external-plugin-confirmation-region class="min-w-0 flex-1">
      <label
        data-external-plugin-confirmation
        class={cn(
          PLUGIN_MOBILE_TOUCH_TARGET_CLASS,
          'group flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 transition-[background-color,transform] duration-150 hover:bg-muted/30 active:scale-[0.995] focus-within:ring-2 focus-within:ring-primary/20 motion-reduce:transform-none motion-reduce:transition-none sm:max-w-[30rem]',
          props.checked && 'bg-primary/5',
        )}
      >
        <input
          type="checkbox"
          checked={props.checked}
          class="mt-0.5 h-4 w-4 shrink-0 rounded border"
          onChange={(event) => props.onChecked(event.currentTarget.checked)}
        />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold">{reviewOperationConfirmationTitle(props.operation, i18n)}</span>
          <span class="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {i18n.t(update()
              ? 'uiCopy.plugin.external.confirmUpdateGuidance'
              : 'uiCopy.plugin.external.confirmInstallGuidance')}
          </span>
        </span>
      </label>
    </div>
  );
}

function VersionReview(props: {
  operation: ExternalReviewOperation;
  previousVersion?: string;
  inspectedVersion: string;
}): JSX.Element {
  const i18n = useI18n();
  if (!props.previousVersion) return <>v{props.inspectedVersion}</>;
  if (props.operation === 'update') return <>{i18n.t('uiCopy.plugin.external.versionChange', {
    previous: props.previousVersion,
    next: props.inspectedVersion,
  })}</>;
  const label = () => {
    switch (props.operation) {
      case 'reinstall': return i18n.t('uiCopy.plugin.external.samePackageInstalled', { version: props.inspectedVersion });
      case 'replace': return i18n.t('uiCopy.plugin.external.sameVersionDifferentPackage', { version: props.inspectedVersion });
      case 'install_checked': return i18n.t('uiCopy.plugin.external.sameVersionUnknownPackage', { version: props.inspectedVersion });
      default: return `v${props.inspectedVersion}`;
    }
  };
  return (
    <span class={cn(
      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium',
      props.operation === 'reinstall' && 'border-[var(--redeven-status-success-foreground)] text-[var(--redeven-status-success-foreground)]',
      (props.operation === 'replace' || props.operation === 'install_checked')
        && 'border-[var(--redeven-status-warning-foreground)] text-[var(--redeven-status-warning-foreground)]',
    )}>
      {props.operation === 'reinstall' ? <CheckCircle class="h-3 w-3" /> : <AlertTriangle class="h-3 w-3" />}
      {label()}
    </span>
  );
}

function ChangeBadge(props: { change: NonNullable<SecurityDeclaration['change']> }): JSX.Element {
  const i18n = useI18n();
  return (
    <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase">
      {i18n.t(`uiCopy.plugin.external.${props.change}`)}
    </span>
  );
}

function ReportFact(props: { primary: string; technical: readonly string[] }): JSX.Element {
  return (
    <div class="border-l-2 border-border pl-3">
      <div class="text-sm font-medium">{props.primary}</div>
      <For each={props.technical}>
        {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground">{fact}</code>}
      </For>
    </div>
  );
}

function AuditFact(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="min-w-0">
      <div class="text-xs font-medium text-muted-foreground">{props.label}</div>
      <code class="mt-1 block break-all text-[11px] text-foreground">{props.value}</code>
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

function PostInstallFacts(props: {
  operation: ExternalReviewOperation;
  updateEligibility: ExternalPluginInspection['update_eligibility']['state'];
  committedEnableState?: ExternalPluginCommitResult['plugin']['enable_state'];
}): JSX.Element {
  const i18n = useI18n();
  const update = () => props.operation !== 'install';
  const lifecycle = () => {
    if (props.committedEnableState === 'enabled') return i18n.t('uiCopy.plugin.enabled');
    if (props.committedEnableState === 'disabled_by_user') return i18n.t('uiCopy.plugin.disabled');
    return update() ? i18n.t('uiCopy.plugin.external.currentStateRetained') : i18n.t('uiCopy.plugin.enabled');
  };
  return (
    <dl class="grid grid-cols-2 gap-3 border-y bg-muted/10 px-1 py-3 sm:grid-cols-3 sm:gap-0 sm:divide-x" data-external-plugin-install-outcome>
      <div class="min-w-0 sm:px-3 sm:first:pl-0">
        <dt class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.lifecycle')}</dt>
        <dd class="mt-0.5 text-sm font-medium">{lifecycle()}</dd>
      </div>
      <div class="min-w-0 sm:px-3">
        <dt class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.permissions')}</dt>
        <dd class="mt-0.5 text-sm font-medium">
          {update()
            ? i18n.t('uiCopy.plugin.external.noNewPermissionGrants')
            : props.committedEnableState === 'disabled_by_user'
              ? i18n.t('uiCopy.plugin.permissionNotGranted')
              : i18n.t('uiCopy.plugin.permissionGranted')}
        </dd>
      </div>
      <div class="col-span-2 min-w-0 border-t pt-3 sm:col-span-1 sm:border-t-0 sm:px-3 sm:pt-0 sm:last:pr-0">
        <dt class="text-[10px] font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.updateMode')}</dt>
        <dd class="mt-0.5 text-sm font-medium">
          {props.updateEligibility === 'automatic_eligible'
            ? i18n.t('uiCopy.plugin.external.automaticUpdates')
            : i18n.t('uiCopy.plugin.external.manualUpdates')}
        </dd>
      </div>
    </dl>
  );
}

function CommitProgress(props: { inspection: ExternalPluginInspection | null; operation: ExternalReviewOperation }): JSX.Element {
  const i18n = useI18n();
  return (
    <div role="status" class="space-y-4 rounded-md border bg-background p-5 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
      <div class="flex items-center gap-3">
        <Loader2 class="h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <div>
          <div class="font-semibold">{reviewOperationProgressLabel(props.operation, i18n)}</div>
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
        `package_sha256=${provenance.package_sha256}`,
        `resolved_at=${provenance.resolved_at}`,
      ];
    }
    if (provenance.kind === 'github_repository') {
      return [
        provenance.repository_url,
        `repository_id=${provenance.repository_id}`,
        `release_id=${provenance.release_id}`,
        `asset_id=${provenance.asset_id}`,
        `owner=${provenance.owner}; repository=${provenance.repository}`,
        `release_tag=${provenance.release_tag ?? '-'}`,
        `asset_name=${provenance.asset_name ?? '-'}`,
        `resolved_commit_sha=${provenance.resolved_commit_sha}`,
        `package_sha256=${provenance.package_sha256}`,
        `resolved_at=${provenance.resolved_at}`,
      ];
    }
    return [
      `upload_id=${provenance.upload_id}`,
      `package_sha256=${provenance.package_sha256}`,
      `resolved_at=${provenance.resolved_at}`,
    ];
  };
  return (
    <div data-external-plugin-source-provenance>
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

function humanizeTechnicalIdentifier(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._:/@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return value;
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}

function operationEffectLabel(effect: OperationEffectGroup, i18n: ReturnType<typeof useI18n>): string {
  const keys: Record<OperationEffectGroup, Parameters<typeof i18n.t>[0]> = {
    read: 'uiCopy.plugin.external.operationRead',
    write: 'uiCopy.plugin.external.operationWrite',
    execute: 'uiCopy.plugin.external.operationExecute',
    delete: 'uiCopy.plugin.external.operationDelete',
    admin: 'uiCopy.plugin.external.operationAdmin',
    other: 'uiCopy.plugin.external.operationOther',
  };
  return i18n.t(keys[effect]);
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

function fields(value: object): string {
  return Object.entries(value).map(([key, field]) => (
    `${key}=${Array.isArray(field) ? list(field.map(String)) : String(field)}`
  )).join('; ');
}

function resolveReviewOperation(
  inspection: ExternalPluginInspection | null,
  updateItem?: PluginInventoryItem,
): ExternalReviewOperation {
  if (!updateItem?.pluginInstanceID) return 'install';
  if (!inspection || updateItem.version !== inspection.version) return 'update';
  const previousHash = updateItem.externalPackage?.sourceProvenance.package_sha256;
  if (!previousHash) return 'install_checked';
  return previousHash === inspection.inspected_hashes.package_sha256 ? 'reinstall' : 'replace';
}

function reviewOperationActionLabel(
  operation: ExternalReviewOperation,
  i18n: ReturnType<typeof useI18n>,
): string {
  switch (operation) {
    case 'install': return i18n.t('uiCopy.plugin.external.confirmInstall');
    case 'update': return i18n.t('uiCopy.plugin.external.confirmUpdate');
    case 'reinstall': return i18n.t('uiCopy.plugin.external.confirmReinstall');
    case 'replace': return i18n.t('uiCopy.plugin.external.confirmReplace');
    case 'install_checked': return i18n.t('uiCopy.plugin.external.confirmInstallChecked');
  }
}

function reviewOperationConfirmationTitle(
  operation: ExternalReviewOperation,
  i18n: ReturnType<typeof useI18n>,
): string {
  switch (operation) {
    case 'install': return i18n.t('uiCopy.plugin.external.confirmInstallTitle');
    case 'update': return i18n.t('uiCopy.plugin.external.confirmUpdateTitle');
    case 'reinstall': return i18n.t('uiCopy.plugin.external.confirmReinstallTitle');
    case 'replace': return i18n.t('uiCopy.plugin.external.confirmReplaceTitle');
    case 'install_checked': return i18n.t('uiCopy.plugin.external.confirmInstallCheckedTitle');
  }
}

function reviewOperationProgressLabel(
  operation: ExternalReviewOperation,
  i18n: ReturnType<typeof useI18n>,
): string {
  switch (operation) {
    case 'install': return i18n.t('uiCopy.plugin.external.committing');
    case 'update': return i18n.t('uiCopy.plugin.external.updating');
    case 'reinstall': return i18n.t('uiCopy.plugin.external.reinstalling');
    case 'replace': return i18n.t('uiCopy.plugin.external.replacing');
    case 'install_checked': return i18n.t('uiCopy.plugin.external.installingChecked');
  }
}

function reviewOperationCompletionKey(
  operation: ExternalReviewOperation,
): Parameters<ReturnType<typeof useI18n>['t']>[0] {
  switch (operation) {
    case 'install': return 'uiCopy.plugin.external.complete';
    case 'update': return 'uiCopy.plugin.external.updateComplete';
    case 'reinstall': return 'uiCopy.plugin.external.reinstallComplete';
    case 'replace': return 'uiCopy.plugin.external.replaceComplete';
    case 'install_checked': return 'uiCopy.plugin.external.installCheckedComplete';
  }
}

function trustDecisionTitle(
  inspection: ExternalPluginInspection,
  i18n: ReturnType<typeof useI18n>,
): string {
  if (inspection.execution_approval.state === 'policy_blocked') return i18n.t('uiCopy.plugin.external.reviewPolicyBlocked');
  if (inspection.signature_assessment.state === 'invalid' || inspection.signature_assessment.state === 'revoked') {
    return i18n.t('uiCopy.plugin.external.reviewBlocked');
  }
  return inspection.signature_assessment.state === 'verified'
    ? i18n.t('uiCopy.plugin.external.reviewIdentityVerified')
    : i18n.t('uiCopy.plugin.external.reviewSourceConfirmation');
}

function trustDecisionGuidance(
  inspection: ExternalPluginInspection,
  i18n: ReturnType<typeof useI18n>,
): string {
  if (inspection.execution_approval.state === 'policy_blocked') return i18n.t('uiCopy.plugin.external.policyBlockedGuidance');
  switch (inspection.signature_assessment.state) {
    case 'verified': return i18n.t('uiCopy.plugin.external.signatureVerifiedGuidance');
    case 'absent': return i18n.t('uiCopy.plugin.external.signatureAbsentGuidance');
    case 'unknown_signer': return i18n.t('uiCopy.plugin.external.signatureUnknownGuidance');
    case 'unavailable': return i18n.t('uiCopy.plugin.external.signatureUnavailableGuidance');
    case 'invalid': return i18n.t('uiCopy.plugin.external.signatureInvalidGuidance');
    case 'revoked': return i18n.t('uiCopy.plugin.external.signatureRevokedGuidance');
    default: return i18n.t('uiCopy.plugin.external.signatureUnavailableGuidance');
  }
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
