import { KeyedFor, Button, Input, Dialog } from '@floegence/floe-webapp-core/ui';
import { Copy, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from 'solid-js';
import { gatewayConnectionOrigin } from '../shared/gatewayNetworkSettings';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewayAuthorizedClient, GatewayClientAccessCode, GatewayEndpoint } from '../shared/gatewayMembership';
import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

export function GatewayClientsPanel(props: Readonly<{ available?: boolean; suspended?: boolean; onPresenceChange?: (present: boolean) => void; gatewayID: string; endpoints?: readonly GatewayEndpoint[]; enrolling: boolean; onEnrollmentChange: (value: boolean) => void; i18n: DesktopI18n }>) {
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
  const [revoking, setRevoking] = createSignal('');
  const [copied, setCopied] = createSignal<'code' | 'address' | 'all'>();
  const currentGatewayID = createMemo(() => props.gatewayID);
  let generation = 0;
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => { generation++; clearInterval(timer); });
  async function perform(request: DesktopLauncherActionRequest) {
    if (busy() || props.available === false) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction(request);
      if (current !== generation) return;
      if (!result?.ok) throw new Error();
      if (result.gateway_clients) setClients(result.gateway_clients);
      if (result.gateway_access_code) { setNow(Date.now()); setCode(result.gateway_access_code); setCopied(undefined); }
      setRevoking('');
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  createEffect(() => {
    const gatewayID = currentGatewayID();
    generation++; setBusy(false); setClients([]); setCode(undefined); setRevoking(''); setAddress(untrack(() => props.endpoints?.[0]?.address ?? ''));
    untrack(() => void perform({ kind: 'list_gateway_clients', gateway_id: gatewayID }));
  });
  createEffect(on(() => props.available, value => {
    if (value !== false) return;
    generation++; setBusy(false); setCode(undefined); setRevoking('');
    setError(props.i18n.t('interactionContinuity.unavailable'));
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
  return <div class="redeven-gateway-clients-panel">
    <div class="redeven-gateway-section-heading"><h3>{props.i18n.t('gatewayExperience.clients')}</h3><Button ref={enrollmentTrigger} size="sm" icon={Plus} disabled={props.available === false} onClick={() => setEnrollment(true)}>{props.i18n.t('gatewayExperience.connectClient')}</Button></div>
    <Dialog open={enrolling() && !props.suspended} onOpenChange={setEnrollment} onPresenceChange={props.onPresenceChange} title={props.i18n.t('gatewayExperience.connectClient')} closeLabel={props.i18n.t('common.close')} class="redeven-gateway-dialog redeven-gateway-task-dialog"><section class="redeven-gateway-client-access" data-gateway-client-enrollment>
      <div class="redeven-gateway-section-heading">
        <div><h3>{props.i18n.t('gatewayClients.createCode')}</h3></div>
        <Button size="sm" icon={Plus} disabled={props.available === false || busy() || !validAddress()} onClick={() => void perform({ kind: 'issue_gateway_access_code', gateway_id: props.gatewayID })}>{props.i18n.t('gatewayClients.createCode')}</Button>
      </div>
      <label class="redeven-gateway-field"><span>{props.i18n.t('gatewayJoin.address')}</span><Input ref={addressInput} value={address()} placeholder={props.i18n.t('gatewayNetwork.addressPlaceholder')} aria-invalid={address() !== '' && !validAddress() || undefined} disabled={props.available === false || busy()} onInput={event => { setAddress(event.currentTarget.value); setCopied(undefined); }} /></label>
      <details class="redeven-gateway-disclosure text-xs text-muted-foreground"><summary class="cursor-pointer">{props.i18n.t('gatewayClients.codeHelpTitle')}</summary><p class="pt-2 leading-relaxed">{props.i18n.t('gatewayClients.codeHelp')}</p></details>
      <Show when={code()}>{value => <div class="redeven-gateway-content-enter redeven-gateway-access-code">
        <code>{value().access_code}</code>
          <Button variant="outline" size="sm" icon={Copy} disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('code')}>{props.i18n.t(copied() === 'code' ? 'environmentCenter.copied' : 'common.copy')}</Button>
        <Button variant="outline" size="sm" disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('address')}>{props.i18n.t(copied() === 'address' ? 'gatewayJoin.copied' : 'gatewayJoin.copyAddress')}</Button>
        <Button variant="outline" size="sm" disabled={!remaining() || !validAddress() || props.available === false} onClick={() => void copyCode('all')}>{props.i18n.t(copied() === 'all' ? 'gatewayJoin.copied' : 'gatewayExperience.copyConnection')}</Button>
        <p class="basis-full text-xs text-muted-foreground" role="status">{remaining() ? props.i18n.t('gatewayClients.codeExpires', { time: `${Math.floor(remaining() / 60)}:${String(remaining() % 60).padStart(2, '0')}` }) : props.i18n.t('gatewayClients.codeExpired')}</p>
      </div>}</Show>
    </section><Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show></Dialog>
    <section class="redeven-gateway-settings-section">
      <div class="redeven-gateway-section-heading"><div><h3>{props.i18n.t('gatewayClients.authorizedClients')}</h3></div>
        <Button variant="ghost" size="sm" disabled={props.available === false || busy()} onClick={() => void perform({ kind: 'list_gateway_clients', gateway_id: props.gatewayID })}>{props.i18n.t('common.refresh')}</Button></div>
      <Show when={clients().length} fallback={<p class="redeven-gateway-empty-state">{props.i18n.t('gatewayClients.emptyClients')}</p>}>
        <ul class="redeven-gateway-authorized-client-list"><KeyedFor each={clients()} by={client => client.client_key_id}>{client => <li class="redeven-gateway-content-enter redeven-gateway-authorized-client-row">
          <div class="flex flex-wrap items-center justify-between gap-3"><strong class="text-sm font-semibold">{client().client_name || props.i18n.t('gatewayClients.unnamedClient')}</strong>
            <Show when={!client().revoked_at_unix_ms} fallback={<span class="text-xs text-muted-foreground">{props.i18n.t('gatewayClients.revoked')}</span>}>
              <Button variant="outline" size="xs" icon={Trash} disabled={props.available === false || busy()} onClick={() => {
                if (revoking() !== client().client_key_id) { setRevoking(client().client_key_id); return; }
                void perform({ kind: 'revoke_gateway_client', gateway_id: props.gatewayID, client_key_id: client().client_key_id });
              }}>{props.i18n.t(revoking() === client().client_key_id ? 'gatewayClients.confirmRevoke' : 'gatewayClients.revoke')}</Button>
            </Show>
          </div>
          <dl class="redeven-gateway-client-metadata"><div><dt>{props.i18n.t('gatewayClients.authorizedAt')}</dt><dd>{new Date(client().paired_at_unix_ms).toLocaleString(props.i18n.locale)}</dd></div><div><dt>{props.i18n.t('gatewayClients.lastSeen')}</dt><dd>{client().last_verified_at_unix_ms ? new Date(client().last_verified_at_unix_ms).toLocaleString(props.i18n.locale) : '—'}</dd></div></dl>
          <Show when={revoking() === client().client_key_id}><div class="redeven-gateway-content-enter space-y-2"><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayClients.revokeHelp')}</p><Button variant="ghost" size="xs" onClick={() => setRevoking('')}>{props.i18n.t('common.cancel')}</Button></div></Show>
        </li>}</KeyedFor></ul>
      </Show>
    </section>
    <Show when={error() && !enrolling()}><p role="alert" class="redeven-gateway-content-enter text-sm text-error">{error()}</p></Show>
  </div>;
}
