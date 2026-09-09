import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  type JSX,
} from 'solid-js';
import { Button, Checkbox } from '@floegence/floe-webapp-core/ui';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';

export type ManagementAction =
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
  actions?: { stop?: { available: boolean } };
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
  onLegacyRestore: () => void;
  onReinstall: () => void;
  canLegacyRestore: boolean;
  canReinstall?: boolean;
  ownershipReview?: JSX.Element;
  onService: (id: string) => void;
  operation?: {
    label: string;
    current: number;
    total: number;
    cancellable: boolean;
  } | null;
  onCancelOperation?: () => void;
}) {
  const i18n = useI18n();
  const [request, setRequest] = createSignal<ManagementRequest>({
    action: 'uninstall',
  });
  const [plan, setPlan] = createSignal<ManagementPlan | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [executing, setExecuting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [revision, setRevision] = createSignal(0);
  let generation = 0;
  const text = (key: string) =>
    i18n.t(`webServices.management.${key}` as EnvAppTranslationKey);
  createEffect(
    on(
      () => [props.service?.service_id, props.initialAction] as const,
      () => {
        setRequest({ action: props.initialAction });
        setPlan(null);
        setError('');
        if (!props.service) generation++;
      },
    ),
  );
  createEffect(() => {
    const service = props.service;
    const body = request();
    revision();
    if (!service) return;
    const controller = new AbortController();
    const current = ++generation;
    setLoading(true);
    setError('');
    setPlan(null);
    void fetchLocalApiJSON<ManagementPlan>(
      `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(service.service_id)}/management-plans`,
      { method: 'POST', body: JSON.stringify(body), signal: controller.signal },
    )
      .then((value) => {
        if (current === generation) setPlan(value);
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
        if (current === generation) setLoading(false);
      });
    onCleanup(() => controller.abort());
  });
  const choose = (action: ManagementAction) => setRequest({ action });
  const execute = async () => {
    const current = plan();
    if (!current || current.blockers.length || executing() || loading()) return;
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
    props.service?.management_state === 'uninstalled';
  const hasCleanupSelection = () =>
    Boolean(
      request().delete_data ||
        request().delete_workspace ||
        plan()?.facts.resources?.some(
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
  const problem = (code: string) => i18n.t(managementProblemKey(code));
  return (
    <EnvAppDrawer
      open={!!props.service}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={props.service?.name ?? text('title')}
      description={text('title')}
      bodyClass="min-h-0"
    >
      <div class="space-y-6 p-1" data-testid="service-management-drawer">
        <section class="space-y-2">
          <h3 class="text-sm font-semibold">{text('currentSituation')}</h3>
          <p class="text-sm">
            {i18n.t(
              managementStatusKey(
                props.service?.status ?? 'inspection_unavailable',
              ),
            )}
          </p>
          <Show when={plan()?.facts.checked_at_unix_ms}>
            <p class="text-xs text-muted-foreground">
              {text('checkedAt')}{' '}
              {i18n.formatDateTime(plan()!.facts.checked_at_unix_ms, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </Show>
          <Show when={loading()}>
            <p role="status" class="text-xs text-muted-foreground">
              {text('checking')}
            </p>
          </Show>
          <Show when={props.operation}>
            {(operation) => (
              <div
                class="space-y-2 rounded-lg border p-3 text-sm"
                role="status"
              >
                <p>
                  {operation().label}{' '}
                  <span class="tabular-nums text-muted-foreground">
                    {operation().current}/{operation().total}
                  </span>
                </p>
                <Show when={operation().cancellable}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onCancelOperation?.()}
                  >
                    {i18n.t('webServices.actions.cancel')}
                  </Button>
                </Show>
                <p class="text-xs text-muted-foreground">
                  {text('cancelMeaning')}
                </p>
              </div>
            )}
          </Show>
        </section>
        <section class="space-y-3">
          <h3 class="text-sm font-semibold">{text('resources')}</h3>
          {props.ownershipReview}
          <Show when={plan()}>
            {(current) => (
              <div class="flex justify-between gap-3 rounded-lg border p-3 text-xs">
                <span>{text('runtimeInstance')}</span>
                <span>
                  {text(
                    current().facts.presence === 'absent'
                      ? 'removed'
                      : current().facts.presence === 'unknown'
                        ? 'unknown'
                        : current().facts.runtime === 'running'
                          ? 'status.running'
                          : 'status.stopped',
                  )}
                </span>
              </div>
            )}
          </Show>
          <For each={plan()?.facts.resources ?? []}>
            {(resource) => (
              <div class="rounded-lg border p-3 text-xs space-y-2">
                <div class="flex justify-between gap-3">
                  <span class="font-medium">
                    {resource.resource_id === 'workspace'
                      ? text('workspace')
                      : resource.kind === 'network'
                        ? text('network')
                        : text('data')}
                  </span>
                  <span>
                    {text(
                      resource.presence === 'absent'
                        ? 'removed'
                        : resource.presence === 'unknown'
                          ? 'unknown'
                          : 'retained',
                    )}
                  </span>
                </div>
                <p class="break-all font-mono text-muted-foreground">
                  {resource.identity}
                </p>
                <Show when={resource.problem_code}>
                  <p class="text-warning">{problem(resource.problem_code!)}</p>
                </Show>
                <For each={resource.references ?? []}>
                  {(reference) => (
                    <button
                      type="button"
                      class="flex w-full cursor-pointer items-center justify-between gap-2 rounded p-1 text-left text-primary hover:bg-muted"
                      onClick={() => props.onResource(reference.container_id)}
                    >
                      <span class="truncate">
                        {reference.name ?? reference.container_id}
                        <Show when={reference.managed_service_id}>
                          <span class="block truncate font-mono text-[10px] text-muted-foreground">
                            {reference.managed_service_id}
                          </span>
                        </Show>
                        <Show when={reference.ports?.length}>
                          <span class="block text-[10px] text-muted-foreground">
                            {reference.ports
                              ?.map((port) => `${port.host_port ?? port.port}`)
                              .join(', ')}
                          </span>
                        </Show>
                      </span>
                      <span>
                        {text(
                          reference.state === 'running'
                            ? 'status.running'
                            : reference.state
                              ? 'status.stopped'
                              : 'unknown',
                        )}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
          <Show when={props.service?.last_failure}>
            <details class="rounded-lg border p-3 text-xs">
              <summary class="cursor-pointer font-medium">
                {text('recentOperation')}
              </summary>
              <p class="mt-2">
                {problem(props.service!.last_failure!.error_code)}
              </p>
              <dl class="mt-2 space-y-1 break-all font-mono text-muted-foreground">
                <dt>{text('diagnostics')}</dt>
                <dd>{props.service?.service_id}</dd>
                <dd>{props.service?.last_failure?.operation_id}</dd>
                <dd>{props.service?.last_failure?.error_code}</dd>
              </dl>
            </details>
          </Show>
        </section>
        <section class="space-y-3">
          <h3 class="text-sm font-semibold">{text('nextAction')}</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={
                request().action === 'uninstall' ? 'secondary' : 'outline'
              }
              onClick={() => choose('uninstall')}
              disabled={executing()}
            >
              {text(
                retainedArchive() ? 'cleanupRetained' : 'actions.uninstall',
              )}
            </Button>
            <Button
              size="sm"
              variant={request().action === 'recover' ? 'secondary' : 'outline'}
              onClick={() => choose('recover')}
              disabled={executing()}
            >
              {text('actions.recover')}
            </Button>
            <Show
              when={
                props.service?.actions?.stop?.available &&
                plan()?.facts.runtime === 'running'
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => choose('stop')}
                disabled={executing()}
              >
                {text('actions.stop')}
              </Button>
            </Show>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRevision((value) => value + 1)}
              disabled={loading()}
            >
              {text('recheck')}
            </Button>
          </div>
          <Show when={request().action === 'uninstall'}>
            <p class="text-xs text-muted-foreground">
              {text(retainedArchive() ? 'cleanupImpact' : 'uninstallImpact')}
            </p>
            <div class="grid gap-3">
              <Checkbox
                size="sm"
                label={text('deleteData')}
                checked={request().delete_data ?? false}
                disabled={!props.administrator || executing()}
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
                disabled={!props.administrator || executing()}
                onChange={(value) =>
                  setRequest((current) => ({
                    ...current,
                    delete_workspace: Boolean(value),
                  }))
                }
              />
              <p class="break-all font-mono text-xs text-muted-foreground">
                {props.service?.workspace_path}
              </p>
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
                props.service?.management_state === 'uninstalled' ||
                props.service?.management_state === 'detached'
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
            <p class="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              {text('detachImpact')}
            </p>
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-sm text-destructive">
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
                plan()?.facts.resources?.some(
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
          <Button
            size="sm"
            variant={
              request().action === 'uninstall' || request().action === 'detach'
                ? 'destructive'
                : 'default'
            }
            onClick={() => void execute()}
            disabled={
              !plan() ||
              loading() ||
              executing() ||
              Boolean(plan()?.blockers.length) ||
              (retainedArchive() &&
                request().action === 'uninstall' &&
                !hasCleanupSelection()) ||
              (request().action === 'detach' && !props.administrator)
            }
          >
            {executing() ? text('executing') : actionLabel()}
          </Button>
          <Show when={request().action === 'uninstall'}>
            <p class="text-xs text-muted-foreground">{text('cancelMeaning')}</p>
          </Show>
          <details class="border-t pt-3">
            <summary class="cursor-pointer text-xs font-medium">
              {text('advanced')}
            </summary>
            <div class="mt-3 space-y-3">
              <Button size="sm" variant="outline" onClick={props.onSettings}>
                {text('settings')}
              </Button>
              <Show when={props.canLegacyRestore}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={props.onLegacyRestore}
                >
                  {text('verifyProcess')}
                </Button>
              </Show>
              <Show
                when={
                  props.administrator &&
                  props.service?.management_state !== 'detached' &&
                  props.service?.management_state !== 'uninstalled'
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => choose('detach')}
                  disabled={executing()}
                >
                  {text('actions.detach')}
                </Button>
              </Show>
              <Show
                when={
                  props.administrator &&
                  (request().action === 'uninstall' ||
                    request().action === 'stop')
                }
              >
                <Checkbox
                  size="sm"
                  label={text('skipHooks')}
                  checked={request().skip_hooks ?? false}
                  onChange={(value) =>
                    setRequest((current) => ({
                      ...current,
                      skip_hooks: Boolean(value),
                    }))
                  }
                />
              </Show>
            </div>
          </details>
        </section>
      </div>
    </EnvAppDrawer>
  );
}
