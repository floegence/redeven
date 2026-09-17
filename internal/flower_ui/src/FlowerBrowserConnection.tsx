import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerBrowserTab, FlowerSurfaceAdapter, FlowerTargetDescriptor } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';

export function FlowerBrowserConnection(props: {
  copy: FlowerComputerCopy;
  listTabs: NonNullable<FlowerSurfaceAdapter['computerManagement']>['listBrowserTabs'];
  connect: NonNullable<FlowerSurfaceAdapter['connectComputerBrowser']>;
  onConnected?: (target: FlowerTargetDescriptor) => void;
}) {
  const [endpoint, setEndpoint] = createSignal('');
  const [tabs, setTabs] = createSignal<readonly FlowerBrowserTab[]>();
  const [profile, setProfile] = createSignal('');
  const [tabID, setTabID] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [connected, setConnected] = createSignal('');
  let generation = 0;
  onCleanup(() => { generation++; });
  const profiles = createMemo(() => [...new Set(tabs()?.map(tab => tab.profile_id))]);
  const tab = createMemo(() => tabs()?.find(item => item.id === tabID() && item.profile_id === profile()));
  const discover = async () => {
    const current = ++generation;
    setBusy(true); setError(false); setTabs(undefined); setProfile(''); setTabID(''); setConnected('');
    try { const result = await props.listTabs(endpoint().trim()); if (current === generation) setTabs(result); }
    catch { if (current === generation) setError(true); }
    finally { if (current === generation) setBusy(false); }
  };
  const connect = async () => {
    const chosen = tab();
    if (!chosen || busy()) return;
    const current = ++generation;
    setBusy(true); setError(false);
    try {
      const target = await props.connect({ cdp_url: endpoint().trim(), tab_id: chosen.id, profile_id: chosen.profile_id });
      if (current !== generation) return;
      if (!target.ready || target.state !== 'ready') throw new Error('unavailable');
      setConnected(target.display_name); props.onConnected?.(target);
    } catch { if (current === generation) setError(true); }
    finally { if (current === generation) setBusy(false); }
  };
  return <div class="space-y-3">
    <form class="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void discover(); }}>
      <label class="min-w-0 flex-1 space-y-1 text-xs">{props.copy.endpoint}
        <input class="flower-settings-text-input w-full" type="url" required disabled={busy()} value={endpoint()}
          aria-invalid={error()} placeholder="http://127.0.0.1:9222" onInput={(event) => { setEndpoint(event.currentTarget.value); setTabs(undefined); setProfile(''); setTabID(''); setConnected(''); }} />
      </label>
      <Button size="sm" type="submit" disabled={busy() || !endpoint().trim()}>{busy() ? props.copy.connecting : props.copy.listTabs}</Button>
    </form>
    <Show when={tabs()?.length} fallback={<Show when={tabs()?.length === 0}><p role="status" class="text-xs text-muted-foreground">{props.copy.noTabs}</p></Show>}>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-xs">{props.copy.profile}
          <select class="flower-settings-text-input w-full cursor-pointer disabled:cursor-not-allowed" value={profile()} disabled={busy()} onChange={(event) => { setProfile(event.currentTarget.value); setTabID(''); }}>
            <option value="">{props.copy.chooseProfile}</option><For each={profiles()}>{value => <option value={value}>{value}</option>}</For>
          </select>
        </label>
        <label class="space-y-1 text-xs">{props.copy.tab}
          <select class="flower-settings-text-input w-full cursor-pointer disabled:cursor-not-allowed" value={tabID()} disabled={busy() || !profile()} onChange={(event) => setTabID(event.currentTarget.value)}>
            <option value="">{props.copy.chooseTab}</option><For each={tabs()?.filter(value => value.profile_id === profile())}>{value => <option value={value.id}>{value.title || value.url}</option>}</For>
          </select>
        </label>
      </div>
      <Show when={tab()}>{chosen => <p class="break-all text-xs text-muted-foreground">{chosen().url}</p>}</Show>
      <Button size="sm" disabled={!tab() || busy()} onClick={() => void connect()}>{props.copy.connect}</Button>
    </Show>
    <Show when={connected()}><p role="status" class="text-xs">{props.copy.connected} · {connected()}</p></Show>
    <Show when={error()}><p role="alert" class="text-xs text-destructive">{props.copy.failed}</p></Show>
  </div>;
}
