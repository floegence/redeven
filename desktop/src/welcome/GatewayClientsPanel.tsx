import { Button } from '@floegence/floe-webapp-core/ui';
import { Copy, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import type { DesktopI18n } from '../shared/i18n';
import type { GatewayAuthorizedClient, GatewayClientAccessCode } from '../shared/gatewayMembership';
import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

export function GatewayClientsPanel(props: Readonly<{ gatewayID: string; i18n: DesktopI18n }>) {
  const [clients, setClients] = createSignal<readonly GatewayAuthorizedClient[]>([]);
  const [code, setCode] = createSignal<GatewayClientAccessCode>();
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [revoking, setRevoking] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const currentGatewayID = createMemo(() => props.gatewayID);
  let generation = 0;
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => { generation++; clearInterval(timer); });
  async function perform(request: DesktopLauncherActionRequest) {
    if (busy()) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction(request);
      if (current !== generation) return;
      if (!result?.ok) throw new Error();
      if (result.gateway_clients) setClients(result.gateway_clients);
      if (result.gateway_access_code) { setNow(Date.now()); setCode(result.gateway_access_code); setCopied(false); }
      setRevoking('');
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  createEffect(() => {
    const gatewayID = currentGatewayID();
    generation++; setBusy(false); setClients([]); setCode(undefined); setRevoking('');
    untrack(() => void perform({ kind: 'list_gateway_clients', gateway_id: gatewayID }));
  });
  const remaining = () => Math.max(0, Math.ceil(((code()?.expires_at_unix_ms ?? 0) - now()) / 1000));
  async function copyCode() {
    const current = generation;
    try {
      await navigator.clipboard.writeText(code()?.access_code ?? '');
      if (current === generation) setCopied(true);
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
  }
  return <div class="redeven-gateway-clients-panel">
    <section class="redeven-gateway-client-access">
      <div class="redeven-gateway-section-heading">
        <div><h3>{props.i18n.t('gatewayClients.clientAccess')}</h3></div>
        <Button size="sm" icon={Plus} disabled={busy()} onClick={() => void perform({ kind: 'issue_gateway_access_code', gateway_id: props.gatewayID })}>{props.i18n.t('gatewayClients.createCode')}</Button>
      </div>
      <details class="redeven-gateway-disclosure text-xs text-muted-foreground"><summary class="cursor-pointer">{props.i18n.t('gatewayClients.codeHelpTitle')}</summary><p class="pt-2 leading-relaxed">{props.i18n.t('gatewayClients.codeHelp')}</p></details>
      <Show when={code()}>{value => <div class="redeven-gateway-content-enter redeven-gateway-access-code">
        <code>{value().access_code}</code>
          <Button variant="outline" size="sm" icon={Copy} disabled={!remaining()} onClick={() => void copyCode()}>{props.i18n.t(copied() ? 'environmentCenter.copied' : 'common.copy')}</Button>
        <p class="basis-full text-xs text-muted-foreground" role="status">{remaining() ? props.i18n.t('gatewayClients.codeExpires', { time: `${Math.floor(remaining() / 60)}:${String(remaining() % 60).padStart(2, '0')}` }) : props.i18n.t('gatewayClients.codeExpired')}</p>
      </div>}</Show>
    </section>
    <section class="redeven-gateway-settings-section">
      <div class="redeven-gateway-section-heading"><div><h3>{props.i18n.t('gatewayClients.authorizedClients')}</h3></div>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void perform({ kind: 'list_gateway_clients', gateway_id: props.gatewayID })}>{props.i18n.t('common.refresh')}</Button></div>
      <Show when={clients().length} fallback={<p class="redeven-gateway-empty-state">{props.i18n.t('gatewayClients.emptyClients')}</p>}>
        <ul class="redeven-gateway-authorized-client-list"><For each={clients()}>{client => <li class="redeven-gateway-content-enter redeven-gateway-authorized-client-row">
          <div class="flex flex-wrap items-center justify-between gap-3"><strong class="text-sm font-semibold">{client.client_name || props.i18n.t('gatewayClients.unnamedClient')}</strong>
            <Show when={!client.revoked_at_unix_ms} fallback={<span class="text-xs text-muted-foreground">{props.i18n.t('gatewayClients.revoked')}</span>}>
              <Button variant="outline" size="xs" icon={Trash} disabled={busy()} onClick={() => {
                if (revoking() !== client.client_key_id) { setRevoking(client.client_key_id); return; }
                void perform({ kind: 'revoke_gateway_client', gateway_id: props.gatewayID, client_key_id: client.client_key_id });
              }}>{props.i18n.t(revoking() === client.client_key_id ? 'gatewayClients.confirmRevoke' : 'gatewayClients.revoke')}</Button>
            </Show>
          </div>
          <dl class="redeven-gateway-client-metadata"><div><dt>{props.i18n.t('gatewayClients.authorizedAt')}</dt><dd>{new Date(client.paired_at_unix_ms).toLocaleString(props.i18n.locale)}</dd></div><div><dt>{props.i18n.t('gatewayClients.lastSeen')}</dt><dd>{client.last_verified_at_unix_ms ? new Date(client.last_verified_at_unix_ms).toLocaleString(props.i18n.locale) : '—'}</dd></div></dl>
          <Show when={revoking() === client.client_key_id}><div class="redeven-gateway-content-enter space-y-2"><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayClients.revokeHelp')}</p><Button variant="ghost" size="xs" onClick={() => setRevoking('')}>{props.i18n.t('common.cancel')}</Button></div></Show>
        </li>}</For></ul>
      </Show>
    </section>
    <Show when={error()}><p role="alert" class="redeven-gateway-content-enter text-sm text-error">{error()}</p></Show>
  </div>;
}
