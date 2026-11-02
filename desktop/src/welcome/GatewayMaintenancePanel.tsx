import { For, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, Download, Package, Play, Refresh, Settings, Stop } from '@floegence/floe-webapp-core/icons';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewaySourceActionModel } from './viewModel';

export function GatewayMaintenancePanel(props: Readonly<{
  gateway: DesktopGatewaySource;
  i18n: DesktopI18n;
  available: boolean;
  busy: boolean;
  onAction: (action: GatewaySourceActionModel) => void;
}>) {
  const text = (key: Parameters<DesktopI18n['t']>[0]) => props.i18n.t(key);
  const disabled = () => !props.available || props.busy;
  const host = () => props.gateway.ssh_details?.ssh_destination
    || props.gateway.container_label || props.gateway.container_ref
    || text('gatewayAccess.localService');
  const action = (intent: GatewaySourceActionModel['intent'], label: string) =>
    props.onAction({ intent, label, enabled: !disabled(), variant: 'outline' });
  const controls = () => [
    ...(props.gateway.service_state?.can_start ? [{ intent: 'start_gateway' as const, label: text('environmentCenter.gatewayActionStart'), text: text('gatewayMaintenance.startAction'), icon: Play }] : []),
    ...(props.gateway.service_state?.can_restart ? [{ intent: 'restart_gateway' as const, label: text('environmentCenter.gatewayActionRestart'), text: text('gatewayMaintenance.restartAction'), icon: Refresh }] : []),
    ...(props.gateway.service_state?.can_stop ? [{ intent: 'stop_gateway' as const, label: text('environmentCenter.gatewayActionStop'), text: text('gatewayMaintenance.stopAction'), icon: Stop }] : []),
  ];
  return <div class="redeven-gateway-maintenance" data-gateway-maintenance>
    <div class="redeven-gateway-section-heading">
      <h3>{text('gatewayExperience.maintenance')}</h3>
      <Button variant="ghost" size="sm" icon={Refresh} disabled={disabled()} onClick={() => action('refresh_gateway', text('common.refresh'))}>{text('common.refresh')}</Button>
    </div>
    <dl class="redeven-gateway-maintenance-facts">
      <div><dt>{text('environmentCenter.gatewayPanelFactHost')}</dt><dd>{host()}</dd></div>
      <div><dt>{text('gatewayExperience.serviceVersion')}</dt><dd>{props.gateway.diagnosis?.managed_probe?.version || text('gatewayMaintenance.versionUnknown')}</dd></div>
      <Show when={props.gateway.service_state?.service_state_root || props.gateway.diagnosis?.managed_probe?.state_root}>
        {root => <div><dt>{text('gatewayMaintenance.dataDirectory')}</dt><dd class="redeven-gateway-maintenance-path">{root()}</dd></div>}
      </Show>
    </dl>
    <Show when={props.gateway.service_state?.status === 'needs_reinstall'}>
      <section class="redeven-gateway-maintenance-row redeven-gateway-maintenance-recovery" aria-label={text('gatewayMaintenance.reset')}>
        <h4><AlertTriangle aria-hidden="true" />{text('gatewayMaintenance.recovery')}</h4>
        <Button size="sm" variant="outline" icon={Settings} aria-label={text('gatewayMaintenance.reset')} disabled={disabled()} onClick={() => props.onAction({
          intent: 'reinstall_gateway', label: text('gatewayMaintenance.reset'), reset_configuration: true, enabled: !disabled(), variant: 'outline',
        })}>{text('gatewayMaintenance.resetAction')}</Button>
      </section>
    </Show>
    <section class="redeven-gateway-maintenance-row" aria-label={text('gatewayMaintenance.software')}>
      <h4>{text('gatewayMaintenance.software')}</h4>
      <div class="redeven-gateway-maintenance-actions">
        <Button size="sm" variant="outline" icon={Download} aria-label={text('environmentCenter.gatewayActionUpdate')} disabled={disabled()} onClick={() => action('update_gateway', text('environmentCenter.gatewayActionUpdate'))}>{text('gatewayMaintenance.updateAction')}</Button>
        <Button size="sm" variant="outline" icon={Package} aria-label={text('gatewayMaintenance.reinstall')} disabled={disabled()} onClick={() => action('reinstall_gateway', text('gatewayMaintenance.reinstall'))}>{text('gatewayMaintenance.reinstallAction')}</Button>
      </div>
    </section>
    <Show when={controls().length}>
      <section class="redeven-gateway-maintenance-row" aria-label={text('gatewayMaintenance.controls')}>
        <h4>{text('gatewayMaintenance.controls')}</h4>
        <div class="redeven-gateway-maintenance-actions"><For each={controls()}>{control => <Button size="sm" variant="outline" icon={control.icon} aria-label={control.label} disabled={disabled()} onClick={() => action(control.intent, control.label)}>{control.text}</Button>}</For></div>
      </section>
    </Show>
  </div>;
}
