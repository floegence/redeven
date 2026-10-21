import { StableText, Button, Checkbox, Dropdown } from '@floegence/floe-webapp-core/ui';
import { writeTextToClipboard } from '../utils/clipboard';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type JSX,
} from 'solid-js';
import { Check, ChevronDown, Copy, FileText, MoreHorizontal, Pencil } from '@floegence/floe-webapp-core/icons';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';
import './web-services-management.css';

export type ManagementAction =
  | 'inspect'
  | 'uninstall'
  | 'recover'
  | 'restore'
  | 'detach'
  | 'stop';
export type ManagementRequest = Readonly<{
  retain_resource_ids?: readonly string[];
  action: ManagementAction;
  delete_data?: boolean;
  delete_workspace?: boolean;
  skip_hooks?: boolean;
}>;
export type ManagementResource = Readonly<{
  resource_id: string;
  kind: string;
  identity: string;
  presence: string;
  ownership: string;
  problem_code?: string;
  references?: ReadonlyArray<{
    container_id: string;
    name?: string;
    state: string;
    managed_service_id?: string;
    ports?: readonly { host_port?: number; port: number; host_ip?: string }[];
  }>;
}>;
export type ManagementPlan = Readonly<{
  plan_digest: string;
  request: ManagementRequest;
  path: string;
  blockers: readonly string[];
  conflict_service_id?: string;
  facts: {
    presence: string;
    runtime: string;
    ownership: string;
    checked_at_unix_ms: number;
    resources?: readonly ManagementResource[];
  };
}>;
export type ManagementService = Readonly<{
  service_id: string;
  name: string;
  workspace_path: string;
  status?: string;
  management_state?: string;
  problem_code?: string;
  actions?: Partial<Record<'open' | 'start' | 'restart' | 'stop' | 'recover' | 'restore_management', { available: boolean }>>;
  facts?: ManagementPlan['facts'];
  opening?: {state: string; error_code?: string; error_message?: string};
  last_failure?: {
    action?: string;
    error_code: string;
    message: string;
    operation_id?: string;
  };
}>;

export function managementStatusKey(status: string): EnvAppTranslationKey {
  const states = [
    'running',
    'stopped',
    'uninstall_pending',
    'recovery_required',
    'confirmation_required',
    'inspection_unavailable',
    'transition',
    'detached',
    'uninstalled',
  ];
  return `webServices.management.status.${states.includes(status) ? status : 'transition'}` as EnvAppTranslationKey;
}

export function managementProblemKey(code: string): EnvAppTranslationKey {
  const known: Record<string, string> = {
    RESOURCE_PERMISSION_DENIED: 'permissionDenied',
    RESOURCE_INSPECTION_TIMEOUT: 'inspectionTimeout',
    ENGINE_NOT_RUNNING: 'engineStopped',
    RESOURCE_IN_USE: 'inUse',
    WORKSPACE_IN_USE: 'inUse',
    RESOURCE_OWNERSHIP_UNVERIFIED: 'ownershipUnknown',
    RESOURCE_INSPECTION_INCOMPLETE: 'inspectionIncomplete',
    RESOURCE_INSPECTION_UNAVAILABLE: 'inspectionUnavailable',
    DOCKER_UNAVAILABLE: 'inspectionUnavailable',
    CONTAINER_INSPECTION_FAILED: 'inspectionUnavailable',
    RESOURCE_PLAN_STALE: 'stale',
    INSTANCE_ALREADY_EXISTS: 'activeConflict',
    REINSTALL_REQUIRED: 'missingData',
    RECOVERY_REQUIRED: 'missingInstance',
    INSTANCE_MISSING: 'missingInstance',
    STOP_SCRIPT_FAILED: 'hookFailed',
    STOP_SCRIPT_UNAVAILABLE: 'hookFailed',
    UNINSTALL_SCRIPT_FAILED: 'hookFailed',
    UNINSTALL_SCRIPT_UNAVAILABLE: 'hookFailed',
    DATA_REMOVE_FAILED: 'cleanupBlocked',
    HOST_PROCESS_IDENTITY_MISMATCH: 'ownershipUnknown',
    UNINSTALL_JOURNAL_INVALID: 'ownershipUnknown',
    LIFECYCLE_TRANSACTION_PENDING: 'transactionPending',
    ADMIN_REQUIRED: 'adminRequired',
    CONTAINER_IDENTITY_MISMATCH: 'ownershipUnknown',
    DATA_IDENTITY_MISMATCH: 'ownershipUnknown',
    WORKSPACE_DELETE_UNSAFE: 'ownershipUnknown',
    CURRENT_TEMPLATE_INVALID: 'configurationRequired',
    CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE: 'configurationRequired',
    TEMPLATE_PARAMETERS_INVALID: 'configurationRequired',
    TEMPLATE_NOT_FOUND: 'configurationRequired',
    OPERATION_CONFLICT: 'operationActive',
    SERVICE_NOT_ACTIVE: 'inactive',
    SERVICE_NOT_FOUND: 'notFound',
    COMPOSE_IDENTITY_MISSING: 'inspectionUnavailable',
    COMPOSE_IDENTITY_MISMATCH: 'ownershipUnknown',
    RUNTIME_BINDING_INVALID: 'ownershipUnknown',
    OPERATION_INTERRUPTED: 'interrupted',
    UNINSTALL_PENDING: 'transactionPending',
  };
  return `webServices.management.problems.${known[code] ?? 'operationFailed'}` as EnvAppTranslationKey;
}

export function ManagedServiceManagementDrawer(props: {
  service: ManagementService | null;
  initialAction: ManagementAction;
  administrator: boolean;
  onClose: () => void;
  onExecute: (
    request: ManagementRequest & { plan_digest: string },
  ) => Promise<void>;
  onResource: (identity: string) => void;
  onSettings: () => void;
  onOpen?: (refresh: boolean) => void;
  onStart?: () => void;
  onRestart?: () => void;
  onLogs?: () => void;
  onVersions?: () => void;
  canManage?: boolean;
  identity?: JSX.Element;
  operationContent?: JSX.Element;
  onLegacyRestore: () => void;
  onReinstall: () => void;
  canLegacyRestore: boolean;
  canReinstall?: boolean;
  ownershipReview?: JSX.Element;
  onService: (id: string) => void;
  operation?: {
    cancellable: boolean;
  } | null;
  onCancelOperation?: () => void;
}) {
  const i18n = useI18n();
  // Preserve the last reviewed identity while the shared Dialog exits.
  const displayedService = createMemo<ManagementService | null>((previous) => props.service ?? previous, null);
  const [request, setRequest] = createSignal<ManagementRequest>({
    action: 'uninstall',
  });
  const [plan, setPlan] = createSignal<ManagementPlan | null>(null);
  const [inspection, setInspection] = createSignal<ManagementService | null>(null);
  const currentService = () => inspection() ?? displayedService();
  const facts = () => plan()?.facts ?? currentService()?.facts;
  const inspecting = () => request().action === 'inspect';
  const [loading, setLoading] = createSignal(false);
  const [executing, setExecuting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [revision, setRevision] = createSignal(0);
  const [restartReview, setRestartReview] = createSignal(false);
  const [pathCopy, setPathCopy] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  const copyPath = async () => {
    try { await writeTextToClipboard(facts()?.resources?.find((resource) => resource.resource_id === 'workspace')?.identity ?? displayedService()?.workspace_path ?? ''); setPathCopy('copied'); }
    catch { setPathCopy('failed'); }
  };
  const copyPathButton = () => <Button size="sm" variant="ghost" class="redeven-copy-action" data-icon-only data-copied={pathCopy() === 'copied' || undefined} onClick={() => void copyPath()} aria-label={text('copyPath')} title={text('copyPath')}>
              <Show when={pathCopy() === 'copied'} fallback={<Copy class="h-3.5 w-3.5" />}><Check class="h-3.5 w-3.5" /></Show>
            </Button>;
  let generation = 0;
  const text = (key: string) =>
    i18n.t(`webServices.management.${key}` as EnvAppTranslationKey);
  const serviceID = createMemo(() => props.service?.service_id);
  createEffect(
    on(
      () => [serviceID(), props.initialAction] as const,
      () => {
        if (!props.service) { generation++; return; }
        setRequest({ action: props.initialAction });
        setRestartReview(false);
        setPlan(null);
        setInspection(props.service);
        setError('');
        setPathCopy('idle');
      },
    ),
  );
  // Inventory and inspection share one retained projection. Unknown checks never erase known facts.
  createEffect(on(() => props.service, (latest) => {
    const previous = inspection();
    if (latest?.service_id === previous?.service_id && latest?.facts && latest.facts.runtime !== 'unknown'
      && latest.facts.checked_at_unix_ms > (previous?.facts?.checked_at_unix_ms ?? 0)) setInspection(latest);
  }));
  createEffect(() => {
    const service = props.service;
    const body = request();
    revision();
    if (!service) return;
    const controller = new AbortController();
    const current = ++generation;
    setLoading(true);
    setError('');
    const readOnly = body.action === 'inspect';
    const timeout = window.setTimeout(() => { if(current===generation){setError('RESOURCE_INSPECTION_TIMEOUT');controller.abort();} }, 15000);
    void fetchLocalApiJSON<ManagementPlan | ManagementService>(
      `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(service.service_id)}/${readOnly ? 'inspection' : 'management-plans'}`,
      readOnly ? {signal:controller.signal} : { method: 'POST', body: JSON.stringify(body), signal: controller.signal },
    )
      .then((value) => {
        if (current === generation) {
          if (readOnly) {
            const latest = value as ManagementService;
            if (latest.status === 'inspection_unavailable' || latest.facts?.runtime === 'unknown') {
              const previous = inspection();
              setInspection({ ...latest, ...(previous?.facts && previous.facts.runtime !== 'unknown' ? {status: previous.status, facts: previous.facts} : {}) });
              setError(latest.problem_code || latest.opening?.error_code || 'RESOURCE_INSPECTION_UNAVAILABLE');
            } else {
              const previous = inspection();
              if ((latest.facts?.checked_at_unix_ms ?? 0) >= (previous?.facts?.checked_at_unix_ms ?? 0)) setInspection(latest);
            }
          }
          else setPlan(value as ManagementPlan);
        }
      })
      .catch((cause: unknown) => {
        if (current === generation && !controller.signal.aborted)
          setError(
            cause instanceof LocalApiError
              ? cause.code
              : 'RESOURCE_INSPECTION_UNAVAILABLE',
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (current === generation) setLoading(false);
      });
    onCleanup(() => { window.clearTimeout(timeout); controller.abort(); });
  });
  const choose = (action: ManagementAction) => {setPlan(null);setRestartReview(false);setRequest({ action });};
  const busy = () => executing() || Boolean(props.operation);
  const mutationDisabled = () => props.canManage === false || busy();
  const utilityItems = () => [
    ...(!inspecting() ? [{ id: 'inspect', label: text('title') }] : []),
    ...(currentService()?.actions?.stop?.available ? [{ id: 'stop', label: text('actions.stop') }] : []),
    ...(currentService()?.actions?.recover?.available ? [{ id: 'recover', label: text('actions.recover') }] : []),
    ...(currentService()?.management_state === 'detached' ? [{ id: 'restore', label: text('actions.restore') }] : []),
    ...(props.canLegacyRestore ? [{ id: 'verify', label: text('verifyProcess') }] : []),
    { id: 'uninstall', label: text(retainedArchive() ? 'cleanupRetained' : 'actions.uninstall') },
    ...(props.administrator && !['detached', 'uninstalled'].includes(currentService()?.management_state ?? '')
      ? [{ id: 'detach', label: text('actions.detach') }] : []),
  ].filter((item) => item.id !== request().action).map((item) => ({
    ...item, disabled: item.id !== 'inspect' && mutationDisabled(),
  }));
  const execute = async () => {
    const current = plan();
    if (inspecting() || mutationDisabled() || !props.service || !current || current.blockers.length || loading() || error()) return;
    setExecuting(true);
    setError('');
    try {
      await props.onExecute({
        ...current.request,
        plan_digest: current.plan_digest,
      });
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof LocalApiError ? cause.code : 'OPERATION_FAILED',
      );
    } finally {
      setExecuting(false);
    }
  };
  const retainedArchive = () =>
    displayedService()?.management_state === 'uninstalled';
  const hasCleanupSelection = () =>
    Boolean(
      request().delete_data ||
        request().delete_workspace ||
        facts()?.resources?.some(
          (item) =>
            item.kind === 'network' &&
            item.presence !== 'absent' &&
            item.ownership !== 'external' &&
            !request().retain_resource_ids?.includes(item.resource_id),
        ),
    );
  const actionLabel = () =>
    retainedArchive() && request().action === 'uninstall'
      ? text('cleanupRetained')
      : request().action === 'uninstall' &&
          !request().delete_data &&
          !request().delete_workspace
        ? text('retainUninstall')
        : text(
            `actions.${plan()?.path === 'restore_management' ? 'restore' : request().action}`,
          );
  const openingProblem = (code: string) => {
    if (code === 'OPENING_URL_MISSING') return 'openingMissing';
    if (code === 'OPENING_OUTPUT_UNAVAILABLE' || code === 'OPENING_OUTPUT_LIMIT' || code === 'OPENING_LINE_LIMIT') return 'openingOutput';
    if (code === 'HOST_OPEN_TARGET_INVALID' || code === 'OPENING_URL_INVALID') return 'openingInvalid';
    if (code === 'OPENING_ENTRY_AMBIGUOUS' || code === 'OPENING_ENTRY_UNAVAILABLE' || code === 'OPENING_GENERATION_UNAVAILABLE') return 'openingIdentity';
    return 'openingUnavailable';
  };
  const problem = (code: string) => i18n.t(managementProblemKey(code));
  return (
    <EnvAppDrawer
      open={!!props.service}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={displayedService()?.name ?? text('title')}
      class="service-management-panel"
      bodyClass="min-h-0"
      footer={<div class="service-management-footer" data-testid="service-management-footer">
        <div class="service-management-utilities">
          <Button size="sm" variant="ghost" icon={FileText} onClick={props.onLogs}>{i18n.t('webServices.managed.logs')}</Button>
          <Button size="sm" variant="ghost" icon={Pencil} onClick={props.onSettings} disabled={busy()}>{text('settings')}</Button>
          <Show when={props.onVersions}><Button size="sm" variant="ghost" onClick={props.onVersions} disabled={busy() || props.canManage === false}>{i18n.t('webServices.managed.versions')}</Button></Show>
          <Dropdown align="end" triggerAriaLabel={text('otherActions')} disabled={busy()} class="service-management-more" triggerClass="web-services-menu-trigger"
            items={utilityItems()} onSelect={(id) => id === 'verify' ? props.onLegacyRestore() : choose(id as ManagementAction)}
            trigger={<MoreHorizontal class="h-4 w-4" aria-hidden="true" />} />
        </div>
        <div class="service-management-footer-main">
          <Show when={props.operation}><p class="service-management-footer-note">{text('closeKeepsOperation')}</p></Show>
          <div class="service-management-primary-actions">
            <Show when={restartReview() && !props.operation}>
              <Button size="sm" onClick={props.onRestart} disabled={loading() || mutationDisabled()}>{i18n.t('webServices.managed.restart')}</Button>
              <Button size="sm" variant="outline" onClick={() => setRestartReview(false)}>{i18n.t('common.actions.cancel')}</Button>
            </Show>
            <Show when={inspecting() && !props.operation && !restartReview()}>
              <Show when={currentService()?.actions?.open?.available}><Button size="sm" onClick={() => props.onOpen?.(Boolean(currentService()?.opening?.error_code))} disabled={loading() || busy()}>{text(currentService()?.opening?.error_code ? 'retryOpen' : 'openService')}</Button></Show>
              <Show when={currentService()?.actions?.start?.available}><Button size="sm" onClick={props.onStart} disabled={loading() || mutationDisabled()}>{i18n.t('webServices.managed.start')}</Button></Show>
              <Show when={currentService()?.actions?.restart?.available && currentService()?.opening?.error_code}><Button size="sm" variant="outline" onClick={() => setRestartReview(true)} disabled={loading() || mutationDisabled()}>{i18n.t('webServices.managed.restart')}</Button></Show>
              <Show when={currentService()?.actions?.recover?.available}><Button size="sm" variant="outline" onClick={() => choose('recover')} disabled={mutationDisabled()}>{text('actions.recover')}</Button></Show>
              <Show when={currentService()?.management_state === 'detached'}><Button size="sm" variant="outline" onClick={() => choose('restore')} disabled={mutationDisabled()}>{text('actions.restore')}</Button></Show>
            </Show>
            <Show when={!inspecting() && !props.operation && !restartReview()}>
          <Button
            size="sm"
            variant={
              request().action === 'uninstall' || request().action === 'detach'
                ? 'destructive'
                : 'default'
            }
            class="service-management-execute"
            onClick={() => void execute()}
            disabled={
              mutationDisabled() || !plan() || Boolean(error()) ||
              loading() ||
              executing() ||
              Boolean(plan()?.blockers.length) ||
              (retainedArchive() &&
                request().action === 'uninstall' &&
                !hasCleanupSelection()) ||
              (request().action === 'detach' && !props.administrator)
            }
          >
            <StableText reserve={[text('executing'), actionLabel()]}>{executing() ? text('executing') : actionLabel()}</StableText>
          </Button>
            </Show>
            <Show when={props.operation?.cancellable}><Button size="sm" variant="outline" onClick={props.onCancelOperation}>{i18n.t('webServices.managed.cancelOperation')}</Button></Show>
            <Button size="sm" variant="outline" onClick={props.onClose}>{i18n.t('common.actions.close')}</Button>
          </div>
        </div>
      </div>}
    >
      <div class="service-management-body" data-testid="service-management-drawer">
        {props.identity}
        <section class="service-management-situation space-y-2">
          <div class="service-management-section-heading"><h3>{text('currentSituation')}</h3><Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)} disabled={loading() || executing()} loading={loading()}><StableText reserve={[text('checking'), text('recheck')]}>{text(loading() ? 'checking' : 'recheck')}</StableText></Button></div>
          <p class="service-management-conclusion">
            {i18n.t(
              managementStatusKey(
                currentService()?.status ?? 'inspection_unavailable',
              ),
            )}
          </p>
          <Show when={facts()?.checked_at_unix_ms}>
            <p class="text-xs text-muted-foreground">
              {text('checkedAt')}{' '}
              {i18n.formatDateTime(facts()!.checked_at_unix_ms, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </Show>
        </section>
        {props.operationContent}
        <section class="service-management-section">
          <h3>{text('resources')}</h3>
          {props.ownershipReview}
          <Show when={facts()}>
            {(current) => (
              <div class="service-management-resource-summary">
                <span>{text('runtimeInstance')}</span>
                <span>
                  {text(
                    current().presence === 'absent'
                      ? 'removed'
                      : current().presence === 'unknown'
                        ? 'unknown'
                        : current().runtime === 'running'
                          ? 'status.running'
                          : current().runtime === 'stopped' ? 'status.stopped' : 'unknown',
                  )}
                </span>
              </div>
            )}
          </Show>
          <For each={facts()?.resources ?? []}>
            {(resource) => {
              const label = () => text(resource.resource_id === 'workspace' ? 'workspace' : resource.kind === 'network' ? 'network' : 'data');
              const state = () => text(resource.presence === 'absent' ? 'removed' : resource.presence === 'unknown' ? 'unknown' : 'retained');
              return (
                <div class="service-management-resource">
                  <Show when={resource.resource_id === 'workspace'} fallback={
                    <details class="service-management-resource-details">
                      <summary><span>{label()}</span><span class="inline-flex items-center gap-2">{state()}<ChevronDown class="h-3 w-3" aria-hidden="true" /></span></summary>
                      <p class="service-management-resource-identity">{resource.identity}</p>
                      <Show when={resource.references?.length}>
                        <details class="service-management-references">
                          <summary><span>{text('references')}</span><span class="inline-flex items-center gap-2 tabular-nums">{resource.references?.length}<ChevronDown class="service-management-reference-chevron h-3 w-3" aria-hidden="true" /></span></summary>
                          <For each={resource.references ?? []}>
                            {(reference) => (
                              <button type="button" class="flex w-full cursor-pointer items-center justify-between gap-2 rounded p-1 text-left text-primary hover:bg-muted" onClick={() => props.onResource(reference.container_id)}>
                                <span class="min-w-0 truncate">{reference.name ?? reference.container_id}
                                  <Show when={reference.managed_service_id}><span class="block truncate font-mono text-[11px] text-muted-foreground">{reference.managed_service_id}</span></Show>
                                  <Show when={reference.ports?.length}><span class="block text-[11px] text-muted-foreground">{reference.ports?.map((port) => `${port.host_port ?? port.port}`).join(', ')}</span></Show>
                                </span>
                                <span>{text(reference.state === 'running' ? 'status.running' : reference.state ? 'status.stopped' : 'unknown')}</span>
                              </button>
                            )}
                          </For>
                        </details>
                      </Show>
                    </details>
                  }>
                    <div class="service-management-resource-summary"><span>{label()}</span><span class="inline-flex items-center gap-2">{state()}{copyPathButton()}</span></div>
                    <p class="service-management-resource-identity">{resource.identity}</p>
                  </Show>
                  <Show when={resource.problem_code}><p class="text-warning">{problem(resource.problem_code!)}</p></Show>
                </div>
              );
            }}
          </For>
          <Show when={!facts()?.resources?.some((resource) => resource.resource_id === 'workspace')}><div class="service-management-path">
            <div class="service-management-section-heading"><span>{text('workspace')}</span>{copyPathButton()}</div>
            <p class="service-management-resource-identity">{displayedService()?.workspace_path}</p>
          </div></Show>
          <Show when={pathCopy() !== 'idle'}><p role="status" class="text-xs">{pathCopy() === 'copied' ? i18n.t('common.actions.copied') : text('copyFailed')}</p></Show>
          <Show when={displayedService()?.last_failure}>
            <details class="rounded-lg border p-3 text-xs">
              <summary class="cursor-pointer font-medium">
                {text('recentOperation')}
              </summary>
              <p class="mt-2">
                {problem(displayedService()!.last_failure!.error_code)}
              </p>
              <dl class="mt-2 space-y-1 break-all font-mono text-muted-foreground">
                <dt>{text('diagnostics')}</dt>
                <dd>{displayedService()?.service_id}</dd>
                <dd>{displayedService()?.last_failure?.operation_id}</dd>
                <dd>{displayedService()?.last_failure?.error_code}</dd>
              </dl>
            </details>
          </Show>
        </section>
        <Show when={!inspecting() || error() || currentService()?.opening?.error_code || restartReview()}>
        <section class="service-management-section">
          <Show when={inspecting()}>
            <Show when={currentService()?.opening?.error_code}><p class="text-[length:var(--floe-type-body)] leading-5 text-warning" role="alert">{text(openingProblem(currentService()?.opening?.error_code ?? ''))}</p><Show when={currentService()?.opening?.error_code === 'OPENING_URL_MISSING' || currentService()?.opening?.error_code === 'OPENING_OUTPUT_UNAVAILABLE'}><p class="text-xs leading-5 text-muted-foreground">{text('restartEntranceImpact')}</p></Show></Show>
            <Show when={error()}><p role="alert" class="text-[length:var(--floe-type-body)] leading-5 text-destructive">{problem(error())}</p></Show>
            <Show when={restartReview()}><p class="text-[length:var(--floe-type-body)] leading-5">{text('restartReview')}</p></Show>
          </Show>
          <Show when={!inspecting()}>
            <Button size="sm" variant="ghost" onClick={() => choose('inspect')}>{text('title')}</Button>

          <Show when={request().action === 'uninstall'}>
            <p class="text-xs text-muted-foreground">
              {text(retainedArchive() ? 'cleanupImpact' : 'uninstallImpact')}
            </p>
            <p class="text-xs text-muted-foreground">{text('cancelMeaning')}</p>
            <div class="grid gap-3">
              <Checkbox
                size="sm"
                label={text('deleteData')}
                checked={request().delete_data ?? false}
                disabled={!props.administrator || mutationDisabled()}
                onChange={(value) =>
                  setRequest((current) => ({
                    ...current,
                    delete_data: Boolean(value),
                  }))
                }
              />
              <Checkbox
                size="sm"
                label={text('deleteWorkspace')}
                checked={request().delete_workspace ?? false}
                disabled={!props.administrator || mutationDisabled()}
                onChange={(value) =>
                  setRequest((current) => ({
                    ...current,
                    delete_workspace: Boolean(value),
                  }))
                }
              />

            </div>
          </Show>
          <Show
            when={
              request().action === 'recover' || request().action === 'restore'
            }
          >
            <p class="text-xs text-muted-foreground">
              {text(
                plan()?.path === 'restore_management'
                  ? 'restoreImpact'
                  : 'recreateImpact',
              )}
            </p>
          </Show>
          <Show when={plan()?.conflict_service_id}>
            <p class="break-all font-mono text-xs">
              {plan()?.conflict_service_id}
            </p>
          </Show>
          <Show
            when={
              plan()?.path === 'reinstall' ||
              plan()?.blockers.includes('RESOURCE_IN_USE')
            }
          >
            <p class="text-xs text-muted-foreground">{text('newDataImpact')}</p>
            <Show
              when={
                displayedService()?.management_state === 'uninstalled' ||
                displayedService()?.management_state === 'detached'
              }
              fallback={
                <p class="text-xs text-muted-foreground">
                  {text('detachBeforeReinstall')}
                </p>
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={props.onReinstall}
                disabled={props.canReinstall === false}
              >
                {text('reinstallNewData')}
              </Button>
              <Show when={props.canReinstall === false}>
                <p class="text-xs text-warning">
                  {text('problems.configurationRequired')}
                </p>
              </Show>
            </Show>
          </Show>
          <Show when={request().action === 'detach'}>
            <p class="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[length:var(--floe-type-body)]">
              {text('detachImpact')}
            </p>
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-[length:var(--floe-type-body)] text-destructive">
              {problem(error())}
            </p>
          </Show>
          <For each={Array.from(new Set(plan()?.blockers ?? []))}>
            {(code) => <p class="text-xs text-warning">{problem(code)}</p>}
          </For>
          <Show when={plan()?.conflict_service_id}>
            {(id) => (
              <Button
                size="sm"
                variant="outline"
                onClick={() => props.onService(id())}
              >
                {text('problems.activeConflict')}
              </Button>
            )}
          </Show>
          <Show
            when={
              plan()?.blockers.length &&
              request().action === 'uninstall' &&
              (request().delete_data ||
                request().delete_workspace ||
                facts()?.resources?.some(
                  (item) =>
                    item.kind === 'network' &&
                    !request().retain_resource_ids?.includes(item.resource_id),
                ))
            }
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setRequest({
                  action: 'uninstall',
                  retain_resource_ids: plan()
                    ?.facts.resources?.filter((item) => item.kind === 'network')
                    .map((item) => item.resource_id),
                })
              }
            >
              {text('preserveInstead')}
            </Button>
          </Show>
          <Show when={props.administrator && (request().action === 'uninstall' || request().action === 'stop')}>
          <details class="service-management-advanced">
            <summary>{text('advanced')}</summary>
            <div class="mt-3">
                <Checkbox
                  size="sm"
                  label={text('skipHooks')}
                  disabled={mutationDisabled()}
                  checked={request().skip_hooks ?? false}
                  onChange={(value) =>
                    setRequest((current) => ({
                      ...current,
                      skip_hooks: Boolean(value),
                    }))
                  }
                />
            </div>
          </details>
          </Show>
          </Show>
        </section>
        </Show>
      </div>
    </EnvAppDrawer>
  );
}
