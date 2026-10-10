import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { localGatewaySuggestions } from './localGatewaySuggestions';
import { Monitor, ArrowRight, Check } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, Input, StableText } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { GatewayJoinPreview, GatewayMembershipStatus, GatewayMembershipOperation, GatewayEnrollmentPurpose } from '../shared/gatewayJoin';
import type { DesktopI18n } from '../shared/i18n';

/** Verification belongs to the selected Runtime; only a verified preview can be confirmed. */
export function RuntimeGatewayJoinPanel(props: Readonly<{
  targetID: DesktopCloudRuntimeLinkTargetID; targetLabel?: string; i18n: DesktopI18n; disabled?: boolean;
  gateways?: readonly DesktopGatewaySource[]; address?: string; code?: string; focusOwner?: () => void;
  embedded?: boolean; onClose?: () => void; openRequest?: number; hideTrigger?: boolean;
}>) {
  const [open, setOpen] = createSignal(false);
  const [address, setAddress] = createSignal(props.address ?? '');
  const [code, setCode] = createSignal(props.code ?? '');
  const [preview, setPreview] = createSignal<GatewayJoinPreview>();
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<GatewayMembershipStatus>();
  const [error, setError] = createSignal('');
  const [statusError, setStatusError] = createSignal('');
  const [purpose, setPurpose] = createSignal<GatewayEnrollmentPurpose>('join');
  const [leaving, setLeaving] = createSignal(false);
  const [choice, setChoice] = createSignal<'preserve' | 'new'>();
  const [now, setNow] = createSignal(Date.now());
  let generation = 0, statusGeneration = 0;
  let trigger: HTMLButtonElement | undefined, addressInput: HTMLInputElement | undefined, codeInput: HTMLInputElement | undefined, confirmButton: HTMLButtonElement | undefined, firstChoice: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastOpenRequest = props.openRequest ?? 0;
  const expiryTimer = setInterval(() => setNow(Date.now()), 1000);
  const text = props.i18n.t;
  // Snapshot identity is observational; only changed enrollment coordinates reset a draft.
  const targetID = createMemo(() => props.targetID);
  const initialAddress = createMemo(() => props.address ?? '');
  const initialCode = createMemo(() => props.code ?? '');
  const suggestions = createMemo(() => localGatewaySuggestions(props.gateways ?? [], props.targetID));
  function fillAddress(value: string) { invalidate(); setAddress(value); queueMicrotask(() => codeInput?.focus()); }
  const invalidate = () => { generation++; setPreview(undefined); setChoice(undefined); setBusy(false); setError(''); };
  createEffect(on([targetID, initialAddress, initialCode], ([, nextAddress, nextCode]) => {
    invalidate(); statusGeneration++; clearTimeout(timer);
    setAddress(nextAddress); setCode(nextCode); setStatus(undefined); setStatusError(''); setPurpose('join'); setLeaving(false);
    if (open()) void refresh();
  }));
  const close = () => { invalidate(); statusGeneration++; clearTimeout(timer); setCode(''); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.()); };
  onCleanup(() => { generation++; statusGeneration++; clearTimeout(timer); clearInterval(expiryTimer); });
  const openDialog = () => { setOpen(true); setLeaving(false); void refresh(); queueMicrotask(() => addressInput?.focus()); };
  createEffect(() => { const request = props.openRequest ?? 0; if (request > 0 && request !== lastOpenRequest) { lastOpenRequest = request; openDialog(); } });
  const enrolling = () => !status()?.joined || purpose() !== 'join';
  const errorText = (failure: string | undefined) => {
    switch (failure) {
      case 'GATEWAY_INVITATION_EXPIRED': case 'GATEWAY_PREVIEW_EXPIRED': return text('gatewayJoin.expired');
      case 'GATEWAY_INVITATION_USED': return text('gatewayJoin.used');
      case 'INVITATION_AUTHENTICATION_FAILED': case 'GATEWAY_INVITATION_INVALID': return text('gatewayJoin.invalid');
      case 'INVITATION_TLS_IDENTITY_FAILED': case 'GATEWAY_IDENTITY_FAILED': return text('gatewayJoin.identityFailed');
      case 'GATEWAY_PREVIEW_CHANGED': case 'GATEWAY_MEMBERSHIP_CONFLICT': return text('gatewayJoin.changed');
      default: return text('gatewayJoin.unreachable');
    }
  };
  async function refresh() {
    const current = ++statusGeneration;
    clearTimeout(timer);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation:'status'});
      if (current !== statusGeneration) return;
      if (result?.ok && result.gateway_membership) { setStatus(result.gateway_membership); setStatusError(''); }
      else setStatusError(text('gatewayJoin.failed'));
    } catch { if (current === statusGeneration) setStatusError(text('gatewayJoin.failed')); }
    finally { if (current === statusGeneration && open()) timer = setTimeout(() => void refresh(),3000); }
  }
  async function verify() {
    invalidate(); const current = generation; setBusy(true);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation:'preview',address:address(),code:code(),purpose:purpose()});
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_preview) { setError(errorText(result && !result.ok ? result.gateway_error_code : undefined)); return; }
      setPreview(result.gateway_preview); setNow(Date.now());
      queueMicrotask(() => result.gateway_preview?.existing_environment_id && purpose()!=='update-endpoints' ? firstChoice?.focus() : confirmButton?.focus());
    } catch { if (current === generation) setError(text('gatewayJoin.unreachable')); }
    finally { if (current === generation) setBusy(false); }
  }
  async function act(operation: GatewayMembershipOperation) {
    const current = generation; setBusy(true); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation,
        ...(['join','replace','update-endpoints'].includes(operation) ? {preview_id:preview()?.preview_id,...(choice() ? {environment_choice:choice()} : {})} : {})});
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_membership) { setError(result && !result.ok ? errorText(result.gateway_error_code) : text('gatewayJoin.failed')); return; }
      setStatus(result.gateway_membership); setPreview(undefined); setCode(''); setPurpose('join'); setLeaving(false);
    } catch { if (current === generation) setError(text('gatewayJoin.failed')); }
    finally { if (current === generation) setBusy(false); }
  }
  onMount(() => { if (props.embedded) openDialog(); });
  const changePurpose = (next: GatewayEnrollmentPurpose) => { invalidate(); setPurpose(next); queueMicrotask(() => addressInput?.focus()); };
  const body = () => <div class="redeven-gateway-join-layout">
    <div class="redeven-gateway-join-scroll">
      <Show when={enrolling()} fallback={<section class="redeven-gateway-join-section">
        <p role="status">{text(`gatewayMembership.${status()!.phase}`)}</p>
        <Show when={status()?.publication_error_code}><p role="alert">{text(status()?.publication_error_code === 'BINDING_PROOF_REQUIRED' ? 'gatewayJoin.bindingProofRequired' : 'gatewayJoin.cloudUnavailable')}</p></Show>
        <Show when={leaving()}><p role="alert" class="text-warning">{text('gatewayMembers.leaveImpact')}</p></Show>
      </section>}>
        <section class="redeven-gateway-join-section">
          <div class="redeven-gateway-join-target"><Monitor class="h-4 w-4 shrink-0" /><span class="shrink-0 text-muted-foreground">{text('gatewayJoin.targetRuntime')}</span><strong class="truncate font-medium" title={props.targetLabel ?? props.targetID}>{props.targetLabel ?? props.targetID}</strong></div>
          <div class="redeven-gateway-join-address">
            <label class="block space-y-2 text-sm"><span>{text('gatewayJoin.address')}</span><Input ref={addressInput} value={address()} placeholder="https://gateway.example:7443" autocomplete="off" spellcheck={false} disabled={busy()}
              onInput={event => { invalidate(); setAddress(event.currentTarget.value); }} /></label>
            <Show when={suggestions().length}><div class="redeven-gateway-local-suggestions">
              <For each={suggestions()}>{suggestion => {
                const selected = () => address().trim() === suggestion.address;
                const multipleEndpoints = () => suggestions().filter(item => item.gatewayID === suggestion.gatewayID).length > 1;
                return <Button data-gateway-suggestion={suggestion.gatewayID} class="redeven-gateway-local-suggestion min-w-0 cursor-pointer" variant="ghost" disabled={busy()} aria-pressed={selected()} aria-label={text('gatewayDiscovery.useNamed',{name:suggestion.name,address:suggestion.address})} title={`${suggestion.name}\n${suggestion.address}`} onClick={() => fillAddress(suggestion.address)}>
                  <Monitor class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span data-gateway-local-label class="redeven-gateway-local-label">{text('gatewayDiscovery.local')}</span>
                  <span class="redeven-gateway-local-name truncate" classList={{'font-mono':multipleEndpoints()}}>{multipleEndpoints() ? new URL(suggestion.address).host : suggestion.name}</span>
                  <span class="redeven-gateway-local-action"><StableText reserve={[text('gatewayDiscovery.useAddress'),text('gatewayDiscovery.filled')]}>{text(selected() ? 'gatewayDiscovery.filled' : 'gatewayDiscovery.useAddress')}</StableText><Show when={selected()} fallback={<ArrowRight class="h-3.5 w-3.5" aria-hidden="true" />}><Check class="h-3.5 w-3.5" aria-hidden="true" /></Show></span>
                </Button>;
              }}</For>
            </div></Show>
          </div>
          <label class="block space-y-2 text-sm"><span>{text('gatewayJoin.code')}</span><Input ref={codeInput} value={code()} autocomplete="off" spellcheck={false} disabled={busy()}
            onInput={event => { invalidate(); setCode(event.currentTarget.value); }} onKeyDown={event => { if (event.key === 'Enter' && !busy() && address().trim() && code().trim()) { event.preventDefault(); void verify(); } }} /></label>
        </section>
        <Show when={preview()}>{value => <section class="redeven-gateway-join-section">
          <p class="font-medium text-primary">{text('gatewayJoin.verified')}</p>
          <dl class="redeven-gateway-join-summary"><div><span>{text('gatewayJoin.gateway')}</span><strong>{value().gateway_name}</strong></div><div><span>{text('gatewayJoin.targetRuntime')}</span><strong>{props.targetLabel ?? value().target_runtime_id}</strong></div><div><span>{text('gatewayJoin.expiry')}</span><strong>{new Date(value().expires_at_unix_ms).toLocaleTimeString(props.i18n.locale)}</strong></div></dl>
          <p class="text-sm text-muted-foreground">{text(purpose() === 'update-endpoints' ? 'gatewayJoin.endpointsHelp' : 'gatewayJoin.accessImpact')}</p>
          <Show when={purpose() === 'replace'}><p role="alert" class="text-sm text-warning">{text('gatewayJoin.replaceHelp')}</p></Show>
          <Show when={value().existing_environment_id && purpose() !== 'update-endpoints'}><fieldset class="space-y-3" disabled={busy()}>
            <legend class="font-medium">{text('gatewayJoin.existingEnvironment')}</legend>
            <label class="redeven-gateway-join-choice flex cursor-pointer gap-3"><input ref={firstChoice} type="radio" name="gateway-cloud-choice" class="shrink-0 cursor-pointer" checked={choice()==='preserve'} onChange={() => setChoice('preserve')} /><span><strong>{text('gatewayJoin.preserve')}</strong><p class="mt-1 text-sm text-muted-foreground">{text('gatewayJoin.preserveHelp')}</p></span></label>
            <label class="redeven-gateway-join-choice flex cursor-pointer gap-3"><input type="radio" name="gateway-cloud-choice" class="shrink-0 cursor-pointer" checked={choice()==='new'} onChange={() => setChoice('new')} /><span><strong>{text('gatewayJoin.createNew')}</strong><p class="mt-1 text-sm text-muted-foreground">{text('gatewayJoin.newHelp')}</p></span></label>
          </fieldset></Show>
          <Show when={value().expires_at_unix_ms <= now()}><p role="alert" class="text-sm text-warning">{text('gatewayJoin.expired')}</p></Show>
        </section>}</Show>
      </Show>
      <Show when={error() || statusError()}><p role="alert" class="text-sm text-error">{error() || statusError()}</p></Show>
    </div>
    <div class="redeven-gateway-join-actions flex-wrap">
      <Button class="cursor-pointer whitespace-nowrap" variant="ghost" onClick={close}>{text('common.cancel')}</Button>
      <Show when={enrolling()} fallback={<>
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()} onClick={() => void refresh()}>{text('common.refresh')}</Button>
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()} onClick={() => changePurpose('update-endpoints')}>{text('gatewayJoin.updateEndpoints')}</Button>
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()} onClick={() => changePurpose('replace')}>{text('gatewayJoin.replace')}</Button>
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy() || status()?.phase==='removal_pending'} onClick={() => void act('retry')}>{text('common.retry')}</Button>
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy() || status()?.phase==='removal_pending'} onClick={() => leaving() ? void act('leave') : setLeaving(true)}>{text(leaving() ? 'gatewayMembers.confirmLeave' : 'gatewayMembers.leave')}</Button>
      </>}>
        <Show when={preview()} fallback={<Button class="cursor-pointer whitespace-nowrap" disabled={busy() || !address().trim() || !code().trim()} onClick={() => void verify()}><StableText reserve={[text('gatewayJoin.verify'),text('gatewayJoin.verifying')]}>{text(busy() ? 'gatewayJoin.verifying' : 'gatewayJoin.verify')}</StableText></Button>}>
          <Button ref={confirmButton} class="cursor-pointer whitespace-nowrap" disabled={busy() || preview()!.expires_at_unix_ms <= now() || Boolean(preview()!.existing_environment_id && purpose() !== 'update-endpoints' && !choice())} onClick={() => void act(purpose())}>{text('gatewayJoin.confirmEnable')}</Button>
        </Show>
      </Show>
    </div>
  </div>;
  return <Show when={props.embedded} fallback={<><Show when={!props.hideTrigger}><Button ref={trigger} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled} onClick={openDialog}>{text('gatewayJoin.title')}</Button></Show>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={text('gatewayJoin.title')} bodyDescription={text('gatewayJoin.codeHelp')} closeLabel={text('common.close')} class="redeven-gateway-dialog redeven-gateway-join-dialog" contentClass="redeven-gateway-join-content">{body()}</Dialog>
  </>}>{body()}</Show>;
}
