import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { normalizeGatewayCloudConfiguration, type GatewayCloudSummary } from '../shared/gatewayCloud';
import type { DesktopI18n } from '../shared/i18n/desktopI18n';

export function GatewayCloudPanel(props: Readonly<{ gatewayID: string; gatewayName: string; i18n: DesktopI18n; disabled?: boolean }>) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<GatewayCloudSummary>();
  const [error, setError] = createSignal('');
  const needsAuthorization = () => ['revoked', 'retired', 'expired'].includes(status()?.state ?? '');
  const needsConfiguration = () => !status()?.configured || needsAuthorization() || status()?.state === 'registering';
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
    const configuration = normalizeGatewayCloudConfiguration({ ...(needsAuthorization() ? { reauthorize: true } : {}) });
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
      if (configure && result.gateway_cloud.management_url) await openManagementURL(result.gateway_cloud.management_url);
    } catch { if (current === generation) setError(props.i18n.t('gatewayCloud.unavailable')); }
    finally { if (current === generation) setBusy(false); }
  }
  function close() { cancel(); setOpen(false); queueMicrotask(() => trigger?.focus()); }
  async function openManagementURL(url: string) {
    if (!url) return;
    const result = await window.redevenDesktopShell?.openExternalURL?.(url);
    if (!result?.ok) setError(props.i18n.t('gatewayCloud.unavailable'));
  }
  async function manage() {
    const url = status()?.management_url;
    if (url) await openManagementURL(url);
  }
  return <>
    <Button ref={trigger} size="sm" variant="outline" class="cursor-pointer" disabled={props.disabled} onClick={() => { setOpen(true); void load(); }}>{props.i18n.t('gatewayCloud.title')}</Button>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayCloud.title')}
      bodyDescription={props.i18n.t('gatewayCloud.description')} closeLabel={props.i18n.t('common.close')}
      class="redeven-gateway-dialog redeven-gateway-cloud-dialog" contentClass="redeven-gateway-dialog__content">
      <div class="redeven-gateway-cloud-layout">
        <div class="redeven-gateway-cloud-state">
          <p class="redeven-gateway-cloud-state__name">{props.gatewayName}</p>
          <Show when={status()}>{value => <div role="status" class="redeven-gateway-cloud-state__status"><span>{props.i18n.t(`gatewayCloud.${value().state}`)}</span><Show when={value().namespace_public_id}><code>{value().namespace_public_id}</code></Show></div>}</Show>
          <Show when={needsConfiguration()}><p class="redeven-gateway-help">{props.i18n.t('gatewayCloud.nextStep')}</p></Show>
        </div>
        <Show when={error()}><p role="alert" class="redeven-gateway-content-enter rounded-md bg-destructive/10 px-3 py-2 text-sm text-error">{error()}</p></Show>
        <Show when={busy()}><p role="status" aria-live="polite" class="text-sm text-muted-foreground">{props.i18n.t('gatewayCloud.working')}</p></Show>
        <div class="redeven-gateway-dialog-actions">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t(busy() ? 'common.cancel' : 'common.close')}</Button>
          <Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => void load()}>{props.i18n.t('common.refresh')}</Button>
          <Show when={!needsConfiguration()} fallback={<Button class="cursor-pointer" disabled={busy()} onClick={() => void load(true)}>{props.i18n.t('gatewayCloud.configure')}</Button>}>
            <Button class="cursor-pointer" disabled={busy()} onClick={() => void manage()}>{props.i18n.t('gatewayCloud.manage')}</Button>
          </Show>
        </div>
      </div>
    </Dialog>
  </>;
}
