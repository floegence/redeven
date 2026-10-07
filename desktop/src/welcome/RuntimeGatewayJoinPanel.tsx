import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createEffect, createSignal, onCleanup, onMount, For, Show } from 'solid-js';
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
  openRequest?: number; hideTrigger?: boolean;
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
  let lastOpenRequest = props.openRequest ?? 0;
  const close = () => {
    generation++; clearTimeout(timer); setBusy(false); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.());
  };
  onCleanup(() => { generation++; clearTimeout(timer); });
  const openDialog = () => {
    generation++;
    setOpen(true);
    setStatus(undefined);
    setLeaving(false);
    setReplacing(false);
    setUpdatingAddress(false);
    void act('status');
  };
  createEffect(() => {
    const request = props.openRequest ?? 0;
    if (request > 0 && request !== lastOpenRequest) {
      lastOpenRequest = request;
      openDialog();
    }
  });
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
  const body = () => <div class="space-y-5 p-4">
        <Show when={status()}>{state => <div class="rounded-lg border border-border/70 bg-muted/20 px-4 py-3" role="status" aria-live="polite">
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{props.i18n.t('gatewayJoin.currentStatus')}</p>
          <p class="mt-1 text-sm font-medium">{state().phase ? props.i18n.t(`gatewayMembership.${state().phase}`) : props.i18n.t(state().joined ? 'gatewayMembership.joined' : 'gatewayMembership.not_joined')}</p>
          <Show when={state().publication_error_code}><p role="alert" class="mt-2 text-sm text-warning">{props.i18n.t(state().publication_error_code === 'BINDING_PROOF_REQUIRED' ? 'gatewayJoin.bindingProofRequired' : 'gatewayJoin.cloudUnavailable')}</p></Show>
        </div>}</Show>
        <Show when={status()?.joined === false || replacing() || updatingAddress()}>
          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-medium">{props.i18n.t('gatewayJoin.connectTitle')}</h3>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">{props.i18n.t('gatewayJoin.connectHelp')}</p>
            </div>
            <Show when={props.gateways?.some(gateway => gateway.permissions?.manage_members)}>
              <label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.chooseGateway')}</span>
                <select class="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-3 text-sm disabled:cursor-not-allowed" value={gatewayID()} disabled={busy()}
                  onChange={event => { setGatewayID(event.currentTarget.value); setInvitation(undefined); }}>
                  <option value="">{props.i18n.t('gatewayJoin.importInvitation')}</option>
                  <For each={props.gateways?.filter(gateway => gateway.permissions?.manage_members && gateway.local_enabled)}>{gateway => <option value={gateway.gateway_id}>{gateway.display_name}</option>}</For>
                </select>
              </label>
              <Show when={gatewayID()}><Button class="cursor-pointer" size="sm" variant="outline" disabled={busy()} onClick={() => void createInvitation()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button></Show>
            </Show>
            <Show when={!gatewayID()}><label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.material')}</span>
              <input type="file" accept=".json,application/json" class="block w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-xs disabled:cursor-not-allowed"
                disabled={busy()} onChange={event => void readInvitation(event.currentTarget.files?.[0])} />
            </label></Show>
            <Show when={selectedInvitation()}><p class="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary"><span class="h-1.5 w-1.5 rounded-full bg-primary" />{props.i18n.t('gatewayJoin.invitationReady')}</p></Show>
            <Show when={status()?.rejoin_required}><p role="status" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayJoin.rejoin')}</p></Show>
          </section>
          <Show when={status()?.existing_environment_id && !updatingAddress()}>
            <fieldset class="space-y-2" disabled={busy()}>
              <legend class="text-sm font-medium">{props.i18n.t('gatewayJoin.existingEnvironment')}</legend>
              <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('gatewayJoin.existingEnvironmentHelp')}</p>
              <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border/70 p-3 text-sm transition-colors hover:bg-muted/40"><input class="mt-0.5 cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'preserve'} onChange={() => setChoice('preserve')} /><span><span class="block font-medium">{props.i18n.t('gatewayJoin.preserve')}</span><span class="mt-1 block text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.preserveHelp')}</span></span></label>
              <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border/70 p-3 text-sm transition-colors hover:bg-muted/40"><input class="mt-0.5 cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'new'} onChange={() => setChoice('new')} /><span><span class="block font-medium">{props.i18n.t('gatewayJoin.createNew')}</span><span class="mt-1 block text-xs text-muted-foreground">{props.i18n.t('gatewayJoin.newHelp')}</span></span></label>
            </fieldset>
          </Show>
        </Show>
        <Show when={updatingAddress()}><p role="status" class="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{props.i18n.t('gatewayJoin.addressHelp')}</p></Show>
        <Show when={replacing()}><p role="alert" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayJoin.replaceHelp')}</p></Show>
        <Show when={leaving()}><p role="alert" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p></Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        <p class="text-xs leading-5 text-muted-foreground">{props.i18n.t('gatewayJoin.pauseDetail')}</p>
        <div class="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
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
    <Show when={!props.hideTrigger}>
      <Button ref={trigger} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled}
        onClick={openDialog}>{props.i18n.t('gatewayJoin.title')}</Button>
    </Show>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={props.i18n.t('gatewayJoin.title')}
      bodyDescription={props.i18n.t('gatewayJoin.consent')} closeLabel={props.i18n.t('common.close')} class="w-[min(38rem,calc(100vw-2rem))]">{body()}</Dialog>
  </>}>{body()}</Show>;
}
