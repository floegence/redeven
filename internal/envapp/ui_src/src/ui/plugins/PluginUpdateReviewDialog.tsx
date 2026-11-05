import { Button, Input, Tabs } from '@floegence/floe-webapp-core/ui';
import type { PluginReleaseRef } from '@floegence/redevplugin-ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, ChevronDown, Loader2, Shield } from '@floegence/floe-webapp-core/icons';
import { pluginMutationOutcome } from '@floegence/redevplugin-ui';

import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
import { PLUGIN_PACKAGE_DIALOG_CLASS, PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import { OfficialPluginAccessReview } from './OfficialPluginAccessReview';
import { PluginIdentityHeader } from './PluginPresentationPrimitives';
import {
  candidateMatchesInventory,
  candidateTargetIsCurrent,
  createExternalUpdateCandidate,
  createOfficialUpdateCandidate,
  samePackageIdentity,
} from './pluginUpdateProjection';
import { dataUpgradeFacts, securityDeclarations } from './externalPluginSecurityProjection';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  ExternalPluginSourceKind,
  ExternalPluginSourcePreset,
  PluginInventoryItem,
  PluginUpdateCandidate,
  PluginMarketDetail,
} from './pluginTypes';

type UpdateStage = 'source_required' | 'loading_review' | 'review' | 'committing' | 'reconciling' | 'complete';

export type PluginUpdateReviewDialogProps = {
  open: boolean;
  item?: PluginInventoryItem;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onInspect: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommitExternal: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onOfficialUpdate: (item: PluginInventoryItem, releaseRef: PluginReleaseRef) => Promise<unknown>;
  onLoadMarketDetail?: (pluginID: string, generation: number, signal: AbortSignal) => Promise<PluginMarketDetail>;
  onRefresh: () => Promise<unknown> | unknown;
  onCommitted: () => void;
  onOpenSurface: () => void;
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

  const closeBlocked = () => stage() === 'committing' || stage() === 'reconciling';
  const sourcePreset = (): ExternalPluginSourcePreset | undefined => props.item?.officialCatalog?.distribution.installSource;
  const needsRiskConfirmation = createMemo(() => {
    const current = candidate();
    if (!current) return false;
    if (current.kind === 'replace') return true;
    if (current.reviewEvidence.kind === 'official_preview') return false;
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
      operation?.abort('Update review closed');
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
    const preset = item.officialCatalog?.distribution.installSource;
    if (preset) {
      if (item.officialCatalog?.sourceKind === 'reviewed-third-party') {
        setSourceKind(preset.sourceKind);
        setURL(preset.url);
        setTag(preset.sourceKind === 'github_repository' ? preset.tag ?? '' : '');
        setStage('source_required');
        return;
      }
      void prepareOfficialReview(item.inventoryKey);
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

  async function prepareOfficialReview(inventoryKey: string) {
    const controller = new AbortController();
    operation?.abort('Official update review superseded');
    operation = controller;
    setStage('loading_review');
    setCandidate(undefined);
    setError(undefined);
    try {
      let item = props.item;
      if (!item || item.inventoryKey !== inventoryKey || !item.officialCatalog) throw new Error('Missing update target');
      if (!item.officialCatalog.installPreview) {
        if (!props.onLoadMarketDetail) throw new Error('Official preview is unavailable');
        const original = item;
        const generation = item.officialCatalog.marketGeneration ?? 0;
        const detail = await props.onLoadMarketDetail(item.pluginID, generation, controller.signal);
        if (controller.signal.aborted) return;
        if (props.item?.inventoryKey !== original.inventoryKey
          || props.item.managementRevision !== original.managementRevision
          || props.item.officialCatalog?.marketGeneration !== original.officialCatalog?.marketGeneration
          || detail.generation !== generation) throw new Error(i18n.t('uiCopy.plugin.updateReview.stale'));
        const preview = detail.latest.find((release) => release.channel === 'stable'
          && release.availability_status === 'visible'
          && release.version === original.officialCatalog!.latestVersion)?.install_preview;
        item = { ...item, officialCatalog: { ...item.officialCatalog, installPreview: preview } };
      }
      setCandidate(createOfficialUpdateCandidate(item));
      setConfirmedRisk(false);
      setStage('review');
    } catch {
      if (!controller.signal.aborted) {
        setError(i18n.t('uiCopy.plugin.marketUnavailable'));
        setStage('review');
      }
    } finally {
      if (operation === controller) operation = undefined;
    }
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

  async function inspectRequest(
    item: PluginInventoryItem,
    request: ExternalPluginInspectionRequest,
  ) {
    const controller = new AbortController();
    operation?.abort('Update inspection superseded');
    operation = controller;
    setStage('loading_review');
    setError(undefined);
    try {
      const inspection = await props.onInspect(request, controller.signal);
      if (controller.signal.aborted) return;
      const expected = item.officialCatalog?.sourceKind === 'reviewed-third-party' ? item.officialCatalog.distribution.releaseRef : undefined;
      if (expected && (inspection.plugin_id !== expected.plugin_id || inspection.publisher_id !== expected.publisher_id || inspection.version !== expected.version
        || inspection.inspected_hashes.package_sha256 !== expected.expected_hashes.package_sha256
        || inspection.inspected_hashes.manifest_sha256 !== expected.expected_hashes.manifest_sha256
        || inspection.inspected_hashes.entries_sha256 !== expected.expected_hashes.entries_sha256)) throw new Error(i18n.t('uiCopy.plugin.updateReview.stale'));
      const current = props.item;
      if (current?.inventoryKey !== item.inventoryKey || current.managementRevision !== item.managementRevision) {
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
      if (current.reviewEvidence.kind === 'official_preview') {
        await props.onOfficialUpdate(props.item!, current.reviewEvidence.preview.release_ref);
      } else {
        await props.onCommitExternal(current.reviewEvidence.inspection, controller.signal);
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
    if (closeBlocked()) return;
    operation?.abort('Update review closed');
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={i18n.t('uiCopy.plugin.updateReview.title', { plugin: props.item?.displayName ?? '' })}
      class={cn(
        'redeven-plugin-update-dialog', PLUGIN_PACKAGE_DIALOG_CLASS,
        closeBlocked() && '[&>div:first-child>button]:hidden',
      )}
      footer={(
        <div data-plugin-update-footer class="flex w-full flex-col gap-3">
          <Show when={!props.canManage && stage() === 'review'}>
            <p class="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.readOnly')}</p>
          </Show>
          <Show when={needsRiskConfirmation() && stage() === 'review'}>
            <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-xs leading-5">
              <input type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-primary" checked={confirmedRisk()} onChange={(event) => setConfirmedRisk(event.currentTarget.checked)} />
              <span>{i18n.t('uiCopy.plugin.updateReview.riskConfirm')}</span>
            </label>
          </Show>
          <div class="flex flex-wrap justify-end gap-2">
            <Show when={!closeBlocked()}>
              <Button data-plugin-update-cancel type="button" variant="secondary" class={actionButtonClass} onClick={close}>
                {stage() === 'complete' ? i18n.t('uiCopy.plugin.updateReview.done') : i18n.t('common.actions.cancel')}
              </Button>
            </Show>
            <Show when={stage() === 'source_required'}>
              <Button data-plugin-update-inspect type="button" variant="primary" class={actionButtonClass} onClick={() => void inspectSource()}>
                {i18n.t('uiCopy.plugin.updateReview.reviewPackage')}
              </Button>
            </Show>
            <Show when={stage() === 'review' && !candidate() && sourcePreset()}>
              <Button data-plugin-update-retry type="button" variant="primary" class={actionButtonClass} onClick={() => {
                const item = props.item;
                if (item) void prepareOfficialReview(item.inventoryKey);
              }}>
                {i18n.t('common.actions.retry')}
              </Button>
            </Show>
            <Show keyed when={stage() === 'review' && candidate()?.kind !== 'noop' && candidate()?.kind !== 'blocked' ? candidate() : undefined}>
              {(current) => (
                <Button data-plugin-update-submit type="button" variant="primary" class={actionButtonClass} disabled={!canSubmit()} onClick={() => void submit()}>
                  {submitLabel(current, i18n.t)}
                </Button>
              )}
            </Show>
            <Show when={stage() === 'reconciling' && error()}>
              <Button data-plugin-update-reconcile type="button" variant="primary" class={actionButtonClass} onClick={() => void reconcile()}>
                {i18n.t('uiCopy.plugin.updateReview.continueReconciliation')}
              </Button>
            </Show>
            <Show when={stage() === 'complete' && completedLaunchTarget()}>
              <Button data-plugin-update-open type="button" variant="primary" class={actionButtonClass} onClick={props.onOpenSurface}>
                {i18n.t('common.actions.open')}
              </Button>
            </Show>
            <Show when={stage() === 'complete' && completedInventoryItem() && !completedLaunchTarget()}>
              <Button data-plugin-update-view-permissions type="button" variant="primary" class={actionButtonClass} onClick={props.onViewPermissions}>
                {i18n.t('uiCopy.plugin.updateReview.viewPermissions')}
              </Button>
            </Show>
          </div>
        </div>
      )}
    >
      <div data-plugin-update-dialog data-plugin-update-stage={stage()} class="min-h-0 space-y-4 overflow-x-hidden">
        <Show when={props.item}>{(item) => <PluginIdentityHeader item={item()} review version={
          <span class="flex flex-wrap items-center gap-2" aria-label={i18n.t('uiCopy.plugin.updateReview.versionChange')}>
            <span>v{candidate()?.installedVersion ?? item().version}</span>
            <Show when={candidate()?.targetVersion ?? item().officialCatalog?.latestVersion}>{(version) => <>
              <span aria-hidden="true">→</span><span class="font-medium text-foreground">v{version()}</span>
            </>}</Show>
          </span>
        } />}</Show>
        <Show when={error()}>
          {(message) => <div role="alert" class="flex gap-2 rounded-md border border-destructive px-3 py-2.5 text-[length:var(--floe-type-body)] text-destructive"><AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" /><span>{message()}</span></div>}
        </Show>
        <Show when={stage() === 'loading_review' || stage() === 'committing' || stage() === 'reconciling'}>
          <div role="status" class="flex items-center gap-3 border-t pt-4 text-[length:var(--floe-type-body)] text-muted-foreground">
            <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>{stage() === 'loading_review' ? i18n.t('uiCopy.plugin.updateReview.loading') : stage() === 'committing' ? i18n.t('uiCopy.plugin.updateReview.committing') : i18n.t('uiCopy.plugin.updateReview.reconciling')}</span>
          </div>
        </Show>
        <Show when={stage() === 'source_required'}><UpdateSourceForm kind={sourceKind()} url={url()} tag={tag()} onKind={setSourceKind} onURL={setURL} onTag={setTag} onFile={setFile} /></Show>
        <Show when={stage() === 'review' && candidate()}>{(current) => <UpdateReview candidate={current()} item={props.item!} />}</Show>
        <Show when={stage() === 'complete' && candidate()}>
          {(current) => <div role="status" data-plugin-update-complete class="space-y-3 border-t pt-4"><div class="flex items-start gap-3"><CheckCircle class="mt-0.5 h-4 w-4 shrink-0 text-[var(--redeven-status-success-foreground)]" /><div><h3 class="text-sm font-medium">{i18n.t('uiCopy.plugin.updateReview.completeTitle', { plugin: current().displayName })}</h3></div></div><Show when={refreshFailed()}><p class="text-xs text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.refreshFailed')}</p></Show></div>}
        </Show>
      </div>
    </Dialog>
  );
}

function UpdateReview(props: { candidate: PluginUpdateCandidate; item: PluginInventoryItem }): JSX.Element {
  const i18n = useI18n();
  const securityChanges = () => props.candidate.reviewEvidence.kind === 'external_inspection'
    ? securityDeclarations(
      props.candidate.reviewEvidence.inspection.security_summary,
      props.item.externalPackage?.securitySummary,
    ).filter((change) => change.change === 'added' || change.change === 'changed')
    : [];
  const dataUpgrade = () => props.candidate.reviewEvidence.kind === 'external_inspection'
    ? props.candidate.reviewEvidence.inspection.security_summary.data_upgrade
    : props.candidate.reviewEvidence.preview.security_summary.data_upgrade;
  const officialPreview = () => props.candidate.reviewEvidence.kind === 'official_preview' ? props.candidate.reviewEvidence.preview : undefined;
  return <div class="space-y-5">
    <Show when={props.candidate.kind === 'replace'}><p class="text-xs text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.replacementBuild')}</p></Show>
    <Show when={officialPreview()}>{(preview) => <OfficialPluginAccessReview preview={preview()} />}</Show>
    <Show when={!officialPreview()}>
    <section class="pb-1"><div class="flex items-start gap-3"><Shield class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.updateReview.impactTitle')}</h3><Show when={securityChanges().length === 0}><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.noAccessChange')}</p></Show><Show when={securityChanges().length > 0}><p class="mt-1 text-xs leading-5 text-[var(--redeven-status-warning-foreground)]">{i18n.t('uiCopy.plugin.updateReview.securityChanges', { count: securityChanges().length })}</p></Show><Show when={dataUpgrade()}><p data-plugin-update-data-upgrade class="mt-2 text-[length:var(--floe-type-body)] leading-6">{i18n.t('uiCopy.plugin.external.dataUpgradeNotice')}</p></Show><Show when={securityChanges().length > 0}><p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.grantsRetained')}</p></Show></div></div></section>
    </Show>
    <Show when={props.candidate.kind === 'noop'}><p class="rounded-md border px-3 py-2 text-[length:var(--floe-type-body)]">{i18n.t('uiCopy.plugin.updateReview.noUpdate')}</p></Show><Show when={props.candidate.kind === 'blocked'}><p class="rounded-md border border-destructive px-3 py-2 text-[length:var(--floe-type-body)] text-destructive">{i18n.t('uiCopy.plugin.updateReview.downgradeBlocked')}</p></Show>
    <details class="group rounded-control bg-[var(--floe-well)]"><summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold"><span>{i18n.t('uiCopy.plugin.updateReview.technicalEvidence')}</span><ChevronDown class="h-4 w-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary><Show when={!officialPreview()}><p class="border-t px-3 pt-3 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.externalEvidence')}</p></Show><dl class="grid gap-3 px-3 py-3 text-xs sm:grid-cols-2"><HashFact label={i18n.t('uiCopy.plugin.updateReview.packageHash')} value={props.candidate.target.packageHash} /><HashFact label={i18n.t('uiCopy.plugin.updateReview.manifestHash')} value={props.candidate.target.manifestHash} /><HashFact label={i18n.t('uiCopy.plugin.updateReview.entriesHash')} value={props.candidate.target.entriesHash} /><Show when={dataUpgrade()}><div class="min-w-0 sm:col-span-2" data-plugin-update-data-upgrade-details><dt class="text-muted-foreground">{i18n.t('uiCopy.plugin.external.dataUpgrade')}</dt><dd class="mt-1 space-y-1 break-all font-mono"><For each={dataUpgradeFacts(dataUpgrade()!)}>{(fact) => <div>{fact}</div>}</For></dd></div></Show></dl></details>
  </div>;
}

function HashFact(props: { label: string; value: string }): JSX.Element { return <div class="min-w-0"><dt class="text-muted-foreground">{props.label}</dt><dd class="mt-1 truncate font-mono" title={props.value}>{props.value}</dd></div>; }

function UpdateSourceForm(props: { kind: ExternalPluginSourceKind; url: string; tag: string; onKind: (kind: ExternalPluginSourceKind) => void; onURL: (value: string) => void; onTag: (value: string) => void; onFile: (file: File | undefined) => void }): JSX.Element {
  const i18n = useI18n();
  const choices = () => [
    { id: 'package_url', label: i18n.t('uiCopy.plugin.external.packageURL') },
    { id: 'github_repository', label: i18n.t('uiCopy.plugin.external.githubRepository') },
    { id: 'package_upload', label: i18n.t('uiCopy.plugin.external.packageFile') },
  ];
  return (
    <section class="space-y-4">
      <div>
        <h3 class="text-sm font-semibold">{i18n.t('uiCopy.plugin.updateReview.sourceTitle')}</h3>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.updateReview.sourceDescription')}</p>
      </div>
      <Tabs ariaLabel={i18n.t('uiCopy.plugin.external.source')}
        items={choices().map(choice => ({ ...choice, domId: 'plugin-update-source-' + choice.id, panelId: 'plugin-update-source-panel' }))}
        activeId={props.kind} onChange={kind => props.onKind(kind as ExternalPluginSourceKind)}
        features={{ containerBorder: false, scrollButtons: 'never' }}
        slotClassNames={{ scrollContainer: 'grid grid-cols-3 w-full', tab: 'min-h-[46px] min-w-0 justify-center px-1 [&>span]:min-w-0 [&>span]:truncate' }} />
      <div id="plugin-update-source-panel" role="tabpanel" aria-labelledby={'plugin-update-source-' + props.kind}>
        <Show when={props.kind === 'package_upload'} fallback={(
          <div class="space-y-3">
            <Input data-plugin-update-source-url type="url" class="h-11" value={props.url}
              aria-label={props.kind === 'github_repository' ? i18n.t('uiCopy.plugin.external.repositoryURL') : i18n.t('uiCopy.plugin.external.packageURL')}
              placeholder={props.kind === 'github_repository' ? i18n.t('uiCopy.plugin.external.repositoryURLPlaceholder') : i18n.t('uiCopy.plugin.external.packageURLPlaceholder')}
              onInput={event => props.onURL(event.currentTarget.value)} />
            <Show when={props.kind === 'github_repository'}>
              <Input type="text" class="h-11" value={props.tag} aria-label={i18n.t('uiCopy.plugin.external.releaseTag')}
                placeholder={i18n.t('uiCopy.plugin.external.releaseTag')} onInput={event => props.onTag(event.currentTarget.value)} />
            </Show>
          </div>
        )}>
          <input data-plugin-update-source-file type="file" class="block min-h-11 w-full text-[length:var(--floe-type-control)]"
            aria-label={i18n.t('uiCopy.plugin.external.packageFile')} accept=".redevplugin,application/octet-stream"
            onChange={event => props.onFile(event.currentTarget.files?.[0])} />
        </Show>
      </div>
    </section>
  );
}

const actionButtonClass = cn('min-h-11 flex-none', PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'sm:min-h-9');

function submitLabel(candidate: PluginUpdateCandidate, t: ReturnType<typeof useI18n>['t']): string {
  if (candidate.kind === 'replace') return t('uiCopy.plugin.updateReview.replaceBuild');
  return t('uiCopy.plugin.updateReview.updateToVersion', { version: candidate.targetVersion });
}
function updateIntent(item: PluginInventoryItem) { return { action: 'update' as const, plugin_instance_id: item.pluginInstanceID!, expected_management_revision: item.managementRevision! }; }
function isHTTPSURL(value: string): boolean { try { const parsed = new URL(value.trim()); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } }

function messageFromUnknown(value: unknown): string { return value instanceof Error ? value.message : String(value); }
