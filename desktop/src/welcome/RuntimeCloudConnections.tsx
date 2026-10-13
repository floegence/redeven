import {Button, Dialog} from '@floegence/floe-webapp-core/ui';
import {createEffect, createMemo, createSignal, For, onCleanup, Show} from 'solid-js';
import type {DesktopI18n} from '../shared/i18n';
import type {DesktopCloudRuntimeLinkTargetID} from '../shared/providerRuntimeLinkTarget';
import type {RuntimeGatewayMembership, RuntimeServiceCloudLinkBinding} from '../shared/runtimeService';
import type {CloudRouteOperation, RuntimeCloudOperation} from '../shared/runtimeCloud';

/** Only Runtime commits a route. This view retains the original operation ID. */
export function RuntimeCloudConnections(props: Readonly<{
 targetID: DesktopCloudRuntimeLinkTargetID; binding: RuntimeServiceCloudLinkBinding;
 memberships: readonly RuntimeGatewayMembership[]; i18n: DesktopI18n;
 onChanged: () => void | Promise<void>; openInBrowser: (url: string) => unknown;
}>) {
 const t = props.i18n.t;
 const [open,setOpen] = createSignal(false), [selected,setSelected] = createSignal('direct');
 const [operation,setOperation] = createSignal<CloudRouteOperation>(), [pending,setPending] = createSignal('');
 const [error,setError] = createSignal(''), [busy,setBusy] = createSignal(false), [corrupt,setCorrupt] = createSignal(false);
 const cloud = () => props.binding.cloud;
 const storageKey = createMemo(() => `redeven-cloud-route:${props.targetID}:${cloud()?.association_revision}`);
 let generation = 0;
 onCleanup(() => { generation++; });
 async function refresh(owner: number) {
  try { await props.onChanged(); } catch { if (owner === generation) setError(t('cloudRoute.reviewCurrent')); }
 }
 createEffect(() => {
  const key = storageKey();
  generation++;
  setOperation(undefined); setError(''); setBusy(false); setPending(''); setCorrupt(false);
  try {
   const saved = window.localStorage.getItem(key);
   if (saved && /^[A-Za-z0-9_-]{43}$/u.test(saved)) setPending(saved);
   else if (saved) {setCorrupt(true); setError(t('cloudRoute.corrupt'));}
  } catch { setError(t('cloudRoute.storageFailed')); }
 });
 function remember(id: string) {
  window.localStorage.setItem(storageKey(),id);
  setPending(id);
 }
 function retire() { window.localStorage.removeItem(storageKey()); setPending(''); setOperation(undefined); }
 async function run(request: RuntimeCloudOperation) {
  if (busy()) return;
  const owner = generation;
  setBusy(true); setError('');
  try {
   const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_cloud',runtime_target_id:props.targetID,...request});
   if (owner !== generation) return;
   if (!result?.ok && result?.cloud_error_code === 'ROUTE_OPERATION_NOT_FOUND') {retire();await refresh(owner);setError(t('cloudRoute.reviewCurrent'));return;}
   if (!result?.ok) {setError(result?.message || t('cloudRoute.unknown')); return;}
   if (result.cloud_route_operation) {
    setOperation(result.cloud_route_operation);
    if (result.cloud_route_operation.state !== 'awaiting_confirmation') {
     retire(); setOpen(false); await refresh(owner);
    }
   } else if (request.operation === 'retry') await refresh(owner);
  } catch { if (owner === generation) setError(t('cloudRoute.unknown')); }
  finally { if (owner === generation) setBusy(false); }
 }
 async function preflight() {
  if (!cloud() || pending() || corrupt()) return;
  try {
   const raw = crypto.getRandomValues(new Uint8Array(32));
   const id = btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   remember(id);
   await run({operation:'preflight',operation_id:id,expected_route_revision:cloud()!.route_revision,selection:selected() === 'direct' ? {kind:'direct'} : {kind:'gateway',member_id:selected()}});
  } catch {setError(t('cloudRoute.storageFailed'));}
 }
 const routeLabel = () => cloud()?.route.kind === 'direct' ? t('cloudRoute.direct') : props.memberships.find(m => m.member_id === cloud()?.route.member_id)?.gateway_name || t('cloudRoute.gatewayUnavailable');
 return <Show when={cloud()}>{status => <div class="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
  <p>{t('cloudRoute.approval')}: {t(`cloudRoute.${status().approval_state}`)}</p>
  <p>{t('cloudRoute.connection')}: {t(status().connection_state === 'connected' ? 'cloudRoute.connected' : 'cloudRoute.disconnected')}</p>
  <p>{t('cloudRoute.selected')}: {routeLabel()}</p>
  <Show when={status().reason_code}><p class="break-all text-xs text-muted-foreground">{status().reason_code}</p></Show>
  <Show when={status().next_attempt_at_unix_ms}><p>{t('cloudRoute.nextAttempt', {time:new Date(status().next_attempt_at_unix_ms!).toLocaleTimeString()})}</p></Show>
  <Show when={!['approved','pending','revoked'].includes(status().approval_state)}><p class="text-xs text-muted-foreground">{t('cloudRoute.reauthorizeHelp')}</p></Show>
  <div class="flex flex-wrap gap-2">
   <Button size="sm" class="cursor-pointer" onClick={() => {setSelected(status().route.kind === 'direct' ? 'direct' : status().route.member_id!);setOpen(true);}}>{t('cloudRoute.change')}</Button>
   <Button size="sm" variant="outline" class="cursor-pointer" disabled={busy()} onClick={() => void run({operation:'retry',expected_association_revision:status().association_revision})}>{t('cloudRoute.retry')}</Button>
   <Button size="sm" variant="ghost" class="cursor-pointer" onClick={() => props.binding.cloud_origin && props.openInBrowser(props.binding.cloud_origin)}>{t('cloudRoute.manageApproval')}</Button>
   <Show when={status().enabled}><Button size="sm" variant="ghost" class="cursor-pointer" disabled={busy()} onClick={() => {
    setBusy(true);
    const owner = generation;
    void (async () => {
     try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'disconnect_cloud_runtime',runtime_target_id:props.targetID});
      if (owner !== generation) return;
      if (result?.ok) await refresh(owner); else setError(result?.message || t('cloudRoute.unknown'));
     } catch {if(owner === generation) setError(t('cloudRoute.unknown'));}
     finally {if(owner === generation) setBusy(false);}
    })();
   }}>{t('cloudRoute.cancelIntent')}</Button></Show>
  </div>
  <Show when={pending() && !open()}><Button size="sm" variant="outline" class="cursor-pointer" onClick={() => setOpen(true)}>{t('cloudRoute.pendingOperation')}</Button></Show>
  <Show when={error() && !open()}><p role="alert" class="text-error">{error()}</p></Show>
  <Dialog open={open()} onOpenChange={setOpen} title={t('cloudRoute.change')} closeLabel={t('common.close')}>
   <div class="space-y-4">
    <p>{t('cloudRoute.impact')}</p>
    <label class="block space-y-2"><span>{t('cloudRoute.selected')}</span>
     <select class="w-full cursor-pointer rounded-md border border-border bg-background p-2" value={selected()} disabled={busy() || !!pending() || corrupt()} onChange={event => setSelected(event.currentTarget.value)}>
      <option value="direct">{t('cloudRoute.direct')}</option>
      <For each={props.memberships}>{member => <option value={member.member_id}>{member.gateway_name || member.gateway_id}</option>}</For>
     </select>
    </label>
    <Show when={error()}><p role="alert" class="text-error">{error()}</p></Show>
    <Show when={operation()}><p role="status">{t(operation()?.state === 'awaiting_confirmation' ? 'cloudRoute.ready' : 'cloudRoute.committed')}</p></Show>
    <div class="flex flex-wrap justify-end gap-2">
     <Button class="cursor-pointer" variant="ghost" onClick={() => setOpen(false)}>{t('common.close')}</Button>
     <Show when={corrupt()}><Button class="cursor-pointer" variant="outline" onClick={() => {try {window.localStorage.removeItem(storageKey());setCorrupt(false);setError('');} catch {setError(t('cloudRoute.storageFailed'));}}}>{t('cloudRoute.reviewCurrent')}</Button></Show>
     <Show when={pending()} fallback={<Button class="cursor-pointer" disabled={busy() || corrupt()} onClick={() => void preflight()}>{t('cloudRoute.verify')}</Button>}>
      <Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => void run({operation:'query',operation_id:pending()})}>{t('cloudRoute.query')}</Button>
      <Button class="cursor-pointer" variant="ghost" disabled={busy()} onClick={() => void run({operation:'cancel',operation_id:pending()})}>{t('common.cancel')}</Button>
      <Show when={operation()?.state === 'awaiting_confirmation'}><Button class="cursor-pointer" disabled={busy()} onClick={() => void run({operation:'commit',operation_id:pending()})}>{t('cloudRoute.confirm')}</Button></Show>
     </Show>
    </div>
   </div>
  </Dialog>
 </div>}</Show>;
}
