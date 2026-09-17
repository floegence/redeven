import { FlowerProfileConnection } from './FlowerProfileConnection';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { FlowerComputerAccess, FlowerSurfaceAdapter, FlowerTargetDescriptor } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';
import { FlowerBrowserConnection } from './FlowerBrowserConnection';

export type FlowerRequestedComputerAccess = Readonly<{ origin?: string; app?: string; foreground?: boolean }>;
export function FlowerComputerConnections(props: {
  open: boolean; onOpenChange: (open: boolean) => void;
  threadID: string; adapter: FlowerSurfaceAdapter; copy: FlowerComputerCopy;
  requested?: FlowerRequestedComputerAccess;
  fullAccess?: boolean;
}) {
  const [targets, setTargets] = createSignal<readonly FlowerTargetDescriptor[]>([]);
  const [targetID, setTargetID] = createSignal('');
  const [access, setAccess] = createSignal<FlowerComputerAccess>();
  const [origin, setOrigin] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  let generation = 0;
  onCleanup(() => { generation++; });
  const available = () => !loading() && !saving() && Boolean(access()) && props.adapter.canMutate !== false;
  const load = async () => {
    const management = props.adapter.computerManagement, thread = props.threadID, current = ++generation;
    setFailed(false); setSaved(false); setSaving(false); setAccess(undefined); setTargets([]); setTargetID(''); setLoading(true);
    if (!management || !thread) { setLoading(false); return; }
    const results = await Promise.allSettled([management.listTargets(), management.loadAccess(thread), management.loadTarget(thread)]);
    if (current !== generation) return;
    const [inventory, grants, target] = results;
    if (inventory.status === 'fulfilled') setTargets(inventory.value);
    if (grants.status === 'fulfilled') setAccess({ ...grants.value, origins: grants.value.origins ?? [], apps: grants.value.apps ?? [] });
    if (target.status === 'fulfilled') setTargetID(target.value.target_id);
    setFailed(results.some(result => result.status === 'rejected')); setLoading(false);
  };
  createEffect(() => { if (props.open && props.threadID) void load(); else generation++; });
  const change = (value: FlowerComputerAccess) => { setAccess(value); setSaved(false); };
  const save = async () => {
    const value = access(), management = props.adapter.computerManagement, current = generation;
    if (!value || !management || !available() || props.fullAccess) return;
    setSaving(true); setFailed(false); setSaved(false);
    try { await management.saveAccess(props.threadID, value); if (current === generation) setSaved(true); }
    catch { if (current === generation) setFailed(true); }
    finally { if (current === generation) setSaving(false); }
  };
  const select = async (id: string) => {
    if (!available() || !props.adapter.computerManagement) return;
    const current = generation;
    setSaving(true); setFailed(false);
    try { await props.adapter.computerManagement.selectTarget(props.threadID, id); if (current === generation) setTargetID(id); }
    catch { if (current === generation) setFailed(true); }
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
  return <Dialog open={props.open} onOpenChange={props.onOpenChange} title={props.copy.title} class="w-[min(42rem,94vw)]"
    footer={<div class="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>{props.copy.close}</Button>
      <Show when={!props.fullAccess}><Button size="sm" disabled={!available()} onClick={() => void save()}>{saving() ? props.copy.saving : props.copy.save}</Button></Show></div>}>
    <div class="space-y-5 text-sm" aria-busy={loading() || saving()}>
      <p class="text-muted-foreground">{props.copy.description}</p>
      <section class="space-y-2">
        <div class="flex items-center justify-between gap-3"><span class="font-medium">{props.copy.target}</span><Button variant="ghost" size="sm" disabled={loading() || saving()} onClick={() => void load()}>{props.copy.refresh}</Button></div>
        <p class="text-xs text-muted-foreground">{props.adapter.runtime.display_name}</p>
        <div role="radiogroup" aria-label={props.copy.target} class="space-y-1">
          <For each={targets()} fallback={<p class="text-xs text-muted-foreground">{props.copy.noTargets}</p>}>{target => {
            const unavailable = () => target.kind === 'desktop.screen' || target.state === 'setup_required' || target.state === 'permission_required';
            return <div class="flex items-center gap-2"><label class="flex flex-1 min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border p-3 has-[:disabled]:cursor-not-allowed">
              <input type="radio" name="flower-computer-target" value={target.id} class="cursor-pointer disabled:cursor-not-allowed" checked={targetID() === target.id} disabled={!available() || unavailable()} onChange={() => void select(target.id)} />
              <span class="min-w-0 flex-1 truncate">{target.display_name}</span>
              <Show when={unavailable()}><span class="text-xs text-muted-foreground">{target.state === 'permission_required' ? props.copy.permissionRequired : props.copy.setupRequired}</span></Show>
            </label><Show when={(target.kind === 'browser.connected' || (target.kind === 'browser.managed' && target.id !== 'browser-main')) && props.adapter.computerManagement?.disconnectBrowser}>
              <Button size="sm" variant="ghost" disabled={!available()} aria-label={`${props.copy.disconnect}: ${target.display_name}`} onClick={() => void disconnect(target.id)}>{props.copy.disconnect}</Button>
            </Show></div>;
          }}</For>
        </div>
      </section>
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
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement?.listManagedProfiles && props.adapter.computerManagement.createManagedProfile && props.adapter.computerManagement.listManagedTabs}>
        <FlowerProfileConnection managed management={props.adapter.computerManagement!} connect={connectBrowser} copy={props.copy} onConnected={() => void load()} />
      </Show>
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement?.setupExtension && props.adapter.computerManagement.listExtensionProfiles && props.adapter.computerManagement.listExtensionTabs}>
        <FlowerProfileConnection management={props.adapter.computerManagement!} connect={connectBrowser} copy={props.copy} onConnected={() => void load()} />
      </Show>
      <Show when={props.adapter.canMutate !== false && props.adapter.connectComputerBrowser && props.adapter.computerManagement}><details class="rounded-md border border-border p-3"><summary class="cursor-pointer text-xs font-medium">{props.copy.advanced}</summary><div class="pt-3"><FlowerBrowserConnection copy={props.copy} listTabs={props.adapter.computerManagement!.listBrowserTabs} connect={connectBrowser} onConnected={() => void load()} /></div></details></Show>
      <Show when={failed()}><p role="alert" class="text-xs text-destructive">{props.copy.failed}</p></Show>
      <Show when={saved()}><p role="status" class="text-xs">{props.copy.saved}</p></Show>
    </div>
  </Dialog>;
}
