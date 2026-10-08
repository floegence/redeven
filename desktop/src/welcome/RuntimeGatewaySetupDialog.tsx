import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';

/** Registration and local Runtime startup precede the single membership API. */
export function RuntimeGatewaySetupDialog(props: Readonly<{
  environment?: DesktopEnvironmentEntry; i18n: DesktopI18n;
  start: (environment: DesktopEnvironmentEntry) => Promise<boolean>; close: () => void;
}>) {
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('');
  let generation = 0, environmentID = '';
  createEffect(() => {
    const next = props.environment?.id ?? '';
    if (next !== environmentID) { environmentID = next; generation++; setBusy(false); setError(''); }
  });
  onCleanup(() => { generation++; });
  const target = () => {
    const value = props.environment?.provider_runtime_link_target;
    return value?.runtime_running && value.runtime_control_status.state === 'available' ? value : undefined;
  };
  async function start() {
    if (!props.environment || busy()) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      if (!await props.start(props.environment) && current === generation) setError(props.i18n.t('gatewayJoin.startFailed'));
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.startFailed')); }
    finally { if (current === generation) setBusy(false); }
  }
  return <Dialog open={!!props.environment} onOpenChange={value => { if (!value) props.close(); }} title={props.i18n.t('gatewayJoin.title')}
    bodyDescription={props.i18n.t('gatewayJoin.consent')} closeLabel={props.i18n.t('common.close')} class="redeven-gateway-dialog redeven-gateway-join-dialog" contentClass="redeven-gateway-join-content">
    <Show when={target()?.id} keyed fallback={<div class="redeven-gateway-join-layout">
      <div class="redeven-gateway-join-scroll">
        <div class="redeven-gateway-empty-state redeven-gateway-setup-empty">
          <p class="font-semibold text-foreground">{props.i18n.t('gatewayJoin.startTitle')}</p>
          <p>{props.i18n.t('gatewayJoin.startHelp')}</p>
        </div>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
      </div>
      <div class="redeven-gateway-join-actions">
        <Button class="cursor-pointer" variant="outline" onClick={props.close}>{props.i18n.t('gatewayJoin.notNow')}</Button>
        <Button class="cursor-pointer" loading={busy()} onClick={() => void start()}>{props.i18n.t('gatewayJoin.startAndContinue')}</Button>
      </div>
    </div>}>{value => <RuntimeGatewayJoinPanel embedded targetID={value} i18n={props.i18n} onClose={props.close} />}</Show>
  </Dialog>;
}
