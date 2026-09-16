import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { AlertCircle, Check, Lock } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { desktopCertificateIdentity, type DesktopCertificateOperation, type DesktopCertificateReport, type DesktopCertificateRequest } from '../shared/desktopCertificate';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';

export function LocalCertificateSettings(props: Readonly<{
  environmentID: string;
  i18n: DesktopI18n;
  manage: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>;
  remote: boolean;
  onReadiness: (ready: boolean) => void;
}>) {
  const [report, setReport] = createSignal<DesktopCertificateReport>();
  const [operation, setOperation] = createSignal<DesktopCertificateOperation>();
  const [queryFailed, setQueryFailed] = createSignal(false);
  let revision = 0;
  onCleanup(() => { revision += 1; });
  const identity = () => queryFailed() ? 'unknown' : desktopCertificateIdentity(report());
  const invalid = () => ['invalid', 'expired', 'not_yet_valid'].includes(identity());
  const legacyUntrusted = () => report()?.code === 'local_ui_device_ca_untrusted' && report()?.identity === 'ready' && report()?.trust === 'untrusted';
  const failed = () => report()?.status === 'failed' && !legacyUntrusted();

  async function perform(action: DesktopCertificateOperation, environmentID = props.environmentID): Promise<void> {
    if (operation()) return;
    const requestRevision = ++revision;
    setOperation(action);
    setQueryFailed(false);
    props.onReadiness(false);
    try {
      const result = await props.manage({ environment_id: environmentID, operation: action });
      if (revision !== requestRevision || props.environmentID !== environmentID) return;
      setReport(result);
      setQueryFailed(result.status === 'failed' && (action === 'status' || result.failure_stage === 'status' || result.failure_stage === 'verify')
        && !['local_ui_device_ca_untrusted', 'local_ui_device_ca_missing', 'local_ui_device_ca_invalid', 'local_ui_device_ca_expired', 'local_ui_device_ca_not_yet_valid'].includes(result.code));
    } catch {
      if (revision !== requestRevision || props.environmentID !== environmentID) return;
      setReport((previous) => ({ ...previous, status: 'failed', code: 'local_ui_device_ca_operation_failed', failure_stage: 'status' }));
      setQueryFailed(true);
    } finally {
      if (revision === requestRevision && props.environmentID === environmentID) {
        setOperation(undefined);
        props.onReadiness(identity() === 'ready' && !queryFailed());
      }
    }
  }

  // Snapshot objects change during health updates; only a new target resets certificate state.
  const environmentID = createMemo(() => props.environmentID);
  createEffect(on(environmentID, (id) => {
    revision += 1;
    setReport(undefined);
    setOperation(undefined);
    setQueryFailed(false);
    void perform('status', id);
  }));

  const identityKey = (): DesktopTranslationKey => {
    if (!report() && operation()) return 'environmentStatus.checking';
    switch (identity()) {
      case 'ready': return 'settings.certificateReady';
      case 'missing': return 'settings.certificateMissing';
      case 'expired': return 'settings.certificateExpired';
      case 'not_yet_valid': return 'settings.certificateNotYetValid';
      case 'invalid': return 'settings.certificateInvalid';
      default: return 'settings.certificateUnknown';
    }
  };
  const errorKey = (): DesktopTranslationKey => {
    switch (report()?.code) {
      case 'local_ui_device_ca_permission_denied': return 'settings.certificatePermissionDenied';
      case 'local_ui_device_ca_timeout': return 'settings.certificateTimeout';
      case 'local_ui_device_ca_install_canceled': return 'settings.certificateCanceled';
      case 'local_ui_device_ca_install_failed': return 'settings.certificateInstallFailed';
      case 'local_ui_device_ca_trust_not_confirmed': return 'settings.certificateTrustNotConfirmed';
      case 'local_ui_device_ca_busy': return 'settings.certificateBusy';
      default: return 'settings.certificateOperationFailed';
    }
  };
  const canInstall = () => !props.remote && report()?.can_install === true;
  return (
    <section aria-label={props.i18n.t('settings.certificateSetup')} aria-busy={Boolean(operation())} class="space-y-3 rounded-md bg-muted/25 p-3">
      <h4 class="flex items-center gap-2 text-xs font-medium"><Lock class="h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('settings.certificateSetup')}</h4>
      <dl class="space-y-2 text-xs" aria-live="polite">
        <div class="flex flex-wrap items-center justify-between gap-2"><dt class="text-muted-foreground">{props.i18n.t('settings.certificateIdentity')}</dt>
          <dd class="flex items-center gap-1.5" classList={{ 'text-destructive': invalid() }}>
            <Show when={identity() === 'ready'}><Check class="h-3.5 w-3.5" aria-hidden="true" /></Show>
            <Show when={invalid()}><AlertCircle class="h-3.5 w-3.5" aria-hidden="true" /></Show>
            {props.i18n.t(identityKey())}
          </dd></div>
        <Show when={!props.remote && identity() === 'ready'}>
          <div class="flex flex-wrap items-center justify-between gap-2"><dt class="text-muted-foreground">{props.i18n.t('settings.certificateSystemTrust')}</dt>
            <dd>{props.i18n.t(report()?.trust === 'trusted' ? 'settings.certificateTrusted' : 'settings.certificateUntrusted')}</dd></div>
        </Show>
      </dl>
      <Show when={operation() && operation() !== 'status'}>
        <p role="status" class="text-xs text-muted-foreground">{props.i18n.t(operation() === 'install' ? 'settings.certificateTrustBusy' : 'settings.certificateSetupBusy')}</p>
      </Show>
      <Show when={invalid()}><p class="text-xs text-destructive">{props.i18n.t('settings.certificateInvalidHelp')}</p></Show>
      <Show when={queryFailed() || failed() && !invalid() && report()?.code !== 'local_ui_device_ca_missing'}>
        <p role="alert" class="text-xs" classList={{ 'text-destructive': report()?.code !== 'local_ui_device_ca_install_canceled' }}>{props.i18n.t(errorKey())}</p>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={identity() === 'missing'}>
          <Button size="sm" disabled={Boolean(operation())} onClick={() => void perform(canInstall() ? 'setup' : 'generate')}>
            {props.i18n.t(canInstall() ? 'settings.certificateSetupAction' : 'settings.generateCertificate')}
          </Button>
        </Show>
        <Show when={identity() === 'ready' && canInstall() && report()?.trust !== 'trusted'}>
          <Button size="sm" disabled={Boolean(operation())} onClick={() => void perform('install')}>{props.i18n.t('settings.trustCertificate')}</Button>
        </Show>
        <Button size="sm" variant="ghost" disabled={Boolean(operation())} onClick={() => void perform('status')}>{props.i18n.t('environmentAction.refreshStatus')}</Button>
      </div>
      <Show when={!props.remote}>
        <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t(canInstall() ? 'settings.certificateTrustScope' : 'settings.certificateManualTrust')}</p>
      </Show>
      <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('settings.certificateImmediateHelp')}</p>
      <Show when={identity() !== 'ready' && !operation()}><p class="text-xs text-muted-foreground">{props.i18n.t('settings.certificateRestartBlocked')}</p></Show>
      <Show when={report()?.certificate_path || report()?.message}>
        <details class="text-xs"><summary class="cursor-pointer text-muted-foreground hover:text-foreground">{props.i18n.t('settings.certificateDetails')}</summary>
          <div class="mt-2 select-text space-y-2 break-all text-muted-foreground">
            <Show when={report()?.not_after}><p>{props.i18n.t('settings.certificateValidUntil', { date: new Date(report()!.not_after!).toLocaleDateString(props.i18n.locale) })}</p></Show>
            <p class="font-mono">{report()?.certificate_path}</p>
            <Show when={failed()}><p class="font-mono">{report()?.code}</p><p>{report()?.message}</p></Show>
          </div>
        </details>
      </Show>
    </section>
  );
}
