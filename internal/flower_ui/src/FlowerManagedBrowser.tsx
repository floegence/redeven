import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { Check, Download, Upload, Sparkles } from '@floegence/floe-webapp-core/icons';
import type { FlowerBrowserInstallationSnapshot, FlowerComputerManagement } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';

const activeStates = new Set(['downloading', 'uploading', 'verifying', 'installing']);

export function FlowerManagedBrowser(props: {
  management: Pick<FlowerComputerManagement, 'loadBrowserInstallation' | 'saveBrowserEnabled' | 'installBrowser' | 'subscribeBrowserInstallation' | 'browserDesktopAvailable'>;
  copy: FlowerComputerCopy;
  canMutate: boolean;
  onChange?: () => void;
  onContinue?: (enabled: boolean) => Promise<void>;
  continuationKey?: string;
}) {
  const management = props.management;
  const [status, setStatus] = createSignal<FlowerBrowserInstallationSnapshot>();
  const [source, setSource] = createSignal<'download' | 'upload'>(management.browserDesktopAvailable ? 'upload' : 'download');
  const [busy, setBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let disposed = false;
  let observation = 0;
  let resumeAfterInstall = false;
  let continuationKey: string | undefined;
  createEffect(on(() => props.continuationKey, () => { resumeAfterInstall = false; }, { defer: true }));
  const accept = (value: FlowerBrowserInstallationSnapshot) => {
    if (disposed) return;
    observation++; setStatus(value);
    if (!props.onContinue || continuationKey !== props.continuationKey || value.desktop_error
      || (!value.transfer_active && (value.state === 'failed' || value.state === 'cancelled'))) resumeAfterInstall = false;
    if (value.state === 'installed' && value.enabled && !value.transfer_active && resumeAfterInstall) {
      resumeAfterInstall = false;
      props.onChange?.();
      void props.onContinue?.(true).catch(() => { if (!disposed) setFailed(true); });
    }
  };
  const unsubscribe = management.subscribeBrowserInstallation?.(accept);
  onCleanup(() => { disposed = true; resumeAfterInstall = false; unsubscribe?.(); });
  const active = () => Boolean(status()?.transfer_active) || activeStates.has(status()?.state ?? '');
  const editable = () => props.canMutate && !busy() && !saving();
  const size = (bytes: number) => String(Math.ceil(bytes / 1_000_000));
  const load = async () => {
    const version = ++observation;
    try {
      const value = await management.loadBrowserInstallation!();
      if (disposed || version !== observation) return;
      accept(value); setFailed(false);
    } catch { if (!disposed && version === observation) setFailed(true); }
  };
  void load();
  const setEnabled = async (enabled: boolean) => {
    if (!props.canMutate || saving()) return;
    observation++; setSaving(true); setFailed(false); resumeAfterInstall = false;
    try {
      const value = await management.saveBrowserEnabled!(enabled);
      if (!disposed) { accept(value); props.onChange?.(); }
    } catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setSaving(false); }
  };
  const cancel = async () => {
    if (!props.canMutate || saving()) return;
    resumeAfterInstall = false; observation++; setSaving(true);
    try { const value = await management.installBrowser!({ action: 'cancel', operation_id: status()?.operation_id }); if (!disposed) accept(value); }
    catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setSaving(false); }
  };
  const install = async () => {
    const current = status();
    if (!current?.enabled || !editable() || active()) return;
    observation++; setBusy(true); setFailed(false);
    continuationKey = props.continuationKey;
    resumeAfterInstall = Boolean(props.onContinue);
    try {
      const value = await management.installBrowser!({ action: 'start', package_id: current.package.id, source: source() });
      if (!disposed) accept(value);
    } catch { resumeAfterInstall = false; if (!disposed) setFailed(true); }
    finally { if (!disposed) setBusy(false); }
  };
  const continueTask = async () => {
    if (!editable()) return;
    setBusy(true); setFailed(false);
    try { await props.onContinue?.(status()!.enabled); }
    catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setBusy(false); }
  };
  const stateLabel = () => status()?.desktop_progress
    ? ({ checking: props.copy.browserCheckingCache, downloading: props.copy.browserDesktopDownloading, verifying: props.copy.browserVerifying }[status()!.desktop_progress!.phase])
    : ({ installed: props.copy.browserInstalled, not_installed: props.copy.browserNotInstalled,
    downloading: props.copy.browserDownloading, uploading: props.copy.browserUploading, verifying: props.copy.browserVerifying,
    installing: props.copy.browserInstalling, failed: props.copy.browserInstallFailed, cancelled: props.copy.browserCancelled,
  } as Record<string, string>)[status()?.state ?? ''] ?? props.copy.checking;
  return <section class="flower-browser-install" aria-label={props.copy.managed}>
    <div class="flower-browser-enable-row">
      <span class="flower-computer-capability-icon" data-kind="managed" aria-hidden="true"><Sparkles /></span>
      <div><h3>{props.copy.browserEnable}</h3><p>{status()?.enabled === false ? props.copy.browserDisabledHint : props.copy.browserEnabledHint}</p></div>
      <Switch aria-label={props.copy.browserEnable} checked={status()?.enabled ?? true}
        disabled={!props.canMutate || saving() || !status()} onChange={enabled => void setEnabled(enabled)} />
    </div>
    <Show when={status()} fallback={<p role="status" class="flower-computer-description">{failed() ? props.copy.loadFailed : props.copy.checking}</p>}>{current => <>
      <div class="flower-browser-package-heading">
        <span>{current().package.name} · {current().package.version} · {current().package.platform === 'darwin' ? 'macOS' : 'Linux'} {current().package.architecture === 'arm64' ? 'ARM64' : 'x64'}</span>
        <span class="flower-computer-status" data-tone={current().enabled && current().state === 'installed' ? 'positive' : 'neutral'}>{current().enabled ? stateLabel() : props.copy.browserDisabled}</span>
      </div>
      <Show when={current().enabled && current().state !== 'installed'}>
        <div class="flower-browser-size-grid">
          <div><strong>{props.copy.browserDownloadSize.replace('{size}', size(current().package.size_bytes))}</strong><span>{props.copy.browserOnce}</span></div>
          <div><strong>{props.copy.browserDiskSize.replace('{size}', size(current().package.installed_bytes))}</strong><span>{props.copy.browserInEnvironment}</span></div>
        </div>
        <Show when={!active()} fallback={<div class="flower-browser-progress" role="status" aria-live="polite">
          <div><span>{stateLabel()}</span><span>{props.copy.browserTransferProgress.replace('{received}', size(current().desktop_progress?.received_bytes ?? current().received_bytes)).replace('{total}', size(current().package.size_bytes))}</span></div>
          <Show when={current().desktop_progress?.phase === 'checking' || current().desktop_progress?.phase === 'verifying' || ['verifying', 'installing'].includes(current().state)}
            fallback={<progress aria-label={stateLabel()} max={current().package.size_bytes} value={current().desktop_progress?.received_bytes ?? current().received_bytes} />}>
            <progress aria-label={stateLabel()} max={current().package.size_bytes} />
          </Show>
          <Button variant="outline" disabled={!props.canMutate || saving()} onClick={() => void cancel()}>{props.copy.browserCancelInstallation}</Button>
          <p>{props.copy.browserBackgroundHint}</p>
        </div>}>
          <div class="flower-browser-source-grid" role="radiogroup" aria-label={props.copy.browserSource}>
            <label data-selected={source() === 'download'} data-disabled={!editable()}><input type="radio" name="browser-install-source" checked={source() === 'download'} disabled={!editable()} onChange={() => setSource('download')} /><Download aria-hidden="true" /><strong>{props.copy.browserDownloadHere}</strong><span>{props.copy.browserDownloadHereHint}</span></label>
            <label data-selected={source() === 'upload'} data-disabled={!editable() || !management.browserDesktopAvailable}><input type="radio" name="browser-install-source" checked={source() === 'upload'} disabled={!editable() || !management.browserDesktopAvailable} onChange={() => setSource('upload')} /><Upload aria-hidden="true" /><strong>{props.copy.browserUploadDesktop}</strong><span>{management.browserDesktopAvailable ? props.copy.browserUploadHint : props.copy.browserDesktopRequired}</span></label>
          </div>
          <div class="flower-browser-consent"><p>{props.copy.browserConsentHint}</p><Button variant="primary" disabled={!editable()} onClick={() => void install()}>{source() === 'upload' ? props.copy.browserConfirmUpload : props.copy.browserConfirmDownload}</Button></div>
        </Show>
      </Show>
      <Show when={current().enabled && current().state === 'installed'}><div class="flower-browser-ready"><Check aria-hidden="true" /><p>{props.copy.browserReadyHint}</p></div></Show>
      <Show when={props.onContinue && !active() && (!current().enabled || current().state === 'installed')}><Button variant="primary" disabled={!editable()} onClick={() => void continueTask()}>{current().enabled ? props.copy.browserContinue : props.copy.browserContinueWithout}</Button></Show>
      <Show when={current().state === 'installed'}><details class="flower-computer-detail-card"><summary>{props.copy.browserInstallLocation}</summary><code>{current().directory}</code></details></Show>
    </>}</Show>
    <Show when={failed() || (!status()?.transfer_active && status()?.state === 'failed') || status()?.desktop_error}>
      <Show when={status()}><p role="alert" class="text-xs text-destructive">{status()?.desktop_error === 'package_mismatch' ? props.copy.browserWrongPackage : status()?.desktop_error === 'desktop_download_failed' ? props.copy.browserDesktopDownloadFailed : status()?.desktop_error === 'desktop_upload_failed' ? props.copy.browserDesktopUploadFailed : props.copy.browserInstallFailed}</p></Show>
      <Button variant="outline" disabled={busy()} onClick={() => void load()}>{props.copy.refresh}</Button>
    </Show>
  </section>;
}
