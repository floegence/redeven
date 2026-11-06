import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, Show } from 'solid-js';
import { Button, Dialog, StableText } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, ChevronRight, Globe, Info, MonitorPointer, Plus, Refresh, Settings, Shield, Sparkles } from '@floegence/floe-webapp-core/icons';
import type { FlowerManagedProfile, FlowerComputerAccess, FlowerComputerCapability, FlowerComputerEnvironment, FlowerComputerInventory, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';
import { FlowerManagedBrowser } from './FlowerManagedBrowser';
import { FlowerChromeConnection } from './FlowerChromeConnection';
import { FlowerChromeReadiness } from './FlowerChromeReadiness';
import { FlowerComputerBrandIcon, FlowerComputerEnvironmentIdentity } from './FlowerComputerIdentity';

export type FlowerRequestedComputerAccess = Readonly<{ origin?: string; app?: string; foreground?: boolean }>;
type Page = 'overview' | 'managed' | 'chrome' | 'setup' | 'access' | 'help' | 'diagnostics';

export function FlowerComputerConnections(props: {
  open: boolean; onOpenChange: (open: boolean) => void;
  threadID: string; adapter: Pick<FlowerSurfaceAdapter, 'runtime' | 'canMutate' | 'computerManagement'>; copy: FlowerComputerCopy;
  requested?: FlowerRequestedComputerAccess; fullAccess?: boolean; connectionOnly?: boolean;
  permissionLabel?: string; onEditPermissionMode?: () => void;
  onContinue?: (enabled?: boolean) => Promise<void>; installationOnly?: boolean; continuationKey?: string;
  desktopSetup?: boolean;
  onInstallDesktopWithFlower?: (environment: FlowerComputerEnvironment) => Promise<void>;
  desktopRepairPending?: boolean;
}) {
  const capabilityID = createUniqueId();
  const [page, setPage] = createSignal<Page>('overview');
  const [inventory, setInventory] = createSignal<FlowerComputerInventory>();
  const [environment, setEnvironment] = createSignal<FlowerComputerEnvironment>();
  const [access, setAccess] = createSignal<FlowerComputerAccess>();
  const [profiles, setProfiles] = createSignal<readonly FlowerManagedProfile[]>([]);
  const [origin, setOrigin] = createSignal('');
  const [stopProfile, setStopProfile] = createSignal('');
  const [profileName, setProfileName] = createSignal('');
  const [diagnostic, setDiagnostic] = createSignal<'managed' | 'desktop'>('managed');
  const [verification, setVerification] = createSignal<FlowerComputerCapability>();
  const [verificationUnavailable, setVerificationUnavailable] = createSignal(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [environmentFailed, setEnvironmentFailed] = createSignal(false);
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  let generation = 0;
  let diagnosticsInput: HTMLTextAreaElement | undefined;
  onCleanup(() => { generation++; });
  const management = () => props.adapter.computerManagement;
  const readable = () => !loading() && !busy();
  const mutable = () => props.adapter.canMutate !== false && readable();
  const guideKey = createMemo(() => props.open ? `${props.threadID}:${props.connectionOnly ? 'assistance' : page()}` : '');
  const targets = () => inventory()?.candidates ?? [];
  const stateLabel = (state?: string) => ({ ready: props.copy.available, on_demand: props.copy.onDemand,
    in_use: props.copy.inUse, user_control: props.copy.waitingControl, permission_required: props.copy.permissionRequired,
    system_preparation_required: props.copy.browserSystemPrepare, unavailable: props.copy.browserDependenciesMissing, disabled: props.copy.browserDisabled, installation_required: props.copy.browserNotInstalled, setup_required: props.copy.setupRequired, stopped: props.copy.stopped, connection_required: props.copy.disconnected }[state ?? ''] ?? props.copy.unknown);
  const go = (next: Page) => { setPage(next); setError(''); setSaved(false); };
  const run = async (action: (epoch: number) => Promise<void>, failure: string, readOnly = false) => {
    if (!(readOnly ? readable() : mutable())) return;
    const epoch = generation; setBusy(true); setError(''); setSaved(false);
    try { await action(epoch); } catch { if (epoch === generation) setError(failure); }
    finally { if (epoch === generation) setBusy(false); }
  };
  const refreshEnvironment = async (epoch = generation) => {
    try {
      const result = await management()?.loadEnvironment?.();
      if (epoch === generation) { setEnvironment(result); setEnvironmentFailed(!result); }
    } catch { if (epoch === generation) { setEnvironment(undefined); setEnvironmentFailed(true); } }
  };
  const refreshInventory = async (epoch = generation) => {
    if (!props.threadID || !management()) return;
    try {
      const result = await management()!.listCandidates(props.threadID);
      if (epoch === generation) setInventory(result);
    } catch { if (epoch === generation) setInventory(undefined); }
  };
  const load = async () => {
    const epoch = generation; setLoading(true);
    await refreshEnvironment(epoch);
    if (epoch === generation) setLoading(false);
  };
  createEffect(on(() => [props.open, props.threadID, props.connectionOnly, props.installationOnly, props.desktopSetup] as const, ([open]) => {
    generation++; setPage(props.installationOnly ? 'managed' : props.desktopSetup ? 'diagnostics' : 'overview'); setDiagnostic(props.desktopSetup ? 'desktop' : 'managed'); setInventory(undefined); setEnvironment(undefined); setAccess(undefined);
    setProfiles([]); setStopProfile(''); setError(''); setSaved(false); setOrigin(''); setProfileName(''); setBusy(false);
    setVerification(undefined); setVerificationUnavailable(false); setDiagnosticsCopied(false);
    setEnvironmentFailed(false);
    if (open && !props.connectionOnly) void load(); else setLoading(false);
  }));
  const openAccess = () => {
    go('access'); setAccess(undefined);
    void run(async epoch => {
      const [value] = await Promise.all([management()!.loadAccess(props.threadID), refreshInventory(epoch)]);
      if (epoch === generation) setAccess({ origins: value.origins ?? [], apps: value.apps ?? [], allow_foreground: value.allow_foreground });
    }, props.copy.accessSettingsFailed, true);
  };
  const loadProfiles = () => {
    setProfiles([]);
    void run(async epoch => {
      const value = await management()!.listManagedProfiles!();
      if (epoch === generation) setProfiles(value);
    }, props.copy.profileFailed, true);
  };
  const manageProfile = (id: string, action: 'start' | 'stop') => run(async epoch => {
    try {
      const value = await management()!.manageBrowserProfile!(id, action);
      if (epoch === generation) { setProfiles(value); setStopProfile(''); }
    } catch {
      if (epoch === generation) setError(props.copy.browserLifecycleFailed);
    }
  }, props.copy.browserLifecycleFailed);
  const saveAccess = (value: FlowerComputerAccess) => run(async epoch => {
    await management()!.saveAccess(props.threadID, value);
    if (epoch === generation) { setAccess(value); setSaved(true); }
  }, props.copy.accessSettingsFailed);
  const addOrigin = () => {
    try {
      const url = new URL(origin().trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid origin');
      setAccess(value => ({ ...value!, origins: [...new Set([...value!.origins, url.origin])] })); setOrigin(''); setError(''); setSaved(false);
    } catch { setError(props.copy.invalidOrigin); }
  };
  const diagnose = (kind: 'managed' | 'desktop') => { setVerification(undefined); setVerificationUnavailable(false); setDiagnostic(kind); go('diagnostics'); };
  const capability = () => environment()?.[diagnostic()];
  const desktopVerification = () => verification();
  const repairEnvironment = () => {
    const current = environment();
    return current ? { ...current, desktop: { ...current.desktop, ...desktopVerification() } } : undefined;
  };
  const verifyDesktop = () => run(async epoch => {
    setVerification(undefined); setVerificationUnavailable(false);
    try {
      const result = await management()!.verifyDesktop!();
      if (epoch === generation) { setVerification(result); await refreshEnvironment(epoch); }
    } catch { if (epoch === generation) setVerificationUnavailable(true); }
  }, props.copy.desktopVerifyUnavailable);
  const installDesktopWithFlower = () => run(async epoch => {
    const current = repairEnvironment();
    if (!current || !props.onInstallDesktopWithFlower || props.desktopRepairPending) return;
    await props.onInstallDesktopWithFlower(current);
    if (epoch === generation) props.onOpenChange(false);
  }, props.copy.desktopRepairUnavailable);
  const diagnosticText = () => JSON.stringify({ platform: environment()?.platform, desktop: environment()?.desktop, verification: desktopVerification() }, null, 2);
  const copyText = (text: string, copied: (value: boolean) => void, input?: HTMLTextAreaElement) => {
    if (!navigator.clipboard?.writeText) { input?.focus(); input?.select(); return; }
    void navigator.clipboard.writeText(text).then(() => copied(true), () => { input?.focus(); input?.select(); });
  };
  const capabilityHint = (kind: 'managed' | 'desktop') => {
    const state = environment()?.[kind].state;
    if (!state) return props.copy.loadFailed;
    if (state === 'disabled') return props.copy.browserDisabledHint;
    if (state === 'permission_required') return props.copy.desktopPermissionHint;
    if (state === 'setup_required') return kind === 'managed' ? props.copy.managedMissingHint : props.copy.desktopMissingHint;
    return kind === 'managed' ? props.copy.managedHint : environment()?.platform === 'linux' ? props.copy.desktopPrivateHint : props.copy.desktopHint;
  };
  const title = createMemo(() => props.connectionOnly ? props.copy.connectionTitle : ({ overview: props.copy.title,
    managed: props.copy.managed, chrome: props.copy.chromeTitle, setup: props.copy.connectionTitle, access: props.copy.permissions,
    help: props.copy.help, diagnostics: diagnostic() === 'desktop' ? props.copy.desktopTitle : props.copy.managed }[page()]));
  const chromeState = () => {
    const snapshot = environment();
    return !snapshot ? props.copy.unknown : snapshot.chrome.profiles.length ? props.copy.connected : props.copy.chromeOffline;
  };
  const browserKind = (installationID: string): 'chrome' | 'chromium' | undefined => {
    const kind = environment()?.chrome.installations.find(item => item.id === installationID)?.kind;
    return kind === 'google_chrome' ? 'chrome' : kind === 'chromium' || kind === 'chromium_snap' ? 'chromium' : undefined;
  };
  const capabilityTone = (state?: string) => state === 'ready' ? 'positive' : state === 'permission_required' || state === 'setup_required' ? 'attention' : 'neutral';
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}
    title={<span class="flower-computer-title"><Show when={page() === 'chrome' || page() === 'setup' || props.connectionOnly} fallback={<Show when={page() === 'managed' || (page() === 'diagnostics' && diagnostic() === 'managed')} fallback={<MonitorPointer aria-hidden="true" />}><FlowerComputerBrandIcon kind="chromium" /></Show>}><FlowerComputerBrandIcon kind="chrome" /></Show>{title()}</span>}
    closeLabel={props.copy.close} class={props.connectionOnly ? 'flower-computer-dialog w-[min(36rem,94vw)] max-w-[36rem]' : 'flower-computer-dialog w-[min(42rem,94vw)] max-w-[42rem]'}
    contentClass={`flower-computer-content${page() === 'managed' ? ' flower-computer-managed-content' : ''}`}
    footer={props.connectionOnly ? undefined : <div class="flower-computer-footer">
      <Show when={page() === 'overview'} fallback={<Button variant="outline" disabled={busy()} onClick={() => go('overview')}><ChevronLeft class="size-3.5" />{props.copy.back}</Button>}>
        <Show when={props.threadID}><Button variant="outline" disabled={!readable()} onClick={openAccess}><Shield class="size-3.5" />{props.permissionLabel || (props.fullAccess ? props.copy.fullAccessTitle : props.copy.permissions)}<ChevronRight class="size-3.5" /></Button></Show>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={page() === 'access' && !props.fullAccess}><Button size="sm" disabled={!mutable() || !access()} onClick={() => { const value = access(); if (value) void saveAccess(value); }}>{props.copy.save}</Button></Show>
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>{props.copy.close}</Button>
      </div>
    </div>}>
    <Show when={!props.connectionOnly} fallback={<Show when={management()?.loadExtensionStatus && management()?.setupExtension && management()?.openExtension && props.adapter.canMutate !== false} fallback={<p role="alert">{props.copy.setupRequired}</p>}>
      <Show when={guideKey()} keyed>{_key => <FlowerChromeConnection onRemoteBrowserPrepared={() => props.onOpenChange(false)} environmentName={environment()?.hostname || props.adapter.runtime.display_name} reuseConnected management={management()!} copy={props.copy} onConnected={async () => { await props.onContinue?.(); }} />}</Show>
    </Show>}>
      <div class="flower-computer-panel flower-body-copy flower-computer-settings" data-flower-computer-panel={page()} aria-busy={loading() || busy()}>
        <Show when={page() !== 'chrome' && page() !== 'setup'}><FlowerComputerEnvironmentIdentity name={environment()?.hostname || props.adapter.runtime.display_name} platform={environment()?.platform} label={props.copy.environmentTitle} /></Show>
        <Show when={page() === 'overview'}>
          <section class="flower-computer-capabilities" aria-label={props.copy.environmentCapabilities}>
            <div class="flower-computer-capability-grid" data-floe-surface="raised">
              <section class="flower-computer-capability" data-floe-surface-divider>
                <span class="flower-computer-capability-icon" aria-hidden="true"><FlowerComputerBrandIcon kind="chromium" /></span>
                <div class="flower-computer-capability-copy"><h4 id={`${capabilityID}-managed-title`}>{props.copy.managed}</h4><p class="flower-computer-description">{capabilityHint('managed')}</p></div>
                <span id={`${capabilityID}-managed-state`} class="flower-computer-status" data-tone={capabilityTone(environment()?.managed.state)}>{stateLabel(environment()?.managed.state)}</span>
                <ChevronRight class="flower-computer-capability-chevron" aria-hidden="true" />
                <button type="button" class="flower-computer-capability-action" aria-labelledby={`${capabilityID}-managed-title ${capabilityID}-managed-action`} aria-describedby={`${capabilityID}-managed-state`} disabled={!readable()} onClick={() => go('managed')}><span id={`${capabilityID}-managed-action`} class="sr-only">{props.copy.browserSettings}</span></button>
              </section>
              <section class="flower-computer-capability" data-floe-surface-divider>
                <span class="flower-computer-capability-icon" aria-hidden="true"><FlowerComputerBrandIcon kind="chrome" /></span>
                <div class="flower-computer-capability-copy"><h4 id={`${capabilityID}-chrome-title`}>{props.copy.chromeTitle}</h4><p class="flower-computer-description">{environment()?.chrome.profiles.length ? props.copy.chromeOnlineHint : props.copy.chromeOfflineHint}</p></div>
                <span id={`${capabilityID}-chrome-state`} class="flower-computer-status" data-tone={environment()?.chrome.profiles.length ? 'positive' : 'neutral'}>{chromeState()}</span>
                <ChevronRight class="flower-computer-capability-chevron" aria-hidden="true" />
                <button type="button" class="flower-computer-capability-action" aria-labelledby={`${capabilityID}-chrome-title ${capabilityID}-chrome-action`} aria-describedby={`${capabilityID}-chrome-state`} disabled={!readable()} onClick={() => go('chrome')}><span id={`${capabilityID}-chrome-action`} class="sr-only">{props.copy.manage}</span></button>
              </section>
              <section class="flower-computer-capability" data-floe-surface-divider>
                <span class="flower-computer-capability-icon" aria-hidden="true"><MonitorPointer /></span>
                <div class="flower-computer-capability-copy"><h4 id={`${capabilityID}-desktop-title`}>{props.copy.desktopTitle}</h4><p class="flower-computer-description">{capabilityHint('desktop')}</p></div>
                <span id={`${capabilityID}-desktop-state`} class="flower-computer-status" data-tone={capabilityTone(environment()?.desktop.state)}>{stateLabel(environment()?.desktop.state)}</span>
                <ChevronRight class="flower-computer-capability-chevron" aria-hidden="true" />
                <button type="button" class="flower-computer-capability-action" aria-labelledby={`${capabilityID}-desktop-title ${capabilityID}-desktop-action`} aria-describedby={`${capabilityID}-desktop-state`} disabled={!readable()} onClick={() => diagnose('desktop')}><span id={`${capabilityID}-desktop-action`} class="sr-only">{props.copy.details}</span></button>
              </section>
            </div>
          </section>
          <div class="flower-computer-utilities">
            <Button variant="ghost" onClick={() => go('help')}><Info class="size-3.5" />{props.copy.help}<ChevronRight class="size-3.5" /></Button>
          </div>
        </Show>
        <Show when={page() === 'managed'}>
          <Show when={management()?.loadBrowserInstallation}><FlowerManagedBrowser continuationKey={props.continuationKey} management={management()!} copy={props.copy} canMutate={props.adapter.canMutate !== false} onChange={() => void load()} onContinue={props.installationOnly ? props.onContinue : undefined} /></Show>
          <p class="flower-computer-description">{props.copy.managedModeValue}</p>
          <Show when={!props.installationOnly}><details class="flower-computer-detail-card" onToggle={event => { if (event.currentTarget.open) loadProfiles(); }}><summary class="cursor-pointer text-xs font-medium">{props.copy.browserProfiles}</summary>
            <p class="mt-3 flower-computer-description">{props.copy.profileHint} {props.copy.profileIsolationHint}</p>
            <div class="mt-3 space-y-2"><For each={profiles()}>{profile => <section class="flower-computer-profile-card rounded-md border border-border p-3 text-xs" aria-label={profile.id === 'browser-main' ? props.copy.profileDefault : profile.name}>
              <div class="flex flex-wrap items-center gap-2"><Globe class="size-4 shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1 break-words text-xs">{profile.id === 'browser-main' ? props.copy.profileDefault : profile.name}</span>
                <span class="text-xs text-muted-foreground">{({ running: props.copy.browserRunning, idle: props.copy.browserIdle, stopped: props.copy.stopped, failed: props.copy.browserNeedsAttention })[profile.state ?? 'stopped']}</span>
                <Show when={management()?.manageBrowserProfile}><Button size="sm" variant="outline" disabled={!mutable()} onClick={() => { if (!profile.state || profile.state === 'stopped') void manageProfile(profile.id, 'start'); else setStopProfile(profile.id); }}>{!profile.state || profile.state === 'stopped' ? props.copy.browserStart : props.copy.browserStop}</Button></Show>
              </div>
              <Show when={stopProfile() === profile.id}><div class="mt-3 space-y-2"><p class="text-xs text-muted-foreground">{props.copy.browserStopHint}</p><div class="flex gap-2"><Button size="sm" variant="outline" disabled={!mutable()} onClick={() => void manageProfile(profile.id, 'stop')}>{props.copy.browserStop}</Button><Button size="sm" variant="ghost" disabled={!mutable()} onClick={() => setStopProfile('')}>{props.copy.cancel}</Button></div></div></Show>
            </section>}</For></div>
            <form class="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(async epoch => {
            const value = await management()!.createManagedProfile!(profileName().trim());
            if (epoch === generation) { setProfiles(value); setProfileName(''); }
          }, props.copy.profileFailed); }}><label class="min-w-0 flex-1 space-y-1 text-xs">{props.copy.profileName}<input class="flower-settings-text-input w-full" value={profileName()} maxlength={120} required onInput={event => setProfileName(event.currentTarget.value)} /></label><Button size="sm" type="submit" disabled={!mutable() || !profileName().trim() || !management()?.createManagedProfile}>{props.copy.createProfile}</Button></form></details></Show>
        </Show>
        <Show when={page() === 'chrome'}>
          <FlowerChromeReadiness status={environment()?.chrome} diagnostic={environment()?.chrome.diagnostic} environmentName={environment()?.hostname || props.adapter.runtime.display_name}
            platform={environment()?.platform} copy={props.copy}>
            <p>{props.copy.pairingPersistence}</p><p>{props.copy.setupHostHint}</p>
          </FlowerChromeReadiness>
          <div class="flower-computer-browser-list" data-floe-surface="raised">
            <For each={environment()?.chrome.profiles ?? []}>{profile => <div class="flower-computer-profile">
              <Show when={browserKind(profile.installation_id)} fallback={<Globe class="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />}>{kind => <FlowerComputerBrandIcon kind={kind()} />}</Show>
              <span class="flower-computer-profile-name">{profile.name}</span><span class="flower-computer-status" data-tone="positive">{props.copy.connected}</span>
            </div>}</For>
            <Show when={environment() && !environment()?.chrome.profiles.length && !environment()?.chrome.diagnostic}><div class="flower-computer-browser-empty"><FlowerComputerBrandIcon kind="chrome" /><h3>{props.copy.chromeOffline}</h3><p class="flower-computer-description">{props.copy.chromeConnectHint}</p></div></Show>
            <Show when={!environment()}><p class="flower-computer-description" role="status">{loading() ? props.copy.checking : props.copy.loadFailed}</p></Show>
            <div class="flower-computer-browser-actions" data-floe-surface-divider><Button size="sm" icon={Plus} variant={environment()?.chrome.profiles.length ? 'outline' : 'primary'} disabled={!mutable() || !management()?.setupExtension || !management()?.openExtension || !management()?.loadExtensionStatus} onClick={() => go('setup')}>{props.copy.setupChrome}</Button>
              <Button size="sm" variant="ghost" icon={Refresh} loading={loading()} disabled={!readable()} onClick={() => void load()}>{props.copy.refresh}</Button></div>
          </div>
          <Show when={!environment()?.chrome.diagnostic}><details class="flower-computer-disclosure"><summary><Info aria-hidden="true" />{props.copy.help}<ChevronRight aria-hidden="true" /></summary><p class="flower-computer-description">{props.copy.pairingPersistence}</p></details></Show>
        </Show>
        <Show when={page() === 'setup' && guideKey()} keyed>{_key => <FlowerChromeConnection onRemoteBrowserPrepared={() => props.onOpenChange(false)} environmentName={environment()?.hostname || props.adapter.runtime.display_name} platform={environment()?.platform} management={management()!} copy={props.copy} onConnected={async () => { const epoch = generation; await refreshEnvironment(epoch); if (epoch === generation) go('chrome'); }} />}</Show>
        <Show when={page() === 'diagnostics'}>
          <div class="flower-computer-detail-card space-y-3" data-floe-surface="raised"><div class="flower-computer-section-heading"><span class="flower-computer-detail-icon" aria-hidden="true"><Show when={diagnostic() === 'desktop'} fallback={<FlowerComputerBrandIcon kind="chromium" />}><MonitorPointer /></Show></span><span class="flower-computer-status" data-tone={capabilityTone(capability()?.state)}>{stateLabel(capability()?.state)}</span></div><p class="leading-relaxed text-muted-foreground">{capabilityHint(diagnostic())}</p>
          <Show when={diagnostic() === 'desktop' && environment()?.platform === 'linux'} fallback={<Show when={!capability() || capability()?.state === 'setup_required'}><p class="text-xs leading-relaxed text-muted-foreground">{environmentFailed() ? props.copy.loadFailed : props.copy.repairHint}</p></Show>}>
            <Show when={capability()?.components?.length}><div class="space-y-1"><h4 class="text-xs font-medium">{props.copy.desktopMissingComponents}</h4><ul class="space-y-1"><For each={capability()?.components}>{component => <li><code class="break-all text-xs">{component.path}</code></li>}</For></ul></div></Show>
            <Show when={capability()?.state === 'setup_required' || desktopVerification()?.state === 'setup_required'}><div class="space-y-2"><p>{props.copy.desktopFlowerHint}</p>
              <Button size="sm" variant="primary" icon={Sparkles} disabled={!mutable() || !props.onInstallDesktopWithFlower || props.desktopRepairPending} onClick={() => void installDesktopWithFlower()}>{props.copy.desktopInstallWithFlower}</Button></div></Show>
            <Show when={desktopVerification()}>{result => <p role={result().state === 'ready' ? 'status' : 'alert'}>{result().state === 'ready' ? props.copy.desktopVerified : result().state === 'in_use' ? props.copy.desktopVerifyInUse : props.copy.desktopVerifyFailed}</p>}</Show>
            <Show when={verificationUnavailable()}><p role="alert">{props.copy.desktopVerifyUnavailable}</p></Show>
          </Show>
          </div><details class="flower-computer-disclosure"><summary><Shield aria-hidden="true" />{props.copy.permissions}<ChevronRight aria-hidden="true" /></summary><p class="flower-computer-description">{props.copy.permissionBoundary}</p></details>
          <Show when={diagnostic() === 'desktop' && environment()?.platform === 'linux'} fallback={<Show when={capability()?.reason}><details><summary class="cursor-pointer text-xs">{props.copy.diagnostics}</summary><code class="mt-2 block break-all text-xs">{capability()!.reason}</code></details></Show>}><details open={!!desktopVerification()?.reason}><summary class="cursor-pointer text-xs">{props.copy.diagnostics}</summary><textarea ref={diagnosticsInput} readOnly aria-label={props.copy.diagnostics} class="flower-settings-text-input mt-2 w-full min-h-20 font-mono text-xs" value={diagnosticText()} onFocus={event => event.currentTarget.select()} /><Button size="sm" variant="outline" onClick={() => copyText(diagnosticText(), setDiagnosticsCopied, diagnosticsInput)}><StableText reserve={[props.copy.chromeDiagnosticCopied, props.copy.chromeCopyDiagnostics]}>{diagnosticsCopied() ? props.copy.chromeDiagnosticCopied : props.copy.chromeCopyDiagnostics}</StableText></Button></details></Show>
          <div class="flower-computer-action-row"><Button size="sm" variant="outline" disabled={!readable()} onClick={() => { setVerification(undefined); setVerificationUnavailable(false); void load(); }}>{props.copy.refresh}</Button><Show when={diagnostic() === 'desktop' && environment()?.platform === 'linux' && ['on_demand', 'ready'].includes(capability()?.state ?? '')}><Button size="sm" loading={busy()} disabled={!mutable() || !management()?.verifyDesktop} onClick={() => void verifyDesktop()}><StableText reserve={[props.copy.desktopVerifying, props.copy.desktopVerify]}>{busy() ? props.copy.desktopVerifying : props.copy.desktopVerify}</StableText></Button></Show><Show when={props.desktopSetup && desktopVerification()?.state === 'ready'}><Button size="sm" variant="primary" onClick={() => props.onOpenChange(false)}>{props.copy.backToChat}</Button></Show></div>
        </Show>
        <Show when={page() === 'help'}><div class="flower-computer-help-grid text-xs leading-relaxed text-muted-foreground"><section class="flower-computer-detail-card"><FlowerComputerBrandIcon kind="chrome" class="mb-3" /><h3 class="mb-2 font-medium text-foreground">{props.copy.chromeTitle}</h3><p>{props.copy.pairingPersistence}</p></section><section class="flower-computer-detail-card"><FlowerComputerBrandIcon kind="chromium" class="mb-3" /><h3 class="mb-2 font-medium text-foreground">{props.copy.managed}</h3><p>{props.copy.profileHint}</p></section><section class="flower-computer-detail-card"><Shield class="mb-3 size-5" /><h3 class="mb-2 font-medium text-foreground">{props.copy.permissions}</h3><p>{props.copy.permissionBoundary}</p></section></div></Show>
        <Show when={page() === 'access'}>
          <div class="flower-computer-note"><Shield aria-hidden="true" /><p class="flower-computer-description">{props.copy.permissionBoundary}</p></div>
          <Show when={props.onEditPermissionMode}><Button size="sm" variant="outline" disabled={!mutable()} onClick={() => { props.onOpenChange(false); props.onEditPermissionMode?.(); }}><Settings class="size-3.5" />{props.copy.editPermissions}</Button></Show>
          <Show when={props.fullAccess} fallback={<Show when={access()}>{value => <>
            <Show when={props.requested?.origin || props.requested?.app || props.requested?.foreground}><div class="space-y-2 rounded-md bg-muted/40 p-3"><p class="font-medium">{props.copy.requestedAccess}</p><p class="break-all text-xs">{[props.requested?.origin, props.requested?.app, props.requested?.foreground ? props.copy.foreground : ''].filter(Boolean).join(' · ')}</p><Button size="sm" variant="outline" disabled={!mutable()} onClick={() => { setAccess({ origins: [...new Set([...value().origins, ...(props.requested?.origin ? [props.requested.origin] : [])])], apps: [...new Set([...value().apps, ...(props.requested?.app ? [props.requested.app] : [])])], allow_foreground: value().allow_foreground || props.requested?.foreground === true }); setSaved(false); }}>{props.copy.grantRequested}</Button></div></Show>
            <section class="space-y-2"><h3 class="font-medium">{props.copy.sites}</h3><For each={value().origins}>{site => <div class="flex items-center justify-between gap-2"><span class="min-w-0 break-all text-xs">{site}</span><Button size="sm" variant="ghost" disabled={!mutable()} aria-label={`${props.copy.remove}: ${site}`} onClick={() => { setAccess({ ...value(), origins: value().origins.filter(item => item !== site) }); setSaved(false); }}>{props.copy.remove}</Button></div>}</For>
              <form class="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); addOrigin(); }}><input type="url" class="flower-settings-text-input min-w-0 flex-1" aria-label={props.copy.sites} placeholder={props.copy.sitePlaceholder} value={origin()} disabled={!mutable()} onInput={event => setOrigin(event.currentTarget.value)} /><Button type="submit" size="sm" disabled={!mutable() || !origin().trim()}>{props.copy.add}</Button></form>
            </section><section class="space-y-2"><h3 class="font-medium">{props.copy.apps}</h3><For each={[...new Set([...value().apps, ...targets().flatMap(target => target.app_bundle_id ? [target.app_bundle_id] : [])])]}>{app => <label class="flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed"><input type="checkbox" class="cursor-pointer disabled:cursor-not-allowed" disabled={!mutable()} checked={value().apps.includes(app)} onChange={event => { setAccess({ ...value(), apps: event.currentTarget.checked ? [...value().apps, app] : value().apps.filter(item => item !== app) }); setSaved(false); }} /><span class="break-all text-xs">{app}</span></label>}</For></section>
            <label class="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed"><input type="checkbox" class="mt-1 cursor-pointer disabled:cursor-not-allowed" disabled={!mutable()} checked={value().allow_foreground} onChange={event => { setAccess({ ...value(), allow_foreground: event.currentTarget.checked }); setSaved(false); }} /><span>{props.copy.foreground}<span class="mt-1 block text-xs text-muted-foreground">{props.copy.foregroundHint}</span></span></label>
            <Button size="sm" variant="outline" disabled={!mutable()} onClick={() => void saveAccess({ origins: [], apps: [], allow_foreground: false })}>{props.copy.revokeAll}</Button>
          </>}</Show>}><p class="rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{props.copy.fullAccessHint}</p></Show>
        </Show>
        <Show when={environmentFailed() && page() === 'overview'}><p role="alert" class="text-xs text-destructive">{props.copy.loadFailed}</p><Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load()}>{props.copy.refresh}</Button></Show>
        <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show><Show when={saved()}><p role="status" class="text-xs">{props.copy.saved}</p></Show>
      </div>
    </Show>
  </Dialog>;
}
