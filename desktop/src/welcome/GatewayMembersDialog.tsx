import { Button, Checkbox, Dialog } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionSuccess } from '../shared/desktopLauncherIPC';
import type { GatewayCloudPermission, GatewayMemberInvitation, GatewayPolicy } from '../shared/gatewayMembership';
import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import type { DesktopI18n } from '../shared/i18n';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';

export function GatewayMembersDialog(props: Readonly<{
  gateway?: DesktopGatewaySource; i18n: DesktopI18n; targets: readonly DesktopProviderRuntimeLinkTarget[];
  onClose: () => void; refresh: () => Promise<unknown>;
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
  let generation = 0, gatewayID = '';
  createEffect(() => {
    const next = props.gateway?.gateway_id ?? '';
    if (next === gatewayID) return;
    gatewayID = next; generation++; setBusy(false); setError(''); setInvitation(undefined); setTargetID('');
    setDraftPolicy(undefined); setOverrides({}); setResults(undefined); setRemoving(''); setSavingPolicy(false);
  });
  onCleanup(() => { generation++; });
  const members = () => props.gateway?.environments.filter(member => member.state === 'active') ?? [];
  const policy = () => draftPolicy() ?? props.gateway?.policy;
  const targets = createMemo(() => [...new Map(props.targets.filter(target => target.runtime_running && target.runtime_control_status.state === 'available').map(target => [target.id, target])).values()]);
  const target = () => targets().find(value => value.id === targetID());
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
    if (!props.gateway) return;
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
  return <Dialog open={!!props.gateway} onOpenChange={open => { if (!open) props.onClose(); }}
    title={props.i18n.t('gatewayMembers.title')} bodyDescription={props.gateway?.display_name} closeLabel={props.i18n.t('common.close')}>
    <div class="max-h-[75vh] space-y-5 overflow-y-auto p-4">
      <Show when={props.gateway?.rebuild_required}><div class="space-y-2 rounded-md border border-warning p-3 text-sm">
        <p>{props.i18n.t('gatewayMembers.rebuild')}</p>
        <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => props.gateway && void perform({ kind: 'dismiss_gateway_rebuild', gateway_id: props.gateway.gateway_id })}>{props.i18n.t('common.close')}</Button>
      </div></Show>
      <section class="space-y-3">
        <h3 class="text-sm font-semibold">{props.i18n.t('gatewayMembers.invite')}</h3>
        <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.inviteHelp')}</p>
        <Button class="cursor-pointer" size="sm" disabled={busy() || !props.gateway?.permissions?.manage_members} onClick={() => void invite()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button>
        <Show when={invitation()}>
          <div class="space-y-3 rounded-md border border-border p-3">
            <Button class="cursor-pointer" size="sm" variant="outline" onClick={download}>{props.i18n.t('gatewayMembers.download')}</Button>
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
      <Show when={policy()}>{current => <section class="space-y-3 border-t border-border pt-4">
        <h3 class="text-sm font-semibold">{props.i18n.t('gatewayMembers.policy')}</h3>
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
        <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayMembers.automaticHelp')}</p>
        <Show when={draftPolicy()}>
          <p class="text-xs">{props.i18n.t('gatewayMembers.affected')}: {affected().map(member => member.display_name).join(', ') || props.i18n.t('gatewayMembers.none')}</p>
          <Show when={savingPolicy()}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p></Show>
          <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => savingPolicy() ? void savePolicy() : setSavingPolicy(true)}>{props.i18n.t(savingPolicy() ? 'gatewayMembers.confirmSave' : 'common.save')}</Button>
        </Show>
        <div class="space-y-1 text-xs text-muted-foreground"><For each={['member.admit', 'access.open', 'cloud.publish'] as const}>{action =>
          <p>{action}: {props.i18n.t(props.gateway?.hook_status?.[action] === 'invalid' ? 'gatewayMembers.hookInvalid' : props.gateway?.hook_status?.[action] === 'configured' ? 'gatewayMembers.hookConfigured' : 'gatewayMembers.hookAbsent')}</p>}
        </For></div>
      </section>}</Show>
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
            <Show when={results()?.find(result => result.member_id === member.member_id)}>{result => <p role="status" class="text-xs">{result().error_code || props.i18n.t('gatewayMembers.saved')}</p>}</Show>
            <Show when={removing() === member.member_id}><p role="alert" class="text-xs text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p></Show>
            <Button class="cursor-pointer" size="xs" variant="outline" disabled={busy() || !props.gateway?.permissions?.manage_members}
              onClick={() => {
                if (removing() !== member.member_id) { setRemoving(member.member_id); return; }
                if (props.gateway) void perform({ kind: 'remove_gateway_member', gateway_id: props.gateway.gateway_id, member_id: member.member_id, member_version: member.member_version }).then(result => { if (result) setRemoving(''); });
              }}>{props.i18n.t(removing() === member.member_id ? 'gatewayMembers.confirmRemove' : 'gatewayMembers.remove')}</Button>
          </li>}</For></ul>
        </Show>
        <Show when={Object.keys(overrides()).length}><p class="text-xs text-warning">{props.i18n.t('gatewayMembers.cloudImpact')}</p>
          <Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => void saveMembers()}>{props.i18n.t('gatewayMembers.confirmSave')}</Button>
        </Show>
      </section>
      <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
      <div class="flex justify-end gap-2"><Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => props.gateway && void perform({ kind: 'refresh_gateway_catalog', gateway_id: props.gateway.gateway_id })}>{props.i18n.t('common.refresh')}</Button>
        <Button class="cursor-pointer" variant="ghost" onClick={props.onClose}>{props.i18n.t('common.close')}</Button></div>
    </div>
  </Dialog>;
}
