import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { normalizeGatewayJoinMaterial, type GatewayJoinMaterial, type GatewayJoinPhase } from '../shared/gatewayJoin';
import type { DesktopI18n } from '../shared/i18n';

export function RuntimeGatewayJoinPanel(props: Readonly<{ targetID: DesktopProviderRuntimeLinkTargetID; i18n: DesktopI18n; pending?: boolean; disabled?: boolean; available?: boolean; focusOwner?: () => void }>) {
  const [open, setOpen] = createSignal(false);
  const [material, setMaterial] = createSignal<GatewayJoinMaterial>();
  const [busy, setBusy] = createSignal(false);
  const [phase, setPhase] = createSignal<GatewayJoinPhase>();
  const [error, setError] = createSignal('');
  let generation = 0;
  let trigger: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pause = () => { generation++; clearTimeout(timer); setBusy(false); };
  onCleanup(pause);
  const close = () => { pause(); setOpen(false); queueMicrotask(() => { if (props.available === false) props.focusOwner?.(); else trigger?.focus(); }); };
  async function readMaterial(file?: File) {
    if (!file) return;
    setError('');
    const current = ++generation;
    try {
      if (file.size > 64 * 1024) throw new Error();
      const parsed = normalizeGatewayJoinMaterial(JSON.parse(await file.text()));
      if (!parsed) throw new Error();
      if (current === generation) { setMaterial(parsed); setPhase(undefined); }
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.invalid')); }
  }
  async function step(current: number, initial = false) {
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'join_runtime_gateway_cloud', runtime_target_id: props.targetID, ...(initial && material() ? { material: material()! } : {}) });
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_join_phase) throw new Error();
      setPhase(result.gateway_join_phase);
      if (result.gateway_join_phase === 'connected') { setBusy(false); setMaterial(undefined); return; }
      timer = setTimeout(() => { void step(current); }, 3000);
    } catch {
      if (current === generation) { setError(props.i18n.t('gatewayJoin.failed')); setBusy(false); }
    }
  }
  function start() { if (busy()) return; setBusy(true); setError(''); void step(++generation, true); }
  async function manage() {
    const m = material();
    if (!m) return;
    const url = `${m.cloud_origin}/namespaces/${encodeURIComponent(m.namespace_public_id)}/gateways?gateway=${encodeURIComponent(m.gateway_public_id)}`;
    const result = await window.redevenDesktopShell?.openExternalURL?.(url);
    if (!result?.ok) setError(props.i18n.t('gatewayCloud.unavailable'));
  }
  return <>
    <Button ref={trigger} hidden={props.available === false && !open()} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled} onClick={() => setOpen(true)}>{props.i18n.t(props.pending ? 'gatewayJoin.resume' : 'gatewayJoin.title')}</Button>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayJoin.title')} bodyDescription={phase() === 'connected' ? undefined : props.i18n.t('gatewayJoin.consent')} closeLabel={props.i18n.t('common.close')}>
      <div class="space-y-4 p-4">
        <Show when={phase() !== 'connected'}><label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.material')}</span><input type="file" accept=".json,application/json" class="block w-full cursor-pointer text-xs disabled:cursor-not-allowed" disabled={busy()} onChange={event => void readMaterial(event.currentTarget.files?.[0])} /></label></Show>
        <Show when={material()}>{m => <dl class="space-y-1 break-all text-xs"><dt>{props.i18n.t('gatewayCloud.cloudOrigin')}</dt><dd>{m().cloud_origin}</dd><dt>{props.i18n.t('gatewayCloud.gatewayURL')}</dt><dd>{m().gateway_url}</dd><dt>{props.i18n.t('gatewayJoin.namespace')}</dt><dd>{m().namespace_public_id}</dd></dl>}</Show>
        <Show when={phase()}>{p => <p role="status" aria-live="polite" class="text-sm">{props.i18n.t(p() === 'connected' ? 'providerRecovery.connected' : p() === 'awaiting_approval' ? 'gatewayCloud.pending' : p() === 'connecting' ? 'providerRecovery.connecting' : 'gatewayCloud.working')}</p>}</Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        <Show when={phase() !== 'connected'}><p class="text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.pauseDetail')}</p></Show>
        <div class="flex flex-wrap justify-end gap-2">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t('common.close')}</Button>
          <Show when={material()}><Button class="cursor-pointer" variant="outline" onClick={() => void manage()}>{props.i18n.t('gatewayCloud.manage')}</Button></Show>
          <Show when={phase() !== 'connected'}><Button class="cursor-pointer" disabled={busy() || (!material() && !props.pending)} onClick={start}>{props.i18n.t(props.pending || phase() ? 'gatewayJoin.resume' : 'gatewayJoin.approve')}</Button></Show>
        </div>
      </div>
    </Dialog>
  </>;
}
