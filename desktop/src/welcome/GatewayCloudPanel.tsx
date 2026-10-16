import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createSignal, createEffect, createMemo, on, onCleanup, Show } from 'solid-js';
import { normalizeGatewayCloudConfiguration, type GatewayCloudSummary } from '../shared/gatewayCloud';
import type { DesktopI18n } from '../shared/i18n/desktopI18n';

export function GatewayCloudPanel(props: Readonly<{ gatewayID: string; gatewayName: string; i18n: DesktopI18n; disabled?: boolean; showTrigger?: boolean; available?: boolean; onOpenChange?: (open: boolean) => void }>) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<GatewayCloudSummary>();
  const [error, setError] = createSignal('');
  const [invalidated, setInvalidated] = createSignal(false);
  const [sessionGateway, setSessionGateway] = createSignal(props.gatewayID);
  const [sessionName, setSessionName] = createSignal(props.gatewayName);
  const gatewayID = createMemo(() => props.gatewayID);
  const available = createMemo(() => props.available !== false);
  const unavailable = () => props.available === false || invalidated();
  const needsAuthorization = () => ['revoked', 'retired', 'expired'].includes(status()?.state ?? '');
  const needsConfiguration = () => !status()?.configured || needsAuthorization() || status()?.state === 'registering';
  let generation = 0;
  let trigger: HTMLButtonElement | undefined;
  function cancel() {
    generation++;
    if (busy()) void window.redevenDesktopLauncher?.performAction({ kind: 'cancel_launcher_operation', operation_key: `${sessionGateway()}:cloud` });
    setBusy(false);
  }
  onCleanup(cancel);
  createEffect(on(open, value => props.onOpenChange?.(value)));
  // IMPORTANT: Observations revoke authority without resetting the open Cloud session.
  createEffect(on([gatewayID, available], () => {
    generation++; setBusy(false);
    if (open()) setInvalidated(true);
  }, { defer: true }));
  function begin() {
    generation++; setSessionGateway(props.gatewayID); setSessionName(props.gatewayName);
    setInvalidated(false); setError(''); setStatus(undefined); setOpen(true); void load();
  }
  function revalidate() {
    if (props.available === false || busy()) return;
    generation++; setSessionGateway(props.gatewayID); setSessionName(props.gatewayName);
    setInvalidated(false); void load();
  }
  async function load(configure = false) {
    const bridge = window.redevenDesktopLauncher;
    if (!bridge || busy() || unavailable()) return;
    const configuration = normalizeGatewayCloudConfiguration({ ...(needsAuthorization() ? { reauthorize: true } : {}) });
    if (configure && !configuration) { setError(props.i18n.t('gatewayCloud.invalid')); return; }
    const current = ++generation;
    setBusy(true);
    setError('');
    try {
      const result = await bridge.performAction(configure
        ? { kind: 'configure_gateway_cloud', gateway_id: sessionGateway(), configuration: configuration! }
        : { kind: 'inspect_gateway_cloud', gateway_id: sessionGateway() });
      if (current !== generation) return;
      if (!result.ok || !result.gateway_cloud) { setError(props.i18n.t('gatewayCloud.unavailable')); return; }
      setStatus(result.gateway_cloud);
      if (configure && result.gateway_cloud.management_url) await openManagementURL(result.gateway_cloud.management_url, current);
    } catch { if (current === generation) setError(props.i18n.t('gatewayCloud.unavailable')); }
    finally { if (current === generation) setBusy(false); }
  }
  function close() { cancel(); setOpen(false); const owner = generation; queueMicrotask(() => { if (owner === generation && !open()) trigger?.focus(); }); }
  async function openManagementURL(url: string, owner = generation) {
    if (!url || unavailable() || !open()) return;
    const result = await window.redevenDesktopShell?.openExternalURL?.(url);
    if (owner === generation && open() && !result?.ok) setError(props.i18n.t('gatewayCloud.unavailable'));
  }
  async function manage() {
    const url = status()?.management_url;
    if (url) await openManagementURL(url);
  }
  return <>
    <Show when={props.showTrigger !== false}><Button ref={trigger} size="sm" variant="outline" class="cursor-pointer" disabled={props.disabled} onClick={begin}>{props.i18n.t('gatewayCloud.title')}</Button></Show>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayCloud.title')}
      bodyDescription={props.i18n.t('gatewayCloud.description')} closeLabel={props.i18n.t('common.close')}
      class="redeven-gateway-dialog redeven-gateway-cloud-dialog" contentClass="redeven-gateway-dialog__content">
      <div class="redeven-gateway-cloud-layout"><Show when={unavailable()}><p role="alert">{props.i18n.t('interactionContinuity.unavailable')}</p><Button variant="outline" disabled={props.available === false || busy()} onClick={revalidate}>{props.i18n.t('interactionContinuity.revalidate')}</Button></Show>
        <div class="redeven-gateway-cloud-state">
          <p class="redeven-gateway-cloud-state__name">{sessionName()}</p>
          <Show when={status()}>{value => <div role="status" class="redeven-gateway-cloud-state__status"><span>{props.i18n.t(`gatewayCloud.${value().state}`)}</span></div>}</Show>
          <Show when={needsConfiguration()}><p class="redeven-gateway-help">{props.i18n.t('gatewayCloud.nextStep')}</p></Show>
        </div>
        <Show when={error()}><p role="alert" class="redeven-gateway-content-enter rounded-md bg-destructive/10 px-3 py-2 text-sm text-error">{error()}</p></Show>
        <Show when={busy()}><p role="status" aria-live="polite" class="text-sm text-muted-foreground">{props.i18n.t('gatewayCloud.working')}</p></Show>
        <div class="redeven-gateway-dialog-actions">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t(busy() ? 'common.cancel' : 'common.close')}</Button>
          <Button class="cursor-pointer" variant="outline" disabled={busy() || unavailable()} onClick={() => void load()}>{props.i18n.t('common.refresh')}</Button>
          <Show when={!needsConfiguration()} fallback={<Button class="cursor-pointer" disabled={busy() || unavailable()} onClick={() => void load(true)}>{props.i18n.t('gatewayCloud.configure')}</Button>}>
            <Button class="cursor-pointer" disabled={busy() || unavailable()} onClick={() => void manage()}>{props.i18n.t('gatewayCloud.manage')}</Button>
          </Show>
        </div>
      </div>
    </Dialog>
  </>;
}
