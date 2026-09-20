import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { Check, Download, Upload, Sparkles } from '@floegence/floe-webapp-core/icons';
import type { FlowerBrowserInstallation, FlowerComputerManagement } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';

const activeStates = new Set(['downloading', 'uploading', 'verifying', 'installing']);

export function FlowerManagedBrowser(props: {
  management: FlowerComputerManagement;
  copy: FlowerComputerCopy;
  canMutate: boolean;
  onChange?: () => void;
  onContinue?: (enabled: boolean) => Promise<void>;
}) {
  const management = props.management;
  const [status, setStatus] = createSignal<FlowerBrowserInstallation>();
  const [source, setSource] = createSignal<'download' | 'upload'>('download');
  const [file, setFile] = createSignal<File>();
  const [busy, setBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let disposed = false;
  let observation = 0;
  let resumeAfterInstall = false;
  let uploadOperation = '';
  let stopUpload = false;
  let picker: HTMLInputElement | undefined;
  const accept = (value: FlowerBrowserInstallation) => { observation++; setStatus(value); };
  const cancelOperation = (id: string) => management.installBrowser!({ action: 'cancel', operation_id: id });
  onCleanup(() => {
    disposed = true; stopUpload = true;
    if (uploadOperation) void cancelOperation(uploadOperation).catch(() => undefined);
  });
  const active = () => activeStates.has(status()?.state ?? '');
  const editable = () => props.canMutate && !busy() && !saving();
  const size = (bytes: number) => String(Math.ceil(bytes / 1_000_000));
  const load = async () => {
    const version = ++observation;
    try {
      const value = await management.loadBrowserInstallation!();
      if (disposed || version !== observation) return;
      setStatus(value); setFailed(false);
      if (value.state === 'installed' && value.enabled && resumeAfterInstall) {
        resumeAfterInstall = false;
        props.onChange?.();
        await props.onContinue?.(true);
      }
    } catch { if (!disposed && version === observation) setFailed(true); }
  };
  void load();
  // Observe only an active installation. Thread continuation stays in Floret.
  createEffect(() => {
    if (!active() || busy() || saving() || failed()) return;
    const timer = setTimeout(() => void load(), 800);
    onCleanup(() => clearTimeout(timer));
  });
  const setEnabled = async (enabled: boolean) => {
    if (!props.canMutate || saving()) return;
    observation++; setSaving(true); setFailed(false); resumeAfterInstall = false;
    if (!enabled) stopUpload = true;
    try {
      const value = await management.saveBrowserEnabled!(enabled);
      if (!disposed) { accept(value); props.onChange?.(); }
    } catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setSaving(false); }
  };
  const cancel = async () => {
    const id = status()?.operation_id;
    if (!id || !props.canMutate || saving()) return;
    stopUpload = true; resumeAfterInstall = false; observation++; setSaving(true);
    try { const value = await cancelOperation(id); if (!disposed) accept(value); }
    catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setSaving(false); }
  };
  const install = async () => {
    const current = status();
    if (!current?.enabled || !editable() || active()) return;
    const selectedSource = source(), selectedFile = file();
    if (selectedSource === 'upload' && (!management.browserUploadSupported || !selectedFile || selectedFile.size !== current.package.size_bytes)) {
      setFailed(true); return;
    }
    observation++; setBusy(true); setFailed(false); stopUpload = false;
    resumeAfterInstall = Boolean(props.onContinue);
    let operation = '';
    try {
      let value = await management.installBrowser!({ action: 'start', package_id: current.package.id, source: selectedSource });
      operation = value.operation_id ?? '';
      if (selectedSource === 'upload' && value.state === 'uploading') uploadOperation = operation;
      if (disposed || stopUpload) {
        if (uploadOperation) await cancelOperation(uploadOperation);
        return;
      }
      accept(value);
      if (value.state === 'installed' && resumeAfterInstall) {
        resumeAfterInstall = false; await props.onContinue?.(true);
      }
      if (selectedSource === 'upload' && selectedFile && value.state === 'uploading') {
        for (let offset = 0; offset < selectedFile.size; offset += 256 * 1024) {
          const bytes = new Uint8Array(await selectedFile.slice(offset, offset + 256 * 1024).arrayBuffer());
          if (disposed || stopUpload) return;
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
          value = await management.installBrowser!({ action: 'chunk', operation_id: operation, offset, data: btoa(binary) });
          if (disposed || stopUpload) return;
          accept(value);
        }
        value = await management.installBrowser!({ action: 'complete', operation_id: operation });
        uploadOperation = '';
        if (!disposed && !stopUpload) accept(value);
      }
    } catch {
      resumeAfterInstall = false;
      if (operation) await cancelOperation(operation).catch(() => undefined);
      if (!disposed && !stopUpload) { await load(); setFailed(true); }
    } finally { uploadOperation = ''; if (!disposed) setBusy(false); }
  };
  const continueTask = async () => {
    if (!editable()) return;
    setBusy(true); setFailed(false);
    try { await props.onContinue?.(status()!.enabled); }
    catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setBusy(false); }
  };
  const stateLabel = () => ({ installed: props.copy.browserInstalled, not_installed: props.copy.browserNotInstalled,
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
          <div><span>{stateLabel()}</span><span>{props.copy.browserTransferProgress.replace('{received}', size(current().received_bytes)).replace('{total}', size(current().package.size_bytes))}</span></div>
          <progress aria-label={stateLabel()} max={current().package.size_bytes} value={['verifying', 'installing'].includes(current().state) ? undefined : current().received_bytes} />
          <Button variant="outline" disabled={!props.canMutate || saving()} onClick={() => void cancel()}>{props.copy.cancel}</Button>
        </div>}>
          <div class="flower-browser-source-grid" role="radiogroup" aria-label={props.copy.browserSource}>
            <label data-selected={source() === 'download'} data-disabled={!editable()}><input type="radio" name="browser-install-source" checked={source() === 'download'} disabled={!editable()} onChange={() => setSource('download')} /><Download aria-hidden="true" /><strong>{props.copy.browserDownloadHere}</strong><span>{props.copy.browserDownloadHereHint}</span></label>
            <label data-selected={source() === 'upload'} data-disabled={!editable() || !management.browserUploadSupported}><input type="radio" name="browser-install-source" checked={source() === 'upload'} disabled={!editable() || !management.browserUploadSupported} onChange={() => setSource('upload')} /><Upload aria-hidden="true" /><strong>{props.copy.browserUploadDesktop}</strong><span>{management.browserUploadSupported ? props.copy.browserUploadHint : props.copy.browserDesktopRequired}</span></label>
          </div>
          <Show when={source() === 'upload'}><div class="flower-browser-file">
            <input ref={picker} type="file" accept=".zip" aria-label={props.copy.browserChooseFile} class="sr-only" disabled={!editable()} onChange={event => { setFile(event.currentTarget.files?.[0]); setFailed(false); }} />
            <Button variant="outline" disabled={!editable()} onClick={() => picker?.click()}>{props.copy.browserChooseFile}</Button>
            <span>{file()?.name ?? props.copy.browserFileHint}</span>
            <a href={current().package.url} target="_blank" rel="noopener noreferrer">{props.copy.browserGetPackage}</a>
          </div></Show>
          <div class="flower-browser-consent"><p>{props.copy.browserConsentHint}</p><Button variant="primary" disabled={!editable() || (source() === 'upload' && !file())} onClick={() => void install()}>{source() === 'upload' ? props.copy.browserConfirmUpload : props.copy.browserConfirmDownload}</Button></div>
        </Show>
      </Show>
      <Show when={current().enabled && current().state === 'installed'}><div class="flower-browser-ready"><Check aria-hidden="true" /><p>{props.copy.browserReadyHint}</p></div></Show>
      <Show when={props.onContinue && !active() && (!current().enabled || current().state === 'installed')}><Button variant="primary" disabled={!editable()} onClick={() => void continueTask()}>{current().enabled ? props.copy.browserContinue : props.copy.browserContinueWithout}</Button></Show>
      <Show when={current().state === 'installed'}><details class="flower-computer-detail-card"><summary>{props.copy.browserInstallLocation}</summary><code>{current().directory}</code></details></Show>
    </>}</Show>
    <Show when={failed() || status()?.state === 'failed'}>
      <Show when={status()}><p role="alert" class="text-xs text-destructive">{status()?.error === 'invalid_archive' || (source() === 'upload' && file() && file()?.size !== status()?.package.size_bytes) ? props.copy.browserWrongPackage : props.copy.browserInstallFailed}</p></Show>
      <Button variant="outline" disabled={busy()} onClick={() => void load()}>{props.copy.refresh}</Button>
    </Show>
  </section>;
}
