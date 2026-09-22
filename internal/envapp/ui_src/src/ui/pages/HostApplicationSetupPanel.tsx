import { Show } from 'solid-js';
import { Button, RadioList } from '@floegence/floe-webapp-core/ui';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { hostApplicationSetupActive, type HostApplicationSetup, type HostApplicationTransferPlan } from '../services/hostApplicationsApi';

export function hostApplicationSetupHeading(setup: HostApplicationSetup | null): EnvAppTranslationKey {
  const keys: Partial<Record<HostApplicationSetup['state'], EnvAppTranslationKey>> = {
    checking: 'hostApplications.prepare.checking', downloading: 'hostApplications.prepare.downloading', receiving: 'hostApplications.prepare.receiving',
    verifying: 'hostApplications.prepare.verifying', installing: 'hostApplications.prepare.installing', validating: 'hostApplications.prepare.validating',
    ready: 'hostApplications.prepare.ready', failed: 'hostApplications.prepare.failed', interrupted: 'hostApplications.prepare.interrupted', cancelled: 'hostApplications.prepare.cancelled',
    unsupported: 'hostApplications.prepare.unsupported',
  };
  return (setup && keys[setup.state]) || 'hostApplications.prepare.title';
}

export function hostApplicationSetupError(code: string | undefined): EnvAppTranslationKey {
  const keys: Record<string, EnvAppTranslationKey> = {
    download_failed: 'hostApplications.prepare.networkError', invalid_archive: 'hostApplications.prepare.archiveError',
    disk_full: 'hostApplications.prepare.diskError', permission_denied: 'hostApplications.prepare.accessError',
    validation_failed: 'hostApplications.prepare.validationError', unsupported_platform: 'hostApplications.prepare.unsupported',
    cache_changed: 'hostApplications.update.cacheChanged', installation_damaged: 'hostApplications.update.damaged', unsupported_installation: 'hostApplications.update.unsupported',
  };
  return keys[code ?? ''] || 'hostApplications.prepare.retryHint';
}

export function hostApplicationSetupProgress(setup: HostApplicationSetup | null): number | undefined {
  if (!setup || !['downloading', 'receiving'].includes(setup.state) || setup.expected_bytes <= 0) return undefined;
  return Math.min(1, Math.max(0, setup.received_bytes / setup.expected_bytes));
}

export function HostApplicationSetupPanel(props: {
  setup: HostApplicationSetup | null;
  plan?: HostApplicationTransferPlan | null;
  checkingPlan?: boolean;
  allowed: boolean;
  submitting: boolean;
  canRelay: boolean;
  disconnected: boolean;
  applicationName?: string;
  inDialog?: boolean;
  downloadMethod: 'host' | 'desktop';
  onDownloadMethodChange: (method: 'host' | 'desktop') => void;
  onStart: () => void;
  onCancel: () => void;
  onReconnect: () => void;
  onUpload: (file: File) => void;
}) {
  const i18n = useI18n();
  const active = () => hostApplicationSetupActive(props.setup);
  const installed = () => props.setup?.installed;
  const unsupported = () => props.setup?.state === 'unsupported' || props.setup?.installation_error_code === 'unsupported_installation';
  const local = () => props.plan?.missing_bytes === 0;
  const progress = () => hostApplicationSetupProgress(props.setup);
  const receiving = () => props.setup?.state === 'receiving' && props.setup.can_cancel;
  const canChoose = () => !props.submitting && (!active() || receiving());
  const canStart = () => props.allowed && !props.submitting && !props.checkingPlan && !unsupported()
    && (local() || (props.downloadMethod === 'desktop' ? props.canRelay : !receiving()));
  let fileInput: HTMLInputElement | undefined;
  return <section class="host-apps-preparation" classList={{ "host-apps-preparation-dialog": props.inDialog }} aria-label={i18n.t('hostApplications.prepare.title')}>
    <div class="host-apps-preparation-copy">
      <Show when={!props.inDialog || active() || props.disconnected || ['failed', 'interrupted', 'cancelled', 'unsupported'].includes(props.setup?.state ?? '')}><h2 aria-live="polite">{i18n.t(props.disconnected ? 'hostApplications.disconnected' : hostApplicationSetupHeading(props.setup))}</h2></Show>
      <p>{i18n.t(props.disconnected ? 'hostApplications.prepare.connectionHint' : props.setup?.installation_error_code ? hostApplicationSetupError(props.setup.installation_error_code) : props.setup?.state === 'failed' ? hostApplicationSetupError(props.setup.error_code) : installed() ? 'hostApplications.update.stabilityFix' : 'hostApplications.prepare.description')}</p>
      <Show when={installed()?.ready}><p class="host-apps-preparation-target">{i18n.t(props.setup?.state === 'failed' ? 'hostApplications.update.failedRetained' : 'hostApplications.update.description')}</p></Show>
      <Show when={installed()}><dl class="host-apps-component-versions">
        <div><dt>{i18n.t('hostApplications.update.installedVersion')}</dt><dd>{installed()?.id}</dd></div>
        <div><dt>{i18n.t('hostApplications.update.targetVersion')}</dt><dd>{props.setup?.package?.id}</dd></div>
      </dl></Show>
      <Show when={props.applicationName}><p class="host-apps-preparation-target">{i18n.t('hostApplications.prepare.openAfter', { name: props.applicationName ?? '' })}</p></Show>
    </div>
    <Show when={!unsupported() && !local()}>
      <div class="host-apps-preparation-method">
        <div class="host-apps-preparation-method-heading"><span>{i18n.t('hostApplications.prepare.downloadMethod')}</span><span class="host-apps-preparation-size"><Show when={props.plan} fallback={i18n.t('hostApplications.update.checkingSize')}>{new Intl.NumberFormat(i18n.locale(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format((props.plan?.missing_bytes ?? 0) / 1000000)}</Show></span></div>
        <RadioList value={receiving() && props.downloadMethod === 'host' ? undefined : props.downloadMethod} onChange={value => props.onDownloadMethodChange(value as 'host' | 'desktop')}
          size="lg" aria-label={i18n.t('hostApplications.prepare.downloadMethod')}
          options={[
            { value: 'host', label: i18n.t('hostApplications.prepare.hostDownload'), description: i18n.t('hostApplications.prepare.hostDownloadHint'), disabled: !props.allowed || !canChoose() || Boolean(receiving()) },
            { value: 'desktop', label: i18n.t('hostApplications.prepare.desktopDownload'), description: i18n.t(props.canRelay ? 'hostApplications.prepare.desktopDownloadHint' : 'hostApplications.prepare.desktopUnavailable'), disabled: !props.allowed || !canChoose() || !props.canRelay },
          ]} />
      </div>
    </Show>
    <Show when={local()}><p class="host-apps-preparation-target">{i18n.t('hostApplications.update.local')}</p></Show>
    <Show when={active()}>
      <div class={`host-apps-preparation-track ${progress() === undefined ? 'indeterminate' : ''}`} role="progressbar" aria-label={i18n.t(hostApplicationSetupHeading(props.setup))} aria-valuenow={progress() === undefined ? undefined : Math.round(progress()! * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: progress() === undefined ? '35%' : `${progress()! * 100}%` }} />
      </div>
    </Show>
    <div class="host-apps-preparation-footer">
      <div class="host-apps-preparation-actions">
        <Show when={props.disconnected} fallback={
          <Show when={active()} fallback={
            <Button size="sm" disabled={!canStart()} onClick={props.onStart}>
              {i18n.t(props.submitting || props.checkingPlan ? 'hostApplications.prepare.checking' : installed() ? installed()?.ready ? 'hostApplications.update.start' : 'hostApplications.update.repair' : props.applicationName ? 'hostApplications.prepare.prepareAndOpen' : props.setup && ['failed', 'interrupted', 'cancelled'].includes(props.setup.state) ? 'hostApplications.prepare.continue' : 'hostApplications.prepare.start')}
            </Button>
          }>
            <Show when={props.setup?.state === 'receiving' && props.setup.can_cancel && !props.submitting && props.canRelay}>
              <Button size="sm" disabled={!canStart()} onClick={props.onStart}>{i18n.t('hostApplications.prepare.continue')}</Button>
            </Show>
            <Show when={props.setup?.can_cancel}><Button variant="ghost" size="sm" disabled={!props.allowed} onClick={props.onCancel}>{i18n.t('hostApplications.cancel')}</Button></Show>
          </Show>
        }><Button size="sm" onClick={props.onReconnect}>{i18n.t('hostApplications.reconnect')}</Button></Show>
      </div>
    </div>
    <Show when={!unsupported() && (!active() || (props.setup?.state === 'receiving' && props.setup.can_cancel && !props.submitting))}><details class="host-apps-preparation-details">
      <summary>{i18n.t('hostApplications.prepare.offline')}</summary>
      <p>{i18n.t('hostApplications.prepare.offlineHint')}</p>
      <input ref={fileInput} type="file" accept=".zip" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) props.onUpload(file); event.currentTarget.value = ''; }} />
      <Button variant="outline" size="sm" disabled={!props.allowed || props.submitting} onClick={() => fileInput?.click()}>{i18n.t('hostApplications.prepare.choosePackage')}</Button>
    </details></Show>
  </section>;
}
