import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { AlertTriangle, Check, Copy, Database, RefreshIcon, Trash } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../../i18n';
import type { AIReadinessController } from '../../flower/aiReadiness';
import { createAIReadinessPresentation } from '../../flower/aiReadinessPresentation';
import { fetchLocalApiJSON } from '../../services/localApi';
import { formatUnknownError } from '../../maintenance/shared';
import { SettingsList, SettingsPill, SettingsSection, SettingRow } from './SettingsPrimitives';

const BUTTON_CLASS = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors motion-reduce:transition-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55';

type OrphanRootItem = Readonly<{ thread_id: string; phase: string; status: string; can_append_message: boolean; recoverable: boolean }>;
type OrphanRootReview = Readonly<{ issue_count: number; items: readonly OrphanRootItem[] }>;
type AdoptionDraft = Readonly<{ endpoint_id: string; namespace_public_id: string; model_id: string; permission_type: string; working_dir: string }>;
type AdoptionModelOption = Readonly<{ id: string; label: string }>;

type AIReadinessSettingsSectionProps = Readonly<{
  controller: AIReadinessController;
  canAdmin?: boolean;
  endpointID?: string;
  namespacePublicID?: string;
  modelID?: string;
  modelOptions?: readonly AdoptionModelOption[];
  permissionType?: string;
  workingDir?: string;
}>;

export function AIReadinessSettingsSection(props: AIReadinessSettingsSectionProps) {
  const i18n = useI18n();
  const presentation = createMemo(() => createAIReadinessPresentation(props.controller.snapshot(), i18n));
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);
  const [copyPending, setCopyPending] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  const [review, setReview] = createSignal<OrphanRootReview | null>(null);
  const [reviewLoading, setReviewLoading] = createSignal(false);
  const [reviewError, setReviewError] = createSignal<string | null>(null);
  const [drafts, setDrafts] = createSignal<Record<string, AdoptionDraft>>({});
  const [actionPending, setActionPending] = createSignal<string | null>(null);
  const [deleteConfirmID, setDeleteConfirmID] = createSignal<string | null>(null);
  let adminEpoch = 0;

  const hasCurrentAdminAccess = (epoch: number): boolean => Boolean(props.canAdmin) && epoch === adminEpoch;

  createEffect(() => {
    if (props.canAdmin) return;
    adminEpoch += 1;
    setReview(null);
    setReviewLoading(false);
    setReviewError(null);
    setDrafts({});
    setActionPending(null);
    setDeleteConfirmID(null);
  });

  const defaultDraft = (): AdoptionDraft => ({
    endpoint_id: String(props.endpointID ?? '').trim(),
    namespace_public_id: String(props.namespacePublicID ?? '').trim(),
    model_id: String(props.modelID ?? '').trim(),
    permission_type: String(props.permissionType ?? 'approval_required').trim(),
    working_dir: String(props.workingDir ?? '').trim(),
  });
  const modelOptions = createMemo(() => {
    const configured = (props.modelOptions ?? []).filter((option) => option.id.trim());
    const current = String(props.modelID ?? '').trim();
    if (!current || configured.some((option) => option.id === current)) return configured;
    return [{ id: current, label: current }, ...configured];
  });

  const loadReview = async (): Promise<void> => {
    if (!props.canAdmin || reviewLoading()) return;
    const requestEpoch = adminEpoch;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const next = await fetchLocalApiJSON<OrphanRootReview>('/_redeven_proxy/api/ai/maintenance/orphan_roots', { method: 'GET' });
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      setReview(next);
      setDrafts((current) => Object.fromEntries(next.items.map((item) => [item.thread_id, current[item.thread_id] ?? defaultDraft()])));
    } catch (error) {
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      setReviewError(formatUnknownError(error) || i18n.t('aiReadiness.settings.reviewFailed'));
    } finally {
      if (hasCurrentAdminAccess(requestEpoch)) setReviewLoading(false);
    }
  };

  const updateDraft = (threadID: string, field: keyof AdoptionDraft, value: string): void => {
    if (!props.canAdmin) return;
    setDrafts((current) => ({ ...current, [threadID]: { ...(current[threadID] ?? defaultDraft()), [field]: value } }));
  };

  const adopt = async (threadID: string): Promise<void> => {
    const draft = drafts()[threadID] ?? defaultDraft();
    if (!props.canAdmin || Object.values(draft).some((value) => !String(value).trim()) || actionPending()) return;
    const requestEpoch = adminEpoch;
    setActionPending(threadID);
    setReviewError(null);
    try {
      await fetchLocalApiJSON('/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt', {
        method: 'POST', body: JSON.stringify({ thread_id: threadID, ...draft }),
      });
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      await props.controller.refresh();
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      await loadReview();
    } catch (error) {
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      setReviewError(formatUnknownError(error) || i18n.t('aiReadiness.settings.adoptFailed'));
    } finally {
      if (hasCurrentAdminAccess(requestEpoch)) setActionPending(null);
    }
  };

  const deleteRoot = async (threadID: string): Promise<void> => {
    if (!props.canAdmin) return;
    if (deleteConfirmID() !== threadID) {
      setDeleteConfirmID(threadID);
      return;
    }
    if (actionPending()) return;
    const requestEpoch = adminEpoch;
    setActionPending(threadID);
    setReviewError(null);
    try {
      await fetchLocalApiJSON('/_redeven_proxy/api/ai/maintenance/orphan_roots/delete', {
        method: 'POST', body: JSON.stringify({ thread_id: threadID }),
      });
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      setDeleteConfirmID(null);
      await props.controller.refresh();
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      await loadReview();
    } catch (error) {
      if (!hasCurrentAdminAccess(requestEpoch)) return;
      setReviewError(formatUnknownError(error) || i18n.t('aiReadiness.settings.deleteFailed'));
    } finally {
      if (hasCurrentAdminAccess(requestEpoch)) setActionPending(null);
    }
  };

  const statusLabel = createMemo(() => {
    if (props.controller.loading()) return i18n.t('aiReadiness.settings.refreshing');
    if (presentation().mode === 'ready') return i18n.t('aiReadiness.settings.noIssue');
    if (presentation().mode === 'busy') return i18n.t('aiReadiness.diagnostics.statusChecking');
    return presentation().title;
  });

  const statusTone = createMemo<'success' | 'warning' | 'danger'>(() => (
    presentation().mode === 'ready'
      ? 'success'
      : presentation().tone === 'danger'
        ? 'danger'
        : 'warning'
  ));

  const copyDiagnostics = async (): Promise<void> => {
    if (copyPending()) return;
    setCopyPending(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(presentation().diagnosticText);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    } finally {
      setCopyPending(false);
    }
  };

  return (
    <SettingsSection
      icon={Database}
      title={i18n.t('aiReadiness.settings.title')}
      description={i18n.t('aiReadiness.settings.description')}
    >
      <SettingsList class="ai-readiness-settings">
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.diagnostics.ownerFloret')}
          description={i18n.t('aiReadiness.settings.floretDescription')}
          tone={statusTone()}
          control={<SettingsPill tone={statusTone()}>{statusLabel()}</SettingsPill>}
        >
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={props.controller.loading() || props.controller.retryPending()}
              aria-busy={props.controller.loading() ? 'true' : undefined}
              data-pending={props.controller.loading() ? 'true' : undefined}
              onClick={() => void props.controller.refresh()}
            >
              <RefreshIcon class={`h-4 w-4 ${props.controller.loading() ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              <span>{props.controller.loading() ? i18n.t('aiReadiness.settings.refreshing') : i18n.t('common.actions.refresh')}</span>
            </button>
            <Show when={props.canAdmin && props.controller.snapshot().state === 'degraded'}>
              <button type="button" class={BUTTON_CLASS} disabled={reviewLoading()} aria-busy={reviewLoading() ? 'true' : undefined} onClick={() => void loadReview()}>
                <AlertTriangle class="h-4 w-4" aria-hidden="true" />
                <span>{reviewLoading() ? i18n.t('aiReadiness.settings.reviewing') : i18n.t('aiReadiness.actions.reviewIssues')}</span>
              </button>
            </Show>
            <button
              type="button"
              class={BUTTON_CLASS}
              aria-expanded={diagnosticsOpen()}
              onClick={() => {
                setDiagnosticsOpen((open) => !open);
                setCopied(false);
              }}
            >
              <span>{diagnosticsOpen() ? i18n.t('aiReadiness.actions.hideDiagnostics') : i18n.t('aiReadiness.actions.showDiagnostics')}</span>
            </button>
          </div>
          <Show when={diagnosticsOpen()}>
            <div class="mt-3 border-t border-border pt-3" data-testid="ai-readiness-settings-diagnostics">
              <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.diagnostics.description')}</p>
              <dl class="mt-3 divide-y divide-border border-y border-border">
                <For each={presentation().diagnosticRows}>{(row) => (
                  <div class="grid min-w-0 grid-cols-[minmax(7.5rem,0.8fr)_minmax(0,1fr)] gap-4 py-2 text-xs max-[420px]:grid-cols-1 max-[420px]:gap-1">
                    <dt class="text-muted-foreground">{row.label}</dt>
                    <dd class="min-w-0 break-words font-semibold text-foreground">{row.value}</dd>
                  </div>
                )}</For>
              </dl>
              <button
                type="button"
                class={`${BUTTON_CLASS} mt-3`}
                disabled={copyPending()}
                aria-busy={copyPending() ? 'true' : undefined}
                data-pending={copyPending() ? 'true' : undefined}
                onClick={() => void copyDiagnostics()}
              >
                <Show when={copied()} fallback={<Copy class="h-4 w-4" aria-hidden="true" />}>
                  <Check class="h-4 w-4" aria-hidden="true" />
                </Show>
                <span>{copyPending()
                  ? i18n.t('aiReadiness.actions.copyingDiagnostics')
                  : copyFailed()
                    ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                  : copied()
                    ? i18n.t('aiReadiness.actions.diagnosticsCopied')
                    : i18n.t('aiReadiness.actions.copyDiagnostics')}</span>
              </button>
              <Show when={copied() || copyFailed()}>
                <span class="sr-only" role="status">
                  {copyFailed()
                    ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                    : i18n.t('aiReadiness.actions.diagnosticsCopied')}
                </span>
              </Show>
            </div>
          </Show>
          <Show when={props.canAdmin && reviewError()}>{(message) => <p role="alert" class="mt-3 text-xs text-destructive">{message()}</p>}</Show>
          <Show when={props.canAdmin && review()}>{(loaded) => (
            <div class="mt-3 border-t border-border pt-3" data-testid="ai-orphan-root-review">
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs font-semibold text-foreground">{i18n.t('aiReadiness.settings.reviewTitle')}</p>
                <SettingsPill tone={loaded().issue_count > 0 ? 'warning' : 'success'}>{String(loaded().issue_count)}</SettingsPill>
              </div>
              <Show when={loaded().items.length > 0} fallback={<p class="mt-2 text-xs text-muted-foreground">{i18n.t('aiReadiness.settings.reviewClear')}</p>}>
                <div class="mt-3 divide-y divide-border border-y border-border">
                  <For each={loaded().items}>{(item) => {
                    const draft = () => drafts()[item.thread_id] ?? defaultDraft();
                    const fieldClass = 'min-h-10 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
                    return (
                      <section class="py-3" data-orphan-thread-id={item.thread_id}>
                        <div class="flex min-w-0 items-center justify-between gap-3">
                          <code class="min-w-0 break-all text-xs font-semibold text-foreground">{item.thread_id}</code>
                          <span class="text-xs text-muted-foreground">{item.phase} / {item.status}</span>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                          <input class={fieldClass} aria-label={i18n.t('aiReadiness.settings.endpoint')} value={draft().endpoint_id} readonly />
                          <input class={fieldClass} aria-label={i18n.t('aiReadiness.settings.namespace')} value={draft().namespace_public_id} readonly />
                          <select class={fieldClass} aria-label={i18n.t('aiReadiness.settings.model')} value={draft().model_id} onChange={(event) => updateDraft(item.thread_id, 'model_id', event.currentTarget.value)}>
                            <For each={modelOptions()}>{(option) => <option value={option.id}>{option.label}</option>}</For>
                          </select>
                          <select class={fieldClass} aria-label={i18n.t('aiReadiness.settings.permission')} value={draft().permission_type} onChange={(event) => updateDraft(item.thread_id, 'permission_type', event.currentTarget.value)}>
                            <option value="readonly">{i18n.t('flowerSettings.permissionReadonlyTitle')}</option>
                            <option value="approval_required">{i18n.t('flowerSettings.permissionApprovalRequiredTitle')}</option>
                            <option value="full_access">{i18n.t('flowerSettings.permissionFullAccessTitle')}</option>
                          </select>
                          <input class={`${fieldClass} col-span-2 max-[520px]:col-span-1`} aria-label={i18n.t('aiReadiness.settings.workingDirectory')} value={draft().working_dir} onInput={(event) => updateDraft(item.thread_id, 'working_dir', event.currentTarget.value)} />
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                          <button type="button" class={BUTTON_CLASS} disabled={Boolean(actionPending()) || Object.values(draft()).some((value) => !String(value).trim())} onClick={() => void adopt(item.thread_id)}>{i18n.t('aiReadiness.settings.adopt')}</button>
                          <button type="button" class={BUTTON_CLASS} disabled={Boolean(actionPending())} onClick={() => void deleteRoot(item.thread_id)}>
                            <Trash class="h-4 w-4" aria-hidden="true" />
                            {deleteConfirmID() === item.thread_id ? i18n.t('aiReadiness.settings.confirmDelete') : i18n.t('common.actions.delete')}
                          </button>
                        </div>
                      </section>
                    );
                  }}</For>
                </div>
              </Show>
            </div>
          )}</Show>
        </SettingRow>
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.settings.redevenOwner')}
          description={i18n.t('aiReadiness.settings.redevenDescription')}
          control={<SettingsPill>{i18n.t('aiReadiness.settings.notChecked')}</SettingsPill>}
        />
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.settings.upstreamOwner')}
          description={i18n.t('aiReadiness.settings.upstreamDescription')}
          control={<SettingsPill>{i18n.t('aiReadiness.settings.notChecked')}</SettingsPill>}
        />
      </SettingsList>
    </SettingsSection>
  );
}
