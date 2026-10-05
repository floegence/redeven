import { For, Show, createMemo } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Settings, Trash } from '@floegence/floe-webapp-core/icons';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { buildProviderBackedEnvironmentActionModel } from './viewModel';
import { ConsoleActionIconButton } from './environmentCardPrimitives';
import { DesktopTooltip } from './DesktopTooltip';

/** Gateway-owned rows over the same entries and access actions as the environment library. */
export function GatewayEnvironmentList(props: {
  i18n: DesktopI18n;
  environments: readonly DesktopEnvironmentEntry[];
  disabled: boolean;
  edit: (environment: DesktopEnvironmentEntry) => void;
  remove: (environment: DesktopEnvironmentEntry) => void;
  open: (environment: DesktopEnvironmentEntry, mode: 'direct_url' | 'gateway_proxy') => void;
}) {
  const entries = createMemo(() => new Map(props.environments.map(environment => [environment.id, environment])));
  const ids = createMemo(() => [...entries().keys()]);
  return <ul class="redeven-gateway-environments">
    <For each={ids()}>{id => {
      const environment = () => entries().get(id)!;
      const actions = createMemo(() => buildProviderBackedEnvironmentActionModel(environment()).action_presentation.menu_actions
        .filter(item => item.action.access_mode));
      const address = () => environment().gateway_environment_profile_access_route?.url ?? environment().local_ui_url ?? '';
      return <li class="redeven-gateway-environment" data-gateway-environment-id={environment().gateway_env_id}>
        <div class="redeven-gateway-environment__identity">
          <strong title={environment().label}>{environment().label}</strong>
          <Show when={address()}><span title={address()}>{address()}</span></Show>
          <Show when={environment().gateway_environment_profile?.access_route_kind === 'url'}>
            <span class="redeven-gateway-environment__mode">{props.i18n.t('gatewayAccess.mode')} · {props.i18n.t(environment().gateway_environment_profile?.access_mode === 'gateway_proxy' ? 'gatewayAccess.proxy' : 'gatewayAccess.direct')}</span>
          </Show>
        </div>
        <div class="redeven-gateway-environment__actions">
          <For each={actions()}>{item => <Button size="xs" variant="outline"
            disabled={props.disabled || !item.action.enabled}
            onClick={() => props.open(environment(), item.action.access_mode!)}>
            {props.i18n.t(item.label_key!)}
          </Button>}</For>
          <Show when={actions().length === 0}><span class="text-xs text-muted-foreground">{props.i18n.t('gatewayAccess.unsupported')}</span></Show>
        </div>
        <div class="redeven-gateway-environment__controls">
          <DesktopTooltip content={props.i18n.t(environment().can_edit ? 'gatewayAccess.editProfile'
            : environment().gateway_environment_profile?.access_route_kind !== 'url' ? 'gatewayAccess.unsupported' : 'gatewayAccess.writePermission')}>
            <span><ConsoleActionIconButton disabled={props.disabled || !environment().can_edit} title={props.i18n.t('gatewayAccess.editProfile')}
              aria-label={props.i18n.t('environmentCenter.settingsForLabel', { label: environment().label })}
              onClick={() => props.edit(environment())}><Settings class="h-3.5 w-3.5" /></ConsoleActionIconButton></span>
          </DesktopTooltip>
          <Show when={environment().can_delete}>
            <DesktopTooltip content={props.i18n.t('gatewayAccess.deleteProfile')}>
              <ConsoleActionIconButton danger disabled={props.disabled} title={props.i18n.t('gatewayAccess.deleteProfile')}
                aria-label={props.i18n.t('environmentCenter.removeLabel', { label: environment().label })}
                onClick={() => props.remove(environment())}><Trash class="h-3.5 w-3.5" /></ConsoleActionIconButton>
            </DesktopTooltip>
          </Show>
        </div>
      </li>;
    }}</For>
  </ul>;
}
