import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { Button, Dialog, Input, StableText } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { runtimeGatewayAccessPresentation, type RuntimeGatewayRecovery } from '../shared/runtimeGatewayAccessPresentation';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { environmentInteractionIdentity } from './environmentInteractionIdentity';

/** One enrollment session survives direct-executor recovery and observational snapshots. */
export function RuntimeGatewaySetupDialog(props: Readonly<{
  gateways?: readonly DesktopGatewaySource[];
  environment?: DesktopEnvironmentEntry;
  i18n: DesktopI18n;
  operationBusy?: boolean;
  available?: boolean;
  suspended?: boolean;
  progress?: DesktopLauncherActionProgress | null;
  progressDetail?: string;
  refresh: (environment: DesktopEnvironmentEntry) => Promise<boolean>;
  recover: (environment: DesktopEnvironmentEntry, operation: Exclude<RuntimeGatewayRecovery, 'refresh'>, sshPassword?: string) => Promise<boolean>;
  edit: (environment: DesktopEnvironmentEntry) => void;
  close: () => void;
}>) {
  const [pending, setPending] = createSignal<RuntimeGatewayRecovery | null>(null);
  const busy = () => pending() !== null;
  const [error, setError] = createSignal('');
  const [connectionRequest, setConnectionRequest] = createSignal(0);
  const [verificationResetRequest, setVerificationResetRequest] = createSignal(0);
  const [requiredPreparation, setRequiredPreparation] = createSignal<'start' | 'restart' | 'update'>();
  const [recoveryPassword, setRecoveryPassword] = createSignal('');
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
  const recoveryNeedsPassword = () => recovery() === 'start' && props.environment?.managed_runtime_host_access?.kind === 'ssh_host'
    && props.environment.managed_runtime_host_access.ssh.auth_mode === 'password' && !props.environment.ssh_password_configured;
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
  async function recover() {
    const environment = props.environment, operation = recovery();
    if (!environment || props.suspended || props.available === false || !operation || !presentation()?.recovery_enabled || busy() || props.operationBusy
      || recoveryNeedsPassword() && !recoveryPassword()) return;
    if (operation === 'refresh') return refresh();
    const current = generation;
    setPending(operation); setError('');
    const password = recoveryNeedsPassword() ? recoveryPassword() : undefined;
    setRecoveryPassword('');
    try {
      const completed = await (password === undefined ? props.recover(environment, operation) : props.recover(environment, operation, password));
      if (current !== generation) return;
      if (!completed) setError(props.i18n.t('gatewayJoin.recoveryFailed'));
      else {
        setRequiredPreparation(undefined);
        setVerificationResetRequest(value => value + 1);
        if (!await props.refresh(environment) && current === generation) setError(props.i18n.t('gatewayJoin.checkFailed'));
        else if (current === generation) setConnectionRequest(value => value + 1);
      }
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.recoveryFailed')); }
    finally { if (current === generation) { setPending(null); setRecoveryPassword(''); } }
  }
  createEffect(on([environmentID, managementCoordinates, available], ([id], previous) => {
    generation++; setPending(null);
    setRequiredPreparation(undefined); setRecoveryPassword('');
    if (id !== previous?.[0]) {
      setError(''); setConnectionRequest(0);
      // Checking is read-only; opening never starts, restarts or updates the Runtime.
      if (id && !canConnect()) void refresh(false);
    } else if (id) setError(props.i18n.t('interactionContinuity.unavailable'));
  }));
  createEffect(on(() => props.suspended === true, suspended => {
    if (suspended) { generation++; setPending(null); setRecoveryPassword(''); }
    else setRequiredPreparation(undefined);
  }, { defer: true }));
  onCleanup(() => { generation++; });
  // Retain the enrollment owner and drafts while settings temporarily covers the dialog.
  const enrollment = <Show when={retainedTarget()}>{targetID =>
      <RuntimeGatewayJoinPanel wizard connectionRequest={connectionRequest()} verificationResetRequest={verificationResetRequest()} gateways={props.gateways} embedded targetID={targetID()} targetLabel={props.environment?.label}
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
          <Show when={recoveryNeedsPassword()}><label class="redeven-gateway-join-field"><span>{props.i18n.t('gatewayJoin.sshPassword')}</span>
            <Input type="password" autocomplete="current-password" value={recoveryPassword()} disabled={busy() || props.operationBusy}
              onInput={event => setRecoveryPassword(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void recover(); } }} />
          </label><p class="text-sm text-muted-foreground">{props.i18n.t('gatewayJoin.sshPasswordHelp')}</p></Show>
        </section></Show>
          <Show when={busy() || props.operationBusy}><div class="redeven-gateway-connect-progress" role="status">
            <span class="redeven-gateway-connect-progress-dot" aria-hidden="true" />
            <span>{progressText() || props.i18n.t(pending() === 'start' ? 'progress.startingRuntime'
              : pending() === 'restart' ? 'progress.restartingRuntime' : pending() === 'update' ? 'progress.updatingRuntime'
                : pending() === 'refresh' ? 'environmentAction.refreshRuntimeStatus' : 'gatewayJoin.operationInProgress')}</span>
          </div></Show>
          <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        </>}
        settingsAction={<Show when={props.environment?.can_edit}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            onClick={() => { if (props.environment) props.edit(props.environment); }}>{props.i18n.t('common.settings')}</Button></Show>}
        preparationActions={<>
          <Show when={presentation()?.phase === 'control_missing'}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            disabled={busy() || props.operationBusy || props.environment?.runtime_operations.refresh.availability !== 'available'}
            onClick={() => void refresh()}>{props.i18n.t('environmentAction.refreshRuntimeStatus')}</Button></Show>
          <Show when={recovery()}><Button class="cursor-pointer whitespace-nowrap" disabled={busy() || props.operationBusy || !presentation()?.recovery_enabled || recoveryNeedsPassword() && !recoveryPassword()}
            onClick={() => void recover()}><StableText reserve={[recoveryLabel()]}>{recoveryLabel()}</StableText></Button></Show>
        </>} />
    }</Show>;
  return <Dialog open={!!props.environment && !props.suspended} onOpenChange={value => { if (!value) props.close(); }} title={props.i18n.t('gatewayJoin.title')}
    closeLabel={props.i18n.t('common.close')}
    class="redeven-gateway-dialog redeven-gateway-join-dialog redeven-gateway-wizard-dialog" contentClass="redeven-gateway-join-content">
    {enrollment}
  </Dialog>;
}
