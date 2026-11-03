import { KeyedFor, Button, Input, Dialog } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, Copy, Monitor, Plus, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from 'solid-js';
import { gatewayConnectionOrigin } from '../shared/gatewayNetworkSettings';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewayAuthorizedClient, GatewayClientAccessCode, GatewayEndpoint } from '../shared/gatewayMembership';
import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

function ClientTimestamp(props: Readonly<{ value?: number; locale: string }>) {
  const date = () => new Date(props.value ?? 0);
  return <Show when={props.value !== undefined} fallback="—"><time class="redeven-gateway-client-timestamp" dateTime={date().toISOString()} title={date().toLocaleString(props.locale)}>
    <span>{date().toLocaleDateString(props.locale, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    <span>{date().toLocaleTimeString(props.locale, { hour: 'numeric', minute: '2-digit' })}</span>
  </time></Show>;
}

export function GatewayClientsPanel(props: Readonly<{ available?: boolean; showAvailabilityNotice?: boolean; suspended?: boolean; onPresenceChange?: (present: boolean) => void; connectionID: string; currentClientKeyID?: string; endpoints?: readonly GatewayEndpoint[]; enrolling: boolean; onEnrollmentChange: (value: boolean) => void; i18n: DesktopI18n }>) {
  const enrolling = () => props.enrolling;
  let enrollmentTrigger: HTMLButtonElement | undefined, addressInput: HTMLInputElement | undefined;
  const setEnrollment = (value: boolean) => {
    props.onEnrollmentChange(value);
    queueMicrotask(() => (value ? addressInput : enrollmentTrigger)?.focus());
  };
  const [address, setAddress] = createSignal('');
  const validAddress = () => gatewayConnectionOrigin(address());
  const [clients, setClients] = createSignal<readonly GatewayAuthorizedClient[]>([]);
  const [code, setCode] = createSignal<GatewayClientAccessCode>();
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [uncertainOperation, setUncertainOperation] = createSignal('');
  const [revoking, setRevoking] = createSignal('');
  const [copied, setCopied] = createSignal<'code' | 'address' | 'all'>();
  const currentConnectionID = createMemo(() => props.connectionID);
  const mutationBlocked = () => props.available === false || busy() || !!uncertainOperation();
  let generation = 0;
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => { generation++; clearInterval(timer); });
  async function acknowledgeOperation() {
    const id = uncertainOperation(), connectionID = props.connectionID;
    if (!id || !connectionID || busy() || props.available === false) return;
    const owner = generation; setBusy(true);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'acknowledge_gateway_operation', connection_id: connectionID, operation_id: id });
      if (owner !== generation) return;
      if (result?.ok) { setUncertainOperation(''); setRevoking(''); setError(''); }
      else setError(props.i18n.t('gatewayMembers.failed'));
    } catch { if (owner === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (owner === generation) setBusy(false); }
  }
  async function perform(request: DesktopLauncherActionRequest) {
    if (busy() || props.available === false || (uncertainOperation() && request.kind !== 'list_gateway_clients')) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction(request);
      if (current !== generation) return;
      if (!result?.ok) {
        if (result?.gateway_error_code === 'OPERATION_RESULT_UNKNOWN') { setUncertainOperation(result.gateway_operation_id ?? ''); return; }
        throw new Error();
      }
      if (request.kind === 'pair_gateway') {
        const refreshed = await window.redevenDesktopLauncher?.performAction({kind:'list_gateway_clients',connection_id:props.connectionID});
        if (current !== generation) return;
        if (!refreshed?.ok || !refreshed.gateway_clients) {setError(props.i18n.t('gatewayMembers.refreshFailed'));return;}
        setClients(refreshed.gateway_clients);
      }
      if (result.gateway_clients) setClients(result.gateway_clients);
      if (result.gateway_access_code) { setNow(Date.now()); setCode(result.gateway_access_code); setCopied(undefined); }
      setRevoking('');
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  createEffect(() => {
    const connectionID = currentConnectionID();
    generation++; setUncertainOperation(''); setBusy(false); setClients([]); setCode(undefined); setRevoking(''); setAddress(untrack(() => props.endpoints?.[0]?.address ?? ''));
    untrack(() => void perform({ kind: 'list_gateway_clients', connection_id: connectionID }));
  });
  createEffect(on(() => props.available, value => {
    if (value !== false) { untrack(() => void perform({ kind: 'list_gateway_clients', connection_id: props.connectionID })); return; }
    generation++; setBusy(false); setCode(undefined); setRevoking('');
    setError('');
  }, { defer: true }));
  const remaining = () => Math.max(0, Math.ceil(((code()?.expires_at_unix_ms ?? 0) - now()) / 1000));
  async function copyCode(kind: 'code' | 'address' | 'all' = 'code') {
    if (!remaining() || props.available === false || !validAddress()) return;
    const current = generation;
    try {
      await navigator.clipboard.writeText(kind === 'address' ? validAddress()! : kind === 'all'
        ? props.i18n.t('gatewayExperience.clientDelivery', { address: validAddress()!, code: code()?.access_code ?? '' }) : code()?.access_code ?? '');
      if (current === generation) setCopied(kind);
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
  }
  const feedback = () => <>
    <Show when={uncertainOperation()}>{id => <div class="space-y-2"><p role="alert" class="text-sm text-warning">{props.i18n.t('gatewayMembers.operationUnknown', { id: id() })}</p><Button variant="outline" size="sm" disabled={busy() || props.available === false} onClick={() => void acknowledgeOperation()}>{props.i18n.t('gatewayMembers.operationReviewed')}</Button></div>}</Show>
    <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
  </>;
  return <div class="redeven-gateway-clients-panel">
    <div class="redeven-gateway-section-heading"><h3>{props.i18n.t('gatewayExperience.clients')}<span class="redeven-gateway-count">{clients().length}</span></h3><div class="redeven-gateway-toolbar-actions"><Button variant="ghost" size="icon" icon={Refresh} aria-label={props.i18n.t('common.refresh')} title={props.i18n.t('common.refresh')} disabled={props.available === false || busy()} onClick={() => void perform({ kind: 'list_gateway_clients', connection_id: props.connectionID })} /><Button ref={enrollmentTrigger} size="sm" icon={Monitor} disabled={props.available === false} onClick={() => setEnrollment(true)}>{props.i18n.t('gatewayExperience.connectClient')}</Button></div></div>
    <Dialog open={enrolling() && !props.suspended} onOpenChange={setEnrollment} onPresenceChange={props.onPresenceChange} title={props.i18n.t('gatewayExperience.connectClient')} closeLabel={props.i18n.t('common.close')} class="redeven-gateway-dialog redeven-gateway-task-dialog"><section class="redeven-gateway-client-access" data-gateway-client-enrollment>
      <div class="flex justify-end">
        <Button size="sm" icon={Plus} disabled={mutationBlocked() || !validAddress()} onClick={() => void perform({ kind: 'issue_gateway_access_code', connection_id: props.connectionID })}>{props.i18n.t('gatewayClients.createCode')}</Button>
      </div>
      <label class="redeven-gateway-field"><span>{props.i18n.t('gatewayJoin.address')}</span><Input ref={addressInput} value={address()} placeholder={props.i18n.t('gatewayNetwork.addressPlaceholder')} aria-invalid={address() !== '' && !validAddress() || undefined} disabled={props.available === false || busy()} onInput={event => { setAddress(event.currentTarget.value); setCopied(undefined); }} /></label>
      <details class="redeven-gateway-disclosure text-xs text-muted-foreground"><summary class="cursor-pointer">{props.i18n.t('gatewayClients.codeHelpTitle')}</summary><p class="pt-2 leading-relaxed">{props.i18n.t('gatewayClients.codeHelp')}</p></details>
      <Show when={code()}>{value => <div class="redeven-gateway-content-enter redeven-gateway-access-code">
        <code class="block min-w-0 max-w-full truncate select-all" title={props.i18n.t('gatewayClients.createCode')}>{value().access_code}</code>
          <Button variant="outline" size="sm" icon={Copy} disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('code')}>{props.i18n.t(copied() === 'code' ? 'environmentCenter.copied' : 'common.copy')}</Button>
        <Button variant="outline" size="sm" disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('address')}>{props.i18n.t(copied() === 'address' ? 'gatewayJoin.copied' : 'gatewayJoin.copyAddress')}</Button>
        <Button variant="outline" size="sm" disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('all')}>{props.i18n.t(copied() === 'all' ? 'gatewayJoin.copied' : 'gatewayExperience.copyConnection')}</Button>
        <p class="basis-full text-xs text-muted-foreground" role="status">{remaining() ? props.i18n.t('gatewayClients.codeExpires', { time: `${Math.floor(remaining() / 60)}:${String(remaining() % 60).padStart(2, '0')}` }) : props.i18n.t('gatewayClients.codeExpired')}</p>
      </div>}</Show>
    </section>{feedback()}
      <Show when={props.available === false}><p role="alert" class="redeven-gateway-access-notice"><AlertTriangle aria-hidden="true" />{props.i18n.t('gatewayWorkspace.accessChanged')}</p></Show>
    </Dialog>
    <section class="redeven-gateway-settings-section">
      <Show when={clients().length} fallback={<div class="redeven-gateway-quiet-empty"><Monitor aria-hidden="true" /><span>{props.i18n.t('gatewayWorkspace.emptyClients')}</span></div>}>
        <ul class="redeven-gateway-authorized-client-list"><KeyedFor each={clients()} by={client => client.client_key_id}>{client => <li class="redeven-gateway-content-enter redeven-gateway-authorized-client-row">
          <div class="redeven-gateway-client-identity"><Monitor aria-hidden="true" /><div><strong>{client().client_name || props.i18n.t('gatewayClients.unnamedClient')}</strong><Show when={client().client_key_id === props.currentClientKeyID}><span>{props.i18n.t('gatewayClients.currentDevice')}</span></Show></div></div>
          <dl class="redeven-gateway-client-metadata"><div><dt>{props.i18n.t('gatewayClients.authorizedAt')}</dt><dd><ClientTimestamp value={client().paired_at_unix_ms} locale={props.i18n.locale} /></dd></div><div><dt>{props.i18n.t('gatewayClients.lastSeen')}</dt><dd><ClientTimestamp value={client().last_verified_at_unix_ms || undefined} locale={props.i18n.locale} /></dd></div></dl>
          <div class="redeven-gateway-client-actions">
            <Show when={!client().revoked_at_unix_ms} fallback={<><span class="text-xs text-muted-foreground">{props.i18n.t('gatewayClients.revoked')}</span><Show when={client().client_key_id === props.currentClientKeyID}><Button size="sm" variant="outline" disabled={mutationBlocked()} onClick={() => void perform({kind:'pair_gateway',connection_id:props.connectionID})}>{props.i18n.t('gatewayClients.reauthorize')}</Button></Show></>}>
              <Button variant="outline" size="sm" icon={Trash} disabled={mutationBlocked()} onClick={() => {
                if (revoking() !== client().client_key_id) { setRevoking(client().client_key_id); return; }
                void perform({ kind: 'revoke_gateway_client', connection_id: props.connectionID, client_key_id: client().client_key_id });
              }}>{props.i18n.t(revoking() === client().client_key_id ? 'gatewayClients.confirmRevoke' : 'gatewayClients.revoke')}</Button>
            </Show>
          </div>

          <Show when={revoking() === client().client_key_id}><div class="redeven-gateway-client-confirmation redeven-gateway-content-enter space-y-2"><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayClients.revokeHelp')}</p><Button variant="ghost" size="sm" onClick={() => setRevoking('')}>{props.i18n.t('common.cancel')}</Button></div></Show>
        </li>}</KeyedFor></ul>
      </Show>
    </section>
    <Show when={props.available === false && props.showAvailabilityNotice !== false && !enrolling()}><p role="alert" class="redeven-gateway-access-notice"><AlertTriangle aria-hidden="true" />{props.i18n.t('gatewayWorkspace.accessChanged')}</p></Show>
    <Show when={!enrolling()}>{feedback()}</Show>
  </div>;
}
