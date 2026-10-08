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
  return <div class="space-y-5">
    <section class="space-y-3 rounded-xl border border-border bg-muted/15 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-semibold">{props.i18n.t('gatewayClients.clientAccess')}</h3>
        <Button size="sm" icon={Plus} disabled={busy()} onClick={() => void perform({ kind: 'issue_gateway_access_code', gateway_id: props.gatewayID })}>{props.i18n.t('gatewayClients.createCode')}</Button>
      </div>
      <details class="redeven-gateway-disclosure text-xs text-muted-foreground"><summary class="cursor-pointer">{props.i18n.t('gatewayClients.codeHelpTitle')}</summary><p class="pt-2 leading-relaxed">{props.i18n.t('gatewayClients.codeHelp')}</p></details>
      <Show when={code()}>{value => <div class="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <code class="break-all text-base font-semibold tracking-wide">{value().access_code}</code>
          <Button variant="outline" size="sm" icon={Copy} disabled={!remaining()} onClick={() => void copyCode()}>{props.i18n.t(copied() ? 'environmentCenter.copied' : 'common.copy')}</Button>
        </div>
        <p role="status" class="text-xs text-muted-foreground">{remaining() ? props.i18n.t('gatewayClients.codeExpires', { time: `${Math.floor(remaining() / 60)}:${String(remaining() % 60).padStart(2, '0')}` }) : props.i18n.t('gatewayClients.codeExpired')}</p>
      </div>}</Show>
    </section>
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold">{props.i18n.t('gatewayClients.authorizedClients')}</h3>
        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => void perform({ kind: 'list_gateway_clients', gateway_id: props.gatewayID })}>{props.i18n.t('common.refresh')}</Button></div>
      <Show when={clients().length} fallback={<p class="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{props.i18n.t('gatewayClients.emptyClients')}</p>}>
        <ul class="space-y-2"><For each={clients()}>{client => <li class="space-y-3 rounded-lg border border-border p-3">
          <div class="flex flex-wrap items-center justify-between gap-3"><strong class="text-sm">{client.client_name || props.i18n.t('gatewayClients.unnamedClient')}</strong>
            <Show when={!client.revoked_at_unix_ms} fallback={<span class="text-xs text-muted-foreground">{props.i18n.t('gatewayClients.revoked')}</span>}>
              <Button variant="outline" size="xs" icon={Trash} disabled={busy()} onClick={() => {
                if (revoking() !== client.client_key_id) { setRevoking(client.client_key_id); return; }
                void perform({ kind: 'revoke_gateway_client', gateway_id: props.gatewayID, client_key_id: client.client_key_id });
              }}>{props.i18n.t(revoking() === client.client_key_id ? 'gatewayClients.confirmRevoke' : 'gatewayClients.revoke')}</Button>
            </Show>
          </div>
          <dl class="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><div><dt>{props.i18n.t('gatewayClients.authorizedAt')}</dt><dd>{new Date(client.paired_at_unix_ms).toLocaleString(props.i18n.locale)}</dd></div><div><dt>{props.i18n.t('gatewayClients.lastSeen')}</dt><dd>{client.last_verified_at_unix_ms ? new Date(client.last_verified_at_unix_ms).toLocaleString(props.i18n.locale) : '—'}</dd></div></dl>
          <Show when={revoking() === client.client_key_id}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayClients.revokeHelp')}</p><Button variant="ghost" size="xs" onClick={() => setRevoking('')}>{props.i18n.t('common.cancel')}</Button></Show>
        </li>}</For></ul>
      </Show>
    </section>
    <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
  </div>;
}
