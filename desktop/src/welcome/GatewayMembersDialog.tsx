import { Button, Checkbox, Input } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, Info, Plus, Trash, Download } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionSuccess } from '../shared/desktopLauncherIPC';
import type { GatewayCloudPermission, GatewayEndpoint, GatewayMemberInvitation, GatewayPolicy } from '../shared/gatewayMembership';
import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import type { DesktopI18n } from '../shared/i18n';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { DesktopTooltip } from './DesktopTooltip';

export function GatewayMembersPanel(props: Readonly<{
  gateway?: DesktopGatewaySource; i18n: DesktopI18n; targets: readonly DesktopProviderRuntimeLinkTarget[];
  section?: 'connection' | 'runtimes'; refresh: () => Promise<unknown>;
}>) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [invitation, setInvitation] = createSignal<GatewayMemberInvitation>();
  const [targetID, setTargetID] = createSignal('');
  const [draftPolicy, setDraftPolicy] = createSignal<GatewayPolicy>();
  const [overrides, setOverrides] = createSignal<Record<string, GatewayCloudPermission>>({});
  const [results, setResults] = createSignal<DesktopLauncherActionSuccess['gateway_member_results']>();
  const [removing, setRemoving] = createSignal('');
  const [savingPolicy, setSavingPolicy] = createSignal(false);
  const [endpointDraft, setEndpointDraft] = createSignal<GatewayEndpoint[]>([]);
  const [savedEndpoints, setSavedEndpoints] = createSignal<readonly GatewayEndpoint[]>([]);
  const [removingEndpointID, setRemovingEndpointID] = createSignal('');
  let generation = 0, gatewayID = '', removalTimer: number | undefined;
  createEffect(() => {
    const next = props.gateway?.gateway_id ?? '';
    if (next === gatewayID) return;
    if (removalTimer !== undefined) window.clearTimeout(removalTimer);
    removalTimer = undefined;
    gatewayID = next; generation++; setBusy(false); setError(''); setInvitation(undefined); setTargetID('');
    setDraftPolicy(undefined); setOverrides({}); setResults(undefined); setRemoving(''); setSavingPolicy(false); setRemovingEndpointID(''); setEndpointDraft([...(props.gateway?.member_endpoints ?? [])]);
    setSavedEndpoints(props.gateway?.member_endpoints ?? []);
  });
  onCleanup(() => { generation++; if (removalTimer !== undefined) window.clearTimeout(removalTimer); });
  const members = () => props.gateway?.environments.filter(member => member.state === 'active') ?? [];
  const policy = () => draftPolicy() ?? props.gateway?.policy;
  const targets = createMemo(() => [...new Map(props.targets.filter(target => target.runtime_running && target.runtime_control_status.state === 'available').map(target => [target.id, target])).values()]);
  const target = () => targets().find(value => value.id === targetID());
  const normalizedEndpoints = () => endpointDraft().map(endpoint => {
    try {
      const url = new URL(endpoint.address.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return { ...endpoint, address: endpoint.address.trim() };
      return { ...endpoint, address: url.origin };
    } catch {
      return { ...endpoint, address: endpoint.address.trim() };
    }
  });
  const endpointsDirty = () => JSON.stringify(normalizedEndpoints()) !== JSON.stringify(savedEndpoints());
  const endpointsValid = () => {
    const endpoints = normalizedEndpoints();
    if (endpoints.length === 0) return true;
    const ids = new Set<string>();
    const addresses = new Set<string>();
    return endpoints.every(endpoint => {
      let url: URL;
      try { url = new URL(endpoint.address); } catch { return false; }
      if (url.protocol !== 'https:' || url.origin !== endpoint.address || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
      if (ids.has(endpoint.endpoint_id) || addresses.has(endpoint.address)) return false;
      ids.add(endpoint.endpoint_id); addresses.add(endpoint.address);
      return Number.isSafeInteger(endpoint.priority) && endpoint.priority >= 0 && endpoint.priority <= 1000;
    });
  };
  const affected = () => members().filter(member => member.cloud_permission === 'inherit'
    && member.effective_cloud_allowed !== policy()?.default_cloud_allowed);
  async function perform(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionSuccess | undefined> {
    if (busy()) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction(request);
      if (current !== generation) return;
      if (!result?.ok) throw new Error();
      // A failed refresh cannot undo an accepted mutation or hide its delivery.
      try { await props.refresh(); }
      catch { if (current === generation) setError(props.i18n.t('gatewayMembers.refreshFailed')); }
      if (current === generation) return result;
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  async function invite() {
    if (!props.gateway || endpointsDirty() || !savedEndpoints().length) return;
    const result = await perform({ kind: 'invite_gateway_runtime', gateway_id: props.gateway.gateway_id });
    if (result?.gateway_invitation) setInvitation(result.gateway_invitation);
  }
  function download() {
    if (!invitation()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(invitation(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'redeven-gateway-invitation.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveMembers() {
    if (!props.gateway) return;
    const items = members().flatMap(member => overrides()[member.member_id] === undefined ? [] : [{ member_id: member.member_id,
      expected_member_version: member.member_version, cloud_permission: overrides()[member.member_id]! }]);
    const result = await perform({ kind: 'update_gateway_members', gateway_id: props.gateway.gateway_id, items });
    if (!result) return;
    setResults(result.gateway_member_results);
    setOverrides(current => Object.fromEntries(Object.entries(current).filter(([id]) => !result.gateway_member_results?.some(item => item.member_id === id && !item.error_code))));
  }
  async function savePolicy() {
    if (!props.gateway || !policy()) return;
    const result = await perform({ kind: 'update_gateway_policy', gateway_id: props.gateway.gateway_id, policy: policy()! });
    if (result) { setDraftPolicy(undefined); setSavingPolicy(false); }
  }
  async function saveEndpoints() {
    if (!props.gateway) return;
    if (removingEndpointID()) return;
    if (!endpointsValid()) { setError(props.i18n.t('gatewayMembers.invalidConnectionAddresses')); return; }
    const endpoints = normalizedEndpoints();
    const result = await perform({ kind: 'update_gateway_endpoints', gateway_id: props.gateway.gateway_id, endpoints });
    if (result) { setSavedEndpoints(endpoints); setEndpointDraft(endpoints); setInvitation(undefined); }
  }
  function removeEndpoint(endpointID: string) {
    if (removingEndpointID()) return;
    const finishRemoval = () => setEndpointDraft(current => current.filter(endpoint => endpoint.endpoint_id !== endpointID));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true) {
      finishRemoval();
      return;
    }
    setRemovingEndpointID(endpointID);
    removalTimer = window.setTimeout(() => {
      finishRemoval();
      setRemovingEndpointID(current => current === endpointID ? '' : current);
      removalTimer = undefined;
    }, 180);
  }
  return (
    <div class="space-y-5">
      <Show when={props.gateway?.rebuild_required}><div class="space-y-2 rounded-md border border-warning p-3 text-sm">
        <p>{props.i18n.t('gatewayMembers.rebuild')}</p>
        <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => props.gateway && void perform({ kind: 'dismiss_gateway_rebuild', gateway_id: props.gateway.gateway_id })}>{props.i18n.t('common.close')}</Button>
      </div></Show>
      <Show when={props.section === 'connection'}>
      <details class="redeven-gateway-disclosure group border-b border-border/60 pb-3">
        <summary class="flex cursor-pointer list-none items-center justify-between text-sm [&::-webkit-details-marker]:hidden"><span>{props.i18n.t('gatewayMembers.listenerAddress')}</span><ChevronDown class="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
        <div>
          <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.listenerAddressHelp')}</p>
        </div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3 bg-muted/20 px-3 py-2 text-xs">
          <span class="break-all font-mono text-foreground">{props.gateway?.listener_addresses?.join(', ') || props.gateway?.listener_address || '—'}</span>
          <span class="text-muted-foreground">{props.i18n.t(props.gateway?.listener_running ? 'gatewayMembers.listenerActive' : 'gatewayMembers.localOnly')}</span>
        </div>
      </details>
      <section class="space-y-3">
        <div>
          <h3 class="flex items-center gap-2 text-sm font-semibold">{props.i18n.t('gatewayMembers.connectionAddresses')}<DesktopTooltip content={props.i18n.t('gatewayMembers.connectionAddressesHelp')}><button type="button" class="cursor-pointer text-muted-foreground" aria-label={props.i18n.t('gatewayMembers.connectionAddressesHelp')}><Info class="h-3.5 w-3.5" /></button></DesktopTooltip></h3>
        </div>
        <div class="redeven-gateway-endpoint-list">
          <For each={endpointDraft()}>{(endpoint, index) => <div class="redeven-gateway-endpoint-shell" data-endpoint-id={endpoint.endpoint_id} classList={{ 'redeven-gateway-endpoint-shell--removing': removingEndpointID() === endpoint.endpoint_id }} inert={removingEndpointID() === endpoint.endpoint_id}>
            <div class="redeven-gateway-endpoint">
            <div class="redeven-gateway-endpoint__address">
              <label class="redeven-gateway-field"><span>{props.i18n.t('gatewayMembers.address')}</span>
                <Input aria-label={props.i18n.t('gatewayMembers.address')} disabled={busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members} size="sm" class="w-full min-w-0 font-mono" value={endpoint.address}
                  onInput={event => setEndpointDraft(current => current.map((item, itemIndex) => itemIndex === index() ? { ...item, address: event.currentTarget.value.trim() } : item))} />
              </label>
              <DesktopTooltip content={props.i18n.t('gatewayMembers.removeAddress')}><Button class="h-8 w-8 cursor-pointer" size="xs" variant="ghost" aria-label={props.i18n.t('gatewayMembers.removeAddress')} disabled={busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members} onClick={() => removeEndpoint(endpoint.endpoint_id)}><Trash class="h-3.5 w-3.5" /></Button></DesktopTooltip>
            </div>
            <span class="text-xs text-muted-foreground">{props.gateway?.endpoint_last_used_at?.[endpoint.endpoint_id] ? `${props.i18n.t('gatewayMembers.usedByRuntime')} · ${new Date(props.gateway.endpoint_last_used_at[endpoint.endpoint_id]!).toLocaleString(props.i18n.locale)}` : props.i18n.t('gatewayMembers.notVerified')}</span>
            </div>
          </div>}</For>
          <Show when={!endpointDraft().length}><p class="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.noConnectionAddresses')}</p></Show>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button class="cursor-pointer" size="xs" variant="outline" icon={Plus} disabled={busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members || endpointDraft().length >= 16} onClick={() => setEndpointDraft(current => [...current, { endpoint_id: `endpoint_${crypto.randomUUID().replaceAll('-', '')}`, address: '', scope: 'lan', priority: current.length }])}>{props.i18n.t('gatewayMembers.addAddress')}</Button>
          <Button class="cursor-pointer" size="xs" disabled={busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members} onClick={() => void saveEndpoints()}>{props.i18n.t('gatewayMembers.saveAddresses')}</Button>
        </div>
        <Show when={endpointsDirty()}><p role="status" class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.saveFirst')}</p></Show>
      </section>
      </Show>
      <Show when={props.section !== 'connection'}>
      <section class="space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold">{props.i18n.t('gatewayMembers.invite')}</h3>
            <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.inviteHelp')}</p>
          </div>
          <Button class="cursor-pointer" size="sm" disabled={busy() || !props.gateway?.permissions?.manage_members || savedEndpoints().length === 0 || endpointsDirty() || !endpointsValid()} onClick={() => void invite()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button>
        </div>
        <Show when={!savedEndpoints().length}><p role="status" class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.noConnectionAddresses')}</p></Show>
        <Show when={invitation() && !endpointsDirty()}>
          <div class="redeven-gateway-content-enter space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p role="status" class="text-xs text-primary">{props.i18n.t('gatewayMembers.invitationReady')}</p>
            <dl class="grid grid-cols-2 gap-2 text-xs"><div><dt class="text-muted-foreground">{props.i18n.t('gatewayJoin.gateway')}</dt><dd class="break-words font-medium">{invitation()?.gateway_name}</dd></div><div><dt class="text-muted-foreground">{props.i18n.t('gatewayJoin.connectionOptions')}</dt><dd>{invitation()?.endpoints.length}</dd></div><div><dt class="text-muted-foreground">{props.i18n.t('gatewayJoin.invitationType')}</dt><dd>{props.i18n.t('gatewayJoin.oneTime')}</dd></div><div><dt class="text-muted-foreground">{props.i18n.t('gatewayJoin.expiry')}</dt><dd>{new Date(invitation()!.expires_at_unix_ms).toLocaleTimeString(props.i18n.locale)}</dd></div></dl>
            <Button class="cursor-pointer" size="sm" variant="outline" icon={Download} onClick={download}>{props.i18n.t('gatewayMembers.download')}</Button>
            <label class="block space-y-1 text-xs"><span>{props.i18n.t('gatewayMembers.chooseRuntime')}</span>
              <select class="w-full cursor-pointer rounded border border-border bg-background p-2" value={targetID()} onChange={event => setTargetID(event.currentTarget.value)}>
                <option value="">{props.i18n.t('gatewayMembers.importOnRuntime')}</option>
                <For each={targets()}>{item => <option value={item.id}>{item.label}</option>}</For>
              </select>
            </label>
            <Show when={target()}>{item => <RuntimeGatewayJoinPanel targetID={item().id} invitation={invitation()} i18n={props.i18n} />}</Show>
          </div>
        </Show>
      </section>
      <Show when={policy()}>{current => <details class="redeven-gateway-disclosure group space-y-3 border-t border-border pt-4">
        <summary class="flex cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">{props.i18n.t('gatewayMembers.policy')}<ChevronDown class="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
        <Checkbox label={props.i18n.t('gatewayMembers.defaultAllow')} checked={current().default_cloud_allowed}
          disabled={busy() || !props.gateway?.permissions?.configure_cloud}
          onChange={default_cloud_allowed => { setDraftPolicy({ ...current(), default_cloud_allowed }); setSavingPolicy(false); }} />
        <label class="block space-y-1 text-xs"><span>{props.i18n.t('gatewayMembers.publication')}</span>
          <select class="w-full cursor-pointer rounded border border-border bg-background p-2 disabled:cursor-not-allowed" value={current().publication_mode}
            disabled={busy() || !props.gateway?.permissions?.configure_cloud}
            onChange={event => { setDraftPolicy({ ...current(), publication_mode: event.currentTarget.value as GatewayPolicy['publication_mode'] }); setSavingPolicy(false); }}>
            <option value="manual">{props.i18n.t('gatewayMembers.manual')}</option><option value="automatic">{props.i18n.t('gatewayMembers.automatic')}</option>
          </select>
        </label>
        <details class="redeven-gateway-disclosure"><summary class="cursor-pointer text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.technicalDetails')}</summary><p class="py-2 text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.automaticHelp')}</p>
        <div class="space-y-1 text-xs text-muted-foreground"><For each={['member.admit', 'access.open', 'cloud.publish'] as const}>{action =>
          <p>{action}: {props.i18n.t(props.gateway?.hook_status?.[action] === 'invalid' ? 'gatewayMembers.hookInvalid' : props.gateway?.hook_status?.[action] === 'configured' ? 'gatewayMembers.hookConfigured' : 'gatewayMembers.hookAbsent')}</p>}
        </For></div></details>
        <Show when={draftPolicy()}>
          <div class="redeven-gateway-content-enter space-y-2">
            <p class="text-xs">{props.i18n.t('gatewayMembers.affected')}: {affected().map(member => member.display_name).join(', ') || props.i18n.t('gatewayMembers.none')}</p>
            <Show when={savingPolicy()}><p role="alert" class="redeven-gateway-content-enter text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p></Show>
            <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => savingPolicy() ? void savePolicy() : setSavingPolicy(true)}>{props.i18n.t(savingPolicy() ? 'gatewayMembers.confirmSave' : 'common.save')}</Button>
          </div>
        </Show>
      </details>}</Show>
      <section class="space-y-3 border-t border-border pt-4">
        <h3 class="text-sm font-semibold">{props.i18n.t('gatewayMembers.members')}</h3>
        <Show when={members().length} fallback={<p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.empty')}</p>}>
          <ul class="space-y-3"><For each={members()}>{member => <li class="space-y-2 rounded-md border border-border p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><strong class="break-all text-sm">{member.display_name}</strong>
              <span class="text-xs">{props.i18n.t(member.connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</span></div>
            <p class="break-all text-xs text-muted-foreground">{member.member_id}</p>
            <label class="flex flex-wrap items-center gap-2 text-xs"><span>{props.i18n.t('gatewayMembers.cloudPermission')}</span>
              <select class="cursor-pointer rounded border border-border bg-background p-1 disabled:cursor-not-allowed"
                disabled={busy() || !props.gateway?.permissions?.configure_cloud} value={overrides()[member.member_id] ?? member.cloud_permission}
                onChange={event => setOverrides(current => ({ ...current, [member.member_id]: event.currentTarget.value as GatewayCloudPermission }))}>
                <For each={['inherit', 'allow', 'deny'] as const}>{value => <option value={value}>{props.i18n.t(`gatewayMembers.${value}`)}</option>}</For>
              </select>
            </label>
            <Show when={member.cloud_revocation_pending}><p role="status" class="text-xs text-warning">{props.i18n.t('gatewayMembers.revocationPending')}</p></Show>
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={busy() || !props.gateway?.permissions?.manage_members}
              onClick={() => props.gateway && void perform({ kind: 'reevaluate_gateway_member', gateway_id: props.gateway.gateway_id,
                member_id: member.member_id, member_version: member.member_version })}>{props.i18n.t('gatewayMembers.reevaluate')}</Button>
            <Show when={results()?.find(result => result.member_id === member.member_id)}>{result => <p role="status" class="text-xs">{result().error_code || props.i18n.t('gatewayMembers.saved')}</p>}</Show>
            <Show when={removing() === member.member_id}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p></Show>
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={busy() || !props.gateway?.permissions?.manage_members}
              onClick={() => {
                if (removing() !== member.member_id) { setRemoving(member.member_id); return; }
                if (props.gateway) void perform({ kind: 'remove_gateway_member', gateway_id: props.gateway.gateway_id, member_id: member.member_id, member_version: member.member_version }).then(result => { if (result) setRemoving(''); });
              }}>{props.i18n.t(removing() === member.member_id ? 'gatewayMembers.confirmRemove' : 'gatewayMembers.remove')}</Button>
          </li>}</For></ul>
        </Show>
        <Show when={Object.keys(overrides()).length}><div class="redeven-gateway-content-enter space-y-2">
          <p class="text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p>
          <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => void saveMembers()}>{props.i18n.t('gatewayMembers.confirmSave')}</Button>
        </div></Show>
      </section>
      </Show>
      <Show when={error()}><p role="alert" class="redeven-gateway-content-enter text-sm text-error">{error()}</p></Show>
    </div>
  );
}
