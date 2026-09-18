import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerComputerExtensionSetup, FlowerComputerManagement } from './contracts/flowerSurfaceContracts';

// This guide observes Runtime connection inventory. It never binds a tab or
// creates a conversation lifecycle; the caller resumes the original interaction.
export function FlowerChromeConnection(props: {
  reuseConnected?: boolean; management: FlowerComputerManagement; copy: FlowerComputerCopy; onConnected: () => Promise<void>;
}) {
  const [setup, setSetup] = createSignal<FlowerComputerExtensionSetup>();
  const [phase, setPhase] = createSignal<'preparing' | 'waiting' | 'confirming' | 'connected' | 'failed' | 'timeout'>('preparing');
  const [step, setStep] = createSignal<'install' | 'connect'>('install');
  const [extensionsOpened, setExtensionsOpened] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [openFailed, setOpenFailed] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let pathInput: HTMLInputElement | undefined;
  let initialProfiles: Set<string> | undefined;
  let disposed = false, completing = false, deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { disposed = true; clearTimeout(timer); });
  const check = async (): Promise<boolean> => {
    const profiles = await props.management.listExtensionProfiles!();
    if (disposed || completing) return true;
    if (!initialProfiles) initialProfiles = new Set(profiles.map(profile => profile.id));
    if (!profiles.some(profile => props.reuseConnected || !initialProfiles!.has(profile.id))) return false;
    completing = true; setPhase('connected');
    await props.onConnected();
    return true;
  };
  const poll = async () => {
    try {
      if (await check() || disposed) return;
      if (Date.now() >= deadline) { setPhase('timeout'); return; }
      timer = setTimeout(() => void poll(), 500);
    } catch { if (!disposed) setPhase('failed'); }
  };
  const prepare = async () => {
    clearTimeout(timer); completing = false; setPhase('preparing'); setOpenFailed(false);
    try {
      if (await check() || disposed) return;
      const result = await props.management.setupExtension!();
      if (disposed) return;
      setSetup(result); setPhase('waiting'); deadline = Date.now() + 120_000;
      void poll();
    } catch { if (!disposed) setPhase('failed'); }
  };
  const open = async (action: 'extensions' | 'folder' | 'connect') => {
    if (opening() || disposed) return;
    setOpening(true); setOpenFailed(false);
    try {
      await props.management.openExtension!(action);
      if (!disposed && !completing) {
        if (action === 'extensions') setExtensionsOpened(true);
        if (action === 'connect') setPhase('confirming');
      }
    } catch { if (!disposed) setOpenFailed(true); }
    finally { if (!disposed) setOpening(false); }
  };
  onMount(() => void prepare());
  const status = () => ({ preparing: props.copy.setupPreparing, waiting: '',
    confirming: props.copy.setupConfirming, connected: props.copy.setupConnected,
    failed: props.copy.setupFailed, timeout: props.copy.setupTimeout }[phase()]);
  const changeStep = (next: 'install' | 'connect') => {
    setStep(next); setOpenFailed(false);
    if (phase() === 'confirming') setPhase('waiting');
  };
  return <section class="space-y-5" data-flower-chrome-connection>
    <ol class="grid grid-cols-2 gap-4 text-sm">
      <li aria-current={step() === 'install' ? 'step' : undefined}
        class="flex items-center gap-2 border-b-2 pb-3" classList={{ 'border-primary font-medium': step() === 'install', 'border-border text-muted-foreground': step() !== 'install' }}>
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">1</span>{props.copy.setupInstallTitle}
      </li>
      <li aria-current={step() === 'connect' ? 'step' : undefined}
        class="flex items-center gap-2 border-b-2 pb-3" classList={{ 'border-primary font-medium': step() === 'connect', 'border-border text-muted-foreground': step() !== 'connect' }}>
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">2</span>{props.copy.setupConfirmTitle}
      </li>
    </ol>
    <Show when={status()}><p class="text-sm" role={phase() === 'failed' ? 'alert' : 'status'} aria-live="polite">{status()}</p></Show>
    <Show when={setup() && (phase() === 'waiting' || phase() === 'confirming')}>
      <Show when={step() === 'install'} fallback={<>
        <p class="text-sm leading-relaxed text-muted-foreground">{props.copy.setupConfirmHint}</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Button size="sm" variant="ghost" disabled={opening()} onClick={() => changeStep('install')}>{props.copy.setupBack}</Button>
          <Button disabled={opening()} onClick={() => void open('connect')}>{props.copy.openConnection}</Button>
        </div>
      </>}>
        <Show when={extensionsOpened()} fallback={<p class="text-sm leading-relaxed text-muted-foreground">{props.copy.extensionHint}</p>}>
          <ol class="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
            <li>{props.copy.setupDeveloperMode}</li>
            <li>{props.copy.setupLoadUnpacked}</li>
            <li>{props.copy.setupChooseFolder}
              <div class="mt-2 rounded-md border border-border bg-muted/30 p-3" role="group" aria-label={props.copy.extensionPath}>
                <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-extension-folder-route>
                  <li class="flex items-center gap-1.5 text-muted-foreground">{props.copy.setupHome}<kbd class="rounded border border-border px-1 py-0.5 text-[10px]">{setup()!.platform === 'darwin' ? '⌘⇧H' : 'Alt+Home'}</kbd></li>
                  <For each={setup()!.extension_home_path}>{(part, index) => <li class="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" class="text-muted-foreground">›</span>
                    <span class="break-all" classList={{ 'font-medium': index() === setup()!.extension_home_path.length - 1 }}>{part}</span>
                  </li>}</For>
                </ol>
                <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{props.copy.setupFolderHint}</p>
                <Button class="mt-2" size="sm" variant="outline" disabled={opening()} onClick={() => void open('folder')}>{props.copy.openExtensionFolder}</Button>
              </div>
            </li>
          </ol>
        </Show>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Show when={extensionsOpened()} fallback={<>
            <Button size="sm" variant="ghost" disabled={opening()} onClick={() => changeStep('connect')}>{props.copy.setupAlreadyInstalled}</Button>
            <Button disabled={opening()} onClick={() => void open('extensions')}>{props.copy.openExtensions}</Button>
          </>}>
            <Button size="sm" variant="ghost" disabled={opening()} onClick={() => void open('extensions')}>{props.copy.openExtensions}</Button>
            <Button disabled={opening()} onClick={() => changeStep('connect')}>{props.copy.setupInstalled}</Button>
          </Show>
        </div>
      </Show>
    </Show>
    <Show when={openFailed()}><p class="text-xs text-destructive" role="alert">{props.copy.setupOpenFailed}</p></Show>
    <Show when={phase() === 'failed' || phase() === 'timeout'}><Button onClick={() => void prepare()}>{props.copy.retryConnection}</Button></Show>
    <Show when={setup() && phase() !== 'connected'}>
      <details class="border-t border-border pt-3 text-xs text-muted-foreground">
        <summary class="w-fit cursor-pointer">{props.copy.setupHelp}</summary>
        <div class="mt-3 space-y-3 leading-relaxed">
          <p>{props.copy.setupHostHint}</p>
          <p>{props.copy.setupLabelsHint}</p>
          <label class="block space-y-1">{props.copy.extensionPath}<input ref={pathInput} class="flower-settings-text-input w-full" readOnly value={setup()!.extension_path} onFocus={event => event.currentTarget.select()} /></label>
          <Button size="sm" variant="ghost" onClick={() => {
            void navigator.clipboard.writeText(setup()!.extension_path).then(() => { if (!disposed) setCopied(true); }, () => {
              if (!disposed) { pathInput?.focus(); pathInput?.select(); }
            });
          }}>{copied() ? props.copy.pathCopied : props.copy.copyExtensionPath}</Button>
        </div>
      </details>
    </Show>
  </section>;
}
