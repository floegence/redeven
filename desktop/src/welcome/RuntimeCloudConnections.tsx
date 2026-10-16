import {Button, Dialog, KeyedFor} from '@floegence/floe-webapp-core/ui';
import {createEffect, createMemo, createSignal, on, onCleanup, Show} from 'solid-js';
import type {DesktopI18n} from '../shared/i18n';
import type {DesktopCloudRuntimeLinkTargetID} from '../shared/providerRuntimeLinkTarget';
import type {RuntimeGatewayMembership, RuntimeServiceCloudLinkBinding} from '../shared/runtimeService';
import type {CloudRouteOperation, RuntimeCloudOperation} from '../shared/runtimeCloud';

/** Only Runtime commits a route. This view retains the original operation ID. */
export function RuntimeCloudConnections(props: Readonly<{
 available?: boolean; onOpenChange?: (open: boolean) => void;
 targetID: DesktopCloudRuntimeLinkTargetID; binding: RuntimeServiceCloudLinkBinding;
 memberships: readonly RuntimeGatewayMembership[]; i18n: DesktopI18n;
 onChanged: () => void | Promise<void>; openInBrowser: (url: string) => unknown;
}>) {
 const t = props.i18n.t;
 const [open,setOpen] = createSignal(false), [selected,setSelected] = createSignal('direct');
 const [operation,setOperation] = createSignal<CloudRouteOperation>(), [pending,setPending] = createSignal('');
 const [error,setError] = createSignal(''), [busy,setBusy] = createSignal(false), [corrupt,setCorrupt] = createSignal(false);
 const cloud = () => props.binding.cloud;
 const [sessionKey, setSessionKey] = createSignal('');
 const [authorityRevoked, setAuthorityRevoked] = createSignal(false);
 const [sessionTarget, setSessionTarget] = createSignal(props.targetID);
 const available = createMemo(() => props.available !== false);
 const invalid = () => props.available === false || authorityRevoked() || (open() && sessionKey() !== storageKey());
 const selectionInvalid = () => selected() !== 'direct' && !props.memberships.some(member => member.member_id === selected());
 const storageKey = createMemo(() => `redeven-cloud-route:${JSON.stringify([props.targetID, props.binding.cloud_origin, props.binding.cloud_id, props.binding.env_public_id, cloud()?.association_revision])}`);
 let generation = 0;
 onCleanup(() => { generation++; });
 async function refresh(owner: number) {
  try { await props.onChanged(); } catch { if (owner === generation) setError(t('cloudRoute.reviewCurrent')); }
 }
 function loadStored(key: string) {
  setOperation(undefined); setError(''); setBusy(false); setPending(''); setCorrupt(false);
  try {
   let saved = window.localStorage.getItem(key);
   // Consume the pre-identity receipt once. Query/cancel still validates it in Runtime; never infer consent.
   const previousKey = `redeven-cloud-route:${props.targetID}:${cloud()?.association_revision}`;
   const previous = window.localStorage.getItem(previousKey);
   if (!saved && previous) {
    window.localStorage.setItem(key, previous);
    saved = previous;
    window.localStorage.removeItem(previousKey);
   }
   if (saved && /^[A-Za-z0-9_-]{43}$/u.test(saved)) setPending(saved);
   else if (saved) {setCorrupt(true); setError(t('cloudRoute.corrupt'));}
  } catch { setError(t('cloudRoute.storageFailed')); }
 }
 function changeOpen(value: boolean) {
  if (value === open()) return;
  generation++; setBusy(false);
  if (value) { setAuthorityRevoked(false); setSessionTarget(props.targetID); setSessionKey(storageKey()); loadStored(storageKey()); }
  setOpen(value); props.onOpenChange?.(value);
 }
 // IMPORTANT: Observations never reset an open route session or retire its original unknown operation.
 createEffect(on([storageKey, available], ([key]) => {
  generation++;
  if (open()) { setAuthorityRevoked(true); setBusy(false); return; }
  setSessionTarget(props.targetID); setSessionKey(key); loadStored(key);
 }));
 function remember(id: string) {
  window.localStorage.setItem(sessionKey(),id);
  setPending(id);
 }
 function retire(key: string) { window.localStorage.removeItem(key); setPending(''); setOperation(undefined); }
 async function run(request: RuntimeCloudOperation) {
  const recovering = request.operation === 'query' || request.operation === 'cancel';
  if (busy() || props.available === false || (invalid() && (!recovering || sessionTarget() !== props.targetID))) return;
  const owner = generation, key = open() ? sessionKey() : storageKey(), target = props.targetID;
  const current = () => owner === generation && target === props.targetID && props.available !== false && (key === storageKey() || recovering);
  setBusy(true); setError('');
  try {
   const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_cloud',runtime_target_id:target,...request});
   if (!current()) return;
   if (!result?.ok && result?.cloud_error_code === 'ROUTE_OPERATION_NOT_FOUND') {retire(key);await refresh(owner);if(current())setError(t('cloudRoute.reviewCurrent'));return;}
   if (!result?.ok) {setError(result?.message || t('cloudRoute.unknown')); return;}
   if (result.cloud_route_operation) {
    if ('operation_id' in request && result.cloud_route_operation.operation_id !== request.operation_id) {setError(t('cloudRoute.unknown'));return;}
    setOperation(result.cloud_route_operation);
    if (result.cloud_route_operation.state !== 'awaiting_confirmation') {
     retire(key); await refresh(owner); if(current() && !invalid()) changeOpen(false);
    }
   } else if (request.operation === 'retry') await refresh(owner);
   else setError(t('cloudRoute.unknown'));
  } catch { if (current()) setError(t('cloudRoute.unknown')); }
  finally { if (owner === generation) setBusy(false); }
 }
 async function preflight() {
  if (!cloud() || pending() || corrupt() || invalid() || selectionInvalid() || busy()) return;
  try {
   const raw = crypto.getRandomValues(new Uint8Array(32));
   const id = btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   remember(id);
   await run({operation:'preflight',operation_id:id,expected_route_revision:cloud()!.route_revision,selection:selected() === 'direct' ? {kind:'direct'} : {kind:'gateway',member_id:selected()}});
  } catch {setError(t('cloudRoute.storageFailed'));}
 }
 const routeLabel = () => cloud()?.route.kind === 'direct' ? t('cloudRoute.direct') : props.memberships.find(m => m.member_id === cloud()?.route.member_id)?.gateway_name || t('cloudRoute.gatewayUnavailable');
 return <><Show when={cloud()}>{status => <div class="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
  <p>{t('cloudRoute.approval')}: {t(`cloudRoute.${status().approval_state}`)}</p>
  <p>{t('cloudRoute.connection')}: {t(status().connection_state === 'connected' ? 'cloudRoute.connected' : 'cloudRoute.disconnected')}</p>
  <p>{t('cloudRoute.selected')}: {routeLabel()}</p>
  <Show when={status().reason_code}><p class="break-all text-xs text-muted-foreground">{status().reason_code}</p></Show>
  <Show when={status().next_attempt_at_unix_ms}><p>{t('cloudRoute.nextAttempt', {time:new Date(status().next_attempt_at_unix_ms!).toLocaleTimeString()})}</p></Show>
  <Show when={!['approved','pending','revoked'].includes(status().approval_state)}><p class="text-xs text-muted-foreground">{t('cloudRoute.reauthorizeHelp')}</p></Show>
  <div class="flex flex-wrap gap-2">
   <Button size="sm" class="cursor-pointer" onClick={() => {setSelected(status().route.kind === 'direct' ? 'direct' : status().route.member_id!);changeOpen(true);}}>{t('cloudRoute.change')}</Button>
   <Button size="sm" variant="outline" class="cursor-pointer" disabled={busy() || invalid()} onClick={() => void run({operation:'retry',expected_association_revision:status().association_revision})}>{t('cloudRoute.retry')}</Button>
   <Button size="sm" variant="ghost" class="cursor-pointer" onClick={() => props.binding.cloud_origin && props.openInBrowser(props.binding.cloud_origin)}>{t('cloudRoute.manageApproval')}</Button>
   <Show when={status().enabled}><Button size="sm" variant="ghost" class="cursor-pointer" disabled={busy() || invalid()} onClick={() => {
    setBusy(true);
    const owner = generation, key = storageKey();
    const current = () => owner === generation && key === storageKey() && props.available !== false;
    void (async () => {
     try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'disconnect_cloud_runtime',runtime_target_id:props.targetID});
      if (!current()) return;
      if (result?.ok) await refresh(owner); else setError(result?.message || t('cloudRoute.unknown'));
     } catch {if(owner === generation) setError(t('cloudRoute.unknown'));}
     finally {if(owner === generation) setBusy(false);}
    })();
   }}>{t('cloudRoute.cancelIntent')}</Button></Show>
  </div>
  <Show when={pending() && !open()}><Button size="sm" variant="outline" class="cursor-pointer" onClick={() => changeOpen(true)}>{t('cloudRoute.pendingOperation')}</Button></Show>
  <Show when={error() && !open()}><p role="alert" class="text-error">{error()}</p></Show>
 </div>}</Show><Dialog open={open()} onOpenChange={changeOpen} title={t('cloudRoute.change')} closeLabel={t('common.close')}>
   <div class="space-y-4">
    <Show when={invalid()}><p role="alert" class="text-warning">{t('interactionContinuity.unavailable')}</p><Button variant="outline" disabled={props.available === false || busy()} onClick={() => { if (props.available !== false && !busy()) { generation++; setAuthorityRevoked(false); setSessionTarget(props.targetID); setSessionKey(storageKey()); loadStored(storageKey()); } }}>{t('interactionContinuity.revalidate')}</Button></Show>
    <p>{t('cloudRoute.impact')}</p>
    <label class="block space-y-2"><span>{t('cloudRoute.selected')}</span>
     <select class="w-full cursor-pointer rounded-md border border-border bg-background p-2" value={selected()} disabled={busy() || !!pending() || corrupt()} onChange={event => setSelected(event.currentTarget.value)}>
      <Show when={selectionInvalid()}><option value={selected()} disabled>{t('cloudRoute.gatewayUnavailable')}</option></Show>
      <option value="direct">{t('cloudRoute.direct')}</option>
      <KeyedFor each={props.memberships} by={member => member.member_id}>{member => <option value={member().member_id}>{member().gateway_name || member().gateway_id}</option>}</KeyedFor>
     </select>
    </label>
    <Show when={error()}><p role="alert" class="text-error">{error()}</p></Show>
    <Show when={operation()}><p role="status">{t(operation()?.state === 'awaiting_confirmation' ? 'cloudRoute.ready' : 'cloudRoute.committed')}</p></Show>
    <div class="flex flex-wrap justify-end gap-2">
     <Button class="cursor-pointer" variant="ghost" onClick={() => changeOpen(false)}>{t('common.close')}</Button>
     <Show when={corrupt()}><Button class="cursor-pointer" variant="outline" onClick={() => {try {window.localStorage.removeItem(sessionKey());setSelected('direct');setCorrupt(false);setError('');} catch {setError(t('cloudRoute.storageFailed'));}}}>{t('cloudRoute.reviewCurrent')}</Button></Show>
     <Show when={pending()} fallback={<Button class="cursor-pointer" disabled={busy() || corrupt() || invalid() || selectionInvalid()} onClick={() => void preflight()}>{t('cloudRoute.verify')}</Button>}>
      <Button class="cursor-pointer" variant="outline" disabled={busy() || props.available === false || sessionTarget() !== props.targetID} onClick={() => void run({operation:'query',operation_id:pending()})}>{t('cloudRoute.query')}</Button>
      <Button class="cursor-pointer" variant="ghost" disabled={busy() || props.available === false || sessionTarget() !== props.targetID} onClick={() => void run({operation:'cancel',operation_id:pending()})}>{t('common.cancel')}</Button>
      <Show when={operation()?.state === 'awaiting_confirmation'}><Button class="cursor-pointer" disabled={busy() || invalid()} onClick={() => void run({operation:'commit',operation_id:pending()})}>{t('cloudRoute.confirm')}</Button></Show>
     </Show>
    </div>
   </div>
  </Dialog>
 </>;
}
