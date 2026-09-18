import { createSignal, onCleanup, onMount, Show } from 'solid-js';
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
  const [opening, setOpening] = createSignal(false);
  const [openFailed, setOpenFailed] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
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
      if (!disposed && !completing && action === 'connect') setPhase('confirming');
    } catch { if (!disposed) setOpenFailed(true); }
    finally { if (!disposed) setOpening(false); }
  };
  onMount(() => void prepare());
  const status = () => ({ preparing: props.copy.setupPreparing, waiting: props.copy.setupWaiting,
    confirming: props.copy.setupConfirming, connected: props.copy.setupConnected,
    failed: props.copy.setupFailed, timeout: props.copy.setupTimeout }[phase()]);
  return <section class="space-y-4 rounded-md border border-border p-4" data-flower-chrome-connection>
    <p class="text-sm text-muted-foreground">{props.copy.connectionHint}</p>
    <p class="text-sm font-medium" role={phase() === 'failed' ? 'alert' : 'status'} aria-live="polite">{status()}</p>
    <Show when={setup() && phase() !== 'connected'}>
      <ol class="space-y-4 text-sm">
        <li class="space-y-2"><h3 class="font-medium">1. {props.copy.setupInstallTitle}</h3>
          <p class="text-xs leading-relaxed text-muted-foreground">{props.copy.extensionHint}</p>
          <div class="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={opening()} onClick={() => void open('extensions')}>{props.copy.openExtensions}</Button>
            <Button size="sm" variant="outline" disabled={opening()} onClick={() => void open('folder')}>{props.copy.openExtensionFolder}</Button></div>
          <label class="block space-y-1 text-xs">{props.copy.extensionPath}<input class="flower-settings-text-input w-full" readOnly value={setup()!.extension_path} /></label>
          <Button size="sm" variant="ghost" onClick={() => {
            void navigator.clipboard.writeText(setup()!.extension_path).then(() => { if (!disposed) setCopied(true); }, () => { if (!disposed) setOpenFailed(true); });
          }}>{copied() ? props.copy.pathCopied : props.copy.copyExtensionPath}</Button>
        </li>
        <li class="space-y-2"><h3 class="font-medium">2. {props.copy.setupConfirmTitle}</h3>
          <p class="text-xs leading-relaxed text-muted-foreground">{props.copy.setupConfirmHint}</p>
          <Button size="sm" disabled={opening()} onClick={() => void open('connect')}>{props.copy.openConnection}</Button>
        </li>
      </ol>
    </Show>
    <Show when={openFailed()}><p class="text-xs text-destructive" role="alert">{props.copy.setupOpenFailed}</p></Show>
    <Show when={phase() === 'failed' || phase() === 'timeout'}><Button size="sm" variant="secondary" onClick={() => void prepare()}>{props.copy.retryConnection}</Button></Show>
  </section>;
}
