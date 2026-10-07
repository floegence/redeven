import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup, onMount, For, Show } from 'solid-js';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { normalizeGatewayInvitation, type GatewayMembershipStatus, type GatewayMembershipOperation } from '../shared/gatewayJoin';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { GatewayMemberInvitation } from '../shared/gatewayMembership';
import type { DesktopI18n } from '../shared/i18n';

/** Local consent and recovery share one Runtime membership API. */
export function RuntimeGatewayJoinPanel(props: Readonly<{
  targetID: DesktopProviderRuntimeLinkTargetID; i18n: DesktopI18n; disabled?: boolean;
  invitation?: GatewayMemberInvitation; focusOwner?: () => void;
  gateways?: readonly DesktopGatewaySource[]; embedded?: boolean; onClose?: () => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [invitation, setInvitation] = createSignal<GatewayMemberInvitation>();
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<GatewayMembershipStatus>();
  const [error, setError] = createSignal('');
  const [replacing, setReplacing] = createSignal(false);
  const [updatingAddress, setUpdatingAddress] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [gatewayID, setGatewayID] = createSignal('');
  const [choice, setChoice] = createSignal<'preserve' | 'new'>();
  let generation = 0;
  let trigger: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    generation++; clearTimeout(timer); setBusy(false); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.());
  };
  onCleanup(() => { generation++; clearTimeout(timer); });
  async function readInvitation(file?: File) {
    if (!file) return;
    setError('');
    const current = generation;
    try {
      if (file.size > 64 * 1024) throw new Error();
      const parsed = normalizeGatewayInvitation(JSON.parse(await file.text()));
      if (!parsed) throw new Error();
      if (current === generation) setInvitation(parsed);
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.invalid')); }
  }
  async function act(operation: GatewayMembershipOperation) {
    const current = generation;
    clearTimeout(timer); setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'manage_runtime_gateway', runtime_target_id: props.targetID,
        operation, ...((operation === 'join' || operation === 'replace' || operation === 'update-address') ? { invitation: invitation() ?? props.invitation, ...((operation === 'join' || operation === 'replace') && choice() ? { environment_choice: choice() } : {}) } : {}) });
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_membership) throw new Error();
      setStatus(result.gateway_membership);
      // Observation never consumes an invitation or dismisses local consent.
      if (operation !== 'status') {
        setLeaving(false); setReplacing(false); setUpdatingAddress(false);
        if (result.gateway_membership.joined) setInvitation(undefined);
      }
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.failed')); }
    finally {
      if (current === generation) {
        setBusy(false);
        if (open()) timer = setTimeout(() => void act('status'), 3000);
      }
    }
  }
  onMount(() => { if (props.embedded) { setOpen(true); void act('status'); } });
  async function createInvitation() {
    const current = generation;
    setBusy(true); setError(''); clearTimeout(timer);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'invite_gateway_runtime', gateway_id: gatewayID() });
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_invitation) throw new Error();
      setInvitation(result.gateway_invitation);
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.failed')); }
    finally {
      if (current === generation) {
        setBusy(false);
        if (open()) timer = setTimeout(() => void act('status'), 3000);
      }
    }
  }
  const selectedInvitation = () => invitation() ?? props.invitation;
  const body = () =>       <div class="space-y-4 p-4">
        <Show when={status()}>{state => <div class="space-y-1 break-all text-sm" role="status" aria-live="polite">
          <p>{props.i18n.t(`gatewayMembership.${state().phase}`)}</p>
          <Show when={state().publication_error_code}><p role="alert" class="text-warning">{props.i18n.t(state().publication_error_code === 'BINDING_PROOF_REQUIRED' ? 'gatewayJoin.bindingProofRequired' : 'gatewayJoin.cloudUnavailable')}</p></Show>
          <Show when={state().gateway_url}><p class="text-xs text-muted-foreground">{state().gateway_url}</p></Show>
        </div>}</Show>
        <Show when={status()?.joined === false || replacing() || updatingAddress()}>
          <Show when={props.gateways?.some(gateway => gateway.permissions?.manage_members)}>
            <label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.chooseGateway')}</span>
              <select class="w-full cursor-pointer rounded border border-border bg-background p-2 disabled:cursor-not-allowed" value={gatewayID()} disabled={busy()}
                onChange={event => { setGatewayID(event.currentTarget.value); setInvitation(undefined); }}>
                <option value="">{props.i18n.t('gatewayJoin.importInvitation')}</option>
                <For each={props.gateways?.filter(gateway => gateway.permissions?.manage_members && gateway.local_enabled)}>{gateway => <option value={gateway.gateway_id}>{gateway.display_name}</option>}</For>
              </select>
            </label>
            <Show when={gatewayID()}><Button class="cursor-pointer" size="sm" disabled={busy()} onClick={() => void createInvitation()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button></Show>
          </Show>
          <Show when={!gatewayID()}><label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.material')}</span>
            <input type="file" accept=".json,application/json" class="block w-full cursor-pointer text-xs disabled:cursor-not-allowed"
              disabled={busy()} onChange={event => void readInvitation(event.currentTarget.files?.[0])} />
          </label></Show>
          <Show when={status()?.rejoin_required}><p role="status" class="text-sm">{props.i18n.t('gatewayJoin.rejoin')}</p></Show>
          <Show when={status()?.existing_environment_id && !updatingAddress()}>
            <fieldset class="space-y-2 text-sm" disabled={busy()}>
              <legend>{props.i18n.t('gatewayJoin.existingEnvironment')}</legend>
              <p class="break-all text-xs text-muted-foreground">{status()?.existing_environment_id}</p>
              <label class="flex cursor-pointer items-center gap-2"><input class="cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'preserve'} onChange={() => setChoice('preserve')} />{props.i18n.t('gatewayJoin.preserve')}</label>
              <label class="flex cursor-pointer items-center gap-2"><input class="cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'new'} onChange={() => setChoice('new')} />{props.i18n.t('gatewayJoin.createNew')}</label>
              <p class="text-xs text-muted-foreground">{props.i18n.t(choice() === 'new' ? 'gatewayJoin.newHelp' : 'gatewayJoin.preserveHelp')}</p>
            </fieldset>
          </Show>
          <Show when={selectedInvitation()}>{item => <dl class="space-y-1 break-all text-xs">
            <dt>{props.i18n.t('gatewayMembers.identity')}</dt><dd>{item().gateway_id}</dd>
            <dt>{props.i18n.t('gatewayCloud.gatewayURL')}</dt><dd>{item().gateway_url}</dd>
          </dl>}</Show>
        </Show>
        <Show when={updatingAddress()}><p role="status" class="text-sm">{props.i18n.t('gatewayJoin.addressHelp')}</p></Show>
        <Show when={replacing()}><p role="alert" class="text-sm text-warning">{props.i18n.t('gatewayJoin.replaceHelp')}</p></Show>
        <Show when={leaving()}><p role="alert" class="text-sm text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p></Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        <p class="text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.pauseDetail')}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t('common.close')}</Button>
          <Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => void act('status')}>{props.i18n.t('common.refresh')}</Button>
          <Show when={status()?.joined === false || replacing() || updatingAddress()} fallback={<>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status()} onClick={() => { setUpdatingAddress(true); setChoice(undefined); }}>{props.i18n.t('gatewayJoin.updateAddress')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status()} onClick={() => { setReplacing(true); setChoice(undefined); }}>{props.i18n.t('gatewayJoin.replace')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status() || status()?.phase === 'removal_pending'} onClick={() => void act('retry')}>{props.i18n.t('common.retry')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status() || status()?.phase === 'removal_pending'}
              onClick={() => leaving() ? void act('leave') : setLeaving(true)}>{props.i18n.t(leaving() ? 'gatewayMembers.confirmLeave' : 'gatewayMembers.leave')}</Button>
          </>}>
            <Button class="cursor-pointer" disabled={busy() || !selectedInvitation() || Boolean(!updatingAddress() && status()?.existing_environment_id && !choice())} onClick={() => void act(updatingAddress() ? 'update-address' : replacing() ? 'replace' : 'join')}>{props.i18n.t(updatingAddress() ? 'gatewayJoin.updateAddress' : replacing() ? 'gatewayJoin.confirmReplace' : 'gatewayJoin.approve')}</Button>
          </Show>
        </div>
      </div>;
  return <Show when={props.embedded} fallback={<>
    <Button ref={trigger} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled}
      onClick={() => { generation++; setOpen(true); setStatus(undefined); setLeaving(false); setReplacing(false); setUpdatingAddress(false); void act('status'); }}>{props.i18n.t('gatewayJoin.title')}</Button>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayJoin.title')}
      bodyDescription={props.i18n.t('gatewayJoin.consent')} closeLabel={props.i18n.t('common.close')}>{body()}</Dialog>
  </>}>{body()}</Show>;
}
