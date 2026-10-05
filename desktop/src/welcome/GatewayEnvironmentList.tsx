import { For, Show, createMemo } from 'solid-js';
import { Button, StableText } from '@floegence/floe-webapp-core/ui';
import { Settings, Trash } from '@floegence/floe-webapp-core/icons';
import type { DesktopLauncherActionProgress, DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { buildProviderBackedEnvironmentActionModel } from './viewModel';
import { ConsoleActionIconButton } from './environmentCardPrimitives';
import { DesktopTooltip } from './DesktopTooltip';

/** Gateway-owned rows over the same entries and access actions as the environment library. */
export function GatewayEnvironmentList(props: {
  i18n: DesktopI18n;
  environments: readonly DesktopEnvironmentEntry[];
  disabled: boolean;
  progress?: readonly DesktopLauncherActionProgress[];
  revealProgress?: () => void;
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
        .filter(item => item.action.access_mode === 'gateway_proxy'));
      const running = () => props.progress?.some(item => item.action === 'open_gateway_environment' && item.gateway_id === environment().gateway_id && item.open_progress?.target_id === environment().id && item.status === 'running');
      const address = () => environment().gateway_environment_profile_access_route?.url ?? environment().local_ui_url ?? '';
      return <li class="redeven-gateway-environment" data-gateway-environment-id={environment().gateway_env_id}>
        <div class="redeven-gateway-environment__identity">
          <strong title={environment().label}>{environment().label}</strong>
          <Show when={address()}><span title={address()}>{address()}</span></Show>
          <span class="redeven-gateway-environment__mode">{props.i18n.t(environment().verified_runtime_identity ? 'gatewayAccess.linkedEnvironment' : 'gatewayAccess.identityNotVerified')}</span>
        </div>
        <div class="redeven-gateway-environment__actions">
          <For each={actions()}>{item => <Button size="xs" variant="outline"
            disabled={!running() && (props.disabled || !item.action.enabled)}
            data-floe-progress-shimmer={running() ? 'surface' : undefined}
            aria-busy={running() || undefined}
            title={props.i18n.t('gatewayAccess.viaNamedGateway', { gateway: environment().gateway_label ?? '' })}
            onClick={() => running() ? props.revealProgress?.() : props.open(environment(), item.action.access_mode!)}>
            <StableText reserve={[props.i18n.t('gatewayAccess.checkingAccess'), props.i18n.t('environmentAction.open')]}>{props.i18n.t(running() ? 'gatewayAccess.checkingAccess' : 'environmentAction.open')}</StableText>
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
