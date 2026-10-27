import { GatewayPicker } from './GatewayPicker';
import { gatewayAllowedHost, gatewayConnectionOrigin, gatewayListenAddress } from '../shared/gatewayNetworkSettings';
import { KeyedFor, Button, Checkbox, Input, StableText } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, Plus, Trash, Copy } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionSuccess } from '../shared/desktopLauncherIPC';
import type { GatewayCloudPermission, GatewayEndpoint, GatewayInvitationCodeDelivery, GatewayPolicy } from '../shared/gatewayMembership';
import type { DesktopI18n } from '../shared/i18n';
import { gatewayInteractionIdentity } from './environmentInteractionIdentity';
import { DesktopTooltip } from './DesktopTooltip';

export function GatewayMembersPanel(props: Readonly<{
  available?: boolean;
  gateway?: DesktopGatewaySource; i18n: DesktopI18n;
  section?: 'connection' | 'runtimes'; refresh: () => Promise<unknown>;
  onEnroll?: () => void;
  onRestart?: () => void;
}>) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [invitation, setInvitation] = createSignal<GatewayInvitationCodeDelivery>();
  const [invitationInvalidated, setInvitationInvalidated] = createSignal(false);
  const [shareAddress, setShareAddress] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const expiryTimer = setInterval(() => setNow(Date.now()),1000);
  onCleanup(() => clearInterval(expiryTimer));
  const [draftPolicy, setDraftPolicy] = createSignal<GatewayPolicy>();
  const [overrides, setOverrides] = createSignal<Record<string, GatewayCloudPermission>>({});
  const [results, setResults] = createSignal<DesktopLauncherActionSuccess['gateway_member_results']>();
  const [removing, setRemoving] = createSignal('');
  const [savingPolicy, setSavingPolicy] = createSignal(false);
  const [endpointDraft, setEndpointDraft] = createSignal<GatewayEndpoint[]>([]);
  const [listenDraft, setListenDraft] = createSignal('');
  const [hostsDraft, setHostsDraft] = createSignal('');
  const [savedNetwork, setSavedNetwork] = createSignal('');
  const [networkFieldError, setNetworkFieldError] = createSignal<'listen' | 'hosts'>();
  let listenInput: HTMLInputElement | undefined, hostsInput: HTMLInputElement | undefined, networkAdvanced: HTMLDetailsElement | undefined;
  const [networkSaved, setNetworkSaved] = createSignal(false);
  const [restartRequired, setRestartRequired] = createSignal(false);
  const [savedEndpoints, setSavedEndpoints] = createSignal<readonly GatewayEndpoint[]>([]);
  const [removingEndpointID, setRemovingEndpointID] = createSignal('');
  let generation = 0, gatewayID = '', removalTimer: number | undefined;
  createEffect(() => {
    const next = props.gateway?.gateway_id ?? '';
    if (!next) { generation++; setBusy(false); setInvitationInvalidated(true); return; }
    if (next === gatewayID) return;
    if (removalTimer !== undefined) window.clearTimeout(removalTimer);
    removalTimer = undefined;
    gatewayID = next; generation++; setBusy(false); setError(''); setInvitation(undefined);
    setDraftPolicy(undefined); setOverrides({}); setResults(undefined); setRemoving(''); setSavingPolicy(false); setRemovingEndpointID(''); setEndpointDraft([...(props.gateway?.member_endpoints ?? [])]);
    setSavedEndpoints(props.gateway?.member_endpoints ?? []);
    const listen = props.gateway?.listener_addresses?.length ? props.gateway.listener_addresses : [props.gateway?.listener_address || ':7443'];
    setListenDraft(listen.join(', ')); setHostsDraft((props.gateway?.allowed_hosts ?? []).join(', '));
    setSavedNetwork(JSON.stringify({listen:listen.join(', '), hosts:(props.gateway?.allowed_hosts ?? []).join(', '), endpoints:props.gateway?.member_endpoints ?? []}));
    setNetworkFieldError(undefined); setNetworkSaved(false); setRestartRequired(props.gateway?.listener_restart_required === true);
  });
  onCleanup(() => { generation++; if (removalTimer !== undefined) window.clearTimeout(removalTimer); });
  createEffect(() => setRestartRequired(props.gateway?.listener_restart_required === true));
  createEffect(on(() => props.available, value => {
    if (value !== false) return;
    generation++; setBusy(false); setInvitationInvalidated(true); setRemoving(''); setSavingPolicy(false);
    setError(props.i18n.t('interactionContinuity.unavailable'));
  }, { defer: true }));
  const currentMembers = () => props.gateway?.environments.filter(member => member.state === 'active') ?? [];
  const members = createMemo<ReturnType<typeof currentMembers>>(previous => {
    const current = currentMembers();
    return [...current, ...(previous ?? []).filter(member => !current.some(item => item.member_id === member.member_id)
      && (removing() === member.member_id || overrides()[member.member_id] !== undefined))];
  }, [] as ReturnType<typeof currentMembers>);
  const currentMember = (id: string) => currentMembers().find(member => member.member_id === id);
  const authority = createMemo(() => JSON.stringify([props.gateway && gatewayInteractionIdentity(props.gateway), props.gateway?.permissions]));
  createEffect(on(authority, () => { generation++; setBusy(false); setInvitationInvalidated(true); setRemoving(''); setSavingPolicy(false); }, { defer: true }));
  const policy = () => draftPolicy() ?? props.gateway?.policy;
  const normalizedEndpoints = () => endpointDraft().map(endpoint => ({
    ...endpoint, address: gatewayConnectionOrigin(endpoint.address) ?? endpoint.address.trim(),
  }));
  const endpointsDirty = () => JSON.stringify(normalizedEndpoints()) !== JSON.stringify(savedEndpoints());
  const endpointsValid = () => {
    const endpoints = normalizedEndpoints();
    if (endpoints.length === 0) return true;
    const ids = new Set<string>();
    const addresses = new Set<string>();
    return endpoints.every(endpoint => {
      if (gatewayConnectionOrigin(endpoint.address) !== endpoint.address) return false;
      if (ids.has(endpoint.endpoint_id) || addresses.has(endpoint.address)) return false;
      ids.add(endpoint.endpoint_id); addresses.add(endpoint.address);
      return Number.isSafeInteger(endpoint.priority) && endpoint.priority >= 0 && endpoint.priority <= 1000;
    });
  };
  const affected = () => members().filter(member => member.cloud_permission === 'inherit'
    && member.effective_cloud_allowed !== policy()?.default_cloud_allowed);
  async function perform(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionSuccess | undefined> {
    const permissions = props.gateway?.permissions;
    const cloudMutation = request.kind === 'update_gateway_members' || request.kind === 'update_gateway_policy';
    if (busy() || !props.gateway || props.available === false || !(cloudMutation ? permissions?.configure_cloud : permissions?.manage_members)) return;
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
    if (result?.gateway_invitation_code) { setInvitation(result.gateway_invitation_code); setInvitationInvalidated(false); setShareAddress(result.gateway_invitation_code.share_address); setCopied(''); setNow(Date.now()); }
  }
  async function copyInvitation(value: string, kind: 'address' | 'code') {
    if (invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_members || !invitation() || invitation()!.expires_at_unix_ms <= Date.now()) return;
    const current = generation; setCopied('');
    try { await navigator.clipboard.writeText(value); if (generation === current) setCopied(kind); }
    catch { if (generation === current) setError(props.i18n.t('gatewayJoin.copyFailed')); }
  }
  async function saveMembers() {
    if (!props.gateway) return;
    const items = currentMembers().flatMap(member => overrides()[member.member_id] === undefined ? [] : [{ member_id: member.member_id,
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
  const entries = (value: string) => value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean);
  const networkDirty = () => JSON.stringify({listen:listenDraft(),hosts:hostsDraft(),endpoints:normalizedEndpoints()}) !== savedNetwork();
  createEffect(on(() => props.gateway, source => untrack(() => {
    if (!source || source.gateway_id !== gatewayID || busy() || networkDirty()) return;
    const endpoints = source.member_endpoints ?? [];
    if (JSON.stringify(endpoints) !== JSON.stringify(savedEndpoints())) setInvitationInvalidated(true);
    const listen = source.listener_addresses?.length ? source.listener_addresses : [source.listener_address || ':7443'];
    setSavedEndpoints(endpoints); setEndpointDraft([...endpoints]);
    setListenDraft(listen.join(', ')); setHostsDraft((source.allowed_hosts ?? []).join(', '));
    setSavedNetwork(JSON.stringify({listen:listenDraft(),hosts:hostsDraft(),endpoints}));
  })));
  function invalidNetworkField(field: 'listen' | 'hosts') {
    setNetworkFieldError(field); setError(props.i18n.t(field === 'listen' ? 'gatewayNetwork.invalidListen' : 'gatewayNetwork.invalidHosts'));
    if (field === 'hosts' && networkAdvanced) networkAdvanced.open = true;
    queueMicrotask(() => (field === 'listen' ? listenInput : hostsInput)?.focus());
  }
  async function saveEndpoints() {
    if (!props.gateway) return;
    if (removingEndpointID()) return;
    if (!endpointsValid()) { setError(props.i18n.t('gatewayMembers.invalidConnectionAddresses')); return; }
    const listen = entries(listenDraft()).map(gatewayListenAddress);
    const hosts = entries(hostsDraft()).map(gatewayAllowedHost);
    if (!listen.length || listen.includes(null) || new Set(listen).size !== listen.length || listen.length > 16) { invalidNetworkField('listen'); return; }
    if (hosts.includes(null) || new Set(hosts).size !== hosts.length || hosts.length > 64) { invalidNetworkField('hosts'); return; }
    setNetworkFieldError(undefined);
    const endpoints = normalizedEndpoints();
    const changedBinding = listen.join(', ') !== (props.gateway.listener_addresses?.join(', ') || props.gateway.listener_address || ':7443');
    const result = await perform({ kind: 'update_gateway_network_settings', gateway_id: props.gateway.gateway_id, settings:{listen_addresses:listen as string[],allowed_hosts:hosts as string[],endpoints} });
    if (result) {
      const settings = result.gateway_network_settings?.settings ?? {listen_addresses:listen as string[],allowed_hosts:hosts as string[],endpoints};
      setSavedEndpoints(settings.endpoints); setEndpointDraft([...settings.endpoints]); setInvitation(undefined);
      setListenDraft(settings.listen_addresses.join(', ')); setHostsDraft(settings.allowed_hosts.join(', '));
      setSavedNetwork(JSON.stringify({listen:listenDraft(),hosts:hostsDraft(),endpoints:settings.endpoints}));
      setRestartRequired(result.gateway_network_settings?.restart_required ?? changedBinding); setNetworkSaved(true);
    }
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
    <div class="redeven-gateway-members-panel">
      <Show when={props.section === 'connection'}>
      <section class="redeven-gateway-settings-section">
        <div>
          <h3 class="redeven-gateway-section-title">{props.i18n.t('gatewayMembers.connectionAddresses')}</h3>
          <p class="redeven-gateway-help mt-1">{props.i18n.t('gatewayMembers.connectionAddressesHelp')}</p>
        </div>
        <div class="redeven-gateway-endpoint-list">
          <KeyedFor each={endpointDraft()} by={endpoint => endpoint.endpoint_id}>{endpoint => <div class="redeven-gateway-endpoint-shell" data-endpoint-id={endpoint().endpoint_id} classList={{ 'redeven-gateway-endpoint-shell--removing': removingEndpointID() === endpoint().endpoint_id }} inert={removingEndpointID() === endpoint().endpoint_id}>
            <div class="redeven-gateway-endpoint">
            <div class="redeven-gateway-endpoint__address">
              <label class="redeven-gateway-field"><span>{props.i18n.t('gatewayMembers.address')}</span>
                <Input aria-label={props.i18n.t('gatewayMembers.address')} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members} size="sm" class="w-full min-w-0 font-mono" value={endpoint().address} placeholder={props.i18n.t('gatewayNetwork.addressPlaceholder')} autocomplete="off" spellcheck={false}
                  onInput={event => setEndpointDraft(current => current.map(item => item.endpoint_id === endpoint().endpoint_id ? { ...item, address: event.currentTarget.value.trim() } : item))} />
              </label>
              <DesktopTooltip content={props.i18n.t('gatewayMembers.removeAddress')}><Button class="cursor-pointer" size="icon" variant="ghost" aria-label={props.i18n.t('gatewayMembers.removeAddress')} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members} onClick={() => removeEndpoint(endpoint().endpoint_id)}><Trash class="h-3.5 w-3.5" /></Button></DesktopTooltip>
            </div>
            <Show when={props.gateway?.endpoint_last_used_at?.[endpoint().endpoint_id]}>{lastUsedAt => <span class="redeven-gateway-endpoint__meta">{props.i18n.t('gatewayMembers.usedByRuntime')} · {new Date(lastUsedAt()).toLocaleString(props.i18n.locale)}</span>}</Show>
            </div>
          </div>}</KeyedFor>
          <Show when={!endpointDraft().length}><p class="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.noConnectionAddresses')}</p></Show>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button class="cursor-pointer" size="xs" variant="outline" icon={Plus} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members || endpointDraft().length >= 16} onClick={() => setEndpointDraft(current => [...current, { endpoint_id: `endpoint_${crypto.randomUUID().replaceAll('-', '')}`, address: '', scope: 'lan', priority: current.length }])}>{props.i18n.t('gatewayMembers.addAddress')}</Button>
        </div>
      </section>
      <section class="redeven-gateway-settings-section redeven-gateway-section-divider">
        <div class="redeven-gateway-section-heading"><div><h3>{props.i18n.t('gatewayNetwork.listenTitle')}</h3><p>{props.i18n.t('gatewayNetwork.listenHelp')}</p></div><span class="redeven-gateway-setting-badge">{props.i18n.t('gatewayNetwork.nextStart')}</span></div>
        <label class="redeven-gateway-field"><span>{props.i18n.t('gatewayNetwork.listenAddress')}</span><Input ref={listenInput} aria-invalid={networkFieldError() === 'listen' || undefined} id="gateway-listen-addresses" class="font-mono" value={listenDraft()} placeholder={props.i18n.t('gatewayNetwork.listenAddressPlaceholder')} size="sm" spellcheck={false} disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_members} onInput={event => { setListenDraft(event.currentTarget.value); setNetworkSaved(false); setNetworkFieldError(undefined); setError(''); }} /></label>
        <Show when={props.gateway?.listener_running}><p class="redeven-gateway-help text-xs">{props.i18n.t('gatewayNetwork.active')} <code class="break-all">{(props.gateway?.active_listener_addresses ?? props.gateway?.listener_addresses ?? [props.gateway?.listener_address]).join(', ')}</code></p></Show>
      </section>
      <details ref={networkAdvanced} data-gateway-network-advanced class="redeven-gateway-disclosure redeven-gateway-network-advanced group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><span>{props.i18n.t('gatewayNetwork.advanced')}</span><span class="ml-auto text-xs font-normal text-muted-foreground">{props.i18n.t(entries(hostsDraft()).length ? 'gatewayNetwork.restrictedHosts' : 'gatewayNetwork.allHosts',{count:entries(hostsDraft()).length})}</span><ChevronDown class="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
        <div class="redeven-gateway-network-advanced__content"><label class="redeven-gateway-field"><span>{props.i18n.t('gatewayNetwork.allowedHosts')}</span><Input ref={hostsInput} aria-invalid={networkFieldError() === 'hosts' || undefined} id="gateway-allowed-hosts" class="font-mono" value={hostsDraft()} placeholder={props.i18n.t('gatewayNetwork.allowedHostsPlaceholder')} size="sm" spellcheck={false} disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_members} onInput={event => { setHostsDraft(event.currentTarget.value); setNetworkSaved(false); setNetworkFieldError(undefined); setError(''); }} /></label><p class="redeven-gateway-help">{props.i18n.t('gatewayNetwork.hostsHelp')}</p></div>
      </details>
      <div class="redeven-gateway-network-actions"><Show when={networkSaved() || restartRequired()}><p role="status" class="redeven-gateway-help">{props.i18n.t(restartRequired() ? 'gatewayNetwork.restartRequired' : 'gatewayNetwork.saved')}</p></Show><Show when={restartRequired() && props.onRestart}><Button variant="outline" size="sm" onClick={() => props.onRestart?.()}>{props.i18n.t('gatewayExperience.reviewRestart')}</Button></Show><Button class="ml-auto cursor-pointer whitespace-nowrap" size="sm" disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_members || !networkDirty()} onClick={() => void saveEndpoints()}><StableText reserve={[props.i18n.t('gatewayNetwork.save'),props.i18n.t('gatewayNetwork.saving')]}>{props.i18n.t(busy() ? 'gatewayNetwork.saving' : 'gatewayNetwork.save')}</StableText></Button></div>
      </Show>
      <Show when={props.section !== 'connection'}>
      <section class="redeven-gateway-settings-section">
        <div class="redeven-gateway-section-heading"><h3 class="redeven-gateway-section-title">{props.i18n.t('gatewayMembers.members')}</h3><Show when={props.onEnroll}><Button data-gateway-add-environment size="sm" icon={Plus} disabled={busy()} onClick={() => props.onEnroll?.()}>{props.i18n.t('gatewayExperience.addEnvironment')}</Button></Show></div>
        <Show when={members().length} fallback={<p class="redeven-gateway-empty-state redeven-gateway-member-empty">{props.i18n.t('gatewayMembers.empty')}</p>}>
          <ul class="redeven-gateway-member-list"><KeyedFor each={members()} by={member => member.member_id}>{member => <li class="redeven-gateway-member-row">
            <div class="flex flex-wrap items-center justify-between gap-2"><strong class="break-all text-sm">{member().display_name}</strong>
              <span class="text-xs">{props.i18n.t(member().connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</span></div>
            <p class="break-all text-xs text-muted-foreground">{member().member_id}</p>
            <GatewayPicker label={props.i18n.t('gatewayMembers.cloudPermission')} placeholder=""
              disabled={props.available === false || busy() || !currentMember(member().member_id) || !props.gateway?.permissions?.configure_cloud}
              value={overrides()[member().member_id] ?? member().cloud_permission}
              options={(['inherit', 'allow', 'deny'] as const).map(value => ({ value, label: props.i18n.t('gatewayMembers.' + value as 'gatewayMembers.inherit') }))}
              onChange={value => setOverrides(current => ({ ...current, [member().member_id]: value as GatewayCloudPermission }))} />
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={props.available === false || busy() || !currentMember(member().member_id) || !props.gateway?.permissions?.manage_members}
              onClick={() => props.gateway && void perform({ kind: 'reevaluate_gateway_member', gateway_id: props.gateway.gateway_id,
                member_id: member().member_id, member_version: member().member_version })}>{props.i18n.t('gatewayMembers.reevaluate')}</Button>
            <Show when={results()?.find(result => result.member_id === member().member_id)}>{result => <>
              <p role="status" class="text-xs">{props.i18n.t(!result().error_code ? 'gatewayMembers.saved'
                : result().error_code === 'MEMBER_VERSION_CONFLICT' ? 'gatewayMembers.memberChanged'
                  : result().error_code === 'MEMBER_DENIED' ? 'gatewayMembers.memberDenied'
                    : result().error_code === 'MEMBER_CAPACITY' ? 'gatewayMembers.memberCapacity' : 'gatewayMembers.failed')}</p>
              <Show when={result().error_code}>{code => <details class="redeven-gateway-disclosure text-xs text-muted-foreground">
                <summary class="cursor-pointer">{props.i18n.t('gatewayJoin.technicalDetails')}</summary>
                <code class="block break-all pt-2">{code()}</code>
              </details>}</Show>
            </>}</Show>
            <Show when={!currentMember(member().member_id)}><p role="alert">{props.i18n.t('interactionContinuity.unavailable')}</p></Show>
            <Show when={removing() === member().member_id}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p><Button variant="ghost" size="xs" onClick={() => setRemoving('')}>{props.i18n.t('common.cancel')}</Button></Show>
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={props.available === false || busy() || !currentMember(member().member_id) || !props.gateway?.permissions?.manage_members}
              onClick={() => {
                if (removing() !== member().member_id) { setRemoving(member().member_id); return; }
                if (props.gateway) void perform({ kind: 'remove_gateway_member', gateway_id: props.gateway.gateway_id, member_id: member().member_id, member_version: member().member_version }).then(result => { if (result) setRemoving(''); });
              }}>{props.i18n.t(removing() === member().member_id ? 'gatewayMembers.confirmRemove' : 'gatewayMembers.remove')}</Button>
          </li>}</KeyedFor></ul>
        </Show>
        <Show when={Object.keys(overrides()).length}><div class="redeven-gateway-content-enter space-y-2">
          <p class="text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p>
          <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy()} onClick={() => void saveMembers()}>{props.i18n.t('gatewayMembers.confirmSave')}</Button>
        </div></Show>
      </section>
      <details class="redeven-gateway-disclosure" data-gateway-invite-others>
        <summary class="cursor-pointer">{props.i18n.t('gatewayExperience.inviteOthers')}</summary>
        <div class="redeven-gateway-settings-section mt-3">
        <div class="redeven-gateway-section-heading">
          <div class="min-w-0">
            <h3>{props.i18n.t('gatewayMembers.invite')}</h3>
            <p>{props.i18n.t('gatewayMembers.inviteHelp')}</p>
          </div>
          <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_members || savedEndpoints().length === 0 || endpointsDirty() || !endpointsValid()} onClick={() => void invite()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button>
        </div>
        <Show when={!savedEndpoints().length}><p role="status" class="redeven-gateway-empty-state">{props.i18n.t('gatewayMembers.noConnectionAddresses')}</p></Show>
        <Show when={invitation() && !endpointsDirty()}>
          <div class="redeven-gateway-content-enter redeven-gateway-invitation-card">
            <p role="status" class="text-sm font-medium text-primary">{props.i18n.t('gatewayMembers.invitationReady')}</p>
            <p class="font-medium">{invitation()?.gateway_name}</p>
            <GatewayPicker label={props.i18n.t('gatewayJoin.address')} placeholder="" disabled={busy()} value={shareAddress()}
              options={(invitation()?.share_addresses ?? []).map(value => ({ value, label: value }))}
              onChange={value => { setShareAddress(value); setCopied(''); }} />
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" icon={Copy} disabled={invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_members || invitation()!.expires_at_unix_ms<=now()} onClick={() => void copyInvitation(shareAddress(),'address')}><StableText reserve={[props.i18n.t('gatewayJoin.copyAddress'),props.i18n.t('gatewayJoin.copied')]}>{props.i18n.t(copied()==='address'?'gatewayJoin.copied':'gatewayJoin.copyAddress')}</StableText></Button>
            <div><p class="text-sm">{props.i18n.t('gatewayJoin.code')}</p><p class="select-text break-all rounded-md bg-muted p-3 font-mono tracking-wide">{invitation()?.code.match(/.{1,5}/g)?.join('-')}</p></div>
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" icon={Copy} disabled={invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_members || invitation()!.expires_at_unix_ms<=now()} onClick={() => void copyInvitation(invitation()!.code,'code')}><StableText reserve={[props.i18n.t('gatewayJoin.copyCode'),props.i18n.t('gatewayJoin.copied')]}>{props.i18n.t(copied()==='code'?'gatewayJoin.copied':'gatewayJoin.copyCode')}</StableText></Button>
            <p role="timer" class="text-sm text-muted-foreground">{invitation()!.expires_at_unix_ms<=now()?props.i18n.t('gatewayJoin.expired'):props.i18n.tn('gatewayJoin.expiresIn',Math.max(0,Math.ceil((invitation()!.expires_at_unix_ms-now())/60000)))}</p>
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" disabled={props.available === false || busy()} onClick={() => void invite()}>{props.i18n.t('gatewayJoin.regenerate')}</Button>

          </div>
        </Show>
      </div></details>

      <Show when={policy()}>{current => <details class="redeven-gateway-disclosure redeven-gateway-policy group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">{props.i18n.t('gatewayMembers.policy')}<ChevronDown class="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
        <div class="redeven-gateway-policy-content">
        <Checkbox label={props.i18n.t('gatewayMembers.defaultAllow')} checked={current().default_cloud_allowed}
          disabled={props.available === false || busy() || !props.gateway?.permissions?.configure_cloud}
          onChange={default_cloud_allowed => { setDraftPolicy({ ...current(), default_cloud_allowed }); setSavingPolicy(false); }} />
        <GatewayPicker label={props.i18n.t('gatewayMembers.publication')} placeholder=""
          disabled={props.available === false || busy() || !props.gateway?.permissions?.configure_cloud} value={current().publication_mode}
          options={(['manual', 'automatic'] as const).map(value => ({ value, label: props.i18n.t('gatewayMembers.' + value as 'gatewayMembers.manual') }))}
          onChange={value => { setDraftPolicy({ ...current(), publication_mode: value as GatewayPolicy['publication_mode'] }); setSavingPolicy(false); }} />
        <details class="redeven-gateway-disclosure"><summary class="cursor-pointer text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.technicalDetails')}</summary><p class="py-2 text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.automaticHelp')}</p>
        <div class="space-y-1 text-xs text-muted-foreground"><For each={['member.admit', 'access.open', 'cloud.publish'] as const}>{action =>
          <p>{props.i18n.t(action === 'member.admit' ? 'gatewayMembers.hookMemberAdmission' : action === 'access.open' ? 'gatewayMembers.hookSessionAccess' : 'gatewayMembers.hookCloudPublication')}: {props.i18n.t(props.gateway?.hook_status?.[action] === 'invalid' ? 'gatewayMembers.hookInvalid' : props.gateway?.hook_status?.[action] === 'configured' ? 'gatewayMembers.hookConfigured' : 'gatewayMembers.hookAbsent')} <code>({action})</code></p>}
        </For></div></details>
        <Show when={draftPolicy()}>
          <div class="redeven-gateway-content-enter space-y-2">
            <p class="text-xs">{props.i18n.t('gatewayMembers.affected')}: {affected().map(member => member.display_name).join(', ') || props.i18n.t('gatewayMembers.none')}</p>
            <Show when={savingPolicy()}><p role="alert" class="redeven-gateway-content-enter text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p></Show>
            <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy()} onClick={() => savingPolicy() ? void savePolicy() : setSavingPolicy(true)}>{props.i18n.t(savingPolicy() ? 'gatewayMembers.confirmSave' : 'common.save')}</Button>
          </div>
        </Show>
        </div>
      </details>}</Show>

      </Show>
      <Show when={error()}><p role="alert" class="redeven-gateway-content-enter text-sm text-error">{error()}</p></Show>
    </div>
  );
}
