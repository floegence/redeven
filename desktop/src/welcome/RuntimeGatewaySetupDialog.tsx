import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { Button, Dialog, Dropdown } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { runtimeGatewayAccessPresentation, type RuntimeGatewayRecovery } from '../shared/runtimeGatewayAccessPresentation';
import { RuntimeGatewayJoinPanel, type RuntimeGatewayPreparationResult } from './RuntimeGatewayJoinPanel';
import { environmentInteractionIdentity } from './environmentInteractionIdentity';

/** One enrollment session survives direct-executor recovery and observational snapshots. */
export function RuntimeGatewaySetupDialog(props: Readonly<{
  gateways?: readonly DesktopGatewaySource[];
  gatewayID?: string;
  recoverGateway?: (gateway: DesktopGatewaySource) => Promise<boolean>;
  open?: boolean;
  covered?: boolean;
  onPresenceChange?: (present: boolean) => void;
  environments?: readonly DesktopEnvironmentEntry[];
  selectEnvironment?: (id: string) => void;
  suspend?: () => void;
  environment?: DesktopEnvironmentEntry;
  i18n: DesktopI18n;
  operationBusy?: boolean;
  available?: boolean;
  suspended?: boolean;
  progress?: DesktopLauncherActionProgress | null;
  progressDetail?: string;
  refresh: (environment: DesktopEnvironmentEntry) => Promise<boolean>;
  recover: (environment: DesktopEnvironmentEntry, operation: Exclude<RuntimeGatewayRecovery, 'refresh'>, sshPassword?: string) => Promise<RuntimeGatewayPreparationResult>;
  edit: (environment: DesktopEnvironmentEntry) => void;
  close: () => void;
}>) {
  const [pending, setPending] = createSignal<RuntimeGatewayRecovery | null>(null);
  const busy = () => pending() !== null;
  const [error, setError] = createSignal('');
  const [connectionRequest, setConnectionRequest] = createSignal(0);
  const [requiredPreparation, setRequiredPreparation] = createSignal<'start' | 'restart' | 'update'>();
  let generation = 0;
  const environmentID = createMemo(() => props.environment?.id ?? '');
  const available = createMemo(() => props.available !== false);
  const managementCoordinates = createMemo(() => {
    const environment = props.environment;
    if (!environment) return '';
    // Native Presence adds live state-root details; the fixed local registration owns its coordinates.
    return environment.registration_ref?.kind === 'local_environment' ? environment.id : JSON.stringify([
      environment.managed_runtime_host_access, environment.managed_runtime_placement,
    ]);
  });
  const retainedTarget = createMemo<DesktopCloudRuntimeLinkTargetID | undefined>(previous => props.environment ? props.environment.provider_runtime_link_target?.id ?? previous : undefined);
  const presentation = createMemo(() => {
    const observed = props.environment && runtimeGatewayAccessPresentation(props.environment);
    const required = requiredPreparation();
    return required && observed ? { ...observed, phase: required === 'start' ? 'not_started' as const
      : required === 'restart' ? 'control_missing' as const : 'update_required' as const, recovery: required,
      recovery_enabled: props.environment?.runtime_operations[required].availability === 'available' } : observed;
  });
  const canConnect = createMemo(() => ['ready', 'connection_required'].includes(presentation()?.phase ?? ''));
  const submissionBlocked = () => props.suspended === true || props.available === false || !props.environment?.provider_runtime_link_target || !canConnect() || busy() || !!props.operationBusy;
  const control = () => presentation()?.revalidating ? props.environment?.runtime_health.observed_runtime_control_status
    ?? props.environment?.provider_runtime_link_target?.runtime_control_status : props.environment?.provider_runtime_link_target?.runtime_control_status;
  const technicalDetail = () => {
    const diagnosis = control();
    return diagnosis?.state === 'missing' ? diagnosis.message : props.environment?.runtime_health.offline_reason;
  };
  const progressText = () => props.progressDetail || (props.progress?.detail_key ? props.i18n.t(props.progress.detail_key)
    : props.progress?.title_key ? props.i18n.t(props.progress.title_key) : '');
  const recovery = () => presentation()?.recovery;
  const recoveryLabel = () => props.i18n.t(recovery() === 'start' ? 'gatewayJoin.startAndContinue'
    : recovery() === 'restart' ? 'environmentAction.restartRuntime'
      : recovery() === 'update' ? 'environmentAction.updateRuntime' : 'common.retry');
  const detail = () => {
    const diagnosis = control();
    const reason = diagnosis?.state === 'missing' ? diagnosis.reason_code : props.environment?.runtime_health.offline_reason_code;
    if (presentation()?.phase === 'management_unavailable') {
      if (reason === 'container_engine_unavailable') return props.i18n.t('gatewayJoin.containerHelp');
      if (reason === 'auth_required') return props.i18n.t('gatewayJoin.credentialsHelp');
      if (reason === 'unverified') return props.i18n.t('gatewayJoin.checkFailed');
      if (reason === 'forward_unavailable') return props.i18n.t('gatewayJoin.channelHelp');
    }
    return props.i18n.t(presentation()?.phase === 'not_started' ? 'gatewayJoin.startHelp'
    : presentation()?.phase === 'control_missing' ? 'gatewayJoin.controlHelp'
      : presentation()?.phase === 'unsupported' ? 'gatewayJoin.unsupportedHelp'
        : presentation()?.phase === 'update_required' ? 'gatewayJoin.updateHelp'
        : presentation()?.phase === 'management_unavailable' ? 'gatewayJoin.managementHelp'
          : 'gatewayJoin.checkHelp');
  };

  async function refresh(continueAfterCheck = true) {
    const environment = props.environment;
    if (!environment || props.suspended || props.available === false || busy() || props.operationBusy) return;
    const current = generation;
    setPending('refresh'); setError('');
    try {
      if (!await props.refresh(environment) && current === generation) setError(props.i18n.t('gatewayJoin.checkFailed'));
      else if (current === generation && continueAfterCheck) setConnectionRequest(value => value + 1);
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.checkFailed')); }
    finally { if (current === generation) setPending(null); }
  }
  async function recover(password?: string): Promise<RuntimeGatewayPreparationResult> {
    const environment = props.environment, operation = recovery();
    if (!environment || props.suspended || props.available === false || !operation || !presentation()?.recovery_enabled || busy() || props.operationBusy) return { ok: false };
    if (operation === 'refresh') { await refresh(); return { ok: true }; }
    const current = generation;
    setPending(operation); setError('');
    try {
      const result = await (password === undefined ? props.recover(environment, operation) : props.recover(environment, operation, password));
      if (current !== generation) return { ok: false };
      if (!result.ok && !result.authenticationRequired) setError(props.i18n.t('gatewayJoin.recoveryFailed'));
      else if (result.ok) {
        setRequiredPreparation(undefined);
        if (!await props.refresh(environment) && current === generation) setError(props.i18n.t('gatewayJoin.checkFailed'));
        else if (current === generation) setConnectionRequest(value => value + 1);
      }
      return result;
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.recoveryFailed')); return { ok: false }; }
    finally { if (current === generation) setPending(null); }
  }
  createEffect(on([environmentID, managementCoordinates, available], ([id], previous) => {
    generation++; setPending(null);
    setRequiredPreparation(undefined);
    if (id !== previous?.[0]) {
      setError(''); setConnectionRequest(0);
      // Checking is read-only; opening never starts, restarts or updates the Runtime.
      if (id && !canConnect()) void refresh(false);
    } else if (id) setError(props.i18n.t('interactionContinuity.unavailable'));
  }));
  createEffect(on(() => props.suspended === true, suspended => {
    if (suspended) { generation++; setPending(null); }
    else setRequiredPreparation(undefined);
  }, { defer: true }));
  onCleanup(() => { generation++; });
  // Retain the enrollment owner and drafts while settings temporarily covers the dialog.
  const enrollment = <Show when={retainedTarget()}>{targetID =>
      <RuntimeGatewayJoinPanel wizard gatewayID={props.gatewayID} recoverGateway={props.recoverGateway} connectionRequest={connectionRequest()} gateways={props.gateways} embedded targetID={targetID()} targetLabel={props.environment?.label}
        suspended={props.suspended}
        onPreparationRequired={failure => setRequiredPreparation(failure === 'runtime_not_started' ? 'start' : failure === 'SECURITY_RESTART_REQUIRED' ? 'restart' : 'update')}
        i18n={props.i18n} onClose={props.close} canConnect={canConnect()} submissionBlocked={submissionBlocked()}
        runtimeStartedAtUnixMS={props.environment?.runtime_started_at_unix_ms}
        managementCoordinates={managementCoordinates()}
        authorityKey={JSON.stringify([props.available !== false, props.environment && environmentInteractionIdentity(props.environment)])}
        preparation={<> <Show when={props.available === false}><p role="alert">{props.i18n.t('interactionContinuity.unavailable')}</p></Show> <Show when={!canConnect()}><section class="redeven-gateway-join-section" data-gateway-preparation={presentation()?.phase}>
          <p class="text-sm text-muted-foreground">{detail()}</p>
          <Show when={technicalDetail()}><details class="mt-2 text-sm text-muted-foreground"><summary class="cursor-pointer">{props.i18n.t('windowStatus.technicalDetails')}</summary><p class="mt-2 whitespace-pre-wrap break-words">{technicalDetail()}</p></details></Show>
          <Show when={recovery() === 'restart' || recovery() === 'update'}><p class="text-sm text-muted-foreground">{props.i18n.t('gatewayJoin.recoveryImpact')}</p></Show>
        </section></Show>
          <div class="redeven-gateway-connect-progress" classList={{ invisible: !busy() && !props.operationBusy }} role="status" aria-hidden={!busy() && !props.operationBusy}>
            <span class="redeven-gateway-connect-progress-dot" aria-hidden="true" />
            <span>{progressText() || props.i18n.t(pending() === 'start' ? 'progress.startingRuntime'
              : pending() === 'restart' ? 'progress.restartingRuntime' : pending() === 'update' ? 'progress.updatingRuntime'
                : pending() === 'refresh' ? 'environmentAction.refreshRuntimeStatus' : 'gatewayJoin.operationInProgress')}</span>
          </div>
          <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        </>}
        settingsAction={<Show when={props.environment?.can_edit}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            onClick={() => { if (props.environment) props.edit(props.environment); }}>{props.i18n.t('common.settings')}</Button></Show>}
        preparationActions={<>
          <Show when={presentation()?.phase === 'control_missing'}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            disabled={busy() || props.operationBusy || props.environment?.runtime_operations.refresh.availability !== 'available'}
            onClick={() => void refresh()}>{props.i18n.t('environmentAction.refreshRuntimeStatus')}</Button></Show>
        </>}
        preparationAction={recovery() ? { label: recoveryLabel(), run: recover,
          disabled: props.suspended === true || props.available === false || busy() || !!props.operationBusy || !presentation()?.recovery_enabled } : undefined} />
    }</Show>;
  return <Dialog open={(props.open ?? !!props.environment) && !props.suspended && !props.covered} onPresenceChange={props.onPresenceChange} onOpenChange={value => { if (!value) (props.suspend ?? props.close)(); }} title={props.i18n.t('gatewayJoin.title')}
    closeLabel={props.i18n.t('common.close')}
    class="redeven-gateway-dialog redeven-gateway-join-dialog redeven-gateway-wizard-dialog" contentClass="redeven-gateway-join-content">
    <Show when={!props.environment}>
      <div class="redeven-gateway-settings-section" data-gateway-environment-choice>
        <p class="redeven-gateway-help">{props.i18n.t('gatewayExperience.chooseEnvironmentHelp')}</p>
        <Dropdown triggerInputSurface triggerAriaLabel={props.i18n.t('gatewayMembers.chooseRuntime')}
          trigger={props.i18n.t('gatewayMembers.chooseRuntime')}
          items={() => (props.environments ?? []).filter(environment => !!runtimeGatewayAccessPresentation(environment)).map(environment => ({
            id: environment.id, label: environment.label,
            description: props.i18n.t(environment.provider_runtime_link_target?.runtime_running ? 'gatewayMembers.connected' : 'gatewayJoin.startAndContinue'),
          }))}
          onSelect={id => props.selectEnvironment?.(id)} />
        <Show when={!(props.environments ?? []).some(environment => !!runtimeGatewayAccessPresentation(environment))}>
          <p role="status" class="redeven-gateway-help">{props.i18n.t('gatewayExperience.noManagedEnvironments')}</p>
        </Show>
        <Button variant="ghost" onClick={props.close}>{props.i18n.t('common.cancel')}</Button>
      </div>
    </Show>
    {enrollment}
  </Dialog>;
}
