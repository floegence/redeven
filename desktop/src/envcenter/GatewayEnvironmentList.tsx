import { For, Show, type JSX } from 'solid-js';
import { Button, StableText } from '@floegence/floe-webapp-core/ui';
import type { EnvironmentEntry, OpenProgress, ListI18n } from './contracts';
import { projectEnvironment } from './core';
import { environmentOpenRunning } from './controller';

export function GatewayEnvironmentList<T extends EnvironmentEntry>(props: Readonly<{
  i18n: ListI18n;
  environments: readonly T[];
  disabled: boolean;
  progress?: readonly OpenProgress[];
  revealProgress?: () => void;
  open: (environment: T) => void;
  details?: (environment: T) => JSX.Element;
}>) {
  return <ul class="redeven-gateway-environments">
    <For each={props.environments}>{environment => {
      const presentation = () => projectEnvironment(environment);
      const running = () => environmentOpenRunning(environment, props.progress);
      return <li class="redeven-gateway-environment" data-gateway-environment-id={environment.gateway_env_id}>
        <div class="redeven-gateway-environment__identity">
          <strong title={environment.label}>{environment.label}</strong>
          <Show when={environment.gateway_member?.metadata.hostname}>{hostname => <span>{hostname()}</span>}</Show>
          <span class="text-xs text-muted-foreground">{props.i18n.t(presentation().connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</span>
        </div>
        <Button class="cursor-pointer" size="xs" variant="outline"
          disabled={!running() && (props.disabled || !presentation().openAvailable)}
          data-floe-progress-shimmer={running() ? 'surface' : undefined} aria-busy={running() || undefined}
          onClick={() => running() ? props.revealProgress?.() : props.open(environment)}>
          <StableText reserve={[props.i18n.t('gatewayAccess.checkingAccess'), props.i18n.t('environmentAction.open')]}>{props.i18n.t(running() ? 'gatewayAccess.checkingAccess' : 'environmentAction.open')}</StableText>
        </Button>
        <Show when={props.details}>{details => details()(environment)}</Show>
      </li>;
    }}</For>
  </ul>;
}
