import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { ArrowRightLeft, ChevronLeft, ChevronRight, Code, Globe, Info, MonitorPointer, Plus, Refresh, Search, Settings, Shield, Sparkles } from '@floegence/floe-webapp-core/icons';
import type { FlowerComputerAccess, FlowerComputerCandidate, FlowerComputerEnvironment, FlowerComputerInventory, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';
import { FlowerManagedBrowser } from './FlowerManagedBrowser';
import { FlowerChromeConnection } from './FlowerChromeConnection';

export type FlowerRequestedComputerAccess = Readonly<{ origin?: string; app?: string; foreground?: boolean }>;
type Page = 'overview' | 'targets' | 'managed' | 'chrome' | 'setup' | 'access' | 'advanced' | 'help' | 'diagnostics';

export function FlowerComputerConnections(props: {
  open: boolean; onOpenChange: (open: boolean) => void;
  threadID: string; adapter: Pick<FlowerSurfaceAdapter, 'runtime' | 'canMutate' | 'computerManagement'>; copy: FlowerComputerCopy;
  requested?: FlowerRequestedComputerAccess; fullAccess?: boolean; connectionOnly?: boolean;
  permissionLabel?: string; onEditPermissionMode?: () => void;
  onContinue?: (enabled?: boolean) => Promise<void>; installationOnly?: boolean;
}) {
  const [page, setPage] = createSignal<Page>('overview');
  const [inventory, setInventory] = createSignal<FlowerComputerInventory>();
  const [environment, setEnvironment] = createSignal<FlowerComputerEnvironment>();
  const [access, setAccess] = createSignal<FlowerComputerAccess>();
  const [profiles, setProfiles] = createSignal<readonly Readonly<{ id: string; name: string }>[]>([]);
  const [query, setQuery] = createSignal('');
  const [targetFilter, setTargetFilter] = createSignal<'all' | 'browser' | 'app'>('all');
  const [draft, setDraft] = createSignal('');
  const [origin, setOrigin] = createSignal('');
  const [profileName, setProfileName] = createSignal('');
  const [endpoint, setEndpoint] = createSignal('');
  const [diagnostic, setDiagnostic] = createSignal<'managed' | 'desktop'>('managed');
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [inventoryFailed, setInventoryFailed] = createSignal(false);
  const [environmentFailed, setEnvironmentFailed] = createSignal(false);
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  let generation = 0;
  let targetList: HTMLDivElement | undefined;
  onCleanup(() => { generation++; });
  const management = () => props.adapter.computerManagement;
  const readable = () => !loading() && !busy();
  const mutable = () => props.adapter.canMutate !== false && readable();
  const guideKey = createMemo(() => props.open ? `${props.threadID}:${props.connectionOnly ? 'assistance' : page()}` : '');
  const targets = () => inventory()?.candidates ?? [];
  const current = () => targets().find(target => target.target_id && target.target_id === inventory()?.current_target_id);
  const selected = () => targets().find(target => target.candidate_ref === draft());
  const targetLabel = (target: FlowerComputerCandidate) => target.new_tab
    ? [target.kind === 'browser.managed' ? props.copy.managed : props.copy.system, target.profile_name, props.copy.newTab].filter(Boolean).join(' · ')
    : target.title || (target.kind === 'browser.managed' ? props.copy.managed : target.display_name);
  const stateLabel = (state?: string) => ({ ready: props.copy.available, on_demand: props.copy.onDemand,
    in_use: props.copy.inUse, user_control: props.copy.waitingControl, permission_required: props.copy.permissionRequired,
    disabled: props.copy.browserDisabled, installation_required: props.copy.browserNotInstalled, setup_required: props.copy.setupRequired, stopped: props.copy.stopped, connection_required: props.copy.disconnected }[state ?? ''] ?? props.copy.unknown);
  const candidateState = (target: FlowerComputerCandidate) => target.kind === 'browser.managed'
    && environment()?.managed.state !== 'on_demand' && environment()?.managed.state !== 'ready'
    ? environment()?.managed.state ?? 'unknown' : target.state;
  const canSelect = (target: FlowerComputerCandidate) => !inventoryFailed() && (candidateState(target) === 'ready'
    || (target.kind === 'xvfb.desktop' && target.state === 'stopped' && environment()?.desktop.state === 'on_demand'));
  const matchingTargets = createMemo(() => targets().filter(target =>
    `${target.display_name} ${target.title ?? ''} ${target.url ?? ''} ${target.profile_name ?? ''}`.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase())));
  const targetCount = (filter: 'all' | 'browser' | 'app') => matchingTargets().filter(target => filter === 'all' || target.kind.startsWith('browser.') === (filter === 'browser')).length;
  const filteredTargets = (browser: boolean) => matchingTargets().filter(target => target.kind.startsWith('browser.') === browser
    && (targetFilter() === 'all' || (targetFilter() === 'browser') === browser));
  const pickerLabel = (target: FlowerComputerCandidate) => target.new_tab ? props.copy.newTab : targetLabel(target);
  const pickerDetail = (target: FlowerComputerCandidate) => {
    if (target.url) return [target.profile_name, target.url.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ');
    return target.profile_name || (target.kind === 'browser.managed' ? props.copy.managed : target.display_name);
  };
  createEffect(on([query, targetFilter], () => { if (targetList) targetList.scrollTop = 0; }, { defer: true }));
  const currentLabel = () => inventoryFailed() || !inventory() ? props.copy.unknown : current() ? targetLabel(current()!) : inventory()!.current_target_id ? props.copy.currentMissing : props.copy.automatic;
  const currentHint = () => inventoryFailed() || !inventory() ? props.copy.loadFailed : current()
    ? [current()!.profile_name, current()!.url, stateLabel(current()!.state)].filter(Boolean).join(' · ')
    : inventory()!.current_target_id ? props.copy.currentMissingHint : props.copy.automaticHint;
  const go = (next: Page) => { setPage(next); setError(''); setSaved(false); setDraft(''); setQuery(''); setTargetFilter('all'); };
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
      if (epoch === generation) { setInventory(result); setInventoryFailed(false); }
    } catch { if (epoch === generation) setInventoryFailed(true); }
  };
  const load = async () => {
    const epoch = generation; setLoading(true);
    await Promise.all([refreshEnvironment(epoch), refreshInventory(epoch)]);
    if (epoch === generation) setLoading(false);
  };
  createEffect(on(() => [props.open, props.threadID, props.connectionOnly, props.installationOnly] as const, ([open]) => {
    generation++; setPage(props.installationOnly ? 'managed' : 'overview'); setInventory(undefined); setEnvironment(undefined); setAccess(undefined);
    setProfiles([]); setError(''); setSaved(false); setDraft(''); setQuery(''); setTargetFilter('all'); setOrigin(''); setProfileName(''); setEndpoint(''); setBusy(false);
    setInventoryFailed(false); setEnvironmentFailed(false);
    if (open && !props.connectionOnly) void load(); else setLoading(false);
  }));
  const openAccess = () => {
    go('access'); setAccess(undefined);
    void run(async epoch => {
      const value = await management()!.loadAccess(props.threadID);
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
  const saveAccess = (value: FlowerComputerAccess) => run(async epoch => {
    await management()!.saveAccess(props.threadID, value);
    if (epoch === generation) { setAccess(value); setSaved(true); }
  }, props.copy.accessSettingsFailed);
  const select = async () => {
    const candidate = selected();
    if (!candidate || !canSelect(candidate)) return;
    await run(async epoch => {
      try {
        const target = await management()!.selectCandidate(props.threadID, candidate.candidate_ref);
        if (epoch !== generation) return;
        setInventory(value => ({ ...value!, current_target_id: target.id, candidates: [...(value?.candidates ?? []).filter(item => item.candidate_ref !== candidate.candidate_ref), { ...candidate, target_id: target.id, new_tab: false, state: target.state ?? 'ready' }] }));
        go('overview'); await refreshInventory(epoch);
      } catch (failure) {
        if (epoch !== generation) return;
        const code = (failure as { code?: string })?.code;
        const messages: Record<string, string> = { target_in_use: props.copy.inUse, target_selection_stale: props.copy.selectionStale,
          target_not_allowed: props.copy.permissionRequired, target_permission_required: props.copy.permissionRequired,
          target_setup_required: props.copy.setupRequired, target_connection_required: props.copy.disconnected,
          interaction_takeover_required: props.copy.waitingControl };
        setError(code ? messages[code] ?? props.copy.selectionFailed : props.copy.selectionFailed);
      }
    }, props.copy.selectionFailed);
  };
  const addOrigin = () => {
    try {
      const url = new URL(origin().trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid origin');
      setAccess(value => ({ ...value!, origins: [...new Set([...value!.origins, url.origin])] })); setOrigin(''); setError(''); setSaved(false);
    } catch { setError(props.copy.invalidOrigin); }
  };
  const diagnose = (kind: 'managed' | 'desktop') => { setDiagnostic(kind); go('diagnostics'); };
  const capability = () => environment()?.[diagnostic()];
  const capabilityHint = (kind: 'managed' | 'desktop') => {
    const state = environment()?.[kind].state;
    if (!state) return props.copy.loadFailed;
    if (state === 'disabled') return props.copy.browserDisabledHint;
    if (state === 'permission_required') return props.copy.desktopPermissionHint;
    if (state === 'setup_required') return kind === 'managed' ? props.copy.managedMissingHint : props.copy.desktopMissingHint;
    return kind === 'managed' ? props.copy.managedHint : props.copy.desktopHint;
  };
  const title = createMemo(() => props.connectionOnly ? props.copy.connectionTitle : ({ overview: props.copy.title, targets: props.copy.switchTarget,
    managed: props.copy.managed, chrome: props.copy.chromeTitle, setup: props.copy.connectionTitle, access: props.copy.permissions,
    advanced: props.copy.advanced, help: props.copy.help, diagnostics: props.copy.diagnostics }[page()]));
  const openPicker = () => { go('targets'); void load(); };
  const capabilityTone = (state?: string) => state === 'ready' ? 'positive' : state === 'permission_required' || state === 'setup_required' ? 'attention' : 'neutral';
  const missingTarget = () => !loading() && !inventoryFailed() && !!inventory()?.current_target_id && !current();
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}
    title={<span class="flower-computer-title"><MonitorPointer aria-hidden="true" />{title()}</span>}
    closeLabel={props.copy.close} class={props.connectionOnly ? 'flower-computer-dialog w-[min(30rem,94vw)] max-w-[30rem]' : `flower-computer-dialog w-[min(48rem,94vw)] max-w-[48rem]${page() === 'targets' ? ' flower-computer-picker-dialog' : ''}`}
    contentClass={`flower-computer-content${page() === 'targets' ? ' flower-computer-picker-content' : ''}`}
    footer={props.connectionOnly ? undefined : <Show when={page() === 'targets'} fallback={<div class="flower-computer-footer">
      <Show when={page() === 'overview'} fallback={<Button variant="outline" disabled={busy()} onClick={() => go('overview')}><ChevronLeft class="size-3.5" />{props.copy.back}</Button>}>
        <Show when={props.threadID}><Button variant="outline" disabled={!readable()} onClick={openAccess}><Shield class="size-3.5" />{props.permissionLabel || (props.fullAccess ? props.copy.fullAccessTitle : props.copy.permissions)}<ChevronRight class="size-3.5" /></Button></Show>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={page() === 'access' && !props.fullAccess}><Button size="sm" disabled={!mutable() || !access()} onClick={() => { const value = access(); if (value) void saveAccess(value); }}>{props.copy.save}</Button></Show>
        <Button variant="outline" onClick={() => props.onOpenChange(false)}>{props.copy.close}</Button>
      </div>
    </div>}><div class="flower-computer-footer flower-computer-picker-footer">
      <Button variant="outline" disabled={busy()} onClick={() => go('overview')}>{props.copy.cancel}</Button>
      <span class="flower-computer-picker-selection" title={selected() ? targetLabel(selected()!) : undefined}>{selected() ? pickerLabel(selected()!) : props.copy.scope}</span>
      <Button variant="primary" disabled={!mutable() || !selected() || !canSelect(selected()!)} onClick={() => void select()}>{props.copy.confirmTarget}</Button>
    </div></Show>}>
    <Show when={!props.connectionOnly} fallback={<Show when={management()?.loadExtensionStatus && management()?.setupExtension && management()?.openExtension && props.adapter.canMutate !== false} fallback={<p role="alert">{props.copy.setupRequired}</p>}>
      <Show when={guideKey()} keyed>{_key => <FlowerChromeConnection environmentName={environment()?.hostname || props.adapter.runtime.display_name} reuseConnected management={management()!} copy={props.copy} onConnected={async () => { await props.onContinue?.(); }} />}</Show>
    </Show>}>
      <div class={`flower-computer-panel text-sm${page() === 'targets' ? ' flower-computer-picker' : ' space-y-5'}`} data-flower-computer-panel={page()} aria-busy={loading() || busy()}>
        <div class="flower-computer-environment"><span>{props.copy.environmentTitle}</span><span class="flower-computer-host"><MonitorPointer aria-hidden="true" />{environment()?.hostname || props.adapter.runtime.display_name}</span><Show when={environment()?.platform}><span class="flower-computer-platform">{environment()!.platform === 'darwin' ? 'macOS' : environment()!.platform === 'linux' ? 'Linux' : environment()!.platform}</span></Show></div>
        <Show when={page() === 'overview'}>
          <Show when={props.threadID} fallback={<p class="text-xs text-muted-foreground">{props.copy.noThread}</p>}>
            <section class="flower-computer-selection">
              <div class="flower-computer-section-heading"><h3>{props.copy.target}</h3><span class="flower-computer-scope">{props.copy.scope}</span></div>
              <div class="flower-computer-selection-body">
                <span class="flower-computer-selection-icon" aria-hidden="true"><Show when={missingTarget()} fallback={<MonitorPointer />}><Info /></Show></span>
                <div role="status" aria-live="polite"><p class="flower-computer-selection-name">{loading() && !inventory() ? props.copy.checking : currentLabel()}</p><p class="flower-computer-description">{currentHint()}</p></div>
                <div class="flower-computer-selection-actions"><Button onClick={() => props.onOpenChange(false)}>{props.copy.backToChat}<ChevronRight class="size-3.5" /></Button>
                  <Button variant="outline" disabled={!mutable() || !inventory() || inventoryFailed()} onClick={openPicker}><ArrowRightLeft class="size-3.5" />{props.copy.switchTarget}</Button>
                  <Show when={inventoryFailed()}><Button variant="outline" disabled={loading()} onClick={() => void load()}>{props.copy.refresh}</Button></Show>
                </div>
              </div>
            </section>
          </Show>
          <section class="flower-computer-capabilities" aria-label={props.copy.environmentCapabilities}>
            <h3 class="flower-computer-section-label">{props.copy.environmentCapabilities}</h3>
            <div class="flower-computer-capability-grid">
              <section class="flower-computer-capability">
                <span class="flower-computer-capability-icon" data-kind="managed" aria-hidden="true"><Sparkles /></span>
                <h4>{props.copy.managed}</h4>
                <span class="flower-computer-status" data-tone={capabilityTone(environment()?.managed.state)}>{stateLabel(environment()?.managed.state)}</span>
                <p class="flower-computer-description">{capabilityHint('managed')}</p>
                <Button variant="outline" disabled={!readable()} onClick={() => go('managed')}>{props.copy.browserSettings}<ChevronRight class="size-3.5" /></Button>
              </section>
              <section class="flower-computer-capability">
                <span class="flower-computer-capability-icon" aria-hidden="true"><Globe /></span>
                <h4>{props.copy.chromeTitle}</h4>
                <span class="flower-computer-status" data-tone={environment()?.chrome.profiles.length ? 'positive' : 'neutral'}>{!environment() ? props.copy.unknown : environment()!.chrome.profiles.length ? props.copy.connected : props.copy.chromeOffline}</span>
                <p class="flower-computer-description">{environment()?.chrome.profiles.length ? props.copy.chromeOnlineHint : props.copy.chromeOfflineHint}</p>
                <Button variant="outline" disabled={!readable()} onClick={() => go('chrome')}>{props.copy.manage}<ChevronRight class="size-3.5" /></Button>
              </section>
              <section class="flower-computer-capability">
                <span class="flower-computer-capability-icon" aria-hidden="true"><MonitorPointer /></span>
                <h4>{props.copy.desktopTitle}</h4>
                <span class="flower-computer-status" data-tone={capabilityTone(environment()?.desktop.state)}>{stateLabel(environment()?.desktop.state)}</span>
                <p class="flower-computer-description">{capabilityHint('desktop')}</p>
                <Button variant="outline" onClick={() => diagnose('desktop')}>{props.copy.details}<ChevronRight class="size-3.5" /></Button>
              </section>
            </div>
          </section>
          <div class="flower-computer-utilities"><Button variant="outline" onClick={() => go('help')}><Info class="size-3.5" />{props.copy.help}<ChevronRight class="size-3.5" /></Button><Button variant="outline" disabled={!mutable() || !props.threadID || !management()?.discoverBrowser} onClick={() => go('advanced')}><Code class="size-3.5" />{props.copy.advanced}<ChevronRight class="size-3.5" /></Button></div>
        </Show>
        <Show when={page() === 'targets'}>
          <div class="flower-computer-picker-toolbar">
            <div class="flower-computer-picker-search-row">
              <label class="flower-computer-picker-search" data-floe-input-surface><Search aria-hidden="true" /><input type="search" aria-label={props.copy.searchTargets} placeholder={props.copy.searchTargets} value={query()} onInput={event => setQuery(event.currentTarget.value)} /></label>
              <Button variant="outline" disabled={!readable()} title={props.copy.refresh} aria-label={props.copy.refresh} onClick={() => { setDraft(''); void load(); }}><Refresh aria-hidden="true" /><span>{props.copy.refresh}</span></Button>
            </div>
            <div class="flower-computer-picker-filters" role="group" aria-label={props.copy.target}>
              <For each={['all', 'browser', 'app'] as const}>{filter => <Button variant="ghost" aria-pressed={targetFilter() === filter} onClick={() => setTargetFilter(filter)}><span>{filter === 'all' ? props.copy.allTargets : filter === 'browser' ? props.copy.targetPages : props.copy.targetApps}</span><span class="flower-computer-picker-count">{targetCount(filter)}</span></Button>}</For>
            </div>
          </div>
          <div ref={targetList} class="flower-computer-picker-list" role="radiogroup" aria-label={props.copy.switchTarget}>
            <For each={[true, false]}>{browser => <Show when={filteredTargets(browser).length}><section class="flower-computer-picker-group"><Show when={targetFilter() === 'all'}><h3>{browser ? props.copy.browserPages : props.copy.applicationWindows}</h3></Show>
              <For each={filteredTargets(browser)}>{target => <label class="flower-computer-target" title={[targetLabel(target), target.profile_name, target.url].filter(Boolean).join('\n')}>
                <span class="flower-computer-target-icon" aria-hidden="true"><Show when={target.new_tab} fallback={<Show when={browser} fallback={<MonitorPointer />}><Globe /></Show>}><Plus /></Show></span>
                <span class="flower-computer-target-text"><span class="flower-computer-target-name">{pickerLabel(target)}</span><Show when={candidateState(target) !== 'ready' || pickerDetail(target) !== pickerLabel(target)}><span class="flower-computer-target-detail" data-unavailable={candidateState(target) !== 'ready'}>{candidateState(target) !== 'ready' ? stateLabel(candidateState(target)) : pickerDetail(target)}</span></Show></span>
                <Show when={target.target_id && target.target_id === inventory()?.current_target_id}><span class="flower-computer-target-current">{props.copy.currentTarget}</span></Show>
                <input type="radio" name="flower-computer-target" value={target.candidate_ref} checked={draft() === target.candidate_ref} disabled={!mutable() || !canSelect(target)} onChange={() => setDraft(target.candidate_ref)} />
              </label>}</For>
            </section></Show>}</For>
            <Show when={!filteredTargets(true).length && !filteredTargets(false).length}><p class="flower-computer-picker-empty">{loading() ? props.copy.checking : targets().length ? props.copy.noMatchingTargets : props.copy.noTargets}</p></Show>
          </div>
          <Show when={inventoryFailed()}><p role="alert" class="text-xs text-destructive">{props.copy.loadFailed}</p></Show>
          <p class="flower-computer-picker-hint">{props.copy.selectionScope}</p>
        </Show>
        <Show when={page() === 'managed'}>
          <Show when={management()?.loadBrowserInstallation}><FlowerManagedBrowser management={management()!} copy={props.copy} canMutate={props.adapter.canMutate !== false} onChange={() => void load()} onContinue={props.installationOnly ? props.onContinue : undefined} /></Show>
          <p class="flower-computer-description">{props.copy.managedModeValue}</p>
          <Show when={!props.installationOnly}><details class="flower-computer-detail-card" onToggle={event => { if (event.currentTarget.open) loadProfiles(); }}><summary class="cursor-pointer text-xs font-medium">{props.copy.createProfileHint}</summary>
            <p class="mt-3 flower-computer-description">{props.copy.profileHint} {props.copy.profileIsolationHint}</p>
            <div class="mt-3 flower-computer-profile-list"><For each={profiles()}>{profile => <div class="flower-computer-profile"><Globe aria-hidden="true" /><span>{profile.id === 'browser-main' ? props.copy.profileDefault : profile.name}</span></div>}</For></div>
            <form class="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(async epoch => {
            const value = await management()!.createManagedProfile!(profileName().trim());
            if (epoch === generation) { setProfiles(value); setProfileName(''); }
          }, props.copy.profileFailed); }}><label class="min-w-0 flex-1 space-y-1 text-xs">{props.copy.profileName}<input class="flower-settings-text-input w-full" value={profileName()} maxlength={120} required onInput={event => setProfileName(event.currentTarget.value)} /></label><Button size="sm" type="submit" disabled={!mutable() || !profileName().trim() || !management()?.createManagedProfile}>{props.copy.createProfile}</Button></form></details></Show>
        </Show>
        <Show when={page() === 'chrome'}>
          <p class="text-muted-foreground">{props.copy.chromeOnlineHint}</p>
          <div class="flower-computer-detail-card space-y-3"><span class="flower-computer-status" data-tone={environment()?.chrome.profiles.length ? 'positive' : 'neutral'}>{!environment() ? props.copy.unknown : environment()!.chrome.profiles.length ? props.copy.connected : props.copy.chromeOffline}</span><For each={environment()?.chrome.profiles ?? []}>{profile => <div class="flower-computer-profile"><Globe aria-hidden="true" /><span>{profile.name}</span></div>}</For><Show when={!environment()?.chrome.profiles.length}><p class="flower-computer-description">{environment() ? props.copy.chromeOfflineHint : props.copy.loadFailed}</p></Show></div>
          <div class="flower-computer-note"><Info aria-hidden="true" /><div><p class="flower-computer-description">{props.copy.pairingPersistence}</p><p class="mt-2 flower-computer-description">{props.copy.setupHostHint}</p></div></div>
          <div class="flower-computer-action-row"><Button disabled={!mutable() || !management()?.setupExtension || !management()?.openExtension || !management()?.loadExtensionStatus} onClick={() => go('setup')}>{props.copy.setupChrome}</Button>
          <Button variant="outline" disabled={!readable()} onClick={() => void load()}>{props.copy.refresh}</Button></div>
        </Show>
        <Show when={page() === 'setup' && guideKey()} keyed>{_key => <FlowerChromeConnection environmentName={environment()?.hostname || props.adapter.runtime.display_name} management={management()!} copy={props.copy} onConnected={async () => { const epoch = generation; await refreshEnvironment(epoch); if (epoch === generation) go('chrome'); }} />}</Show>
        <Show when={page() === 'diagnostics'}>
          <div class="flower-computer-detail-card space-y-3"><div class="flower-computer-section-heading"><h3 class="font-medium text-foreground">{diagnostic() === 'managed' ? props.copy.managed : props.copy.desktopTitle}</h3><span class="flower-computer-status" data-tone={capabilityTone(capability()?.state)}>{stateLabel(capability()?.state)}</span></div><p class="leading-relaxed text-muted-foreground">{capabilityHint(diagnostic())}</p>
          <Show when={!capability() || capability()?.state === 'setup_required'}><p class="text-xs leading-relaxed text-muted-foreground">{environmentFailed() ? props.copy.loadFailed : props.copy.repairHint}</p></Show>
          </div><div class="flower-computer-note"><Shield aria-hidden="true" /><p class="flower-computer-description">{props.copy.permissionBoundary}</p></div>
          <Show when={capability()?.reason}><details><summary class="cursor-pointer text-xs">{props.copy.diagnostics}</summary><code class="mt-2 block break-all text-xs">{capability()!.reason}</code></details></Show>
          <Button size="sm" disabled={!readable()} onClick={() => void load()}>{props.copy.refresh}</Button>
        </Show>
        <Show when={page() === 'help'}><div class="flower-computer-help-grid text-xs leading-relaxed text-muted-foreground"><section class="flower-computer-detail-card"><Globe class="mb-3 size-5" /><h3 class="mb-2 font-medium text-foreground">{props.copy.chromeTitle}</h3><p>{props.copy.pairingPersistence}</p></section><section class="flower-computer-detail-card"><Sparkles class="mb-3 size-5" /><h3 class="mb-2 font-medium text-foreground">{props.copy.managed}</h3><p>{props.copy.profileHint}</p></section><section class="flower-computer-detail-card"><MonitorPointer class="mb-3 size-5" /><h3 class="mb-2 font-medium text-foreground">{props.copy.target}</h3><p>{props.copy.selectionPersistence}</p></section><section class="flower-computer-detail-card"><Shield class="mb-3 size-5" /><h3 class="mb-2 font-medium text-foreground">{props.copy.permissions}</h3><p>{props.copy.permissionBoundary}</p></section></div></Show>
        <Show when={page() === 'advanced'}>
          <div class="flower-computer-note"><Code aria-hidden="true" /><p class="flower-computer-description">{props.copy.advancedHint}</p></div>
          <form class="flower-computer-detail-card space-y-3" onSubmit={event => { event.preventDefault(); void run(async epoch => {
            const result = await management()!.discoverBrowser!(props.threadID, endpoint().trim());
            if (epoch === generation) { setInventory(result); setInventoryFailed(false); go('targets'); }
          }, props.copy.endpointFailed); }}><label class="block space-y-1 text-xs">{props.copy.endpoint}<input type="url" required class="flower-settings-text-input w-full" value={endpoint()} onInput={event => setEndpoint(event.currentTarget.value)} placeholder="http://127.0.0.1:9222" /></label><Button size="sm" type="submit" disabled={!mutable() || !endpoint().trim()}>{props.copy.listTabs}</Button></form>
        </Show>
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
