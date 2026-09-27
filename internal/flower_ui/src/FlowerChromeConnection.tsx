import { StableText, Button } from '@floegence/floe-webapp-core/ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerChromeDiagnostic, FlowerChromeStatus, FlowerComputerExtensionSetup, FlowerComputerManagement } from './contracts/flowerSurfaceContracts';

import { FlowerChromeReadiness } from './FlowerChromeReadiness';
import { chromeConnectionDiagnostic, chromeConnectionError } from './chromeConnectionDiagnostic';

// This guide observes Runtime connection inventory. It never binds a tab or
// creates a conversation lifecycle; the caller resumes the original interaction.
export function FlowerChromeConnection(props: {
  environmentName?: string; platform?: string; reuseConnected?: boolean; management: Pick<FlowerComputerManagement, 'setupExtension' | 'openExtension' | 'loadExtensionStatus'>; copy: FlowerComputerCopy; onConnected: () => Promise<void>;
}) {
  const [setup, setSetup] = createSignal<FlowerComputerExtensionSetup>();
  const [phase, setPhase] = createSignal<'preparing' | 'waiting' | 'confirming' | 'connected' | 'failed' | 'timeout'>('preparing');
  const [step, setStep] = createSignal<'install' | 'connect'>('install');
  const [extensionsOpened, setExtensionsOpened] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
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
  onCleanup(() => { disposed = true; generation++; clearTimeout(timer); });
  const check = async (epoch: number): Promise<boolean> => {
    const connection = await props.management.loadExtensionStatus!();
    if (disposed || completing || epoch !== generation) return true;
    const profiles = connection.profiles;
    setConnectionStatus(connection);
    setDiagnostic(connection.diagnostic ? chromeConnectionDiagnostic(connection.diagnostic, connection.diagnostic.stage) : undefined);
    if (connection.diagnostic?.reason === 'desktop_session_unavailable') setExtensionsOpened(true);
    if (!initialProfiles) {
      initialProfiles = new Set(profiles.map(profile => profile.id));
      if (props.reuseConnected && connection.prepared) setStep('connect');
    }
    if (connection.error === 'extension_update_required') {
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
    if (diagnostic()?.stage === 'prepare') { setPhase('failed'); return; }
    try {
      const result = await props.management.setupExtension!();
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
      await props.management.openExtension!(action);
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
  const manualDesktop = () => connectionStatus()?.diagnostic?.reason === 'desktop_session_unavailable';
  const connectionURL = () => setup() ? `chrome-extension://${setup()!.extension_id}/popup.html#${setup()!.native_host}` : '';
  const copyConnection = () => {
    observeConfirmation();
    void navigator.clipboard.writeText(connectionURL()).then(() => { if (!disposed) setLinkCopied(true); }, () => { if (!disposed) { connectionInput?.closest('details')?.setAttribute('open', ''); connectionInput?.focus(); connectionInput?.select(); } });
  };
  const retryLabel = () => diagnostic()?.stage === 'continue' ? props.copy.continueTask
    : ['browser_resources_missing', 'browser_extension_missing', 'chrome_not_installed', 'desktop_session_unavailable'].includes(diagnostic()?.reason ?? '') ? props.copy.chromeCheckAfterRepair
    : diagnostic()?.stage === 'prepare' ? props.copy.chromeRetryPrepare : props.copy.retryConnection;
  return <section class="space-y-5" data-flower-chrome-connection>
    <FlowerChromeReadiness status={connectionStatus()} diagnostic={diagnostic()} environmentName={props.environmentName} platform={props.platform} copy={props.copy}
      onRetry={diagnostic() ? () => void prepare() : undefined} retryLabel={retryLabel()} retryDisabled={opening()} />
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
    <Show when={status()}><p class="flower-body-copy" role={phase() === 'failed' ? 'alert' : 'status'} aria-live="polite">{status()}</p></Show>
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
  </section>;
}
