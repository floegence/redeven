import '../../styles/browserSources.css';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Button, Dialog, Select } from '@floegence/floe-webapp-core/ui';
import { Globe, Plus, Refresh, Settings } from '@floegence/floe-webapp-core/icons';
import { FlowerChromeConnection } from '../../../../../flower_ui/src/FlowerChromeConnection';
import { FlowerManagedBrowser } from '../../../../../flower_ui/src/FlowerManagedBrowser';
import type { FlowerChromeStatus } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceService, BrowserSourceSelection, BrowserSourceTab as Tab } from '../services/browserSourceContract';
export type { BrowserSourceSelection } from '../services/browserSourceContract';
import { browserFailureCode } from '../services/browserFailure';
import { browserFailureMessage } from './BrowserWorkspaceNotice';
import type { BrowserWorkspaceRequest } from '../services/browserWindowProtocol';


/** Selection drafts never change the active source or Flower's target. */
export function BrowserSourceDialog(props: {
  service: BrowserSourceService;
  messages: BrowserSourceMessages;
  current: BrowserSourceSelection;
  onClose(): void;
  onSelect(selection: BrowserSourceSelection, signal: AbortSignal): void | Promise<void>;
}) {
  const management = props.service.management;
  const copy = () => props.messages.computer;
  const [page, setPage] = createSignal<'sources' | 'installation' | 'chrome'>('sources');
  const [profiles, setProfiles] = createSignal<Array<{ id: string; name: string }>>([]);
  const [chrome, setChrome] = createSignal<FlowerChromeStatus>();
  const [chromeProfile, setChromeProfile] = createSignal('');
  const [chromeTabs, setChromeTabs] = createSignal<Tab[]>([]);
  const [cdpTabs, setCDPTabs] = createSignal<Tab[]>([]);
  const [endpoint, setEndpoint] = createSignal('');
  const [discoveredEndpoint, setDiscoveredEndpoint] = createSignal('');
  const [profileName, setProfileName] = createSignal('');
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
  onCleanup(() => { lifetime.abort(); tabRead?.abort(); });
  const profileLabel = (profile: { id: string; name: string }) => profile.id === 'browser-main' ? props.messages.product.defaultProfile : profile.name;
  const selected = (request: BrowserWorkspaceRequest) => JSON.stringify(draft().request) === JSON.stringify(request);
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
      const [available, status] = await Promise.allSettled([props.service.profiles(lifetime.signal), props.service.status(lifetime.signal)]);
      if (lifetime.signal.aborted) return;
      setProfileError(available.status === 'rejected'); setChromeError(status.status === 'rejected');
      if (available.status === 'fulfilled') setProfiles(available.value);
      if (status.status === 'fulfilled') {
        setChrome(status.value);
        const chosen = status.value.profiles.find(profile => profile.id === chromeProfile())?.id ?? status.value.profiles[0]?.id ?? '';
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
      setProfiles(available); setProfileName('');
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
    if (busy()) return;
    setBusy(true); setError('');
    try {
      if ('managed_profile_id' in draft().request) {
        const installation = await management.loadBrowserInstallation!();
        if (lifetime.signal.aborted) return;
        if (!installation.enabled || installation.state !== 'installed') { setContinueAfterInstall(true); setPage('installation'); return; }
      }
      await props.onSelect(draft(), lifetime.signal);
    } catch (error) { if (!lifetime.signal.aborted) setError(browserFailureMessage(browserFailureCode(error), props.messages)); }
    finally { if (!lifetime.signal.aborted) setBusy(false); }
  };
  onMount(() => void refresh());
  const Option = (option: { request: BrowserWorkspaceRequest; label: string; detail: string }) => <label class="redeven-browser-source-option" classList={{ 'is-selected': selected(option.request) }}>
    <input type="radio" name="browser-source" checked={selected(option.request)} onChange={() => setDraft({ request: option.request, label: option.label })} />
    <span><strong>{option.label}</strong><small title={option.detail}>{option.detail}</small></span>
  </label>;
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }} title={props.messages.product.sources} closeLabel={copy().close}
    bodyDescription={props.messages.product.sourceHint} class="redeven-browser-sources-dialog" footer={<div class="flex w-full flex-wrap items-center justify-between gap-3">
      <Show when={page() === 'sources'} fallback={<Button variant="outline" onClick={() => { setContinueAfterInstall(false); setPage('sources'); }}>{copy().back}</Button>}>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void refresh()}><Refresh class="size-3.5" />{copy().refresh}</Button>
      </Show>
      <div class="flex items-center gap-2"><Button variant="outline" onClick={props.onClose}>{copy().cancel}</Button>
        <Show when={page() === 'sources'}><Button disabled={busy()} onClick={() => void select()}>{props.messages.product.openSelection}</Button></Show></div>
    </div>}>
    <Show when={error()}><p role="alert" class="mb-3 text-sm text-destructive">{error()}</p></Show>
    <Show when={page() === 'sources'}>
      <div class="redeven-browser-source-sections" aria-busy={busy()}>
        <section><div class="redeven-browser-source-heading"><h3>{props.messages.product.managedSource}</h3><Button size="sm" variant="ghost" onClick={() => setPage('installation')}><Settings class="size-3.5" />{copy().browserSettings}</Button></div>
          <p class="text-xs text-muted-foreground">{copy().profileHint}</p>
          <Show when={profileError()}><p role="alert" class="text-xs text-destructive">{copy().loadFailed}</p></Show>
          <div class="redeven-browser-source-list"><For each={profiles()}>{profile => <Option request={{ managed_profile_id: profile.id }} label={profileLabel(profile)} detail={props.messages.product.managedSource} />}</For></div>
          <div class="mt-3 flex items-center gap-2">
            <input class="redeven-browser-source-input" aria-label={props.messages.product.profileName} placeholder={props.messages.product.profileName} maxLength={120} value={profileName()} onInput={event => setProfileName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void createProfile(); } }} />
            <Button class="shrink-0 whitespace-nowrap" type="button" variant="outline" size="sm" disabled={busy() || !profileName().trim()} onClick={() => void createProfile()}><Plus class="size-3.5" />{props.messages.product.createProfile}</Button>
          </div>
        </section>
        <section><div class="redeven-browser-source-heading"><h3>{props.messages.product.chromeSource}</h3><Button size="sm" variant="ghost" onClick={() => setPage('chrome')}><Globe class="size-3.5" />{copy().setupChrome}</Button></div>
          <p class="text-xs text-muted-foreground">{copy().chromeOnlineHint}</p>
          <Show when={chromeError()}><p role="alert" class="text-xs text-destructive">{copy().loadFailed}</p></Show>
          <Show when={chrome()?.profiles.length} fallback={<p class="py-4 text-sm text-muted-foreground">{copy().chromeOffline}</p>}>
            <Select class="my-3 w-full" value={chromeProfile()} onChange={value => { if (value) void readTabs(value); }} aria-label={props.messages.product.profile}
              options={(chrome()?.profiles ?? []).map(profile => ({ value: profile.id, label: profile.name }))} />
            <input class="redeven-browser-source-input" aria-label={props.messages.product.searchPages} placeholder={props.messages.product.searchPages} value={search()} onInput={event => setSearch(event.currentTarget.value)} />
            <div class="redeven-browser-source-list" aria-busy={readingTabs()}>
              <Option request={{ connection: { extension_profile_id: chromeProfile(), new_tab: true } }} label={copy().newTab} detail={chrome()?.profiles.find(profile => profile.id === chromeProfile())?.name ?? ''} />
              <For each={chromeTabs().filter(matches)}>{tab => <Option request={{ connection: { extension_profile_id: chromeProfile(), tab_id: tab.id, tab_url: tab.url, tab_title: tab.title } }} label={tab.title || tab.url} detail={tab.url} />}</For>
              <Show when={readingTabs()}><p role="status" class="p-3 text-sm">{copy().checking}</p></Show>
            </div>
          </Show>
        </section>
        <details><summary class="cursor-pointer text-sm font-medium">{copy().advanced}</summary><p class="my-3 text-xs leading-relaxed text-muted-foreground">{copy().advancedHint}</p>
          <div class="flex items-center gap-2"><input class="redeven-browser-source-input" aria-label={copy().endpoint} placeholder={copy().endpoint} value={endpoint()} onInput={event => setEndpoint(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void discover(); } }} />
            <Button class="shrink-0 whitespace-nowrap" type="button" size="sm" variant="outline" disabled={busy() || !endpoint().trim()} onClick={() => void discover()}>{copy().listTabs}</Button></div>
          <div class="redeven-browser-source-list"><For each={cdpTabs()}>{tab => <Option request={{ connection: { cdp_url: discoveredEndpoint(), profile_id: tab.profile_id, tab_id: tab.id, tab_title: tab.title, tab_url: tab.url } }} label={tab.title || tab.url} detail={tab.url} />}</For></div>
          <Show when={discoveredEndpoint() && !cdpTabs().length && !busy()}><p class="mt-3 text-sm text-muted-foreground">{props.messages.product.noPages}</p></Show>
        </details>
        <p class="text-xs leading-relaxed text-muted-foreground">{props.messages.product.selectionHint}</p>
      </div>
    </Show>
    <Show when={page() === 'installation'}><FlowerManagedBrowser management={management} copy={copy()} canMutate onChange={() => void refresh()}
      requireEnabledForContinue continuationKey={JSON.stringify(draft().request)} installLabel={continueAfterInstall() ? props.messages.product.installOpen : undefined}
      onContinue={continueAfterInstall() ? async enabled => { if (enabled && !lifetime.signal.aborted) await props.onSelect(draft(), lifetime.signal); } : undefined} /></Show>
    <Show when={page() === 'chrome'}><FlowerChromeConnection management={management} copy={copy()} platform={chrome()?.platform} environmentName={chrome()?.hostname} reuseConnected={false}
      onConnected={async () => { await refresh(); if (!lifetime.signal.aborted) setPage('sources'); }} /></Show>
  </Dialog>;
}
