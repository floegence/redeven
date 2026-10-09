import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { CheckCircle, Cloud, Info, X } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';
import { DesktopActionPopover } from './DesktopActionPopover';
import { buildProviderBackedEnvironmentActionModel, type EnvironmentActionModel } from './viewModel';

export function cloudConnectionState(runtime: DesktopEnvironmentEntry, cloud: DesktopEnvironmentEntry): string {
  const target = runtime.provider_runtime_link_target;
  if (cloud.control_plane_sync_state === 'auth_required') return 'sign_in_required';
  if (target?.provider_connection_state === 'connected') return 'connected';
  if (target?.credential_recovery_details?.last_error_code === 'provider_tls_untrusted') return 'tls_error';
  return target?.credential_recovery ?? target?.provider_connection_state ?? 'unknown';
}

export function cloudConnectionTitleKey(runtime: DesktopEnvironmentEntry, cloud: DesktopEnvironmentEntry): DesktopTranslationKey {
  const target = runtime.provider_runtime_link_target;
  switch (cloudConnectionState(runtime, cloud)) {
    case 'connected': return 'providerRecovery.connected';
    case 'connecting': return 'providerRecovery.connecting';
    case 'restoring': return 'providerRecovery.restoring';
    case 'retrying': return 'providerRecovery.retrying';
    case 'waiting': case 'waiting_for_service': return 'providerRecovery.waitingService';
    case 'sign_in_required': return 'environmentCenter.cloudSignInRequired';
    case 'permission_required': return 'providerRecovery.permissionRevoked';
    case 'disabled': return 'providerRecovery.disabled';
    case 'tls_error': return 'providerRecovery.tlsError';
    case 'binding_changed': return 'providerRecovery.bindingChanged';
    case 'unknown': return 'providerRecovery.unknown';
    case 'authorization_required': return target?.cloud_link_binding?.last_error_code === 'CONTROL_CREDENTIALS_EXPIRED'
      ? 'providerRecovery.expired' : 'providerRecovery.needsAuthorization';
    default: return 'providerRecovery.attention';
  }
}

export function CloudConnectionStatus(props: Readonly<{
  runtime: DesktopEnvironmentEntry; cloud: DesktopEnvironmentEntry; i18n: DesktopI18n;
  active: boolean; busy: boolean; onRuntimeAction: (action: EnvironmentActionModel) => void;
  onSignIn?: () => void;
}>) {
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  createEffect(() => { if (!props.active) setDetailsOpen(false); });
  const target = () => props.runtime.provider_runtime_link_target;
  const state = () => cloudConnectionState(props.runtime, props.cloud);
  const localAvailable = () => props.runtime.kind === 'local_environment'
    && props.runtime.runtime_operations.open.availability === 'available';
  const titleKey = () => cloudConnectionTitleKey(props.runtime, props.cloud);
  const statusKey = () => ['waiting', 'waiting_for_service'].includes(state()) ? 'providerRecovery.waitingShort' : titleKey();
  const detailKey = createMemo((): DesktopTranslationKey => {
    switch (state()) {
      case 'connected': return 'providerRecovery.connectedDetail';
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
    .action_presentation.menu_actions.find(item => item.action.intent === 'connect_cloud_runtime')?.action);
  const canRestore = () => !['connected', 'connecting', 'restoring', 'retrying', 'unknown', 'tls_error', 'sign_in_required', 'permission_required', 'binding_changed'].includes(state())
    && restoreAction()?.enabled;
  const diagnostics = () => target()?.credential_recovery_details;
  const errorCode = () => diagnostics()?.last_error_code ?? target()?.cloud_link_binding?.last_error_code;
  const restore = () => {
    const action = restoreAction();
    if (action && canRestore()) { setDetailsOpen(false); props.onRuntimeAction(action); }
  };
  const signIn = () => { setDetailsOpen(false); props.onSignIn?.(); };
  return (
    <div class="redeven-cloud-connection-status" data-cloud-connection-status data-runtime-target={target()?.id}
      data-tone={state() === 'connected' ? 'success' : state() === 'unknown' ? 'muted' : 'warning'}>
      <span class="redeven-cloud-connection-label" title={props.i18n.t('environmentCenter.providerFilter')}>
        <Cloud aria-hidden="true" /><span>{props.i18n.t('environmentCenter.providerFilter')}</span>
      </span>
      <div class="redeven-cloud-connection-value">
        <DesktopActionPopover open={detailsOpen()} onOpenChange={setDetailsOpen}
          class="redeven-cloud-connection-surface" anchorClass="redeven-cloud-connection-anchor"
          allowMainAxisOverflow={false} popoverAriaLabel={props.i18n.t('providerRecovery.details')}
          content={
            <section class="redeven-cloud-connection-panel" data-cloud-connection-details>
              <header class="redeven-cloud-connection-heading">
                <Cloud aria-hidden="true" class={state() === 'connected' ? 'text-success' : 'text-warning'} />
                <h3>{props.i18n.t(titleKey())}</h3>
                <Button size="icon" variant="ghost" aria-label={props.i18n.t('common.close')}
                  onClick={() => { setDetailsOpen(false); trigger?.focus(); }}><X aria-hidden="true" /></Button>
              </header>
              <p class="redeven-cloud-connection-explanation">{props.i18n.t(detailKey())}</p>
              <Show when={localAvailable()}>
                <div class="redeven-cloud-connection-local">
                  <span><CheckCircle aria-hidden="true" />{props.i18n.t('providerRecovery.localAvailable')}</span>
                  <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => {
                    setDetailsOpen(false);
                    props.onRuntimeAction({ intent: 'open', label: props.i18n.t('providerRecovery.openLocally'), enabled: true, variant: 'outline' });
                  }}>{props.i18n.t('providerRecovery.openLocally')}</Button>
                </div>
              </Show>
              <details class="redeven-cloud-connection-diagnostics">
                <summary>{props.i18n.t('windowStatus.technicalDetails')}</summary>
                <dl>
                  <div><dt>{props.i18n.t('providerRecovery.runtimeOwner')}</dt><dd>{props.runtime.label}</dd></div>
                  <Show when={errorCode()}><div><dt>{props.i18n.t('providerRecovery.lastError')}</dt><dd>{errorCode()}</dd></div></Show>
                  <Show when={diagnostics()?.last_attempt_at_unix_ms}>{time => <div><dt>{props.i18n.t('providerRecovery.lastAttempt')}</dt><dd>{props.i18n.formatDateTime(time(), { dateStyle: 'short', timeStyle: 'medium' })}</dd></div>}</Show>
                  <Show when={diagnostics()?.next_retry_at_unix_ms}>{time => <div><dt>{props.i18n.t('providerRecovery.nextCheck')}</dt><dd>{props.i18n.formatDateTime(time(), { dateStyle: 'short', timeStyle: 'medium' })}</dd></div>}</Show>
                </dl>
              </details>
              <Show when={canRestore() || (state() === 'sign_in_required' && props.onSignIn)}>
                <footer class="redeven-cloud-connection-panel-actions">
                  <Button size="sm" disabled={props.busy} onClick={() => state() === 'sign_in_required' ? signIn() : restore()}>
                    {props.i18n.t(state() === 'sign_in_required' ? 'environmentCenter.cloudSignInAgain' : 'providerRecovery.restoreShort')}
                  </Button>
                </footer>
              </Show>
            </section>
          }>
          <button ref={trigger} type="button" class="redeven-cloud-connection-trigger"
            aria-expanded={detailsOpen()} aria-haspopup="dialog"
            aria-label={`${props.i18n.t('providerRecovery.details')}: ${props.i18n.t(titleKey())}`}
            title={`${props.i18n.t(titleKey())} · ${props.i18n.t('providerRecovery.details')}`}
            onClick={() => setDetailsOpen(!detailsOpen())}>
            <span role="status" aria-live="polite">{props.i18n.t(statusKey())}</span><Info aria-hidden="true" />
          </button>
        </DesktopActionPopover>
        <Show when={canRestore() || (state() === 'sign_in_required' && props.onSignIn)}>
          <button type="button" class="redeven-cloud-connection-action" disabled={props.busy}
            title={props.i18n.t(state() === 'sign_in_required' ? 'environmentCenter.cloudSignInAgain' : 'providerRecovery.restoreShort')}
            onClick={() => state() === 'sign_in_required' ? signIn() : restore()}>
            {props.i18n.t(state() === 'sign_in_required' ? 'providerRecovery.signInAction' : 'providerRecovery.restoreAction')}
          </button>
        </Show>
      </div>
    </div>
  );
}
