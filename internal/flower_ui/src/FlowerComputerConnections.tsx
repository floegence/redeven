import { FlowerProfileConnection } from './FlowerProfileConnection';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { FlowerComputerAccess, FlowerSurfaceAdapter, FlowerComputerCandidate } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';
import { FlowerBrowserConnection } from './FlowerBrowserConnection';

export type FlowerRequestedComputerAccess = Readonly<{ origin?: string; app?: string; foreground?: boolean }>;
export function FlowerComputerConnections(props: {
  open: boolean; onOpenChange: (open: boolean) => void;
  threadID: string; adapter: FlowerSurfaceAdapter; copy: FlowerComputerCopy;
  requested?: FlowerRequestedComputerAccess;
  fullAccess?: boolean;
  connectionOnly?: boolean;
  onContinue?: () => Promise<void>;
}) {
  const [targets, setTargets] = createSignal<readonly FlowerComputerCandidate[]>([]);
  const [targetID, setTargetID] = createSignal('');
  const [switching, setSwitching] = createSignal(false);
  const [managing, setManaging] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const currentTarget = () => targets().find(target => target.target_id === targetID() && Boolean(targetID()));
  const candidateLabel = (target: FlowerComputerCandidate) => target.new_tab ? `${target.kind === "browser.managed" ? props.copy.managed : props.copy.system} · ${target.profile_name || target.display_name} · ${props.copy.newTab}` : target.title || target.display_name;
  const candidateState = (target: FlowerComputerCandidate) => ({ in_use: props.copy.inUse, user_control: props.copy.waitingControl,
    permission_required: props.copy.permissionRequired, setup_required: props.copy.setupRequired, connection_required: props.copy.disconnected,
    stopped: props.copy.disconnected, ready: props.copy.connected }[target.state] || props.copy.disconnected);
  const candidates = (browser: boolean) => targets().filter(target => target.kind.startsWith('browser.') === browser
    && `${target.display_name} ${target.title || ''} ${target.url || ''} ${target.profile_name || ''}`.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()));
  const [access, setAccess] = createSignal<FlowerComputerAccess>();
  const [origin, setOrigin] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [selectionFailure, setSelectionFailure] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  let generation = 0;
  onCleanup(() => { generation++; });
  const available = () => !loading() && !saving() && Boolean(access()) && props.adapter.canMutate !== false;
  const load = async () => {
    const management = props.adapter.computerManagement, thread = props.threadID, current = ++generation;
    setFailed(false); setSelectionFailure(''); setSaved(false); setSaving(false); setAccess(undefined); setTargets([]); setTargetID(''); setLoading(true);
    if (props.connectionOnly || !management || !thread) { setLoading(false); return; }
    const results = await Promise.allSettled([management.listCandidates(thread), management.loadAccess(thread)]);
    if (current !== generation) return;
    const [inventory, grants] = results;
    if (inventory.status === 'fulfilled') { setTargets(inventory.value.candidates); setTargetID(inventory.value.current_target_id); }
    if (grants.status === 'fulfilled') setAccess({ ...grants.value, origins: grants.value.origins ?? [], apps: grants.value.apps ?? [] });
    setFailed(results.some(result => result.status === 'rejected')); setLoading(false);
  };
  createEffect(() => { if (props.open && props.threadID) { setSwitching(false); setManaging(false); setQuery(''); void load(); } else generation++; });
  const change = (value: FlowerComputerAccess) => { setAccess(value); setSaved(false); };
  const save = async () => {
    const value = access(), management = props.adapter.computerManagement, current = generation;
    if (!value || !management || !available() || props.fullAccess) return;
    setSaving(true); setFailed(false); setSaved(false);
    try { await management.saveAccess(props.threadID, value); if (current === generation) setSaved(true); }
    catch { if (current === generation) setFailed(true); }
    finally { if (current === generation) setSaving(false); }
  };
  const select = async (ref: string) => {
    if (!available() || !props.adapter.computerManagement) return;
    const current = generation;
    setSaving(true); setFailed(false); setSelectionFailure('');
    try {
      const target = await props.adapter.computerManagement.selectCandidate(props.threadID, ref);
      if (current === generation) { setTargetID(target.id); setSwitching(false); await load(); }
    }
    catch (error) {
      if (current === generation) {
        const code = (error as { code?: string })?.code;
        const messages: Record<string, string> = { target_in_use: props.copy.inUse, target_selection_stale: props.copy.selectionStale,
          target_not_allowed: props.copy.permissionRequired, target_permission_required: props.copy.permissionRequired,
          target_setup_required: props.copy.setupRequired, target_connection_required: props.copy.disconnected,
          interaction_takeover_required: props.copy.waitingControl };
        setSelectionFailure(code ? messages[code] || '' : ''); setFailed(true);
      }
    }
    finally { if (current === generation) setSaving(false); }
  };
  const connectBrowser: NonNullable<FlowerSurfaceAdapter['connectComputerBrowser']> = async connection => {
    const current = generation, thread = props.threadID;
    const management = props.adapter.computerManagement, connect = props.adapter.connectComputerBrowser;
    if (!management || !connect || !available()) throw new Error('computer connections unavailable');
    const target = await connect(connection);
    if (!target.ready || current !== generation) throw new Error('computer connection changed');
    // Connecting an explicitly chosen tab also selects it for this conversation.
    await management.selectTarget(thread, target.id);
    return target;
  };
  const disconnect = async (id: string) => {
    if (!available() || !props.adapter.computerManagement?.disconnectBrowser) return;
    const current = generation; setSaving(true); setFailed(false);
    try { await props.adapter.computerManagement.disconnectBrowser(id); if (current === generation) await load(); }
    catch { if (current === generation) setFailed(true); }
    finally { if (current === generation) setSaving(false); }
  };
  const addOrigin = () => {
    const value = access(); if (!value) return;
    try {
      const url = new URL(origin().trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid');
      change({ ...value, origins: [...new Set([...value.origins, url.origin])] }); setOrigin(''); setFailed(false);
    } catch { setFailed(true); }
  };
  const requested = () => Boolean(props.requested?.origin || props.requested?.app || props.requested?.foreground);
  return <Dialog open={props.open} onOpenChange={props.onOpenChange} title={props.connectionOnly ? props.copy.connectionTitle : props.copy.title} class={props.connectionOnly ? "w-[min(30rem,94vw)]" : "w-[min(42rem,94vw)]"}
    footer={props.connectionOnly ? undefined : <div class="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>{props.copy.close}</Button>
      <Show when={!props.connectionOnly && !props.fullAccess}><Button size="sm" disabled={!available()} onClick={() => void save()}>{saving() ? props.copy.saving : props.copy.save}</Button></Show></div>}>
    <div class="space-y-5 text-sm" aria-busy={loading() || saving()}>
      <Show when={props.connectionOnly} fallback={<>
      <p class="text-muted-foreground">{props.copy.description}</p>
      <section class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center justify-between gap-3"><span class="text-xs text-muted-foreground">{props.copy.target}</span><span class="text-xs text-muted-foreground">{props.adapter.runtime.display_name}</span></div>
        <div role="status" class="min-w-0 space-y-1">
          <p class="truncate font-medium">{currentTarget() ? candidateLabel(currentTarget()!) : targetID() ? props.copy.disconnected : props.copy.automatic}</p>
          <p class="truncate text-xs text-muted-foreground">{currentTarget() ? [currentTarget()!.profile_name, currentTarget()!.url, candidateState(currentTarget()!)].filter(Boolean).join(' · ') : props.copy.automaticHint}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" aria-expanded={switching()} disabled={!available()} onClick={() => setSwitching(!switching())}>{props.copy.switchTarget}</Button>
          <Button size="sm" variant="ghost" aria-expanded={managing()} onClick={() => setManaging(!managing())}>{props.copy.manageConnections}</Button>
          <Button variant="ghost" size="sm" disabled={loading() || saving()} onClick={() => void load()}>{props.copy.refresh}</Button>
          <Show when={currentTarget()?.kind.startsWith('browser.') && props.adapter.computerManagement?.disconnectBrowser}>
            <Button size="sm" variant="ghost" disabled={!available()} onClick={() => void disconnect(targetID())}>{props.copy.disconnect}</Button>
          </Show>
        </div>
      </section>
      <Show when={switching()}><section class="space-y-3" aria-label={props.copy.switchTarget}>
        <input type="search" class="flower-settings-text-input w-full" aria-label={props.copy.searchTargets} placeholder={props.copy.searchTargets}
          value={query()} onInput={event => setQuery(event.currentTarget.value)} />
        <div class="max-h-72 space-y-4 overflow-y-auto overscroll-contain">
          <For each={[true, false]}>{browser => <Show when={candidates(browser).length}><section class="space-y-1">
            <h3 class="px-1 text-xs font-medium text-muted-foreground">{browser ? props.copy.browserPages : props.copy.applicationWindows}</h3>
            <For each={candidates(browser)}>{target => <button type="button" class="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              data-computer-candidate-target={target.target_id}
              disabled={!available() || target.state !== 'ready'} aria-pressed={Boolean(target.target_id) && targetID() === target.target_id}
              onClick={() => void select(target.candidate_ref)}>
              <span class="min-w-0 flex-1"><span class="block truncate text-sm">{candidateLabel(target)}</span>
                <span class="block truncate text-xs text-muted-foreground">{[target.profile_name, target.url, !browser ? target.display_name : ''].filter(Boolean).join(' · ')}</span></span>
              <span class="shrink-0 text-xs text-muted-foreground">{candidateState(target)}</span>
            </button>}</For>
          </section></Show>}</For>
          <Show when={!candidates(true).length && !candidates(false).length}><p class="text-xs text-muted-foreground">{props.copy.noTargets}</p></Show>
        </div>
      </section></Show>
      <Show when={props.fullAccess}><section class="space-y-1 rounded-md border border-border p-3" role="status"><p class="font-medium">{props.copy.fullAccessTitle}</p><p class="text-xs text-muted-foreground">{props.copy.fullAccessHint}</p></section></Show>
      <Show when={!props.fullAccess && access()}>{value => <>
        <Show when={requested()}><div class="space-y-2 rounded-md border border-border p-3">
          <p class="font-medium">{props.copy.requestedAccess}</p>
          <p class="break-all text-xs">{[props.requested?.origin, props.requested?.app, props.requested?.foreground ? props.copy.foreground : ''].filter(Boolean).join(' · ')}</p>
          <Button size="sm" variant="secondary" disabled={!available()} onClick={() => change({
            ...value(), origins: [...new Set([...value().origins, ...(props.requested?.origin ? [props.requested.origin] : [])])],
            apps: [...new Set([...value().apps, ...(props.requested?.app ? [props.requested.app] : [])])],
            allow_foreground: value().allow_foreground || props.requested?.foreground === true,
          })}>{props.copy.grantRequested}</Button>
        </div></Show>
        <section class="space-y-2"><p class="font-medium">{props.copy.sites}</p>
          <For each={value().origins}>{site => <div class="flex items-center justify-between gap-2"><span class="truncate text-xs">{site}</span><Button variant="ghost" size="sm" disabled={!available()} aria-label={`${props.copy.remove}: ${site}`} onClick={() => change({ ...value(), origins: value().origins.filter(item => item !== site) })}>{props.copy.remove}</Button></div>}</For>
          <form class="flex gap-2" onSubmit={event => { event.preventDefault(); addOrigin(); }}><input type="url" class="flower-settings-text-input min-w-0 flex-1" aria-label={props.copy.sites} placeholder={props.copy.sitePlaceholder} disabled={!available()} value={origin()} onInput={event => setOrigin(event.currentTarget.value)} /><Button type="submit" size="sm" disabled={!available() || !origin().trim()}>{props.copy.add}</Button></form>
        </section>
        <section class="space-y-2"><p class="font-medium">{props.copy.apps}</p>
          <For each={[...new Set([...value().apps, ...targets().flatMap(target => target.app_bundle_id ? [target.app_bundle_id] : [])])]}>{app => <label class="flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed"><input type="checkbox" class="cursor-pointer disabled:cursor-not-allowed" disabled={!available()} checked={value().apps.includes(app)} onChange={event => change({ ...value(), apps: event.currentTarget.checked ? [...value().apps, app] : value().apps.filter(item => item !== app) })} /><span class="truncate text-xs">{app}</span></label>}</For>
        </section>
        <label class="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed"><input type="checkbox" class="mt-1 cursor-pointer disabled:cursor-not-allowed" disabled={!available()} checked={value().allow_foreground} onChange={event => change({ ...value(), allow_foreground: event.currentTarget.checked })} /><span>{props.copy.foreground}<span class="mt-1 block text-xs text-muted-foreground">{props.copy.foregroundHint}</span></span></label>
        <Button size="sm" variant="ghost" disabled={!available()} onClick={() => { change({ origins: [], apps: [], allow_foreground: false }); void save(); }}>{props.copy.revokeAll}</Button>
      </>}</Show>
      <Show when={managing()}>
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement?.listManagedProfiles && props.adapter.computerManagement.createManagedProfile && props.adapter.computerManagement.listManagedTabs}>
        <FlowerProfileConnection managed management={props.adapter.computerManagement!} connect={connectBrowser} copy={props.copy} onConnected={() => void load()} />
      </Show>
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement?.openExtension && props.adapter.computerManagement.setupExtension && props.adapter.computerManagement.loadExtensionStatus && props.adapter.computerManagement.listExtensionTabs}>
        <FlowerProfileConnection management={props.adapter.computerManagement!} connect={connectBrowser} copy={props.copy} onConnected={() => void load()} />
      </Show>
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement}><details class="rounded-md border border-border p-3"><summary class="cursor-pointer text-xs font-medium">{props.copy.advanced}</summary><div class="pt-3"><FlowerBrowserConnection copy={props.copy} listTabs={props.adapter.computerManagement!.listBrowserTabs} connect={connectBrowser} onConnected={() => void load()} /></div></details></Show>
      </Show>
      </>}>
        <Show when={props.adapter.canMutate !== false && props.adapter.computerManagement?.loadExtensionStatus && props.adapter.computerManagement.setupExtension && props.adapter.computerManagement.openExtension} fallback={<p role="alert">{props.copy.setupRequired}</p>}>
          <FlowerProfileConnection connectionOnly management={props.adapter.computerManagement!} connect={connectBrowser} copy={props.copy} onConnected={() => undefined} onContinue={props.onContinue} />
        </Show>
      </Show>
      <Show when={failed()}><p role="alert" class="text-xs text-destructive">{selectionFailure() || props.copy.failed}</p></Show>
      <Show when={saved()}><p role="status" class="text-xs">{props.copy.saved}</p></Show>
    </div>
  </Dialog>;
}
