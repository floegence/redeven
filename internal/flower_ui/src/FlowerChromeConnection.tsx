import { StableText, Button, Select } from '@floegence/floe-webapp-core/ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerChromeDiagnostic, FlowerChromeStatus, FlowerComputerExtensionSetup, FlowerComputerManagement } from './contracts/flowerSurfaceContracts';

import { FlowerChromeReadiness } from './FlowerChromeReadiness';
import { chromeConnectionDiagnostic, chromeConnectionError } from './chromeConnectionDiagnostic';

// This guide observes Runtime connection inventory. It never binds a tab or
// creates a conversation lifecycle; the caller resumes the original interaction.
export function FlowerChromeConnection(props: {
  environmentName?: string; platform?: string; preferredInstallationID?: string; reuseConnected?: boolean; management: Pick<FlowerComputerManagement, 'setupExtension' | 'openExtension' | 'loadExtensionStatus' | 'prepareRemoteBrowser'>; copy: FlowerComputerCopy; onConnected: () => Promise<void>; onRemoteBrowserPrepared?: () => void;
}) {
  const [installationID, setInstallationID] = createSignal('');
  const selectedInstallation = () => connectionStatus()?.installations.find(item => item.id === installationID());
  const [setup, setSetup] = createSignal<FlowerComputerExtensionSetup>();
  const [phase, setPhase] = createSignal<'preparing' | 'waiting' | 'confirming' | 'connected' | 'failed' | 'timeout'>('preparing');
  const [step, setStep] = createSignal<'install' | 'connect'>('install');
  const [extensionsOpened, setExtensionsOpened] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [remoteError, setRemoteError] = createSignal(false);
  const [desktopGuide, setDesktopGuide] = createSignal(false);
  let remotePreparation: AbortController | undefined;
  const [diagnostic, setDiagnostic] = createSignal<FlowerChromeDiagnostic>();
  const [connectionStatus, setConnectionStatus] = createSignal<FlowerChromeStatus>();
  const [updateRequired, setUpdateRequired] = createSignal(false);
  const [linkCopied, setLinkCopied] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let connectionInput: HTMLInputElement | undefined;
  let generation = 0;
  let pathInput: HTMLInputElement | undefined;
  let initialProfiles: Set<string> | undefined;
  let disposed = false, completing = false, deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { disposed = true; generation++; clearTimeout(timer); remotePreparation?.abort(); });
  const check = async (epoch: number): Promise<boolean> => {
    const connection = await props.management.loadExtensionStatus!();
    if (disposed || completing || epoch !== generation) return true;
    if (!installationID()) setInstallationID(connection.installations.find(item => item.id === props.preferredInstallationID && item.installed)?.id ?? connection.installations.find(item => item.connected)?.id ?? connection.installations.find(item => item.installed)?.id ?? '');
    const installation = connection.installations.find(item => item.id === installationID());
    const profiles = connection.profiles.filter(profile => profile.installation_id === installationID());
    setConnectionStatus(connection);
    const diagnostic = connection.diagnostic ?? installation?.diagnostic ?? (installation?.reason && !['connection_required', 'extension_update_required'].includes(installation.reason) ? { stage: 'open' as const, reason: installation.reason } : undefined);
    setDiagnostic(diagnostic ? chromeConnectionDiagnostic(diagnostic, diagnostic.stage) : undefined);
    if (diagnostic?.reason === 'desktop_session_unavailable') setExtensionsOpened(true);
    if (!initialProfiles) {
      initialProfiles = new Set(profiles.map(profile => profile.id));
      if (props.reuseConnected && installation?.prepared) setStep('connect');
    }
    if (installation?.reason === 'extension_update_required') {
      if (!updateRequired()) {
        setUpdateRequired(true); setStep('install'); setExtensionsOpened(false); setPhase('waiting');
      }
      return false;
    }
    if (!profiles.some(profile => props.reuseConnected || !initialProfiles!.has(profile.id))) {
      return false;
    }
    completing = true;
    try { await props.onConnected(); if (!disposed && epoch === generation) setPhase('connected'); }
    catch (error) { if (!disposed && epoch === generation) { setDiagnostic(chromeConnectionError(error, 'continue')); setPhase('failed'); } }
    return true;
  };
  const poll = async (epoch = generation) => {
    try {
      if (await check(epoch) || disposed) return;
      if (Date.now() >= deadline) { setPhase('timeout'); return; }
      timer = setTimeout(() => void poll(epoch), 500);
    } catch (error) { if (!disposed && epoch === generation) { setDiagnostic(chromeConnectionError(error, 'check')); setPhase('failed'); } }
  };
  const prepare = async () => {
    if (opening() || disposed) return;
    const epoch = ++generation;
    clearTimeout(timer); completing = false; setPhase('preparing'); setDiagnostic(undefined);
    try { if (await check(epoch) || disposed) return; }
    catch (error) { if (!disposed && epoch === generation) { setDiagnostic(chromeConnectionError(error, 'check')); setPhase('failed'); } return; }
    if (!installationID() || connectionStatus()?.diagnostic?.stage === 'prepare') { setPhase('failed'); return; }
    try {
      const result = await props.management.setupExtension!(installationID());
      if (disposed || epoch !== generation) return;
      setSetup(result); setPhase('waiting'); deadline = Date.now() + 120_000;
      void poll();
    } catch (error) { if (!disposed && epoch === generation) { setDiagnostic(chromeConnectionError(error, 'prepare')); setPhase('failed'); } }
  };
  const observeConfirmation = () => {
    if (disposed || completing) return;
    clearTimeout(timer); setUpdateRequired(false); setPhase('confirming'); deadline = Date.now() + 120_000;
    void poll(++generation);
  };
  const open = async (action: 'extensions' | 'folder' | 'connect') => {
    if (opening() || disposed) return;
    const epoch = generation;
    setOpening(true); setDiagnostic(undefined);
    try {
      await props.management.openExtension!(action, installationID());
      if (!disposed && !completing && epoch === generation) {
        if (action === 'extensions') setExtensionsOpened(true);
        if (action === 'connect') observeConfirmation();
      }
    } catch (error) { if (!disposed && epoch === generation) { clearTimeout(timer); setDiagnostic(chromeConnectionError(error, 'open')); } }
    finally { if (!disposed) setOpening(false); }
  };
  onMount(() => void prepare());
  const status = () => ({ preparing: props.copy.setupPreparing, waiting: '',
    confirming: props.copy.setupConfirming, connected: props.reuseConnected ? props.copy.setupConnected : props.copy.pairingSaved,
    failed: '', timeout: props.copy.setupTimeout }[phase()]);
  const changeStep = (next: 'install' | 'connect') => {
    setStep(next); setDiagnostic(undefined);
    if (phase() === 'confirming') setPhase('waiting');
  };
  const manualDesktop = () => selectedInstallation()?.reason === 'desktop_session_unavailable';
  const remoteAvailable = () => (setup()?.platform ?? connectionStatus()?.platform ?? props.platform) === 'linux' && Boolean(props.management.prepareRemoteBrowser);
  const remotePrimary = () => remoteAvailable() && manualDesktop();
  const showDesktopGuide = () => !remotePrimary() || desktopGuide();
  const prepareRemote = async () => {
    if (opening() || disposed || !remoteAvailable()) return;
    const controller = new AbortController(); remotePreparation = controller;
    const epoch = generation;
    setOpening(true); setRemoteError(false);
    try {
      await props.management.prepareRemoteBrowser!(installationID(), controller.signal);
      if (!disposed && !controller.signal.aborted && epoch === generation) props.onRemoteBrowserPrepared?.();
    } catch { if (!disposed && !controller.signal.aborted && epoch === generation) setRemoteError(true); }
    finally { if (!disposed && epoch === generation) setOpening(false); }
  };
  const connectionURL = () => setup() ? `chrome-extension://${setup()!.extension_id}/popup.html#${setup()!.native_host}` : '';
  const copyConnection = () => {
    observeConfirmation();
    void navigator.clipboard.writeText(connectionURL()).then(() => { if (!disposed) setLinkCopied(true); }, () => { if (!disposed) { connectionInput?.closest('details')?.setAttribute('open', ''); connectionInput?.focus(); connectionInput?.select(); } });
  };
  const retryLabel = () => diagnostic()?.stage === 'continue' ? props.copy.continueTask
    : ['browser_resources_missing', 'browser_extension_missing', 'browser_not_installed', 'desktop_session_unavailable'].includes(diagnostic()?.reason ?? '') ? props.copy.chromeCheckAfterRepair
    : diagnostic()?.stage === 'prepare' ? props.copy.chromeRetryPrepare : props.copy.retryConnection;
  const selectInstallation = (id: string) => {
    if (opening() || id === installationID()) return;
    clearTimeout(timer); ++generation; initialProfiles = undefined; completing = false;
    remotePreparation?.abort(); setRemoteError(false); setDesktopGuide(false);
    setInstallationID(id); setSetup(undefined); setStep('install'); setExtensionsOpened(false); setUpdateRequired(false);
    void prepare();
  };
  return <section class="space-y-5" data-flower-chrome-connection>
    <Show when={(connectionStatus()?.installations.filter(item => item.installed).length ?? 0) > 1}>
      <Select value={installationID()} onChange={value => { if (value) selectInstallation(value); }} disabled={opening()}
        aria-label={props.copy.chromeTitle} options={(connectionStatus()?.installations ?? []).filter(item => item.installed).map(item => ({ value: item.id, label: item.name }))} />
    </Show>
    <FlowerChromeReadiness status={connectionStatus() ? { ...connectionStatus()!, profiles: connectionStatus()!.profiles.filter(profile => profile.installation_id === installationID()), browser_installed: selectedInstallation()?.installed } : undefined} diagnostic={remotePrimary() && !showDesktopGuide() && diagnostic()?.reason === 'desktop_session_unavailable' ? undefined : diagnostic()} environmentName={props.environmentName} platform={props.platform} copy={props.copy}
      onRetry={diagnostic() ? () => void prepare() : undefined} retryLabel={retryLabel()} retryDisabled={opening()} />
    <Show when={status() && (phase() === 'preparing' || showDesktopGuide())}><p class="flower-body-copy" role={phase() === 'failed' ? 'alert' : 'status'} aria-live="polite">{status()}</p></Show>
    <Show when={remoteAvailable() && phase() !== 'connected' && phase() !== 'preparing' && diagnostic()?.stage !== 'prepare' && diagnostic()?.stage !== 'continue'}>
      <section class="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-remote-browser-setup>
        <div class="space-y-1"><h3 class="flower-body-copy font-medium">{props.copy.chromeRemoteTitle}</h3>
          <p class="flower-body-copy leading-relaxed text-muted-foreground">{props.copy.chromeRemoteHint}</p></div>
        <Show when={remoteError()}><p class="flower-body-copy text-destructive" role="alert">{props.copy.chromeRemoteFailed}</p></Show>
        <Button variant={remotePrimary() ? 'default' : 'outline'} disabled={opening()} loading={opening()} onClick={() => void prepareRemote()}>{props.copy.chromeRemotePrepare}</Button>
      </section>
      <Show when={remotePrimary() && !desktopGuide()}><Button variant="ghost" size="sm" onClick={() => setDesktopGuide(true)}>{props.copy.chromeDesktopAction}</Button></Show>
    </Show>
    <Show when={showDesktopGuide() && phase() !== 'preparing'}>
    <Show when={diagnostic()?.stage !== 'prepare' && diagnostic()?.stage !== 'continue'}><ol class="grid grid-cols-2 gap-4 flower-body-copy">
      <li aria-current={step() === 'install' ? 'step' : undefined}
        class="flex items-center gap-2 border-b-2 pb-3" classList={{ 'border-primary font-medium': step() === 'install', 'border-border text-muted-foreground': step() !== 'install' }}>
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">1</span>{updateRequired() ? props.copy.setupUpdateTitle : props.copy.setupInstallTitle}
      </li>
      <li aria-current={step() === 'connect' ? 'step' : undefined}
        class="flex items-center gap-2 border-b-2 pb-3" classList={{ 'border-primary font-medium': step() === 'connect', 'border-border text-muted-foreground': step() !== 'connect' }}>
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">2</span>{props.copy.setupConfirmTitle}
      </li>
    </ol></Show>
    <Show when={setup() && phase() !== 'connected' && phase() !== 'preparing' && diagnostic()?.stage !== 'continue' && diagnostic()?.stage !== 'prepare'}>
      <Show when={step() === 'install'} fallback={<>
        <p class="flower-body-copy leading-relaxed text-muted-foreground">{props.reuseConnected ? props.copy.setupConfirmHint : props.copy.pairingConfirmHint}</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Button size="sm" variant="ghost" disabled={opening()} onClick={() => changeStep('install')}>{props.copy.setupBack}</Button>
          <Show when={manualDesktop()} fallback={<Button disabled={opening()} onClick={() => void open('connect')}>{props.copy.openConnection}</Button>}><Button onClick={copyConnection}><StableText reserve={[props.copy.chromeConnectionLinkCopied, props.copy.chromeCopyConnectionLink]}>{linkCopied() ? props.copy.chromeConnectionLinkCopied : props.copy.chromeCopyConnectionLink}</StableText></Button></Show>
        </div>
      </>}>
        <Show when={extensionsOpened()} fallback={<p class="flower-body-copy leading-relaxed text-muted-foreground">{updateRequired() ? props.copy.setupUpdateHint : props.copy.extensionHint}</p>}><div class="space-y-4">
          <ol class="list-decimal space-y-3 pl-5 flower-body-copy leading-relaxed">
            <li>{props.copy.setupDeveloperMode}</li>
            <li>{props.copy.setupDragFolderHint}
              <div class="mt-2 rounded-md border border-border bg-muted/30 p-3" role="group" aria-label={props.copy.extensionPath}>
                <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-extension-folder-route>
                  <li class="text-muted-foreground">{props.copy.setupHome}</li>
                  <For each={setup()!.extension_home_path}>{(part, index) => <li class="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" class="text-muted-foreground">›</span>
                    <span class="break-all" classList={{ 'font-medium': index() === setup()!.extension_home_path.length - 1 }}>{part}</span>
                  </li>}</For>
                </ol>
                <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{props.copy.setupFolderHint}</p>
                <Button class="mt-2" size="sm" variant="outline" disabled={opening() || manualDesktop()} onClick={() => void open('folder')}>{props.copy.openExtensionFolder}</Button>
              </div>
            </li>
          </ol>
          <details class="ml-5 text-xs leading-relaxed text-muted-foreground">
            <summary class="w-fit cursor-pointer">{props.copy.setupManualInstall}</summary>
            <ol class="mt-2 list-decimal space-y-2 pl-5">
              <li>{props.copy.setupLoadUnpacked}</li>
              <li>{props.copy.setupChooseFolder}
                <span class="mt-1 flex items-center gap-2">{props.copy.setupHome}<kbd class="rounded border border-border px-1 py-0.5 text-[10px]">{setup()!.platform === 'darwin' ? '⌘⇧H' : 'Alt+Home'}</kbd></span>
              </li>
            </ol>
          </details>
          <p class="text-xs leading-relaxed text-muted-foreground">{props.copy.setupInstallDone}</p>
        </div></Show>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Show when={extensionsOpened()} fallback={<>
            <Show when={!updateRequired()}><Button size="sm" variant="ghost" disabled={opening()} onClick={() => changeStep('connect')}>{props.copy.setupAlreadyInstalled}</Button></Show>
            <Button disabled={opening()} onClick={() => void open('extensions')}>{props.copy.openExtensions}</Button>
          </>}>
            <Button size="sm" variant="ghost" disabled={opening()} onClick={() => void open('extensions')}>{props.copy.openExtensions}</Button>
            <Button disabled={opening()} onClick={() => changeStep('connect')}>{props.copy.setupInstalled}</Button>
          </Show>
        </div>
      </Show>
    </Show>
    <Show when={phase() === 'timeout' && !diagnostic()}><Button onClick={() => void prepare()}>{props.copy.retryConnection}</Button></Show>
    <Show when={setup() && phase() !== 'connected'}>
      <details class="border-t border-border pt-3 text-xs text-muted-foreground">
        <summary class="w-fit cursor-pointer">{props.copy.setupHelp}</summary>
        <div class="mt-3 space-y-3 leading-relaxed">
          <p>{props.copy.setupHostHint}</p>
          <p>{props.copy.setupLabelsHint}</p>
          <Show when={manualDesktop()}><label class="block space-y-1">{props.copy.chromeConnectionPage}<input ref={connectionInput} class="flower-settings-text-input w-full" readOnly value={connectionURL()} onFocus={event => event.currentTarget.select()} /></label><Button size="sm" variant="ghost" class="redeven-copy-action" data-copied={linkCopied() || undefined} onClick={copyConnection}><StableText reserve={[props.copy.chromeConnectionLinkCopied, props.copy.chromeCopyConnectionLink]}>{linkCopied() ? props.copy.chromeConnectionLinkCopied : props.copy.chromeCopyConnectionLink}</StableText></Button></Show>
          <label class="block space-y-1">{props.copy.extensionPath}<input ref={pathInput} class="flower-settings-text-input w-full" readOnly value={setup()!.extension_path} onFocus={event => event.currentTarget.select()} /></label>
          <Button size="sm" variant="ghost" class="redeven-copy-action" data-copied={copied() || undefined} onClick={() => {
            void navigator.clipboard.writeText(setup()!.extension_path).then(() => { if (!disposed) setCopied(true); }, () => {
              if (!disposed) { pathInput?.focus(); pathInput?.select(); }
            });
          }}><StableText reserve={[props.copy.pathCopied, props.copy.copyExtensionPath]}>{copied() ? props.copy.pathCopied : props.copy.copyExtensionPath}</StableText></Button>
        </div>
      </details>
    </Show>
    </Show>
  </section>;
}
