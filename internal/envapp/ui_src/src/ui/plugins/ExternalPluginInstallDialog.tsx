import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Link, Shield, Upload } from '@floegence/floe-webapp-core/icons';
import { Dialog } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import { ExternalPackageInspectionTerminalError } from './pluginApi';
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
};

type InstallStage = 'source' | 'review' | 'committing' | 'complete';

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
  const [error, setError] = createSignal<string | null>(null);
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
  });

  onCleanup(() => operation?.abort('External plugin dialog disposed'));

  const canInspect = createMemo(() => {
    if (pending()) return false;
    if (sourceKind() === 'package_upload') return Boolean(file());
    return url().trim().length > 0;
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
      setStage('review');
    } catch {
      if (!controller.signal.aborted) setError(i18n.t('uiCopy.plugin.external.inspectFailed'));
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
    try {
      const result = await props.onCommit(current, controller.signal);
      setCommitted(result);
      setStage('complete');
      try {
        await props.onCommitted(result);
      } catch {
        setError(i18n.t('uiCopy.plugin.external.refreshFailed'));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(i18n.t('uiCopy.plugin.external.commitFailed'));
        if (error instanceof ExternalPackageInspectionTerminalError) {
          setInspection(null);
          setConfirmed(false);
          setStage('source');
        } else {
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

  const close = () => {
    if (stage() === 'committing') return;
    operation?.abort('External plugin dialog closed');
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={dialogTitle()}
      description={i18n.t('uiCopy.plugin.external.dialogDescription')}
      footer={(
        <div class="flex w-full flex-wrap justify-end gap-2">
          <Show when={stage() === 'review'}>
            <button type="button" class="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted" disabled={pending()} onClick={() => setStage('source')}>
              {i18n.t('uiCopy.plugin.external.back')}
            </button>
          </Show>
          <Show when={stage() !== 'committing'}>
            <button type="button" class="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={close}>
              {stage() === 'complete' ? i18n.t('common.actions.close') : i18n.t('common.actions.cancel')}
            </button>
          </Show>
          <Show when={stage() === 'source'}>
            <button type="button" class="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!canInspect()} onClick={() => void inspect()}>
              {pending() ? i18n.t('uiCopy.plugin.external.inspecting') : i18n.t('uiCopy.plugin.external.inspect')}
            </button>
          </Show>
          <Show when={stage() === 'review'}>
            <button type="button" class="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={!confirmed() || pending()} onClick={() => void commit()}>
              {isUpdate() ? i18n.t('uiCopy.plugin.external.confirmUpdate') : i18n.t('uiCopy.plugin.external.confirmInstall')}
            </button>
          </Show>
        </div>
      )}
    >
      <div data-external-plugin-dialog class="space-y-4">
        <Show when={error()}>
          <div role="alert" class="border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{error()}</div>
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
              confirmed={confirmed()}
              onConfirmed={setConfirmed}
            />
          )}
        </Show>
        <Show when={stage() === 'committing'}>
          <div role="status" class="py-8 text-center text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.external.committing')}</div>
        </Show>
        <Show when={stage() === 'complete' && committed()}>
          {(result) => (
            <div role="status" class="border-l-2 border-[var(--redeven-status-success-foreground)] bg-[var(--redeven-status-success-soft)] px-3 py-3 text-sm text-foreground">
              {i18n.t('uiCopy.plugin.external.complete', { plugin: result().plugin.manifest.plugin.display_name })}
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  );
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
  const choices: readonly { kind: ExternalPluginSourceKind; label: string; icon: typeof Link }[] = [
    { kind: 'package_url', label: i18n.t('uiCopy.plugin.external.packageURL'), icon: Link },
    { kind: 'github_repository', label: i18n.t('uiCopy.plugin.external.githubRepository'), icon: Link },
    { kind: 'package_upload', label: i18n.t('uiCopy.plugin.external.packageFile'), icon: Upload },
  ];
  const sourceTabID = (kind: ExternalPluginSourceKind) => `external-plugin-source-tab-${kind}`;
  const selectSource = (kind: ExternalPluginSourceKind, focus = false) => {
    props.onSourceKind(kind);
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
                'flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition',
                props.sourceKind === choice.kind ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              disabled={props.pending}
              onClick={() => selectSource(choice.kind)}
              onKeyDown={(event) => selectAdjacentSource(event, choice.kind)}
            >
              <choice.icon class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{choice.label}</span>
            </button>
          )}
        </For>
      </div>
      <div
        id="external-plugin-source-panel"
        role="tabpanel"
        aria-labelledby={sourceTabID(props.sourceKind)}
        class="space-y-4"
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
            class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            onInput={(event) => props.onURL(event.currentTarget.value)}
          />
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
            class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            onInput={(event) => props.onTag(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={props.sourceKind === 'package_upload'}>
        <label class="block space-y-1.5 text-sm font-medium">
          <span>{i18n.t('uiCopy.plugin.external.packageFile')}</span>
          <input
            type="file"
            accept=".redevplugin,application/vnd.redevplugin.package+zip,application/zip"
            disabled={props.pending}
            class="block w-full cursor-pointer rounded-md border bg-background text-sm file:mr-3 file:cursor-pointer file:border-0 file:border-r file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
            onChange={(event) => props.onFile(event.currentTarget.files?.[0] ?? null)}
          />
          <Show when={props.file}><div class="truncate text-xs font-normal text-muted-foreground">{props.file?.name}</div></Show>
        </label>
      </Show>
      </div>
    </>
  );
}

function InspectionReview(props: {
  inspection: ExternalPluginInspection;
  previousSummary?: PluginExternalPackageSecuritySummary;
  confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void;
}): JSX.Element {
  const i18n = useI18n();
  const summary = () => props.inspection.security_summary;
  const signature = () => props.inspection.signature_assessment.state;
  const blocked = () => signature() === 'invalid'
    || signature() === 'revoked'
    || props.inspection.execution_approval.state === 'policy_blocked';
  const facts = () => [
    [i18n.t('uiCopy.plugin.external.permissions'), summary().permissions.length],
    [i18n.t('uiCopy.plugin.external.methods'), summary().methods.length],
    [i18n.t('uiCopy.plugin.external.capabilityContracts'), summary().capability_contracts.length],
    [i18n.t('uiCopy.plugin.external.workers'), summary().workers.length],
    [i18n.t('uiCopy.plugin.external.network'), summary().network.length],
    [i18n.t('uiCopy.plugin.external.storage'), summary().storage.length],
    [i18n.t('uiCopy.plugin.external.secretRefs'), summary().secret_refs.length],
    [i18n.t('uiCopy.plugin.external.coreActions'), summary().core_actions.length],
    [i18n.t('uiCopy.plugin.external.intents'), summary().intents.length],
    [i18n.t('uiCopy.plugin.external.surfaces'), summary().surfaces.length],
  ] as const;
  const declarations = createMemo(() => securityDeclarations(summary(), props.previousSummary));
  const accessChanged = createMemo(() => declarations().some((declaration) => Boolean(declaration.change)));
  return (
    <div class="space-y-4">
      <div class="flex items-start gap-3 border-b pb-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"><Shield class="h-4 w-4" /></div>
        <div class="min-w-0">
          <div class="truncate font-semibold">{props.inspection.plugin_id}</div>
          <div class="mt-0.5 text-xs text-muted-foreground">{props.inspection.publisher_id} · v{props.inspection.version}</div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <For each={facts()}>
          {(fact) => (
            <div class="border-t pt-2">
              <div class="text-[10px] font-semibold uppercase text-muted-foreground">{fact[0]}</div>
              <div class="mt-0.5 text-sm font-medium">{fact[1]}</div>
            </div>
          )}
        </For>
      </div>
      <SourceProvenanceReview provenance={props.inspection.source_provenance} />
      <Show when={props.previousSummary && accessChanged()}>
        <div class="border-l-2 border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)] px-3 py-2 text-sm">
          {i18n.t('uiCopy.plugin.external.accessChanged')}
        </div>
      </Show>
      <div class="space-y-3 border-t pt-3">
        <div class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.external.declaredAccess')}</div>
        <For each={declarations()}>
          {(declaration) => (
            <div class={cn(
              'border-l-2 px-3 py-2',
              declaration.change === 'added' || declaration.change === 'changed'
                ? 'border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)]'
                : declaration.change === 'removed'
                  ? 'border-muted-foreground/35 bg-muted/40 opacity-75'
                  : 'border-border bg-muted/25',
            )}>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[10px] font-semibold uppercase text-muted-foreground">{securityCategoryLabel(declaration.category, i18n)}</span>
                <Show when={declaration.change}>
                  {(change) => (
                    <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                      {i18n.t(`uiCopy.plugin.external.${change()}`)}
                    </span>
                  )}
                </Show>
              </div>
              <code class="mt-1 block break-all text-xs font-semibold">{declaration.identity}</code>
              <For each={declaration.facts}>
                {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground">{fact}</code>}
              </For>
              <Show when={declaration.previousFacts}>
                {(previousFacts) => (
                  <div class="mt-2 border-t border-current/15 pt-2 opacity-75">
                    <span class="text-[10px] font-semibold uppercase text-muted-foreground">
                      {i18n.t('uiCopy.plugin.external.previous')}
                    </span>
                    <For each={previousFacts()}>
                      {(fact) => <code class="mt-1 block break-all text-[11px] text-muted-foreground line-through">{fact}</code>}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>
        <div>
          <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.securitySummaryHash')}</div>
          <code class="mt-1 block break-all text-[11px]">{summary().summary_sha256}</code>
        </div>
      </div>
      <div class={cn(
        'border-l-2 px-3 py-2 text-sm',
        blocked() ? 'border-destructive bg-destructive/10 text-destructive' : signature() === 'verified'
          ? 'border-[var(--redeven-status-success-foreground)] bg-[var(--redeven-status-success-soft)]'
          : 'border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)]',
      )}>
        <div class="font-medium">{signatureReviewLabel(signature(), i18n)}</div>
        <Show when={props.inspection.execution_approval.state === 'policy_blocked'}>
          <div class="mt-1 font-medium">{i18n.t('uiCopy.plugin.managedByPolicy')}</div>
          <For each={props.inspection.execution_approval.reason_codes}>
            {(reason) => <code class="mt-1 block break-all text-[11px]">{reason}</code>}
          </For>
        </Show>
        <div class="mt-1 text-xs opacity-80">
          {props.inspection.update_eligibility.state === 'automatic_eligible'
            ? i18n.t('uiCopy.plugin.external.automaticUpdates')
            : i18n.t('uiCopy.plugin.external.manualUpdates')}
        </div>
      </div>
      <div class="space-y-2 border-t pt-3 text-xs">
        <div>
          <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.packageHash')}</div>
          <code class="mt-1 block break-all text-[11px]">{props.inspection.inspected_hashes.package_sha256}</code>
        </div>
        <div>
          <div class="font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.external.confirmationDigest')}</div>
          <code class="mt-1 block break-all text-[11px]">{props.inspection.confirmation_digest}</code>
        </div>
      </div>
      <label class={cn('flex items-start gap-2 text-sm', blocked() ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={props.confirmed}
          disabled={blocked()}
          class="mt-0.5 h-4 w-4 rounded border"
          onChange={(event) => props.onConfirmed(event.currentTarget.checked)}
        />
        <span>{i18n.t('uiCopy.plugin.external.confirmDigest')}</span>
      </label>
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
