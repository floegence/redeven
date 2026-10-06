import { Button, Dialog, Input } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { normalizeGatewayCloudConfiguration, type GatewayCloudSummary } from '../shared/gatewayCloud';
import type { DesktopI18n } from '../shared/i18n/desktopI18n';

export function GatewayCloudPanel(props: Readonly<{ gatewayID: string; gatewayName: string; i18n: DesktopI18n; disabled?: boolean }>) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<GatewayCloudSummary>();
  const [error, setError] = createSignal('');
  const [cloud, setCloud] = createSignal('');
  const [gatewayURL, setGatewayURL] = createSignal('');
  const [listen, setListen] = createSignal('0.0.0.0:7443');
  let generation = 0;
  let trigger: HTMLButtonElement | undefined;
  function cancel() {
    generation++;
    if (busy()) void window.redevenDesktopLauncher?.performAction({ kind: 'cancel_launcher_operation', operation_key: `${props.gatewayID}:cloud` });
    setBusy(false);
  }
  onCleanup(cancel);
  async function load(configure = false) {
    const bridge = window.redevenDesktopLauncher;
    if (!bridge || busy()) return;
    const configuration = normalizeGatewayCloudConfiguration({ cloud_origin: cloud(), gateway_url: gatewayURL(), egress_listen: listen() });
    if (configure && !configuration) { setError(props.i18n.t('gatewayCloud.invalid')); return; }
    const current = ++generation;
    setBusy(true);
    setError('');
    try {
      const result = await bridge.performAction(configure
        ? { kind: 'configure_gateway_cloud', gateway_id: props.gatewayID, configuration: configuration! }
        : { kind: 'inspect_gateway_cloud', gateway_id: props.gatewayID });
      if (current !== generation) return;
      if (!result.ok || !result.gateway_cloud) { setError(props.i18n.t('gatewayCloud.unavailable')); return; }
      setStatus(result.gateway_cloud);
      if (result.gateway_cloud.cloud_origin) setCloud(result.gateway_cloud.cloud_origin);
    } catch { if (current === generation) setError(props.i18n.t('gatewayCloud.unavailable')); }
    finally { if (current === generation) setBusy(false); }
  }
  function close() { cancel(); setOpen(false); queueMicrotask(() => trigger?.focus()); }
  async function manage() {
    const url = status()?.management_url;
    if (!url) return;
    const result = await window.redevenDesktopShell?.openExternalURL?.(url);
    if (!result?.ok) setError(props.i18n.t('gatewayCloud.unavailable'));
  }
  return <>
    <Button ref={trigger} size="sm" variant="outline" class="cursor-pointer" disabled={props.disabled} onClick={() => { setOpen(true); void load(); }}>{props.i18n.t('gatewayCloud.title')}</Button>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayCloud.title')}
      bodyDescription={props.i18n.t('gatewayCloud.description')} closeLabel={props.i18n.t('common.close')}>
      <div class="space-y-4 p-4">
        <p class="font-medium">{props.gatewayName}</p>
        <Show when={status()}>{value => <p role="status" class="text-sm text-muted-foreground">{props.i18n.t(`gatewayCloud.${value().state}`)}<Show when={value().namespace_public_id}><span class="ml-2 font-mono text-xs">{value().namespace_public_id}</span></Show></p>}</Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        <Show when={!status()?.configured}>
          <label class="block space-y-1 text-sm"><span>{props.i18n.t('gatewayCloud.cloudOrigin')}</span><Input value={cloud()} onInput={event => setCloud(event.currentTarget.value)} placeholder="https://cloud.example.com" disabled={busy()} /></label>
          <label class="block space-y-1 text-sm"><span>{props.i18n.t('gatewayCloud.gatewayURL')}</span><Input value={gatewayURL()} onInput={event => setGatewayURL(event.currentTarget.value)} placeholder="https://gateway.internal:7443" disabled={busy()} /></label>
          <label class="block space-y-1 text-sm"><span>{props.i18n.t('gatewayCloud.listenAddress')}</span><Input value={listen()} onInput={event => setListen(event.currentTarget.value)} disabled={busy()} /></label>
        </Show>
        <div class="flex flex-wrap justify-end gap-2">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t(busy() ? 'common.cancel' : 'common.close')}</Button>
          <Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => void load()}>{props.i18n.t('common.refresh')}</Button>
          <Show when={status()?.configured} fallback={<Button class="cursor-pointer" disabled={busy() || !cloud().trim() || !gatewayURL().trim()} onClick={() => void load(true)}>{props.i18n.t('gatewayCloud.configure')}</Button>}>
            <Button class="cursor-pointer" disabled={busy()} onClick={() => void manage()}>{props.i18n.t('gatewayCloud.manage')}</Button>
          </Show>
        </div>
        <Show when={busy()}><p role="status" aria-live="polite" class="text-sm text-muted-foreground">{props.i18n.t('gatewayCloud.working')}</p></Show>
      </div>
    </Dialog>
  </>;
}
