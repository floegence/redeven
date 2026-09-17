import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerBrowserTab, FlowerComputerExtensionSetup, FlowerComputerManagement, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';

export function FlowerProfileConnection(props: { managed?: boolean; management: FlowerComputerManagement; connect: NonNullable<FlowerSurfaceAdapter['connectComputerBrowser']>; copy: FlowerComputerCopy; onConnected: () => void }) {
  const [setup, setSetup] = createSignal<FlowerComputerExtensionSetup>();
  const [profiles, setProfiles] = createSignal<readonly { id: string; name: string }[]>([]);
  const [profile, setProfile] = createSignal('');
  const [profileName, setProfileName] = createSignal('');
  const [tabs, setTabs] = createSignal<readonly FlowerBrowserTab[]>([]);
  const [tab, setTab] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let generation = 0;
  onCleanup(() => { generation++; });
  const action = async (run: () => Promise<void>) => {
    if (busy()) return;
    const current = generation;
    setBusy(true); setFailed(false);
    try { await run(); } catch { if (current === generation) setFailed(true); }
    finally { if (current === generation) setBusy(false); }
  };
  const refresh = async () => {
    const current = generation;
    const result = await (props.managed ? props.management.listManagedProfiles!() : props.management.listExtensionProfiles!());
    if (current !== generation) return;
    setProfiles(result); setProfile(''); setTabs([]); setTab('');
  };
  const selectProfile = async (id: string) => {
    const current = generation; setProfile(id); setTabs([]); setTab('');
    if (!id) return;
    const result = await (props.managed ? props.management.listManagedTabs!(id) : props.management.listExtensionTabs!(id));
    if (current === generation) setTabs(result);
  };
  onMount(() => { void action(refresh); });
  const connect = async (newTab: boolean) => {
    const current = generation;
    const selected = tabs().find(value => value.id === tab());
    if (!newTab && !selected) throw new Error('select a tab');
    const result = await props.connect({ ...(props.managed ? { managed_profile_id: profile() } : { extension_profile_id: profile() }),
      ...(newTab ? { new_tab: true } : { tab_id: selected!.id, ...(!props.managed ? { tab_title: selected!.title, tab_url: selected!.url } : {}) }) });
    if (!result.ready) throw new Error('unavailable');
    if (current === generation) props.onConnected();
  };
  return <section class="space-y-3 rounded-md border border-border p-3">
    <div class="flex items-center justify-between gap-2"><span class="font-medium">{props.managed ? props.copy.managed : props.copy.extension}</span><Button size="sm" variant="ghost" disabled={busy()} onClick={() => void action(refresh)}>{props.copy.refresh}</Button></div>
    <Show when={profiles().length > 0}>
      <label class="block space-y-1 text-xs">{props.copy.profile}<select class="flower-settings-text-input w-full cursor-pointer disabled:cursor-not-allowed" disabled={busy()} value={profile()} onChange={event => { const id = event.currentTarget.value; void action(() => selectProfile(id)); }}>
        <option value="" selected={!profile()}>{props.copy.chooseProfile}</option><For each={profiles()}>{value => <option value={value.id} selected={value.id === profile()}>{value.name}</option>}</For>
      </select></label>
      <Show when={profile()}><div class="flex flex-wrap gap-2"><Button size="sm" disabled={busy()} onClick={() => void action(() => connect(true))}>{props.copy.newTab}</Button></div>
        <label class="block space-y-1 text-xs">{props.copy.tab}<select class="flower-settings-text-input w-full cursor-pointer disabled:cursor-not-allowed" value={tab()} disabled={busy()} onChange={event => setTab(event.currentTarget.value)}>
          <option value="" selected={!tab()}>{props.copy.chooseTab}</option><For each={tabs()}>{value => <option value={value.id} selected={value.id === tab()}>{value.title || value.url}</option>}</For>
        </select></label><Button size="sm" variant="secondary" disabled={busy() || !tab()} onClick={() => void action(() => connect(false))}>{props.copy.connect}</Button>
      </Show>
    </Show>
    <Show when={props.managed}><form class="flex gap-2" onSubmit={event => { event.preventDefault(); void action(async () => {
      const current = generation; const result = await props.management.createManagedProfile!(profileName().trim());
      if (current === generation) { setProfiles(result); setProfileName(''); }
    }); }}><input class="flower-settings-text-input min-w-0 flex-1" aria-label={props.copy.profileName} placeholder={props.copy.profileName} maxlength={120} disabled={busy()} value={profileName()} onInput={event => setProfileName(event.currentTarget.value)} /><Button size="sm" type="submit" disabled={busy() || !profileName().trim()}>{props.copy.createProfile}</Button></form></Show>
    <Show when={!props.managed}><details><summary class="cursor-pointer text-xs">{props.copy.setupExtension}</summary><div class="space-y-3 pt-3">
      <p class="text-xs text-muted-foreground">{props.copy.extensionHint}</p><Button size="sm" variant="outline" disabled={busy()} onClick={() => void action(async () => { const current = generation; const result = await props.management.setupExtension!(); if (current === generation) setSetup(result); })}>{props.copy.setupExtension}</Button>
      <Show when={setup()}>{value => <div class="space-y-2 text-xs">
        <label class="block">{props.copy.extensionPath}<input class="flower-settings-text-input mt-1 w-full" readOnly value={value().extension_path} /></label>
        <label class="block">{props.copy.connectionName}<input class="flower-settings-text-input mt-1 w-full" readOnly value={value().native_host} /></label>
        <Button size="sm" variant="ghost" onClick={() => void action(() => navigator.clipboard.writeText(value().native_host))}>{props.copy.copyConnection}</Button>
      </div>}</Show>
    </div></details></Show>
    <Show when={failed()}><p role="alert" class="text-xs text-destructive">{props.copy.failed}</p></Show>
  </section>;
}
