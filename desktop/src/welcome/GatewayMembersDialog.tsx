import { FlowerContextDialog as Dialog } from '../../../internal/flower_ui/src/FlowerContextDialog';
import { GatewayPicker } from './GatewayPicker';
import { gatewayAllowedHost, gatewayConnectionOrigin, gatewayListenAddress } from '../shared/gatewayNetworkSettings';
import { KeyedFor, Button, Checkbox, Input, StableText } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, ChevronDown, Globe, HelpIcon, Plus, Refresh, Save, Shield, Terminal, Trash, Copy } from '@floegence/floe-webapp-core/icons';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionSuccess } from '../shared/desktopLauncherIPC';
import type { GatewayEgressPermission, GatewayEndpoint, GatewayInvitationCodeDelivery, GatewayPolicy } from '../shared/gatewayMembership';
import type { DesktopI18n } from '../shared/i18n';
import { gatewayInteractionIdentity } from './environmentInteractionIdentity';
import { DesktopTooltip } from './DesktopTooltip';

export function RuntimeAttachmentsPanel(props: Readonly<{
  available?: boolean;
  showAvailabilityNotice?: boolean;
  suspended?: boolean;
  onPresenceChange?: (present: boolean) => void;
  gateway?: DesktopGatewaySource; i18n: DesktopI18n;
  section: 'connection' | 'runtimes' | 'policy'; refresh: () => Promise<unknown>;
  onEnroll?: () => void;
  enrolling?: boolean;
  onEnrollmentChange?: (value: boolean) => void;
  onNetwork?: () => void;
  onRestart?: () => void;
}>) {
  const [enrollmentStep, setEnrollmentStep] = createSignal<'choice' | 'invite'>('choice');
  const enrolling = () => props.enrolling === true;
  let enrollmentTrigger: HTMLButtonElement | undefined, ownedRuntimeChoice: HTMLButtonElement | undefined, otherRuntimeChoice: HTMLButtonElement | undefined, invitationHeading: HTMLHeadingElement | undefined;
  function openEnrollment() {
    props.onEnrollmentChange?.(true);
    queueMicrotask(() => (enrollmentStep() === 'invite' ? invitationHeading : ownedRuntimeChoice)?.focus());
  }
  function leaveEnrollment() {
    if (enrollmentStep() === 'invite') {
      setEnrollmentStep('choice');
      queueMicrotask(() => otherRuntimeChoice?.focus());
    } else {
      props.onEnrollmentChange?.(false);
      queueMicrotask(() => enrollmentTrigger?.focus());
    }
  }
  const canEnroll = () => props.available !== false && props.gateway?.connection_kind !== 'url' && props.gateway?.permissions?.manage_attachments === true;
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [uncertainOperation, setUncertainOperation] = createSignal('');
  const [invitation, setInvitation] = createSignal<GatewayInvitationCodeDelivery>();
  const [invitationInvalidated, setInvitationInvalidated] = createSignal(false);
  const [shareAddress, setShareAddress] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const expiryTimer = setInterval(() => setNow(Date.now()),1000);
  onCleanup(() => clearInterval(expiryTimer));
  const [draftPolicy, setDraftPolicy] = createSignal<GatewayPolicy>();
  const [overrides, setOverrides] = createSignal<Record<string, GatewayEgressPermission>>({});
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
    const next = props.gateway?.connection_id ?? '';
    if (!next) { generation++; setBusy(false); setInvitationInvalidated(true); return; }
    if (next === gatewayID) return;
    if (removalTimer !== undefined) window.clearTimeout(removalTimer);
    removalTimer = undefined;
    gatewayID = next; generation++; setBusy(false); setError(''); setInvitation(undefined);
    setDraftPolicy(undefined); setOverrides({}); setResults(undefined); setRemoving(''); setSavingPolicy(false); setRemovingEndpointID(''); setEndpointDraft([...(props.gateway?.endpoints ?? [])]);
    setSavedEndpoints(props.gateway?.endpoints ?? []);
    const listen = props.gateway?.listener_addresses?.length ? props.gateway.listener_addresses : [props.gateway?.listener_address || ':7443'];
    setListenDraft(listen.join(', ')); setHostsDraft((props.gateway?.allowed_hosts ?? []).join(', '));
    setSavedNetwork(JSON.stringify({listen:listen.join(', '), hosts:(props.gateway?.allowed_hosts ?? []).join(', '), endpoints:props.gateway?.endpoints ?? []}));
    setNetworkFieldError(undefined); setNetworkSaved(false); setRestartRequired(props.gateway?.listener_restart_required === true);
  });
  onCleanup(() => { generation++; if (removalTimer !== undefined) window.clearTimeout(removalTimer); });
  createEffect(() => setRestartRequired(props.gateway?.listener_restart_required === true));
  createEffect(on(() => props.available, value => {
    if (value !== false) return;
    generation++; setBusy(false); setInvitationInvalidated(true); setRemoving(''); setSavingPolicy(false);
    setError('');
  }, { defer: true }));
  const currentMembers = () => props.gateway?.environments.filter(member => member.state === 'active') ?? [];
  const members = createMemo<ReturnType<typeof currentMembers>>(previous => {
    const current = currentMembers();
    return [...current, ...(previous ?? []).filter(member => !current.some(item => item.attachment_id === member.attachment_id)
      && (removing() === member.attachment_id || overrides()[member.attachment_id] !== undefined))];
  }, [] as ReturnType<typeof currentMembers>);
  const currentMember = (id: string) => currentMembers().find(member => member.attachment_id === id);
  const authority = createMemo(() => JSON.stringify([props.gateway && gatewayInteractionIdentity(props.gateway), props.gateway?.permissions]));
  createEffect(on(authority, () => { generation++; setUncertainOperation(''); setBusy(false); setInvitationInvalidated(true); setRemoving(''); setSavingPolicy(false); }, { defer: true }));
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
  const affected = () => members().filter(member => {
    const before = props.gateway?.policy, after = policy();
    if (!before || !after || member.state !== 'active' || member.egress_permission === 'deny') return false;
    const defaultChanged = member.egress_permission === 'inherit' && before.default_egress_allowed !== after.default_egress_allowed;
    const destinationsChanged = JSON.stringify([...before.destinations].sort()) !== JSON.stringify([...after.destinations].sort());
    return defaultChanged || (destinationsChanged && (member.egress_permission === 'allow' || before.default_egress_allowed || after.default_egress_allowed));
  });
  async function acknowledgeOperation() {
    const id = uncertainOperation(), gatewayID = props.gateway?.connection_id;
    if (!id || !gatewayID || busy() || props.available === false) return;
    const owner = generation; setBusy(true);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'acknowledge_gateway_operation', connection_id: gatewayID, operation_id: id });
      if (owner !== generation) return;
      if (result?.ok) { setUncertainOperation(''); setError(''); }
      else setError(props.i18n.t('gatewayMembers.failed'));
    } catch { if (owner === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (owner === generation) setBusy(false); }
  }
  async function perform(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionSuccess | undefined> {
    const permissions = props.gateway?.permissions;
    const networkMutation = request.kind === 'reevaluate_gateway_egress' || request.kind === 'update_gateway_members' || request.kind === 'update_gateway_policy' || request.kind === 'update_gateway_network_settings' || request.kind === 'update_gateway_endpoints';
    if (busy() || !props.gateway || props.available === false || !(networkMutation ? permissions?.manage_network : permissions?.manage_attachments)) return;
    const current = generation;
    setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction(request);
      if (current !== generation) return;
      if (!result?.ok) {
        if (result?.gateway_error_code === 'OPERATION_RESULT_UNKNOWN') { setUncertainOperation(result.gateway_operation_id ?? ''); setError(props.i18n.t('gatewayMembers.operationUnknown', { id: result.gateway_operation_id ?? '' })); return; }
        throw new Error();
      }
      // A failed refresh cannot undo an accepted mutation or hide its delivery.
      try { await props.refresh(); }
      catch { if (current === generation) setError(props.i18n.t('gatewayMembers.refreshFailed')); }
      if (current === generation) return result;
    } catch { if (current === generation) setError(props.i18n.t('gatewayMembers.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  async function invite() {
    if (!props.gateway || endpointsDirty() || !savedEndpoints().length) return;
    const result = await perform({ kind: 'invite_gateway_runtime', connection_id: props.gateway.connection_id });
    if (result?.gateway_invitation_code) { setInvitation(result.gateway_invitation_code); setInvitationInvalidated(false); setShareAddress(result.gateway_invitation_code.share_address); setCopied(''); setNow(Date.now()); }
  }
  async function copyInvitation(value: string, kind: 'address' | 'code') {
    if (invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_attachments || !invitation() || invitation()!.expires_at_unix_ms <= Date.now()) return;
    const current = generation; setCopied('');
    try { await navigator.clipboard.writeText(value); if (generation === current) setCopied(kind); }
    catch { if (generation === current) setError(props.i18n.t('gatewayJoin.copyFailed')); }
  }
  async function saveMembers() {
    if (!props.gateway) return;
    const items = currentMembers().flatMap(member => overrides()[member.attachment_id] === undefined ? [] : [{ attachment_id: member.attachment_id,
      expected_attachment_version: member.attachment_version, egress_permission: overrides()[member.attachment_id]! }]);
    const result = await perform({ kind: 'update_gateway_members', connection_id: props.gateway.connection_id, items });
    if (!result) return;
    setResults(result.gateway_member_results);
    setOverrides(current => Object.fromEntries(Object.entries(current).filter(([id]) => !result.gateway_member_results?.some(item => item.attachment_id === id && !item.error_code))));
  }
  async function savePolicy() {
    if (!props.gateway || !policy()) return;
    const result = await perform({ kind: 'update_gateway_policy', connection_id: props.gateway.connection_id, policy: policy()! });
    if (result) { setDraftPolicy(undefined); setSavingPolicy(false); }
  }
  const entries = (value: string) => value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean);
  const networkDirty = () => JSON.stringify({listen:listenDraft(),hosts:hostsDraft(),endpoints:normalizedEndpoints()}) !== savedNetwork();
  createEffect(on(() => props.gateway, source => untrack(() => {
    if (!source || source.connection_id !== gatewayID || busy() || networkDirty()) return;
    const endpoints = source.endpoints ?? [];
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
    const result = await perform({ kind: 'update_gateway_network_settings', connection_id: props.gateway.connection_id, settings:{listen_addresses:listen as string[],allowed_hosts:hosts as string[],endpoints} });
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
    <div class="redeven-gateway-members-panel" data-gateway-panel={props.section}>
      <Show when={props.section === 'connection'}>
      <section class="redeven-gateway-settings-section redeven-gateway-setting-row">
        <div class="redeven-gateway-setting-label"><Globe aria-hidden="true" /><h3>{props.i18n.t('gatewayWorkspace.addresses')}</h3><DesktopTooltip content={props.i18n.t('gatewayMembers.connectionAddressesHelp')}><button type="button" class="redeven-gateway-help-trigger" aria-label={props.i18n.t('gatewayMembers.connectionAddressesHelp')}><HelpIcon aria-hidden="true" /></button></DesktopTooltip></div>
        <div class="redeven-gateway-setting-value">
        <div class="redeven-gateway-endpoint-list">
          <KeyedFor each={endpointDraft()} by={endpoint => endpoint.endpoint_id}>{endpoint => <div class="redeven-gateway-endpoint-shell" data-endpoint-id={endpoint().endpoint_id} classList={{ 'redeven-gateway-endpoint-shell--removing': removingEndpointID() === endpoint().endpoint_id }} inert={removingEndpointID() === endpoint().endpoint_id}>
            <div class="redeven-gateway-endpoint">
            <div class="redeven-gateway-endpoint__address">
              <label class="redeven-gateway-field"><span class="sr-only">{props.i18n.t('gatewayMembers.address')}</span>
                <Input aria-label={props.i18n.t('gatewayMembers.address')} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_network} size="sm" class="w-full min-w-0 redeven-gateway-network-input" value={endpoint().address} placeholder={props.i18n.t('gatewayNetwork.addressPlaceholder')} autocomplete="off" spellcheck={false}
                  onInput={event => setEndpointDraft(current => current.map(item => item.endpoint_id === endpoint().endpoint_id ? { ...item, address: event.currentTarget.value.trim() } : item))} />
              </label>
              <DesktopTooltip content={props.i18n.t('gatewayMembers.removeAddress')}><Button class="cursor-pointer" size="icon" variant="ghost" aria-label={props.i18n.t('gatewayMembers.removeAddress')} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_network} onClick={() => removeEndpoint(endpoint().endpoint_id)}><Trash class="h-3.5 w-3.5" /></Button></DesktopTooltip>
            </div>
            <Show when={props.gateway?.endpoint_last_used_at?.[endpoint().endpoint_id]}>{lastUsedAt => <span class="redeven-gateway-endpoint__meta">{props.i18n.t('gatewayMembers.usedByRuntime')} · {new Date(lastUsedAt()).toLocaleString(props.i18n.locale)}</span>}</Show>
            </div>
          </div>}</KeyedFor>
        </div>
        <div class="redeven-gateway-endpoint-actions">
          <Button class="cursor-pointer" size="sm" variant="outline" icon={Plus} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_network || endpointDraft().length >= 16} onClick={() => setEndpointDraft(current => [...current, { endpoint_id: `endpoint_${crypto.randomUUID().replaceAll('-', '')}`, address: '', scope: 'lan', priority: current.length }])}>{props.i18n.t('gatewayMembers.addAddress')}</Button>
          <Show when={!endpointDraft().length}><span class="redeven-gateway-inline-empty">{props.i18n.t('gatewayWorkspace.addressMissing')}</span></Show>
        </div>
        </div>
      </section>
      <section class="redeven-gateway-settings-section redeven-gateway-setting-row">
        <div class="redeven-gateway-setting-label"><Terminal aria-hidden="true" /><h3>{props.i18n.t('gatewayNetwork.listenTitle')}</h3><DesktopTooltip content={props.i18n.t('gatewayNetwork.listenHelp')}><button type="button" class="redeven-gateway-help-trigger" aria-label={props.i18n.t('gatewayNetwork.listenHelp')}><HelpIcon aria-hidden="true" /></button></DesktopTooltip></div>
        <div class="redeven-gateway-setting-value">
          <label class="redeven-gateway-field"><span class="sr-only">{props.i18n.t('gatewayNetwork.listenAddress')}</span><Input ref={listenInput} aria-invalid={networkFieldError() === 'listen' || undefined} id="gateway-listen-addresses" class="redeven-gateway-network-input" value={listenDraft()} placeholder={props.i18n.t('gatewayNetwork.listenAddressPlaceholder')} size="sm" spellcheck={false} disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_network} onInput={event => { setListenDraft(event.currentTarget.value); setNetworkSaved(false); setNetworkFieldError(undefined); setError(''); }} /></label>
          <div class="redeven-gateway-listener-status"><Show when={props.gateway?.listener_running}><span>{props.i18n.t('gatewayNetwork.active')} <code>{(props.gateway?.active_listener_addresses ?? props.gateway?.listener_addresses ?? [props.gateway?.listener_address]).join(', ')}</code></span></Show><span>{props.i18n.t('gatewayNetwork.nextStart')}</span></div>
        </div>
      </section>
      <details ref={networkAdvanced} data-gateway-network-advanced class="redeven-gateway-disclosure redeven-gateway-network-advanced group">
        <summary class="redeven-gateway-network-summary"><span class="redeven-gateway-item-name"><Shield aria-hidden="true" />{props.i18n.t('gatewayNetwork.advanced')}</span><span class="redeven-gateway-network-summary-status">{props.i18n.t(entries(hostsDraft()).length ? 'gatewayNetwork.restrictedHosts' : 'gatewayNetwork.allHosts',{count:entries(hostsDraft()).length})}</span><ChevronDown aria-hidden="true" /></summary>
        <div class="redeven-gateway-network-advanced__content">
          <div class="redeven-gateway-setting-label"><label for="gateway-allowed-hosts">{props.i18n.t('gatewayNetwork.allowedHosts')}</label><DesktopTooltip content={props.i18n.t('gatewayNetwork.hostsHelp')}><button type="button" class="redeven-gateway-help-trigger" aria-label={props.i18n.t('gatewayNetwork.hostsHelp')}><HelpIcon aria-hidden="true" /></button></DesktopTooltip></div>
          <Input ref={hostsInput} aria-invalid={networkFieldError() === 'hosts' || undefined} id="gateway-allowed-hosts" class="redeven-gateway-network-input" value={hostsDraft()} placeholder={props.i18n.t('gatewayNetwork.allowedHostsPlaceholder')} size="sm" spellcheck={false} disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_network} onInput={event => { setHostsDraft(event.currentTarget.value); setNetworkSaved(false); setNetworkFieldError(undefined); setError(''); }} />
        </div>
      </details>
      <div class="redeven-gateway-network-actions"><Show when={networkSaved() || restartRequired()}><p role="status" class="redeven-gateway-help">{props.i18n.t(restartRequired() ? 'gatewayNetwork.restartRequired' : 'gatewayNetwork.saved')}</p></Show><Show when={restartRequired() && props.onRestart}><Button variant="outline" size="sm" icon={Refresh} onClick={() => props.onRestart?.()}>{props.i18n.t('gatewayExperience.reviewRestart')}</Button></Show><Button class="ml-auto cursor-pointer whitespace-nowrap" size="sm" icon={Save} aria-label={props.i18n.t('gatewayNetwork.save')} disabled={props.available === false || busy() || Boolean(removingEndpointID()) || !props.gateway?.permissions?.manage_network || !networkDirty()} onClick={() => void saveEndpoints()}><StableText reserve={[props.i18n.t('common.save'),props.i18n.t('gatewayNetwork.saving')]}>{props.i18n.t(busy() ? 'gatewayNetwork.saving' : 'common.save')}</StableText></Button></div>
      </Show>
      <Show when={props.section === 'runtimes'}>
      <Dialog open={enrolling() && !props.suspended} onOpenChange={open => props.onEnrollmentChange?.(open)} onPresenceChange={present => { props.onPresenceChange?.(present); if (present) requestAnimationFrame(() => (enrollmentStep() === 'invite' ? invitationHeading : ownedRuntimeChoice)?.focus()); }} title={props.i18n.t('gatewayExperience.connectRuntime')} closeLabel={props.i18n.t('common.close')} class="redeven-gateway-dialog redeven-gateway-task-dialog"><div data-gateway-runtime-enrollment>
        <Button class="self-start" variant="ghost" size="sm" onClick={leaveEnrollment}>{props.i18n.t('gatewayJoin.back')}</Button>
        <div class="redeven-gateway-onboarding-choices mt-3" hidden={enrollmentStep() !== 'choice'}>
          <Button ref={ownedRuntimeChoice} variant="outline" aria-label={props.i18n.t('gatewayExperience.ownedRuntime')} disabled={!canEnroll() || busy()} onClick={() => props.onEnroll?.()}><span><strong>{props.i18n.t('gatewayExperience.ownedRuntime')}</strong><span class="block text-xs text-muted-foreground">{props.i18n.t('gatewayExperience.ownedRuntimeHelp')}</span></span></Button>
          <Button ref={otherRuntimeChoice} variant="outline" aria-label={props.i18n.t('gatewayExperience.otherRuntime')} disabled={!canEnroll() || busy()} onClick={() => { setEnrollmentStep('invite'); queueMicrotask(() => invitationHeading?.focus()); }}><span><strong>{props.i18n.t('gatewayExperience.otherRuntime')}</strong><span class="block text-xs text-muted-foreground">{props.i18n.t('gatewayExperience.otherRuntimeHelp')}</span></span></Button>
        </div>
      </div>
      <section data-gateway-invite-others hidden={enrollmentStep() !== 'invite'}>
        <div class="redeven-gateway-settings-section mt-3">
        <div class="redeven-gateway-section-heading">
          <div class="min-w-0">
            <h3 ref={invitationHeading} tabIndex={-1}>{props.i18n.t('gatewayMembers.invite')}</h3>
            <p>{props.i18n.t('gatewayMembers.inviteHelp')}</p>
          </div>
          <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_attachments || savedEndpoints().length === 0 || endpointsDirty() || !endpointsValid()} onClick={() => void invite()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button>
        </div>
        <Show when={!savedEndpoints().length}><p role="status" class="redeven-gateway-empty-state">{props.i18n.t('gatewayMembers.noConnectionAddresses')}</p><Show when={props.onNetwork}><Button variant="outline" size="sm" onClick={() => { props.onEnrollmentChange?.(false); props.onNetwork?.(); }}>{props.i18n.t('gatewayMembers.connectionAddresses')}</Button></Show></Show>
        <Show when={invitation() && !endpointsDirty()}>
          <div class="redeven-gateway-content-enter redeven-gateway-invitation-card">
            <p role="status" class="text-sm font-medium text-primary">{props.i18n.t('gatewayMembers.invitationReady')}</p>
            <p class="font-medium">{invitation()?.gateway_name}</p>
            <GatewayPicker label={props.i18n.t('gatewayJoin.address')} placeholder="" disabled={busy()} value={shareAddress()}
              options={(invitation()?.share_addresses ?? []).map(value => ({ value, label: value }))}
              onChange={value => { setShareAddress(value); setCopied(''); }} />
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" icon={Copy} disabled={invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_attachments || invitation()!.expires_at_unix_ms<=now()} onClick={() => void copyInvitation(shareAddress(),'address')}><StableText reserve={[props.i18n.t('gatewayJoin.copyAddress'),props.i18n.t('gatewayJoin.copied')]}>{props.i18n.t(copied()==='address'?'gatewayJoin.copied':'gatewayJoin.copyAddress')}</StableText></Button>
            <div><p class="text-sm">{props.i18n.t('gatewayJoin.code')}</p><p class="select-text break-all rounded-md bg-muted p-3 font-mono tracking-wide">{invitation()?.code.match(/.{1,5}/g)?.join('-')}</p></div>
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" icon={Copy} disabled={invitationInvalidated() || props.available === false || !props.gateway?.permissions?.manage_attachments || invitation()!.expires_at_unix_ms<=now()} onClick={() => void copyInvitation(invitation()!.code,'code')}><StableText reserve={[props.i18n.t('gatewayJoin.copyCode'),props.i18n.t('gatewayJoin.copied')]}>{props.i18n.t(copied()==='code'?'gatewayJoin.copied':'gatewayJoin.copyCode')}</StableText></Button>
            <p role="timer" class="text-sm text-muted-foreground">{invitation()!.expires_at_unix_ms<=now()?props.i18n.t('gatewayJoin.expired'):props.i18n.tn('gatewayJoin.expiresIn',Math.max(0,Math.ceil((invitation()!.expires_at_unix_ms-now())/60000)))}</p>
            <Button class="cursor-pointer whitespace-nowrap" size="sm" variant="outline" disabled={props.available === false || busy()} onClick={() => void invite()}>{props.i18n.t('gatewayJoin.regenerate')}</Button>

          </div>
        </Show>
      </div></section>
      <Show when={uncertainOperation()}><Button variant="outline" size="sm" disabled={busy() || props.available === false} onClick={() => void acknowledgeOperation()}>{props.i18n.t('gatewayMembers.operationReviewed')}</Button></Show>
      <Show when={props.available === false}><p role="alert" class="redeven-gateway-access-notice"><AlertTriangle aria-hidden="true" />{props.i18n.t('gatewayWorkspace.accessChanged')}</p></Show>
      <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show></Dialog>
      <div>
      <section class="redeven-gateway-settings-section">
        <div class="redeven-gateway-section-heading"><h3 class="redeven-gateway-section-title">{props.i18n.t('gatewayMembers.members')}</h3><Show when={props.onEnroll}><Button ref={enrollmentTrigger} data-gateway-add-environment size="sm" icon={Plus} disabled={!canEnroll() || busy()} onClick={openEnrollment}>{props.i18n.t('gatewayExperience.connectRuntime')}</Button></Show></div>
        <Show when={members().length} fallback={<p class="redeven-gateway-empty-state redeven-gateway-member-empty">{props.i18n.t('gatewayMembers.empty')}</p>}>
          <ul class="redeven-gateway-member-list"><KeyedFor each={members()} by={member => member.attachment_id}>{member => <li class="redeven-gateway-member-row">
            <div class="flex flex-wrap items-center justify-between gap-2"><strong class="break-all text-sm">{member().display_name}</strong>
              <span class="text-xs">{props.i18n.t(member().connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</span></div>
            <p class="break-all text-xs text-muted-foreground">{member().attachment_id}</p>
            <p class="text-xs text-muted-foreground" title={props.i18n.t('gatewayMembers.egressPolicyHelp')}>{props.i18n.t(member().effective_egress_allowed ? 'gatewayMembers.egressAllowed' : 'gatewayMembers.egressDenied')}</p>
            <GatewayPicker label={props.i18n.t('gatewayMembers.egressPermission')} placeholder=""
              disabled={props.available === false || busy() || !currentMember(member().attachment_id) || !props.gateway?.permissions?.manage_network}
              value={overrides()[member().attachment_id] ?? member().egress_permission}
              options={(['inherit', 'allow', 'deny'] as const).map(value => ({ value, label: props.i18n.t('gatewayMembers.' + value as 'gatewayMembers.inherit') }))}
              onChange={value => setOverrides(current => ({ ...current, [member().attachment_id]: value as GatewayEgressPermission }))} />
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={props.available === false || busy() || !currentMember(member().attachment_id) || !props.gateway?.permissions?.manage_network}
              onClick={() => props.gateway && void perform({ kind: 'reevaluate_gateway_egress', connection_id: props.gateway.connection_id,
                attachment_id: member().attachment_id, attachment_version: member().attachment_version })}>{props.i18n.t('gatewayMembers.reevaluate')}</Button>
            <Show when={results()?.find(result => result.attachment_id === member().attachment_id)}>{result => <>
              <p role="status" class="text-xs">{props.i18n.t(!result().error_code ? 'gatewayMembers.saved'
                : result().error_code === 'ATTACHMENT_VERSION_CONFLICT' ? 'gatewayMembers.memberChanged'
                  : result().error_code === 'ATTACHMENT_DENIED' ? 'gatewayMembers.memberDenied'
                    : result().error_code === 'ATTACHMENT_CAPACITY' ? 'gatewayMembers.memberCapacity' : 'gatewayMembers.failed')}</p>
              <Show when={result().error_code}>{code => <details class="redeven-gateway-disclosure text-xs text-muted-foreground">
                <summary class="cursor-pointer">{props.i18n.t('gatewayJoin.technicalDetails')}</summary>
                <code class="block break-all pt-2">{code()}</code>
              </details>}</Show>
            </>}</Show>
            <Show when={!currentMember(member().attachment_id)}><p role="alert">{props.i18n.t('interactionContinuity.unavailable')}</p></Show>
            <Show when={removing() === member().attachment_id}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p><Button variant="ghost" size="xs" onClick={() => setRemoving('')}>{props.i18n.t('common.cancel')}</Button></Show>
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={props.available === false || busy() || !currentMember(member().attachment_id) || !props.gateway?.permissions?.manage_attachments}
              onClick={() => {
                if (removing() !== member().attachment_id) { setRemoving(member().attachment_id); return; }
                if (props.gateway) void perform({ kind: 'remove_gateway_member', connection_id: props.gateway.connection_id, attachment_id: member().attachment_id, attachment_version: member().attachment_version }).then(result => { if (result) setRemoving(''); });
              }}>{props.i18n.t(removing() === member().attachment_id ? 'gatewayMembers.confirmRemove' : 'gatewayMembers.remove')}</Button>
          </li>}</KeyedFor></ul>
        </Show>
        <Show when={Object.keys(overrides()).length}><div class="redeven-gateway-content-enter space-y-2">
          <p class="text-xs text-warning">{props.i18n.t('gatewayMembers.egressImpact')}</p>
          <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy()} onClick={() => void saveMembers()}>{props.i18n.t('gatewayMembers.confirmSave')}</Button>
        </div></Show>
      </section>
      </div>

      </Show>
      <Show when={props.section === 'policy'}>
      <Show when={policy()}>{current => <details class="redeven-gateway-disclosure redeven-gateway-policy group">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><span class="redeven-gateway-item-name"><Globe aria-hidden="true" />{props.i18n.t('gatewayMembers.policy')}</span><ChevronDown class="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
        <div class="redeven-gateway-policy-content">
        <Checkbox label={props.i18n.t('gatewayMembers.defaultAllow')} checked={current().default_egress_allowed}
          disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_network}
          onChange={default_egress_allowed => { setDraftPolicy({ ...current(), default_egress_allowed }); setSavingPolicy(false); }} />
        <label class="space-y-2 text-sm"><span>{props.i18n.t('gatewayMembers.destinations')}</span>
          <textarea class="w-full rounded-md border border-border bg-background p-2 font-mono text-sm" rows={3}
            aria-label={props.i18n.t('gatewayMembers.destinations')}
            disabled={props.available === false || busy() || !props.gateway?.permissions?.manage_network}
            value={current().destinations.join('\n')}
            onInput={event => { setDraftPolicy({ ...current(), destinations: event.currentTarget.value.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) }); setSavingPolicy(false); }} />
        </label>
        <details class="redeven-gateway-disclosure"><summary class="cursor-pointer text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.technicalDetails')}</summary><p class="py-2 text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.automaticHelp')}</p>
        <div class="space-y-1 text-xs text-muted-foreground"><For each={['attachment.admit', 'access.open', 'egress.open'] as const}>{action =>
          <p>{props.i18n.t(action === 'attachment.admit' ? 'gatewayMembers.hookMemberAdmission' : action === 'access.open' ? 'gatewayMembers.hookSessionAccess' : 'gatewayMembers.hookEgress')}: {props.i18n.t(props.gateway?.hook_status?.[action] === 'invalid' ? 'gatewayMembers.hookInvalid' : props.gateway?.hook_status?.[action] === 'configured' ? 'gatewayMembers.hookConfigured' : 'gatewayMembers.hookAbsent')} <code>({action})</code></p>}
        </For></div></details>
        <Show when={draftPolicy()}>
          <div class="redeven-gateway-content-enter space-y-2">
            <p class="text-xs">{props.i18n.t('gatewayMembers.affected')}: {affected().map(member => member.display_name).join(', ') || props.i18n.t('gatewayMembers.none')}</p>
            <Show when={savingPolicy()}><p role="alert" class="redeven-gateway-content-enter text-xs text-warning">{props.i18n.t('gatewayMembers.egressImpact')}</p></Show>
            <Button class="cursor-pointer" size="sm" disabled={props.available === false || busy()} onClick={() => savingPolicy() ? void savePolicy() : setSavingPolicy(true)}>{props.i18n.t(savingPolicy() ? 'gatewayMembers.confirmSave' : 'common.save')}</Button>
          </div>
        </Show>
        </div>
      </details>}</Show>

      </Show>
      <Show when={uncertainOperation()}><Button variant="outline" size="sm" disabled={busy() || props.available === false} onClick={() => void acknowledgeOperation()}>{props.i18n.t('gatewayMembers.operationReviewed')}</Button></Show>
      <Show when={props.available === false && props.showAvailabilityNotice !== false}><p role="alert" class="redeven-gateway-access-notice"><AlertTriangle aria-hidden="true" />{props.i18n.t('gatewayWorkspace.accessChanged')}</p></Show>
      <Show when={error()}><p role="alert" class="redeven-gateway-content-enter text-sm text-error">{error()}</p></Show>
    </div>
  );
}
