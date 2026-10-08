import { ChevronDown, Info } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { createEffect, createSignal, onCleanup, onMount, For, Show, type JSX } from 'solid-js';
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
  const [updatingEndpoints, setUpdatingEndpoints] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [gatewayID, setGatewayID] = createSignal('');
  const [choice, setChoice] = createSignal<'preserve' | 'new'>();
  const [invitationFileName, setInvitationFileName] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const expiryTimer = setInterval(() => setNow(Date.now()), 1000);
  let generation = 0;
  let trigger: HTMLButtonElement | undefined;
  let invitationInput: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastOpenRequest = props.openRequest ?? 0;
  const close = () => {
    generation++; clearTimeout(timer); setBusy(false); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.());
  };
  onCleanup(() => { generation++; clearTimeout(timer); clearInterval(expiryTimer); });
  const openDialog = () => {
    generation++;
    setOpen(true);
    setStatus(undefined);
    setLeaving(false);
    setReplacing(false);
    setUpdatingEndpoints(false);
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
    setInvitation(undefined);
    setInvitationFileName('');
    const current = generation;
    try {
      if (file.size > 64 * 1024) throw new Error();
      const parsed = normalizeGatewayInvitation(JSON.parse(await file.text()));
      if (!parsed) throw new Error();
      if (current === generation) {
        setInvitation(parsed);
        setInvitationFileName(file.name || '');
      }
    } catch { if (current === generation) setError(props.i18n.t('gatewayJoin.invalid')); }
  }
  async function act(operation: GatewayMembershipOperation) {
    const current = generation;
    clearTimeout(timer); setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'manage_runtime_gateway', runtime_target_id: props.targetID,
        operation, ...((operation === 'join' || operation === 'replace' || operation === 'update-endpoints') ? { invitation: invitation() ?? props.invitation, ...((operation === 'join' || operation === 'replace') && choice() ? { environment_choice: choice() } : {}) } : {}) });
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_membership) throw new Error();
      setStatus(result.gateway_membership);
      // Observation never consumes an invitation or dismisses local consent.
      if (operation !== 'status') {
        setLeaving(false); setReplacing(false); setUpdatingEndpoints(false);
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
  const invitationExpiry = (value: number) => props.i18n.t('gatewayJoin.expiresIn', {
    minutes: Math.max(0, Math.ceil((value - now()) / 60_000)),
  });
  const statusLabel = (state: GatewayMembershipStatus) => state.phase
    ? props.i18n.t(`gatewayMembership.${state.phase}`)
    : props.i18n.t(state.joined ? 'gatewayMembership.joined' : 'gatewayMembership.not_joined');
  const disclosure = (label: string, content: JSX.Element) => <details class="group rounded-md border border-border/60 text-xs">
    <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground [&::-webkit-details-marker]:hidden">
      <span class="flex items-center gap-2"><Info class="h-3.5 w-3.5" aria-hidden="true" />{label}</span>
      <ChevronDown class="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true" />
    </summary>
    <div class="border-t border-border/50 px-3 py-2.5 leading-5 text-muted-foreground">{content}</div>
  </details>;
  const body = () => <div class="space-y-5 p-4">
        <Show when={status()}>{state => <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5" role="status" aria-live="polite">
          <span class="text-xs font-medium text-muted-foreground">{props.i18n.t('gatewayJoin.currentStatus')}</span>
          <span class="flex min-w-0 items-center gap-2 text-sm font-medium"><span class="h-2 w-2 shrink-0 rounded-full" classList={{ 'bg-success': state().joined && !['gateway_offline', 'joining', 'reauthorization_required', 'removal_pending'].includes(state().phase), 'bg-muted-foreground': !state().joined, 'bg-warning': state().joined && ['gateway_offline', 'joining', 'reauthorization_required', 'removal_pending'].includes(state().phase) }} />{statusLabel(state())}</span>
          <Show when={state().publication_error_code}><p role="alert" class="basis-full text-sm text-warning">{props.i18n.t(state().publication_error_code === 'BINDING_PROOF_REQUIRED' ? 'gatewayJoin.bindingProofRequired' : 'gatewayJoin.cloudUnavailable')}</p></Show>
        </div>}</Show>
        <Show when={status()?.joined === false || replacing() || updatingEndpoints()}>
          <section class="space-y-3">
            <h3 class="text-sm font-medium">{props.i18n.t('gatewayJoin.connectTitle')}</h3>
            <Show when={props.gateways?.some(gateway => gateway.permissions?.manage_members)}>
              <label class="block space-y-2 text-sm"><span>{props.i18n.t('gatewayJoin.chooseGateway')}</span>
                <select class="h-9 w-full cursor-pointer rounded-md border border-border bg-background px-3 text-sm disabled:cursor-not-allowed" value={gatewayID()} disabled={busy()}
                  onChange={event => { setGatewayID(event.currentTarget.value); setInvitation(undefined); setInvitationFileName(''); }}>
                  <option value="">{props.i18n.t('gatewayJoin.importInvitation')}</option>
                  <For each={props.gateways?.filter(gateway => gateway.permissions?.manage_members && gateway.local_enabled && gateway.member_endpoints?.length)}>{gateway => <option value={gateway.gateway_id}>{gateway.display_name}</option>}</For>
                </select>
              </label>
              <Show when={gatewayID()}><Button class="cursor-pointer" size="sm" variant="outline" disabled={busy()} onClick={() => void createInvitation()}>{props.i18n.t('gatewayMembers.createInvitation')}</Button></Show>
            </Show>
            <Show when={!gatewayID()}><div class="space-y-2">
              <span class="block text-sm">{props.i18n.t('gatewayJoin.material')}</span>
              <div class="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
                <Button class="shrink-0 cursor-pointer" size="sm" variant="outline" disabled={busy()} onClick={() => invitationInput?.click()}>{props.i18n.t('gatewayJoin.chooseFile')}</Button>
                <span class="min-w-0 truncate text-xs text-muted-foreground">{invitationFileName() || props.i18n.t('gatewayJoin.noFile')}</span>
              </div>
              <input ref={invitationInput} id="gateway-invitation-file" type="file" accept=".json,application/json" class="sr-only"
                disabled={busy()} onChange={event => void readInvitation(event.currentTarget.files?.[0])} />
            </div></Show>
            <Show when={selectedInvitation()}>{current => <div class="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p class="flex items-center gap-2 text-xs font-medium text-primary"><span class="h-1.5 w-1.5 rounded-full bg-primary" />{props.i18n.t('gatewayJoin.invitationReady')}</p>
              <div class="grid gap-2 text-xs sm:grid-cols-2">
                <div class="min-w-0"><span class="block text-muted-foreground">{props.i18n.t('gatewayJoin.gateway')}</span><strong class="break-words">{current().gateway_name}</strong></div>
                <div><span class="block text-muted-foreground">{props.i18n.t('gatewayJoin.connectionOptions')}</span><strong>{current().endpoints.length}</strong></div>
                <div><span class="block text-muted-foreground">{props.i18n.t('gatewayJoin.invitationType')}</span><strong>{props.i18n.t('gatewayJoin.oneTime')}</strong></div>
                <div><span class="block text-muted-foreground">{props.i18n.t('gatewayJoin.expiry')}</span><strong>{invitationExpiry(current().expires_at_unix_ms)}</strong></div>
                <div><span class="block text-muted-foreground">{props.i18n.t('gatewayJoin.selection')}</span><strong>{props.i18n.t('gatewayJoin.automatic')}</strong></div>
              </div>
              <details class="group rounded-md border border-border/60 text-xs">
                <summary class="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden">{props.i18n.t('gatewayJoin.technicalDetails')}<ChevronDown class="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" /></summary>
                <div class="space-y-1 border-t border-border/50 px-3 py-2 text-muted-foreground"><For each={current().endpoints}>{endpoint => <div class="flex items-center justify-between gap-2"><span>{endpoint.scope}</span><span class="truncate font-mono">{endpoint.address}</span></div>}</For></div>
              </details>
            </div>}</Show>
            <Show when={status()?.rejoin_required}><p role="status" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayJoin.rejoin')}</p></Show>
            {disclosure(props.i18n.t('gatewayJoin.aboutConnection'), props.i18n.t('gatewayJoin.connectHelp'))}
          </section>
          <Show when={status()?.existing_environment_id && !updatingEndpoints()}>
            <fieldset class="space-y-2" disabled={busy()}>
              <legend class="text-sm font-medium">{props.i18n.t('gatewayJoin.existingEnvironment')}</legend>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"><input class="cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'preserve'} onChange={() => setChoice('preserve')} /><span class="font-medium">{props.i18n.t('gatewayJoin.preserve')}</span></label>
                <label class="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"><input class="cursor-pointer disabled:cursor-not-allowed" type="radio" name="gateway-environment-choice" checked={choice() === 'new'} onChange={() => setChoice('new')} /><span class="font-medium">{props.i18n.t('gatewayJoin.createNew')}</span></label>
              </div>
              {disclosure(props.i18n.t('gatewayJoin.choiceDetails'), <div class="space-y-2">
                <p>{props.i18n.t('gatewayJoin.existingEnvironmentHelp')}</p>
                <p><strong class="font-medium text-foreground">{props.i18n.t('gatewayJoin.preserve')}:</strong> {props.i18n.t('gatewayJoin.preserveHelp')}</p>
                <p><strong class="font-medium text-foreground">{props.i18n.t('gatewayJoin.createNew')}:</strong> {props.i18n.t('gatewayJoin.newHelp')}</p>
              </div>)}
            </fieldset>
          </Show>
        </Show>
        <Show when={updatingEndpoints()}><p role="status" class="rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{props.i18n.t('gatewayJoin.endpointsHelp')}</p></Show>
        <Show when={replacing()}><p role="alert" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayJoin.replaceHelp')}</p></Show>
        <Show when={leaving()}><p role="alert" class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{props.i18n.t('gatewayMembers.leaveImpact')}</p></Show>
        <Show when={error()}><p role="alert" class="text-sm text-error">{error()}</p></Show>
        {disclosure(props.i18n.t('gatewayJoin.impactDetails'), props.i18n.t('gatewayJoin.pauseDetail'))}
        <div class="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
          <Button class="cursor-pointer" variant="ghost" onClick={close}>{props.i18n.t('common.close')}</Button>
          <Button class="cursor-pointer" variant="outline" disabled={busy()} onClick={() => void act('status')}>{props.i18n.t('common.refresh')}</Button>
          <Show when={status()?.joined === false || replacing() || updatingEndpoints()} fallback={<>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status()} onClick={() => { setUpdatingEndpoints(true); setChoice(undefined); }}>{props.i18n.t('gatewayJoin.updateEndpoints')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status()} onClick={() => { setReplacing(true); setChoice(undefined); }}>{props.i18n.t('gatewayJoin.replace')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status() || status()?.phase === 'removal_pending'} onClick={() => void act('retry')}>{props.i18n.t('common.retry')}</Button>
            <Button class="cursor-pointer" variant="outline" disabled={busy() || !status() || status()?.phase === 'removal_pending'}
              onClick={() => leaving() ? void act('leave') : setLeaving(true)}>{props.i18n.t(leaving() ? 'gatewayMembers.confirmLeave' : 'gatewayMembers.leave')}</Button>
          </>}>
            <Button class="cursor-pointer" disabled={busy() || !selectedInvitation() || selectedInvitation()!.expires_at_unix_ms <= now() || Boolean(!updatingEndpoints() && status()?.existing_environment_id && !choice())} onClick={() => void act(updatingEndpoints() ? 'update-endpoints' : replacing() ? 'replace' : 'join')}>{props.i18n.t(updatingEndpoints() ? 'gatewayJoin.updateEndpoints' : replacing() ? 'gatewayJoin.confirmReplace' : 'gatewayJoin.approve')}</Button>
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
