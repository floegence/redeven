import { StableText, Button, RadioList } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, Download, FolderOpen, Info, MonitorPointer, Package, Upload } from '@floegence/floe-webapp-core/icons';
import './host-application-preparation.css';
import type { HostApplicationComponentsProgress } from '../../../../../../desktop/src/shared/hostApplicationComponents';
import { Show } from 'solid-js';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { hostApplicationSetupActive, type HostApplicationSetup, type HostApplicationTransferPlan } from '../services/hostApplicationsApi';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export type HostApplicationDesktopProgress = Omit<HostApplicationComponentsProgress, 'phase'> & {
  phase: HostApplicationComponentsProgress['phase'] | 'uploading';
};

export function hostApplicationSetupHeading(setup: HostApplicationSetup | null, desktop?: HostApplicationDesktopProgress | null): EnvAppTranslationKey {
  if (desktop) {
    const keys: Record<HostApplicationDesktopProgress['phase'], EnvAppTranslationKey> = {
      waiting: 'hostApplications.prepare.desktopWaiting', checking: 'hostApplications.prepare.desktopChecking',
      downloading: 'hostApplications.prepare.desktopDownloading', packing: 'hostApplications.prepare.desktopPacking', uploading: 'hostApplications.prepare.desktopUploading',
    };
    return keys[desktop.phase];
  }
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

export function hostApplicationSetupProgress(setup: HostApplicationSetup | null, desktop?: HostApplicationDesktopProgress | null): number | undefined {
  if (desktop && desktop.phase !== 'uploading') {
    return desktop.phase === 'downloading' && desktop.download_bytes && desktop.download_bytes > 0
      ? desktop.downloaded_bytes / desktop.download_bytes : undefined;
  }
  if (!setup || !['downloading', 'receiving'].includes(setup.state) || setup.expected_bytes <= 0) return undefined;
  return Math.min(1, Math.max(0, setup.received_bytes / setup.expected_bytes));
}

export function hostApplicationDesktopDetail(progress: HostApplicationDesktopProgress | null | undefined, i18n: ReturnType<typeof useI18n>): string | undefined {
  if (progress?.download_bytes === undefined || progress.cached_bytes === undefined) return;
  if (progress.download_bytes === 0) return i18n.t('hostApplications.prepare.desktopCached');
  const size = (bytes: number) => new Intl.NumberFormat(i18n.locale(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / 1000000);
  return i18n.t('hostApplications.prepare.desktopBytes', { cached: size(progress.cached_bytes), download: size(progress.download_bytes) });
}

export function HostApplicationSetupPanel(props: {
  desktopProgress?: HostApplicationDesktopProgress | null;
  setup: HostApplicationSetup | null;
  plan?: HostApplicationTransferPlan | null;
  checkingPlan?: boolean;
  allowed: boolean;
  submitting: boolean;
  canRelay: boolean;
  disconnected: boolean;
  applicationName?: string;
  inDialog?: boolean;
  requiresUpdate?: boolean;
  downloadMethod: 'host' | 'desktop';
  onDownloadMethodChange: (method: 'host' | 'desktop') => void;
  onStart: () => void;
  onCancel: () => void;
  onReconnect: () => void;
  onUpload: (file: File) => void;
}) {
  const i18n = useI18n();
  const active = () => Boolean(props.desktopProgress) || hostApplicationSetupActive(props.setup);
  const installed = () => props.setup?.installed;
  const updateNeeded = () => Boolean(installed() && props.setup?.update_available);
  const attention = () => props.disconnected || Boolean(props.setup?.installation_error_code) || ['failed', 'interrupted', 'cancelled', 'unsupported'].includes(props.setup?.state ?? '');
  const heading = (): EnvAppTranslationKey => props.disconnected ? 'hostApplications.disconnected'
    : !active() && !attention() && updateNeeded() ? props.requiresUpdate ? 'hostApplications.update.required' : 'hostApplications.update.available'
    : hostApplicationSetupHeading(props.setup, props.desktopProgress);
  const unsupported = () => props.setup?.state === 'unsupported' || props.setup?.installation_error_code === 'unsupported_installation';
  const local = () => props.plan?.missing_bytes === 0;
  const progress = () => hostApplicationSetupProgress(props.setup, props.desktopProgress);
  const receiving = () => props.setup?.state === 'receiving' && props.setup.can_cancel;
  const canChoose = () => !props.submitting && (!active() || receiving());
  const canStart = () => props.allowed && !props.submitting && !props.checkingPlan && !unsupported()
    && (local() || (props.downloadMethod === 'desktop' ? props.canRelay : !receiving()));
  let fileInput: HTMLInputElement | undefined;
  return <section class={`host-apps-preparation ${props.inDialog ? '' : redevenSurfaceRoleClass('panel')}`} classList={{ "host-apps-preparation-dialog": props.inDialog }} aria-label={i18n.t(installed() ? 'hostApplications.update.title' : 'hostApplications.prepare.title')}>
    <div class="host-apps-preparation-content">
    <div class="host-apps-preparation-copy">
      <Show when={!props.inDialog || (props.applicationName && updateNeeded()) || active() || attention()}><div class="host-apps-preparation-heading"><Show when={!props.inDialog}><span class="host-apps-preparation-icon" aria-hidden="true"><Package class="w-5 h-5" /></span></Show><h2 aria-live="polite">{i18n.t(heading())}</h2></div></Show>
      <Show when={attention()} fallback={<p>{i18n.t(installed()?.ready ? props.requiresUpdate ? 'hostApplications.update.requiredDescription' : 'hostApplications.update.description' : 'hostApplications.prepare.summary')}</p>}>
        <p role="status">{i18n.t(props.disconnected ? 'hostApplications.prepare.connectionHint' : props.setup?.installation_error_code ? hostApplicationSetupError(props.setup.installation_error_code) : hostApplicationSetupError(props.setup?.error_code))}</p>
        <Show when={installed()?.ready && props.setup?.state === 'failed'}><p>{i18n.t('hostApplications.update.failedRetained')}</p></Show>
      </Show>
      <Show when={hostApplicationDesktopDetail(props.desktopProgress, i18n)}>{detail => <p aria-live="polite">{detail()}</p>}</Show>
      <Show when={props.applicationName}><p class="host-apps-preparation-target">{i18n.t('hostApplications.prepare.openAfter', { name: props.applicationName ?? '' })}</p></Show>
    </div>
    <Show when={!unsupported() && !local()}>
      <div class="host-apps-preparation-method">
        <div class="host-apps-preparation-method-heading"><span>{i18n.t('hostApplications.prepare.downloadMethod')}</span><Show when={props.plan}><span class="host-apps-preparation-size" title={i18n.t('hostApplications.prepare.missingComponents')}>{new Intl.NumberFormat(i18n.locale(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format((props.plan?.missing_bytes ?? 0) / 1000000)}</span></Show></div>
        <RadioList value={receiving() && props.downloadMethod === 'host' ? undefined : props.downloadMethod} onChange={value => props.onDownloadMethodChange(value as 'host' | 'desktop')}
          size="sm" variant="tile" aria-label={i18n.t('hostApplications.prepare.downloadMethod')}
          options={[
            { value: 'host', icon: Download, label: i18n.t('hostApplications.prepare.hostDownload'), disabled: !props.allowed || !canChoose() || Boolean(receiving()) },
            { value: 'desktop', icon: MonitorPointer, label: i18n.t('hostApplications.prepare.desktopDownload'), description: props.canRelay ? undefined : i18n.t('hostApplications.prepare.desktopUnavailable'), disabled: !props.allowed || !canChoose() || !props.canRelay },
          ]} />
      </div>
    </Show>
    <Show when={local()}><p class="host-apps-preparation-target">{i18n.t('hostApplications.update.local')}</p></Show>
    <div class="host-apps-preparation-disclosures">
    <details class="host-apps-preparation-details host-apps-component-details">
      <summary><Info class="w-3.5 h-3.5" aria-hidden="true" /><span>{i18n.t('hostApplications.prepare.details')}</span><ChevronRight class="host-apps-details-chevron w-3 h-3" aria-hidden="true" /></summary>
      <p>{i18n.t(installed() ? 'hostApplications.update.stabilityFix' : 'hostApplications.prepare.description')}</p>
      <Show when={installed()}><dl class="host-apps-component-versions">
        <div><dt>{i18n.t('hostApplications.update.installedVersion')}</dt><dd>{installed()?.id}</dd></div>
        <div><dt>{i18n.t('hostApplications.update.targetVersion')}</dt><dd>{props.setup?.package?.id}</dd></div>
      </dl></Show>
      <Show when={!unsupported() && !local()}><p>{i18n.t('hostApplications.prepare.hostDownloadHint')}</p><p>{i18n.t('hostApplications.prepare.desktopDownloadHint')}</p></Show>
    </details>
    <Show when={!unsupported() && (!active() || (props.setup?.state === 'receiving' && props.setup.can_cancel && !props.submitting))}><details class="host-apps-preparation-details">
      <summary><FolderOpen class="w-3.5 h-3.5" aria-hidden="true" /><span>{i18n.t('hostApplications.prepare.offline')}</span><ChevronRight class="host-apps-details-chevron w-3 h-3" aria-hidden="true" /></summary>
      <p>{i18n.t('hostApplications.prepare.offlineHint')}</p>
      <input ref={fileInput} type="file" accept=".zip" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) props.onUpload(file); event.currentTarget.value = ''; }} />
      <Button variant="outline" size="sm" disabled={!props.allowed || props.submitting} onClick={() => fileInput?.click()}><Upload class="w-3.5 h-3.5" aria-hidden="true" />{i18n.t('hostApplications.prepare.choosePackage')}</Button>
    </details></Show>
    </div>
    </div>
    <Show when={active()}><div class="host-apps-preparation-progress">
      <div class={`host-apps-preparation-track ${progress() === undefined ? 'indeterminate' : ''}`} role="progressbar" aria-label={i18n.t(hostApplicationSetupHeading(props.setup, props.desktopProgress))} aria-valuenow={progress() === undefined ? undefined : Math.round(progress()! * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: progress() === undefined ? '35%' : `${progress()! * 100}%` }} />
      </div>
    </div></Show>
    <div class="host-apps-preparation-footer">
      <div class="host-apps-preparation-actions">
        <Show when={props.disconnected} fallback={
          <Show when={active()} fallback={
            <Button size="sm" disabled={!canStart()} onClick={props.onStart}>
              <StableText reserve={[i18n.t('hostApplications.prepare.checking'), i18n.t('hostApplications.update.start'), i18n.t('hostApplications.update.repair'), i18n.t('hostApplications.prepare.prepareAndOpen'), i18n.t('hostApplications.prepare.continue'), i18n.t('hostApplications.prepare.start')]}>{i18n.t(props.submitting || props.checkingPlan ? 'hostApplications.prepare.checking' : installed() ? installed()?.ready ? 'hostApplications.update.start' : 'hostApplications.update.repair' : props.applicationName ? 'hostApplications.prepare.prepareAndOpen' : props.setup && ['failed', 'interrupted', 'cancelled'].includes(props.setup.state) ? 'hostApplications.prepare.continue' : 'hostApplications.prepare.start')}</StableText>
            </Button>
          }>
            <Show when={props.setup?.state === 'receiving' && props.setup.can_cancel && !props.submitting && props.canRelay}>
              <Button size="sm" disabled={!canStart()} onClick={props.onStart}>{i18n.t('hostApplications.prepare.continue')}</Button>
            </Show>
            <Show when={props.desktopProgress || props.setup?.can_cancel}><Button variant="ghost" size="sm" disabled={!props.allowed} onClick={props.onCancel}>{i18n.t('hostApplications.cancel')}</Button></Show>
          </Show>
        }><Button size="sm" onClick={props.onReconnect}>{i18n.t('hostApplications.reconnect')}</Button></Show>
      </div>
    </div>

  </section>;
}
