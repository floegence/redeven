import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, ChevronDown, Loader2, Shield } from '@floegence/floe-webapp-core/icons';
import { pluginMutationOutcome } from '@floegence/redevplugin-ui';

import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS, PLUGIN_PRESS_MOTION_CLASS } from './pluginPresentation';
import { PluginIdentityHeader } from './PluginPresentationPrimitives';
import {
  candidateMatchesInventory,
  candidateTargetIsCurrent,
  createDevelopmentUpdateCandidate,
  createExternalUpdateCandidate,
} from './pluginUpdateProjection';
import { samePackageIdentity } from './pluginReleaseNotes';
import { securityDeclarations } from './externalPluginSecurityProjection';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  ExternalPluginSourceKind,
  ExternalPluginSourcePreset,
  PluginInventoryItem,
  PluginUpdateCandidate,
} from './pluginTypes';

type UpdateStage = 'source_required' | 'loading_review' | 'review' | 'committing' | 'reconciling' | 'complete';

export type PluginUpdateReviewDialogProps = {
  open: boolean;
  item?: PluginInventoryItem;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onInspect: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommitExternal: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onCommitDevelopment: (candidate: PluginUpdateCandidate, signal: AbortSignal) => Promise<unknown>;
  onRefresh: () => Promise<unknown> | unknown;
  onCommitted: () => void;
  onOpenActivity: () => void;
  onViewPermissions: () => void;
};

export function PluginUpdateReviewDialog(props: PluginUpdateReviewDialogProps): JSX.Element {
  const i18n = useI18n();
  const [stage, setStage] = createSignal<UpdateStage>('loading_review');
  const [candidate, setCandidate] = createSignal<PluginUpdateCandidate>();
  const [error, setError] = createSignal<string>();
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  const [confirmedRisk, setConfirmedRisk] = createSignal(false);
  const [sourceKind, setSourceKind] = createSignal<ExternalPluginSourceKind>('package_url');
  const [url, setURL] = createSignal('');
  const [tag, setTag] = createSignal('');
  const [file, setFile] = createSignal<File>();
  let operation: AbortController | undefined;
  let initializedInventoryKey: string | undefined;
  let completionReported = false;

  const pending = () => stage() === 'loading_review' || stage() === 'committing' || stage() === 'reconciling';
  const sourcePreset = (): ExternalPluginSourcePreset | undefined => props.item?.officialCatalog?.distribution.installSource;
  const needsRiskConfirmation = createMemo(() => {
    const current = candidate();
    if (!current) return false;
    if (current.kind === 'replace' || current.reviewEvidence.kind === 'development_delivery') return true;
    const inspection = current.reviewEvidence.inspection;
    const changes = securityDeclarations(inspection.security_summary, props.item?.externalPackage?.securitySummary);
    return inspection.signature_assessment.state !== 'verified'
      || changes.some((change) => change.change === 'added' || change.change === 'changed');
  });
  const canSubmit = createMemo(() => Boolean(candidate()
    && props.canManage
    && stage() === 'review'
    && candidate()!.kind !== 'noop'
    && candidate()!.kind !== 'blocked'
    && (!needsRiskConfirmation() || confirmedRisk())));
  const completedInventoryItem = createMemo(() => {
    const current = candidate();
    const item = props.item;
    if (stage() !== 'complete' || !current || !item?.installedPackage) return undefined;
    return samePackageIdentity(item.installedPackage, current.target) ? item : undefined;
  });
  const completedLaunchTarget = createMemo(() => completedInventoryItem()?.defaultLaunchTarget);

  createEffect(() => {
    if (!props.open) {
      initializedInventoryKey = undefined;
      return;
    }
    const item = props.item;
    if (!item || item.inventoryKey === initializedInventoryKey) return;
    initializedInventoryKey = item.inventoryKey;
    completionReported = false;
    operation?.abort('Update review target changed');
    setCandidate(undefined);
    setError(undefined);
    setRefreshFailed(false);
    setConfirmedRisk(false);
    const delivery = item.officialCatalog?.distribution.developmentDelivery;
    if (delivery) {
      setStage('loading_review');
      queueMicrotask(() => {
        try {
          setCandidate(createDevelopmentUpdateCandidate(item));
          setStage('review');
        } catch (caught) {
          setError(messageFromUnknown(caught));
          setStage('review');
        }
      });
      return;
    }
    const preset = item.officialCatalog?.distribution.installSource;
    if (preset) {
      setSourceKind(preset.sourceKind);
      setURL(preset.url);
      setTag(preset.sourceKind === 'github_repository' ? preset.tag ?? '' : '');
      void inspectPreset(item, preset);
      return;
    }
    const provenance = item.externalPackage?.sourceProvenance;
    setSourceKind(provenance?.kind === 'github_repository' ? 'github_repository' : 'package_url');
    setURL(provenance?.kind === 'github_repository' ? provenance.repository_url : '');
    setTag('');
    setFile(undefined);
    setStage('source_required');
  });

  onCleanup(() => operation?.abort('Update review disposed'));

  async function inspectPreset(item: PluginInventoryItem, preset: ExternalPluginSourcePreset) {
    const request: ExternalPluginInspectionRequest = preset.sourceKind === 'github_repository'
      ? { sourceKind: 'github_repository', url: preset.url, tag: preset.tag, intent: updateIntent(item) }
      : { sourceKind: 'package_url', url: preset.url, intent: updateIntent(item) };
    await inspectRequest(item, request);
  }

  async function inspectSource() {
    const item = props.item;
    if (!item) return;
    let request: ExternalPluginInspectionRequest | undefined;
    if (sourceKind() === 'package_upload' && file()) {
      request = { sourceKind: 'package_upload', file: file()!, intent: updateIntent(item) };
    } else if (sourceKind() === 'github_repository' && isHTTPSURL(url())) {
      request = { sourceKind: 'github_repository', url: url().trim(), tag: tag().trim() || undefined, intent: updateIntent(item) };
    } else if (sourceKind() === 'package_url' && isHTTPSURL(url())) {
      request = { sourceKind: 'package_url', url: url().trim(), intent: updateIntent(item) };
    }
    if (!request) {
      setError(i18n.t('uiCopy.plugin.external.sourceInvalid'));
      return;
    }
    await inspectRequest(item, request);
  }

  async function inspectRequest(item: PluginInventoryItem, request: ExternalPluginInspectionRequest) {
    const controller = new AbortController();
    operation?.abort('Update inspection superseded');
    operation = controller;
    setStage('loading_review');
    setError(undefined);
    try {
      const inspection = await props.onInspect(request, controller.signal);
      if (props.item?.inventoryKey !== item.inventoryKey || props.item.managementRevision !== item.managementRevision) {
        throw new Error(i18n.t('uiCopy.plugin.updateReview.stale'));
      }
      setCandidate(createExternalUpdateCandidate(item, inspection));
      setConfirmedRisk(false);
      setStage('review');
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(messageFromUnknown(caught));
        setStage(sourcePreset() ? 'review' : 'source_required');
      }
    } finally {
      if (operation === controller) operation = undefined;
    }
  }

  async function submit() {
    const current = candidate();
    if (!current || !canSubmit()) return;
    if (!candidateTargetIsCurrent(current, props.item)) {
      setError(i18n.t('uiCopy.plugin.updateReview.stale'));
      return;
    }
    const controller = new AbortController();
    operation = controller;
    setStage('committing');
    setError(undefined);
    try {
      if (current.reviewEvidence.kind === 'external_inspection') {
        await props.onCommitExternal(current.reviewEvidence.inspection, controller.signal);
      } else {
        await props.onCommitDevelopment(current, controller.signal);
      }
      setStage('reconciling');
      await refreshAfterCommit(current);
      completeUpdate();
    } catch (caught) {
      if (controller.signal.aborted) return;
      const outcome = pluginMutationOutcome(caught);
      if (outcome === 'not_committed') {
        setError(i18n.t('uiCopy.plugin.updateReview.failed'));
        setStage('review');
      } else {
        setError(i18n.t('uiCopy.plugin.updateReview.outcomeUnknown'));
        setStage('reconciling');
      }
    } finally {
      if (operation === controller) operation = undefined;
    }
  }

  async function refreshAfterCommit(current: PluginUpdateCandidate) {
    try {
      await props.onRefresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
      setError(i18n.t('uiCopy.plugin.updateReview.refreshFailed'));
    }
    // A successful mutation response is authoritative. Refresh failure is shown
    // separately and must not turn a completed update into a failed update.
    void current;
  }

  async function reconcile() {
    const current = candidate();
    if (!current || stage() !== 'reconciling') return;
    setError(undefined);
    try {
      await props.onRefresh();
      const item = props.item;
      if (item?.installedPackage && samePackageIdentity(item.installedPackage, current.target)) {
        completeUpdate();
      } else if (candidateMatchesInventory(current, item)) {
        setError(i18n.t('uiCopy.plugin.updateReview.outcomeUnknown'));
      } else {
        setError(i18n.t('uiCopy.plugin.updateReview.stale'));
        setStage('review');
      }
    } catch {
      setError(i18n.t('uiCopy.plugin.updateReview.outcomeUnknown'));
    }
  }

  function completeUpdate() {
    setStage('complete');
    if (completionReported) return;
    completionReported = true;
    props.onCommitted();
  }

  const close = () => {
    if (pending()) return;
    operation?.abort('Update review closed');
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={i18n.t('uiCopy.plugin.updateReview.title', { plugin: props.item?.displayName ?? '' })}
      description={i18n.t('uiCopy.plugin.updateReview.description')}
      class={cn(
        'h-dvh max-h-dvh w-screen max-w-none rounded-none bg-background text-foreground sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(47rem,calc(100vw-2rem))] sm:max-w-[47rem] sm:rounded-lg',
        pending() && '[&>div:first-child>button]:hidden',
      )}
      footer={(
        <div data-plugin-update-footer class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Show when={!props.canManage && stage() === 'review'}>
            <p class="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.readOnly')}</p>
          </Show>
          <Show when={needsRiskConfirmation() && stage() === 'review'}>
            <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-xs leading-5">
              <input type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-primary" checked={confirmedRisk()} onChange={(event) => setConfirmedRisk(event.currentTarget.checked)} />
              <span>{i18n.t('uiCopy.plugin.updateReview.riskConfirm')}</span>
            </label>
          </Show>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Show when={!pending()}>
              <button type="button" class={secondaryButtonClass} onClick={close}>
                {stage() === 'complete' ? i18n.t('uiCopy.plugin.updateReview.done') : i18n.t('common.actions.cancel')}
              </button>
            </Show>
            <Show when={stage() === 'source_required'}>
              <button data-plugin-update-inspect type="button" class={primaryButtonClass} onClick={() => void inspectSource()}>
                {i18n.t('uiCopy.plugin.updateReview.reviewPackage')}
              </button>
            </Show>
            <Show keyed when={stage() === 'review' && candidate()?.kind !== 'noop' && candidate()?.kind !== 'blocked' ? candidate() : undefined}>
              {(current) => (
                <button data-plugin-update-submit type="button" class={primaryButtonClass} disabled={!canSubmit()} onClick={() => void submit()}>
                  {submitLabel(current, i18n.t)}
                </button>
              )}
            </Show>
            <Show when={stage() === 'reconciling'}>
              <button data-plugin-update-reconcile type="button" class={primaryButtonClass} onClick={() => void reconcile()}>
                {i18n.t('uiCopy.plugin.updateReview.continueReconciliation')}
              </button>
            </Show>
            <Show when={stage() === 'complete' && completedLaunchTarget()}>
              <button data-plugin-update-open-activity type="button" class={primaryButtonClass} onClick={props.onOpenActivity}>
                {i18n.t('uiCopy.plugin.openInActivity')}
              </button>
            </Show>
            <Show when={stage() === 'complete' && completedInventoryItem() && !completedLaunchTarget()}>
              <button data-plugin-update-view-permissions type="button" class={primaryButtonClass} onClick={props.onViewPermissions}>
                {i18n.t('uiCopy.plugin.updateReview.viewPermissions')}
              </button>
            </Show>
          </div>
        </div>
      )}
    >
      <div data-plugin-update-dialog class="min-h-0 space-y-4 overflow-x-hidden">
        <Show when={error()}>
          {(message) => <div role="alert" class="flex gap-2 rounded-md border border-destructive px-3 py-2.5 text-sm text-destructive"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" /><span>{message()}</span></div>}
        </Show>
        <Show when={stage() === 'loading_review' || stage() === 'committing' || stage() === 'reconciling'}>
          <div role="status" class="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>{stage() === 'loading_review' ? i18n.t('uiCopy.plugin.updateReview.loading') : stage() === 'committing' ? i18n.t('uiCopy.plugin.updateReview.committing') : i18n.t('uiCopy.plugin.updateReview.reconciling')}</span>
          </div>
        </Show>
        <Show when={stage() === 'source_required'}><UpdateSourceForm kind={sourceKind()} url={url()} tag={tag()} onKind={setSourceKind} onURL={setURL} onTag={setTag} onFile={setFile} /></Show>
        <Show when={stage() === 'review' && candidate()}>{(current) => <UpdateReview candidate={current()} item={props.item!} />}</Show>
        <Show when={stage() === 'complete' && candidate()}>
          {(current) => <div role="status" data-plugin-update-complete class="space-y-4 py-3 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"><div class="flex items-start gap-3"><CheckCircle class="mt-0.5 h-6 w-6 shrink-0 text-[var(--redeven-status-success-foreground)]" /><div><h3 class="font-semibold">{i18n.t('uiCopy.plugin.updateReview.completeTitle', { plugin: current().displayName })}</h3></div></div><Show when={refreshFailed()}><p class="text-xs text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.refreshFailed')}</p></Show></div>}
        </Show>
      </div>
    </Dialog>
  );
}

function UpdateReview(props: { candidate: PluginUpdateCandidate; item: PluginInventoryItem }): JSX.Element {
  const i18n = useI18n();
  const notes = () => props.candidate.releaseNotes;
  const securityChanges = () => props.candidate.reviewEvidence.kind === 'external_inspection'
    ? securityDeclarations(
      props.candidate.reviewEvidence.inspection.security_summary,
      props.item.externalPackage?.securitySummary,
    ).filter((change) => change.change === 'added' || change.change === 'changed')
    : [];
  return <div class="space-y-5">
    <PluginIdentityHeader item={props.item} />
    <section class="border-y py-4"><p class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.versionChange')}</p><div class="mt-2 flex flex-wrap items-center gap-2 text-sm"><span class="rounded-md border px-2.5 py-1">v{props.candidate.installedVersion}</span><span aria-hidden="true">→</span><span class="rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 font-semibold">v{props.candidate.targetVersion}</span><Show when={props.candidate.kind === 'development_build'}><span class="text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.newBuild')}</span></Show><Show when={props.candidate.kind === 'replace'}><span class="text-xs text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.replacementBuild')}</span></Show></div></section>
    <section><h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.updateReview.whatIsNew')}</h3><Show when={notes()} fallback={<p class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.noReleaseNotes')}</p>}>{(current) => <div class="mt-2 space-y-3"><p class="text-sm leading-6">{i18n.t(current().summaryKey as EnvAppTranslationKey)}</p><NoteList title={i18n.t('uiCopy.plugin.updateReview.features')} keys={current().featureKeys} /><NoteList title={i18n.t('uiCopy.plugin.updateReview.improvements')} keys={current().improvementKeys} /><NoteList title={i18n.t('uiCopy.plugin.updateReview.fixes')} keys={current().fixKeys} /><NoteList title={i18n.t('uiCopy.plugin.updateReview.notices')} keys={current().noticeKeys} /></div>}</Show></section>
    <section class="border-y py-4"><div class="flex items-start gap-3"><Shield class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.updateReview.impactTitle')}</h3><Show when={props.candidate.reviewEvidence.kind === 'external_inspection' && securityChanges().length === 0}><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.noAccessChange')}</p></Show><Show when={securityChanges().length > 0}><p class="mt-1 text-xs leading-5 text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.securityChanges', { count: securityChanges().length })}</p></Show><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.grantsRetained')}</p><p class="mt-1 text-xs leading-5 text-muted-foreground">{props.candidate.reviewEvidence.kind === 'development_delivery' ? i18n.t('uiCopy.plugin.updateReview.developmentEvidence') : i18n.t('uiCopy.plugin.updateReview.externalEvidence')}</p><Show when={props.candidate.reviewEvidence.kind === 'development_delivery'}><p class="mt-1 text-xs leading-5 text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.developmentInspectionUnavailable')}</p></Show></div></div></section>
    <Show when={props.candidate.kind === 'noop'}><p class="rounded-md border px-3 py-2 text-sm">{i18n.t('uiCopy.plugin.updateReview.noUpdate')}</p></Show><Show when={props.candidate.kind === 'blocked'}><p class="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">{i18n.t('uiCopy.plugin.updateReview.downgradeBlocked')}</p></Show>
    <details class="group rounded-md border"><summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold"><span>{i18n.t('uiCopy.plugin.updateReview.technicalEvidence')}</span><ChevronDown class="h-4 w-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary><dl class="grid gap-3 border-t px-3 py-3 text-xs sm:grid-cols-2"><HashFact label={i18n.t('uiCopy.plugin.updateReview.packageHash')} value={props.candidate.target.packageHash} /><HashFact label={i18n.t('uiCopy.plugin.updateReview.manifestHash')} value={props.candidate.target.manifestHash} /><HashFact label={i18n.t('uiCopy.plugin.updateReview.entriesHash')} value={props.candidate.target.entriesHash} /><Show when={notes()}>{(current) => <HashFact label={i18n.t('uiCopy.plugin.updateReview.releaseNotesID')} value={current().releaseID} />}</Show></dl></details>
  </div>;
}

function NoteList(props: { title: string; keys: readonly string[] }): JSX.Element { const i18n = useI18n(); return <Show when={props.keys.length}><div><h4 class="text-xs font-semibold text-muted-foreground">{props.title}</h4><ul class="mt-1 space-y-1 text-sm leading-5"><For each={props.keys}>{(key) => <li class="flex gap-2"><span aria-hidden="true">•</span><span>{i18n.t(key as EnvAppTranslationKey)}</span></li>}</For></ul></div></Show>; }
function HashFact(props: { label: string; value: string }): JSX.Element { return <div class="min-w-0"><dt class="text-muted-foreground">{props.label}</dt><dd class="mt-1 truncate font-mono" title={props.value}>{props.value}</dd></div>; }

function UpdateSourceForm(props: { kind: ExternalPluginSourceKind; url: string; tag: string; onKind: (kind: ExternalPluginSourceKind) => void; onURL: (value: string) => void; onTag: (value: string) => void; onFile: (file: File | undefined) => void }): JSX.Element {
  const i18n = useI18n();
  return <section class="space-y-4"><div><h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.updateReview.sourceTitle')}</h3><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.sourceDescription')}</p></div><div class="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1">{(['package_url','github_repository','package_upload'] as const).map((kind) => <button type="button" class={cn('min-h-11 rounded px-2 text-xs font-medium', props.kind === kind ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => props.onKind(kind)}>{kind === 'package_url' ? i18n.t('uiCopy.plugin.external.packageURL') : kind === 'github_repository' ? i18n.t('uiCopy.plugin.external.githubRepository') : i18n.t('uiCopy.plugin.external.packageFile')}</button>)}</div><Show when={props.kind === 'package_upload'} fallback={<div class="space-y-3"><input data-plugin-update-source-url type="url" class="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={props.url} placeholder={props.kind === 'github_repository' ? i18n.t('uiCopy.plugin.external.repositoryURLPlaceholder') : i18n.t('uiCopy.plugin.external.packageURLPlaceholder')} onInput={(event) => props.onURL(event.currentTarget.value)} /><Show when={props.kind === 'github_repository'}><input type="text" class="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={props.tag} placeholder={i18n.t('uiCopy.plugin.external.releaseTag')} onInput={(event) => props.onTag(event.currentTarget.value)} /></Show></div>}><input data-plugin-update-source-file type="file" class="block min-h-11 w-full text-sm" accept=".redevplugin,application/octet-stream" onChange={(event) => props.onFile(event.currentTarget.files?.[0])} /></Show></section>;
}

const primaryButtonClass = cn('inline-flex min-h-[44px] flex-none cursor-pointer items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', PLUGIN_PRESS_MOTION_CLASS, PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'sm:min-h-9');
const secondaryButtonClass = cn('inline-flex min-h-[44px] flex-none cursor-pointer items-center justify-center whitespace-nowrap rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', PLUGIN_PRESS_MOTION_CLASS, PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'sm:min-h-9');

function submitLabel(candidate: PluginUpdateCandidate, t: ReturnType<typeof useI18n>['t']): string {
  if (candidate.kind === 'development_build') return t('uiCopy.plugin.updateReview.installNewBuild');
  if (candidate.kind === 'replace') return t('uiCopy.plugin.updateReview.replaceBuild');
  return t('uiCopy.plugin.updateReview.updateToVersion', { version: candidate.targetVersion });
}
function updateIntent(item: PluginInventoryItem) { return { action: 'update' as const, plugin_instance_id: item.pluginInstanceID!, expected_management_revision: item.managementRevision! }; }
function isHTTPSURL(value: string): boolean { try { const parsed = new URL(value.trim()); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } }
function messageFromUnknown(value: unknown): string { return value instanceof Error ? value.message : String(value); }
