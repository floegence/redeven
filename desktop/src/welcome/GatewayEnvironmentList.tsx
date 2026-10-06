import { For, Show } from 'solid-js';
import { Button, StableText } from '@floegence/floe-webapp-core/ui';
import type { DesktopLauncherActionProgress, DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';

export function GatewayEnvironmentList(props: Readonly<{
  i18n: DesktopI18n;
  environments: readonly DesktopEnvironmentEntry[];
  disabled: boolean;
  progress?: readonly DesktopLauncherActionProgress[];
  revealProgress?: () => void;
  open: (environment: DesktopEnvironmentEntry) => void;
}>) {
  return <ul class="redeven-gateway-environments">
    <For each={props.environments}>{environment => {
      const running = () => props.progress?.some(item => item.action === 'open_gateway_environment'
        && item.gateway_id === environment.gateway_id && item.environment_id === environment.id && item.status === 'running');
      return <li class="redeven-gateway-environment" data-gateway-environment-id={environment.gateway_env_id}>
        <div class="redeven-gateway-environment__identity">
          <strong title={environment.label}>{environment.label}</strong>
          <Show when={environment.gateway_member?.metadata.hostname}>{hostname => <span>{hostname()}</span>}</Show>
          <span class="text-xs text-muted-foreground">{props.i18n.t(environment.gateway_member?.connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</span>
        </div>
        <Button class="cursor-pointer" size="xs" variant="outline"
          disabled={!running() && (props.disabled || environment.runtime_operations.open.availability !== 'available')}
          data-floe-progress-shimmer={running() ? 'surface' : undefined} aria-busy={running() || undefined}
          onClick={() => running() ? props.revealProgress?.() : props.open(environment)}>
          <StableText reserve={[props.i18n.t('gatewayAccess.checkingAccess'), props.i18n.t('environmentAction.open')]}>{props.i18n.t(running() ? 'gatewayAccess.checkingAccess' : 'environmentAction.open')}</StableText>
        </Button>
      </li>;
    }}</For>
  </ul>;
}
