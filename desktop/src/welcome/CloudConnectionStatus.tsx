import { Show, createMemo } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';
import { buildProviderBackedEnvironmentActionModel, type EnvironmentActionModel } from './viewModel';

export function cloudConnectionState(runtime: DesktopEnvironmentEntry, cloud: DesktopEnvironmentEntry): string {
  const target = runtime.provider_runtime_link_target;
  if (cloud.control_plane_sync_state === 'auth_required') return 'sign_in_required';
  if (target?.provider_connection_state === 'connected') return 'connected';
  if (target?.credential_recovery_details?.last_error_code === 'provider_tls_untrusted') return 'tls_error';
  return target?.credential_recovery ?? target?.provider_connection_state ?? 'unknown';
}

export function CloudConnectionStatus(props: Readonly<{
  runtime: DesktopEnvironmentEntry; cloud: DesktopEnvironmentEntry; i18n: DesktopI18n;
  busy: boolean; onRuntimeAction: (action: EnvironmentActionModel) => void;
  onSignIn?: () => void;
}>) {
  const target = () => props.runtime.provider_runtime_link_target;
  const state = () => cloudConnectionState(props.runtime, props.cloud);
  const localAvailable = () => props.runtime.kind === 'local_environment'
    && props.runtime.runtime_operations.open.availability === 'available';
  const titleKey = createMemo((): DesktopTranslationKey => {
    switch (state()) {
      case 'connected': return 'providerRecovery.connected';
      case 'connecting': return 'providerRecovery.connecting';
      case 'restoring': return 'providerRecovery.restoring';
      case 'retrying': return 'providerRecovery.retrying';
      case 'waiting': case 'waiting_for_service': return 'providerRecovery.waitingService';
      case 'sign_in_required': return 'environmentCenter.cloudSignInRequired';
      case 'permission_required': return 'providerRecovery.permissionRevoked';
      case 'disabled': return 'providerRecovery.disabled';
      case 'unknown': return 'providerRecovery.unknown';
      case 'authorization_required': return target()?.provider_link_binding?.last_error_code === 'CONTROL_CREDENTIALS_EXPIRED'
        ? 'providerRecovery.expired' : 'providerRecovery.needsAuthorization';
      default: return 'providerRecovery.attention';
    }
  });
  const detailKey = createMemo((): DesktopTranslationKey => {
    switch (state()) {
      case 'waiting': case 'waiting_for_service': return 'providerRecovery.waitingDetail';
      case 'restoring': case 'connecting': case 'retrying': return 'providerRecovery.restoringDetail';
      case 'sign_in_required': return 'environmentCenter.cloudSignInRequiredDetail';
      case 'permission_required': return 'providerRecovery.permissionDetail';
      case 'tls_error': return 'providerRecovery.tlsDetail';
      case 'binding_changed': return 'providerRecovery.bindingDetail';
      case 'unknown': return 'providerRecovery.unknownDetail';
      default: return 'providerRecovery.attentionDetail';
    }
  });
  const restoreAction = createMemo(() => buildProviderBackedEnvironmentActionModel(props.runtime)
    .action_presentation.menu_actions.find(item => item.action.intent === 'connect_provider_runtime')?.action);
  const canRestore = () => !['connected', 'connecting', 'restoring', 'retrying', 'unknown', 'tls_error', 'sign_in_required', 'permission_required', 'binding_changed'].includes(state())
    && restoreAction()?.enabled;
  const diagnostics = () => target()?.credential_recovery_details;
  const errorCode = () => diagnostics()?.last_error_code ?? target()?.provider_link_binding?.last_error_code;
  return (
    <div class="redeven-cloud-connection-status" data-cloud-connection-status data-runtime-target={target()?.id}>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status" aria-live="polite">
        <span class={localAvailable() ? 'text-success' : 'text-muted-foreground'}>
          {props.i18n.t(localAvailable() ? 'providerRecovery.localAvailable' : 'providerRecovery.runtimeStatus', { label: props.runtime.label })}
        </span>
        <span class={state() === 'connected' ? 'text-success' : 'text-warning'}>
          {props.i18n.t('environmentCenter.providerFilter')} · {props.i18n.t(titleKey())}
        </span>
      </div>
      <Show when={state() !== 'connected'}>
        <p class="text-xs text-muted-foreground">{props.i18n.t(detailKey())}</p>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={canRestore()}>
            <Button size="sm" variant="outline" disabled={props.busy}
              onClick={() => { const action = restoreAction(); if (action) props.onRuntimeAction(action); }}>
              {props.i18n.t('providerRecovery.restoreShort')}
            </Button>
          </Show>
          <Show when={state() === 'sign_in_required' && props.onSignIn}>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onSignIn?.()}>
              {props.i18n.t('environmentCenter.cloudSignInAgain')}
            </Button>
          </Show>
          <Show when={localAvailable()}>
            <Button size="sm" variant="ghost" disabled={props.busy}
              onClick={() => props.onRuntimeAction({ intent: 'open', label: props.i18n.t('providerRecovery.openLocally'), enabled: true, variant: 'outline' })}>
              {props.i18n.t('providerRecovery.openLocally')}
            </Button>
          </Show>
        </div>
        <details class="text-xs text-muted-foreground">
          <summary class="cursor-pointer">{props.i18n.t('providerRecovery.details')}</summary>
          <dl class="mt-2 space-y-1 break-words">
            <div><dt>{props.i18n.t('providerRecovery.runtimeOwner')}</dt><dd>{props.runtime.label}</dd></div>
            <Show when={errorCode()}><div><dt>{props.i18n.t('providerRecovery.lastError')}</dt><dd>{errorCode()}</dd></div></Show>
            <Show when={diagnostics()?.last_attempt_at_unix_ms}>{time => <div><dt>{props.i18n.t('providerRecovery.lastAttempt')}</dt><dd>{props.i18n.formatDateTime(time(), { dateStyle: 'short', timeStyle: 'medium' })}</dd></div>}</Show>
            <Show when={diagnostics()?.next_retry_at_unix_ms}>{time => <div><dt>{props.i18n.t('providerRecovery.nextCheck')}</dt><dd>{props.i18n.formatDateTime(time(), { dateStyle: 'short', timeStyle: 'medium' })}</dd></div>}</Show>
          </dl>
        </details>
      </Show>
    </div>
  );
}
