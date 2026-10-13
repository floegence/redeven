import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { Button, Dialog, StableText } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { runtimeGatewayAccessPresentation, type RuntimeGatewayRecovery } from '../shared/runtimeGatewayAccessPresentation';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';

/** One enrollment session survives direct-executor recovery and observational snapshots. */
export function RuntimeGatewaySetupDialog(props: Readonly<{
  gateways?: readonly DesktopGatewaySource[];
  environment?: DesktopEnvironmentEntry;
  i18n: DesktopI18n;
  operationBusy?: boolean;
  progress?: DesktopLauncherActionProgress | null;
  progressContent?: JSX.Element;
  refresh: (environment: DesktopEnvironmentEntry) => Promise<boolean>;
  recover: (environment: DesktopEnvironmentEntry, operation: Exclude<RuntimeGatewayRecovery, 'refresh'>) => Promise<boolean>;
  edit: (environment: DesktopEnvironmentEntry) => void;
  close: () => void;
}>) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let generation = 0;
  const environmentID = createMemo(() => props.environment?.id ?? '');
  const presentation = createMemo(() => props.environment && runtimeGatewayAccessPresentation(props.environment, props.operationBusy));
  const ready = createMemo(() => presentation()?.phase === 'ready' && !busy());
  const recovery = () => presentation()?.recovery;
  const recoveryLabel = () => props.i18n.t(recovery() === 'start' ? 'gatewayJoin.startAndContinue'
    : recovery() === 'restart' ? 'environmentAction.restartRuntime'
      : recovery() === 'update' ? 'environmentAction.updateRuntime' : 'common.retry');
  const detail = () => {
    const control = props.environment?.provider_runtime_link_target?.runtime_control_status;
    if (presentation()?.phase === 'management_unavailable' && control?.state === 'missing') {
      if (control.reason_code === 'container_engine_unavailable') return props.i18n.t('gatewayJoin.containerHelp');
      if (control.reason_code === 'auth_required' || control.reason_code === 'unverified') return props.i18n.t('gatewayJoin.credentialsHelp');
      if (control.reason_code === 'forward_unavailable') return props.i18n.t('gatewayJoin.channelHelp');
    }
    return props.i18n.t(presentation()?.phase === 'not_started' ? 'gatewayJoin.startHelp'
    : presentation()?.phase === 'control_missing' ? 'gatewayJoin.controlHelp'
      : presentation()?.phase === 'unsupported' ? 'gatewayJoin.unsupportedHelp'
        : presentation()?.phase === 'update_required' ? 'gatewayJoin.updateHelp'
        : presentation()?.phase === 'management_unavailable' ? 'gatewayJoin.managementHelp'
          : 'gatewayJoin.checkHelp');
  };

  async function refresh() {
    const environment = props.environment;
    if (!environment || busy() || props.operationBusy) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      if (!await props.refresh(environment) && current === generation) setError(props.i18n.t('gatewayJoin.checkFailed'));
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.checkFailed')); }
    finally { if (current === generation) setBusy(false); }
  }
  async function recover() {
    const environment = props.environment, operation = recovery();
    if (!environment || !operation || !presentation()?.recovery_enabled || busy() || props.operationBusy) return;
    if (operation === 'refresh') return refresh();
    const current = generation;
    setBusy(true); setError('');
    try {
      const completed = await props.recover(environment, operation);
      if (current !== generation) return;
      if (!completed) setError(props.i18n.t('gatewayJoin.recoveryFailed'));
      else if (!await props.refresh(environment) && current === generation) setError(props.i18n.t('gatewayJoin.checkFailed'));
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.recoveryFailed')); }
    finally { if (current === generation) setBusy(false); }
  }
  createEffect(on(environmentID, id => {
    generation++; setBusy(false); setError('');
    // Checking is read-only; opening never starts, restarts or updates the Runtime.
    if (id && presentation()?.phase !== 'ready') void refresh();
  }));
  onCleanup(() => { generation++; });
  return <Dialog open={!!props.environment} onOpenChange={value => { if (!value) props.close(); }} title={props.i18n.t('gatewayJoin.title')}
    bodyDescription={props.i18n.t('gatewayJoin.codeHelp')} closeLabel={props.i18n.t('common.close')}
    class="redeven-gateway-dialog redeven-gateway-join-dialog" contentClass="redeven-gateway-join-content">
    <Show when={props.environment?.provider_runtime_link_target?.id} keyed>{targetID =>
      <RuntimeGatewayJoinPanel gateways={props.gateways} embedded targetID={targetID} targetLabel={props.environment?.label}
        i18n={props.i18n} onClose={props.close} ready={ready()}
        preparation={<Show when={!ready()}><section class="redeven-gateway-join-section" data-gateway-preparation={presentation()?.phase}>
          <p class="font-medium">{props.i18n.t('gatewayJoin.prepareTitle')}</p>
          <p class="text-sm text-muted-foreground">{detail()}</p>
          <Show when={recovery() === 'restart' || recovery() === 'update'}><p class="text-sm text-muted-foreground">{props.i18n.t('gatewayJoin.recoveryImpact')}</p></Show>
          <Show when={(busy() || props.operationBusy) && !props.progress}><p role="status" class="text-sm">{props.i18n.t('progress.checkingRuntime')}</p></Show>
          {props.progressContent}
          <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        </section></Show>}
        preparationActions={<>
          <Show when={props.environment?.can_edit}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            onClick={() => { if (props.environment) props.edit(props.environment); }}>{props.i18n.t('common.settings')}</Button></Show>
          <Show when={presentation()?.phase === 'control_missing'}><Button class="cursor-pointer whitespace-nowrap" variant="outline"
            disabled={busy() || props.operationBusy || props.environment?.runtime_operations.refresh.availability !== 'available'}
            onClick={() => void refresh()}>{props.i18n.t('environmentAction.refreshRuntimeStatus')}</Button></Show>
          <Show when={recovery()}><Button class="cursor-pointer whitespace-nowrap" disabled={busy() || props.operationBusy || !presentation()?.recovery_enabled}
            onClick={() => void recover()}><StableText reserve={[recoveryLabel()]}>{recoveryLabel()}</StableText></Button></Show>
        </>} />
    }</Show>
  </Dialog>;
}
