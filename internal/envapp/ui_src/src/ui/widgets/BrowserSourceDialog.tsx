import '../../styles/browserSources.css';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Button, Dialog, Select } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, Globe, Plus, Refresh, Settings } from '@floegence/floe-webapp-core/icons';
import { FlowerChromeConnection } from '../../../../../flower_ui/src/FlowerChromeConnection';
import { FlowerManagedBrowser } from '../../../../../flower_ui/src/FlowerManagedBrowser';
import type { FlowerChromeStatus } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceService, BrowserSourceSelection, BrowserSourcePreference, BrowserSourceTab as Tab } from '../services/browserSourceContract';
export type { BrowserSourceSelection } from '../services/browserSourceContract';
import { ActivityBarBrowserIcon } from '../icons/ActivityBarDockIcons';
import { browserFailureCode } from '../services/browserFailure';
import { browserFailureMessage } from './BrowserWorkspaceNotice';
import type { BrowserWorkspaceRequest } from '../services/browserWindowProtocol';


/** Selection drafts never change the active source or Flower's target. */
export function BrowserSourceDialog(props: {
  service: BrowserSourceService;
  messages: BrowserSourceMessages;
  current?: BrowserSourceSelection;
  onClose(): void;
  onSelect(selection: BrowserSourceSelection, signal: AbortSignal): void | Promise<void>;
}) {
  const management = props.service.management;
  const copy = () => props.messages.computer;
  const [page, setPage] = createSignal<'sources' | 'personal' | 'managed' | 'advanced' | 'installation' | 'chrome'>('sources');
  const [profiles, setProfiles] = createSignal<Array<{ id: string; name: string }>>([]);
  const [chrome, setChrome] = createSignal<FlowerChromeStatus>();
  const [preference, setPreference] = createSignal<BrowserSourcePreference['preference']>(null);
  const preferredInstallation = () => chrome()?.installations.find(item => item.id === preference()?.installation_id && item.installed)
    ?? chrome()?.installations.find(item => item.connected) ?? chrome()?.installations.find(item => item.installed);
  const [chromeProfile, setChromeProfile] = createSignal('');
  const [chromeTabs, setChromeTabs] = createSignal<Tab[]>([]);
  const [cdpTabs, setCDPTabs] = createSignal<Tab[]>([]);
  const [endpoint, setEndpoint] = createSignal('');
  const [discoveredEndpoint, setDiscoveredEndpoint] = createSignal('');
  const [profileName, setProfileName] = createSignal('');
  const [creatingProfile, setCreatingProfile] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [draft, setDraft] = createSignal(props.current);
  const [busy, setBusy] = createSignal(false);
  const [readingTabs, setReadingTabs] = createSignal(false);
  const [error, setError] = createSignal('');
  const [profileError, setProfileError] = createSignal(false);
  const [chromeError, setChromeError] = createSignal(false);
  const [continueAfterInstall, setContinueAfterInstall] = createSignal(false);
  const lifetime = new AbortController();
  let tabRead: AbortController | undefined;
  let selectionAttempt: AbortController | undefined;
  onCleanup(() => { lifetime.abort(); tabRead?.abort(); selectionAttempt?.abort(); });
  const profileLabel = (profile: { id: string; name: string }) => profile.id === 'browser-main' ? props.messages.product.defaultProfile : profile.name;
  const selected = (request: BrowserWorkspaceRequest) => JSON.stringify(draft()?.request) === JSON.stringify(request);
  const matches = (tab: Tab) => `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(search().trim().toLocaleLowerCase());
  const readTabs = async (profile: string) => {
    tabRead?.abort(); const read = new AbortController(); tabRead = read;
    setChromeProfile(profile); setChromeTabs([]); setReadingTabs(Boolean(profile));
    if (!profile) return;
    try {
      const tabs = await props.service.tabs(profile, AbortSignal.any([lifetime.signal, read.signal]));
      if (!read.signal.aborted && !lifetime.signal.aborted) setChromeTabs(tabs);
    } catch { if (!read.signal.aborted && !lifetime.signal.aborted) setError(copy().loadFailed); }
    finally { if (!read.signal.aborted && !lifetime.signal.aborted) setReadingTabs(false); }
  };
  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const [available, status, saved] = await Promise.allSettled([props.service.profiles(lifetime.signal), props.service.status(lifetime.signal), props.service.preference(lifetime.signal)]);
      if (lifetime.signal.aborted) return;
      setProfileError(available.status === 'rejected'); setChromeError(status.status === 'rejected');
      if (available.status === 'fulfilled') setProfiles(available.value);
      if (saved.status === 'fulfilled') setPreference(saved.value.preference);
      if (status.status === 'fulfilled') {
        setChrome(status.value);
        const chosen = status.value.profiles.find(profile => profile.id === chromeProfile())?.id
          ?? status.value.profiles.find(profile => profile.library_id === preference()?.profile_id)?.id ?? status.value.profiles[0]?.id ?? '';
        await readTabs(chosen);
      }
    } catch { if (!lifetime.signal.aborted) setError(copy().loadFailed); }
    finally { if (!lifetime.signal.aborted) setBusy(false); }
  };
  const createProfile = async () => {
    if (!profileName().trim() || busy()) return;
    setBusy(true); setError('');
    try {
      const available = await props.service.createProfile(profileName().trim(), lifetime.signal);
      if (lifetime.signal.aborted) return;
      const created = available.find(item => !profiles().some(previous => previous.id === item.id));
      setProfiles(available); setProfileName(''); setCreatingProfile(false);
      if (created) setDraft({ request: { managed_profile_id: created.id }, label: created.name });
    } catch { if (!lifetime.signal.aborted) setError(copy().profileFailed); }
    finally { if (!lifetime.signal.aborted) setBusy(false); }
  };
  const discover = async () => {
    if (!endpoint().trim() || busy()) return;
    setBusy(true); setError(''); setCDPTabs([]);
    const address = endpoint().trim();
    try {
      const tabs = await props.service.discover(address, lifetime.signal);
      if (!lifetime.signal.aborted) { setCDPTabs(tabs); setDiscoveredEndpoint(address); }
    } catch { if (!lifetime.signal.aborted) setError(copy().endpointFailed); }
    finally { if (!lifetime.signal.aborted) setBusy(false); }
  };
  const select = async () => {
    const selection = draft();
    if (busy() || !selection) return;
    const attempt = new AbortController(); selectionAttempt = attempt;
    const signal = AbortSignal.any([lifetime.signal, attempt.signal]);
    setBusy(true); setError('');
    try {
      if ('managed_profile_id' in selection.request) {
        const installation = await management.loadBrowserInstallation!();
        if (signal.aborted) return;
        if (!installation.enabled || installation.state !== 'installed' || installation.launch.state !== 'ready') { setContinueAfterInstall(true); setPage('installation'); return; }
      }
      await props.onSelect(selection, signal);
    } catch (error) { if (!signal.aborted) setError(browserFailureMessage(browserFailureCode(error), props.messages)); }
    finally { if (selectionAttempt === attempt) { selectionAttempt = undefined; if (!lifetime.signal.aborted) setBusy(false); } }
  };
  onMount(() => void refresh());
  const Option = (option: { request: BrowserWorkspaceRequest; label: string; detail: string }) => <label class="redeven-browser-source-option" classList={{ 'is-selected': selected(option.request) }}>
    <input type="radio" name="browser-source" checked={selected(option.request)} onChange={() => setDraft({ request: option.request, label: option.label })} />
    <span><strong>{option.label}</strong><small title={option.detail}>{option.detail}</small></span>
  </label>;
  const changePage = (next: ReturnType<typeof page>) => {
    if (selectionAttempt) { selectionAttempt.abort(); selectionAttempt = undefined; setBusy(false); }
    setError(''); setContinueAfterInstall(false); setPage(next);
  };
  const chooseManaged = () => {
    const current = draft();
    if (!current || !('managed_profile_id' in current.request)) {
      const profile = profiles().find(item => item.id === preference()?.profile_id) ?? profiles()[0];
      if (profile) setDraft({ request: { managed_profile_id: profile.id }, label: profileLabel(profile) });
    }
    changePage('managed');
  };
  const draftInStep = () => {
    const request = draft()?.request;
    if (!request) return false;
    if (page() === 'managed') return 'managed_profile_id' in request;
    if (!('connection' in request) || !request.connection) return false;
    if (page() === 'personal') return 'extension_profile_id' in request.connection && request.connection.extension_profile_id === chromeProfile();
    return page() === 'advanced' && 'cdp_url' in request.connection && request.connection.cdp_url === discoveredEndpoint();
  };
  const choosingPage = () => ['personal', 'managed', 'advanced'].includes(page());
  const title = () => ({ sources: props.messages.product.sources, personal: props.messages.product.chromeSource,
    managed: props.messages.product.managedSource, installation: props.messages.product.installTitle,
    chrome: copy().setupChrome, advanced: copy().advanced })[page()];
  const description = () => ({ sources: props.messages.product.sourceHint, personal: copy().chromeOnlineHint,
    managed: copy().profileHint, installation: undefined, chrome: undefined, advanced: copy().advancedHint })[page()];
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }} title={title()} closeLabel={copy().close}
    bodyDescription={description()} class="redeven-browser-sources-dialog" footer={<div class="flex w-full flex-wrap items-center justify-between gap-3">
      <Show when={page() === 'sources'} fallback={<Button variant="ghost" onClick={() => changePage(page() === 'installation' ? 'managed' : page() === 'chrome' ? 'personal' : 'sources')}>{copy().back}</Button>}>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void refresh()}><Refresh class="size-3.5" />{copy().refresh}</Button>
      </Show>
      <div class="flex items-center gap-2"><Button variant="outline" onClick={props.onClose}>{copy().cancel}</Button>
        <Show when={choosingPage()}><Button disabled={busy() || !draftInStep()} onClick={() => void select()}>{props.messages.product.openSelection}</Button></Show></div>
    </div>}>
    <Show when={error()}><p role="alert" class="mb-3 text-[length:var(--floe-type-body)] text-destructive">{error()}</p></Show>
    <Show when={page() === 'sources'}>
      <div class="redeven-browser-source-cards" aria-busy={busy()}>
        <button type="button" class="redeven-browser-source-card" aria-label={props.messages.product.chromeSource} disabled={busy()} onClick={() => changePage(chrome()?.profiles.length ? 'personal' : 'chrome')}>
          <span class="redeven-browser-source-card-icon"><Globe class="size-5" /></span>
          <span class="redeven-browser-source-card-content">
            <span class="redeven-browser-source-card-title">{props.messages.product.chromeSource}<span class="redeven-browser-source-badge">{preference()?.installation_id ? props.messages.product.previouslyUsed : props.messages.product.recommended}</span></span>
            <span class="redeven-browser-source-card-description">{copy().chromeOnlineHint}</span>
            <Show when={preferredInstallation()}><span class="redeven-browser-source-card-status"><span classList={{ 'is-connected': preferredInstallation()?.connected }} />{preferredInstallation()!.name}</span></Show>
            <Show when={chromeError()}><span class="text-xs text-destructive">{copy().loadFailed}</span></Show>
          </span><ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>
        <button type="button" class="redeven-browser-source-card" aria-label={props.messages.product.managedSource} disabled={busy()} onClick={chooseManaged}>
          <span class="redeven-browser-source-card-icon"><ActivityBarBrowserIcon class="size-5" /></span>
          <span class="redeven-browser-source-card-content">
            <span class="redeven-browser-source-card-title">{props.messages.product.managedSource}<Show when={preference() && !preference()?.installation_id}><span class="redeven-browser-source-badge">{props.messages.product.previouslyUsed}</span></Show></span>
            <span class="redeven-browser-source-card-description">{copy().profileHint}</span>
            <Show when={profileError()}><span class="text-xs text-destructive">{copy().loadFailed}</span></Show>
          </span><ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
      <div class="redeven-browser-source-advanced"><Button size="sm" variant="ghost" onClick={() => changePage('advanced')}>{copy().advanced}<ChevronRight class="size-3.5 shrink-0" /></Button></div>
    </Show>
    <Show when={page() === 'personal'}>
      <div class="redeven-browser-source-heading">
        <Select class="min-w-0 flex-1" value={chromeProfile()} onChange={value => { if (value) void readTabs(value); }} aria-label={props.messages.product.profile}
          options={(chrome()?.profiles ?? []).map(profile => ({ value: profile.id, label: profile.name }))} />
        <Button size="sm" variant="ghost" onClick={() => changePage('chrome')}><Plus class="size-3.5" />{copy().setupChrome}</Button>
        <Button size="sm" variant="ghost" aria-label={copy().refresh} disabled={busy()} onClick={() => void refresh()}><Refresh class="size-3.5" /></Button>
      </div>
      <Show when={chromeError()}><p role="alert" class="text-xs text-destructive">{copy().loadFailed}</p></Show>
      <Show when={chrome()?.profiles.length} fallback={<p class="py-4 text-[length:var(--floe-type-body)] text-muted-foreground">{copy().chromeOffline}</p>}>
        <input data-floe-control="input" class="redeven-browser-source-input" aria-label={props.messages.product.searchPages} placeholder={props.messages.product.searchPages} value={search()} onInput={event => setSearch(event.currentTarget.value)} />
        <div class="redeven-browser-source-list" aria-busy={readingTabs()}>
          <Option request={{ connection: { extension_profile_id: chromeProfile(), new_tab: true } }} label={copy().newTab} detail={chrome()?.profiles.find(profile => profile.id === chromeProfile())?.name ?? ''} />
          <For each={chromeTabs().filter(matches)}>{tab => <Option request={{ connection: { extension_profile_id: chromeProfile(), tab_id: tab.id, tab_url: tab.url, tab_title: tab.title } }} label={tab.title || tab.url} detail={tab.url} />}</For>
          <Show when={readingTabs()}><p role="status" class="p-3 text-[length:var(--floe-type-body)]">{copy().checking}</p></Show>
        </div>
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{props.messages.product.selectionHint}</p>
      </Show>
    </Show>
    <Show when={page() === 'managed'}>
      <Show when={profileError()}><p role="alert" class="text-xs text-destructive">{copy().loadFailed}</p></Show>
      <div class="redeven-browser-source-list"><For each={profiles()}>{profile => <Option request={{ managed_profile_id: profile.id }} label={profileLabel(profile)} detail={props.messages.product.managedSource} />}</For></div>
      <div class="redeven-browser-source-management">
        <Show when={!creatingProfile()} fallback={<div class="flex min-w-0 flex-1 items-center gap-2">
          <input data-floe-control="input" class="redeven-browser-source-input" aria-label={props.messages.product.profileName} placeholder={props.messages.product.profileName} maxLength={120} value={profileName()} onInput={event => setProfileName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void createProfile(); } }} />
          <Button class="shrink-0 whitespace-nowrap" type="button" variant="outline" size="sm" disabled={busy() || !profileName().trim()} onClick={() => void createProfile()}>{props.messages.product.createProfile}</Button>
        </div>}><Button size="sm" variant="ghost" onClick={() => setCreatingProfile(true)}><Plus class="size-3.5" />{props.messages.product.createProfile}</Button></Show>
        <Button size="sm" variant="ghost" onClick={() => changePage('installation')}><Settings class="size-3.5" />{copy().browserSettings}</Button>
      </div>
    </Show>
    <Show when={page() === 'advanced'}>
      <div class="flex items-center gap-2"><input data-floe-control="input" class="redeven-browser-source-input" aria-label={copy().endpoint} placeholder={copy().endpoint} value={endpoint()} onInput={event => setEndpoint(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void discover(); } }} />
        <Button class="shrink-0 whitespace-nowrap" type="button" size="sm" variant="outline" disabled={busy() || !endpoint().trim()} onClick={() => void discover()}>{copy().listTabs}</Button></div>
      <div class="redeven-browser-source-list"><For each={cdpTabs()}>{tab => <Option request={{ connection: { cdp_url: discoveredEndpoint(), profile_id: tab.profile_id, tab_id: tab.id, tab_title: tab.title, tab_url: tab.url } }} label={tab.title || tab.url} detail={tab.url} />}</For></div>
      <Show when={discoveredEndpoint() && !cdpTabs().length && !busy()}><p class="mt-3 text-[length:var(--floe-type-body)] text-muted-foreground">{props.messages.product.noPages}</p></Show>
    </Show>
    <Show when={page() === 'installation'}><FlowerManagedBrowser management={management} copy={copy()} canMutate onChange={() => void refresh()}
      requireEnabledForContinue continuationKey={JSON.stringify(draft()?.request)} installLabel={continueAfterInstall() ? props.messages.product.installOpen : undefined}
      onContinue={continueAfterInstall() ? async enabled => { if (enabled && !lifetime.signal.aborted) await select(); } : undefined} /></Show>
    <Show when={page() === 'chrome'}><FlowerChromeConnection management={management} copy={copy()} platform={chrome()?.platform} environmentName={chrome()?.hostname} preferredInstallationID={preferredInstallation()?.id} reuseConnected={false}
      onConnected={async () => { await refresh(); if (!lifetime.signal.aborted) changePage('personal'); }} /></Show>
  </Dialog>;
}
