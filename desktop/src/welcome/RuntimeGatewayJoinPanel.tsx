import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { localGatewaySuggestions } from './localGatewaySuggestions';
import { Monitor, ArrowRight, Check } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, Input, StableText, Stepper } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { GatewayJoinPreview, GatewayMembershipOperation, GatewayEnrollmentPurpose } from '../shared/gatewayJoin';
import type { DesktopI18n } from '../shared/i18n';

/** Verification belongs to the selected Runtime; only a verified preview can be confirmed. */
export function RuntimeGatewayJoinPanel(props: Readonly<{
  targetID: DesktopCloudRuntimeLinkTargetID; targetLabel?: string; i18n: DesktopI18n; disabled?: boolean;
  gateways?: readonly DesktopGatewaySource[]; address?: string; code?: string; focusOwner?: () => void;
  purpose?: GatewayEnrollmentPurpose; embedded?: boolean; onClose?: () => void; openRequest?: number; hideTrigger?: boolean;
  connectionRequest?: number; verificationResetRequest?: number; wizard?: boolean; canConnect?: boolean; submissionBlocked?: boolean; runtimeStartedAtUnixMS?: number;
  managementCoordinates?: string; settingsAction?: JSX.Element; preparation?: JSX.Element; preparationActions?: JSX.Element;
}>) {
  const [open, setOpen] = createSignal(false);
  const [address, setAddress] = createSignal(props.address ?? '');
  const [code, setCode] = createSignal(props.code ?? '');
  const [preview, setPreview] = createSignal<GatewayJoinPreview>();
  const [pending, setPending] = createSignal<'connecting' | 'verifying' | 'joining' | null>(null);
  const busy = () => pending() !== null;
  const [error, setError] = createSignal('');
  const [statusError, setStatusError] = createSignal('');
  const purpose = () => props.purpose ?? 'join';
  const canConnect = () => props.canConnect !== false;
  const blocked = () => props.submissionBlocked === true;
  const runtimeStart = createMemo(() => props.runtimeStartedAtUnixMS);
  const managementCoordinates = createMemo(() => props.managementCoordinates);
  const verificationResetRequest = createMemo(() => props.verificationResetRequest);
  const [step, setStep] = createSignal(0);
  const currentStep = createMemo(() => props.wizard ? step() : preview() ? 2 : 1);
  const [now, setNow] = createSignal(Date.now());
  let generation = 0, statusGeneration = 0;
  let trigger: HTMLButtonElement | undefined, addressInput: HTMLInputElement | undefined, codeInput: HTMLInputElement | undefined, confirmButton: HTMLButtonElement | undefined;
  let connectionHeading: HTMLHeadingElement | undefined, confirmationHeading: HTMLHeadingElement | undefined;
  const focusConfirmation = () => props.wizard ? confirmationHeading?.focus({ preventScroll: true }) : confirmButton?.focus();
  let scrollViewport: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastConnectionRequest = 0;
  let lastOpenRequest = props.openRequest ?? 0;
  const expiryTimer = setInterval(() => setNow(Date.now()), 1000);
  const text = props.i18n.t;
  // Snapshot identity is observational; only changed enrollment coordinates reset a draft.
  const targetID = createMemo(() => props.targetID);
  const initialAddress = createMemo(() => props.address ?? '');
  const initialCode = createMemo(() => props.code ?? '');
  const initialPurpose = createMemo(purpose);
  createEffect(on(currentStep, () => {
    if (props.wizard && scrollViewport) scrollViewport.scrollTop = 0;
  }, { defer: true }));
  const suggestions = createMemo(() => localGatewaySuggestions(props.gateways ?? [], props.targetID));
  function fillAddress(value: string) { invalidate(); setAddress(value); queueMicrotask(() => codeInput?.focus()); }
  const invalidate = () => { generation++; setPreview(undefined); setPending(null); setError(''); };
  createEffect(on([targetID, initialAddress, initialCode, initialPurpose], ([, nextAddress, nextCode]) => {
    invalidate(); statusGeneration++; clearTimeout(timer);
    setAddress(nextAddress); setCode(nextCode); setStatusError('');
    if (props.wizard) setStep(0);
    else if (open()) void refresh();
  }));
  createEffect(on(managementCoordinates, () => {
    invalidate(); statusGeneration++; clearTimeout(timer);
    if (props.wizard) setStep(0);
  }, { defer: true }));
  createEffect(on(verificationResetRequest, () => { setPreview(undefined); }, { defer: true }));
  const close = () => { invalidate(); statusGeneration++; clearTimeout(timer); setCode(''); setStep(0); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.()); };
  onCleanup(() => { generation++; statusGeneration++; clearTimeout(timer); clearInterval(expiryTimer); });
  const openDialog = () => { setOpen(true); if (!blocked() && !props.wizard) void refresh(); queueMicrotask(() => { if (props.wizard) connectionHeading?.focus({ preventScroll: true }); else if (!blocked()) addressInput?.focus(); }); };
  let observedRuntimeStart = props.runtimeStartedAtUnixMS;
  createEffect(on(runtimeStart, value => {
    if (!value) return;
    if (observedRuntimeStart && value !== observedRuntimeStart) {
      setPreview(undefined);
      setError(text('gatewayJoin.changed'));
      if (props.wizard && step() === 2 && !busy()) setStep(1);
    }
    observedRuntimeStart = value;
  }));
  createEffect(() => { const request = props.openRequest ?? 0; if (request > 0 && request !== lastOpenRequest) { lastOpenRequest = request; openDialog(); } });
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
  async function connect() {
    if (!canConnect() || blocked() || busy()) return;
    const current = ++statusGeneration;
    setPending('connecting'); setStatusError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'manage_runtime_gateway', runtime_target_id: props.targetID, operation: 'status' });
      if (current !== statusGeneration) return;
      if (!result?.ok || !result.gateway_membership) { setStatusError(text('gatewayJoin.connectFailed')); return; }
      if (preview() && preview()!.expires_at_unix_ms <= Date.now()) { setPreview(undefined); setError(text('gatewayJoin.expired')); }
      setStep(preview() ? 2 : 1);
      queueMicrotask(() => preview() ? focusConfirmation() : addressInput?.focus());
    } catch { if (current === statusGeneration) setStatusError(text('gatewayJoin.connectFailed')); }
    finally { if (current === statusGeneration) setPending(null); }
  }
  createEffect(() => {
    const request = props.connectionRequest ?? 0;
    if (canConnect() && !blocked() && !busy() && request > lastConnectionRequest) { lastConnectionRequest = request; void connect(); }
  });
  async function refresh() {
    if (blocked()) return;
    const current = ++statusGeneration;
    clearTimeout(timer);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation:'status'});
      if (current !== statusGeneration) return;
      if (result?.ok && result.gateway_membership) { setStatusError(''); }
      else setStatusError(text('gatewayJoin.failed'));
    } catch { if (current === statusGeneration) setStatusError(text('gatewayJoin.failed')); }
    finally { if (current === statusGeneration && open()) timer = setTimeout(() => void refresh(),3000); }
  }
  async function verify() {
    if (blocked() || busy()) return;
    invalidate(); const current = generation; const start = runtimeStart(); setPending('verifying');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation:'preview',address:address(),code:code(),purpose:purpose()});
      if (current !== generation) return;
      if (start && runtimeStart() && start !== runtimeStart()) { setError(text('gatewayJoin.changed')); return; }
      if (!result?.ok || !result.gateway_preview) { setError(errorText(result && !result.ok ? result.gateway_error_code : undefined)); return; }
      setPreview(result.gateway_preview); setNow(Date.now()); if (props.wizard) setStep(2);
      queueMicrotask(focusConfirmation);
    } catch { if (current === generation) setError(text('gatewayJoin.unreachable')); }
    finally { if (current === generation) setPending(null); }
  }
  async function act(operation: GatewayMembershipOperation) {
    if (blocked() || busy()) return;
    const current = generation; setPending('joining'); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',runtime_target_id:props.targetID,operation,
        ...(['join','replace','update-endpoints'].includes(operation) ? {preview_id:preview()?.preview_id} : {})});
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_membership) {
        const code = result && !result.ok ? result.gateway_error_code : undefined;
        setError(errorText(code));
        if (code === 'GATEWAY_PREVIEW_CHANGED' || code === 'GATEWAY_PREVIEW_EXPIRED') {
          setPreview(undefined);
        }
        return;
      }
      setPreview(undefined); setCode('');  close();
    } catch { if (current === generation) setError(text('gatewayJoin.failed')); }
    finally {
      if (current === generation) {
        setPending(null);
        if (props.wizard && step() === 2 && !preview()) setStep(1);
      }
    }
  }
  onMount(() => { if (props.embedded) openDialog(); });
  const body = () => <div class="redeven-gateway-join-layout" data-gateway-step={props.wizard ? currentStep() : undefined}>
    <Show when={props.wizard}><div class="redeven-gateway-wizard-steps" aria-label={text('gatewayJoin.title')}>
      <Stepper orientation="horizontal" variant="minimal" size="sm" currentStep={currentStep()} allowClickCompleted={false}
        steps={[{ id: 'environment', label: text('gatewayJoin.connectEnvironment') },
          { id: 'invitation', label: text('gatewayJoin.gatewayInvitation') }, { id: 'confirmation', label: text('gatewayJoin.confirmAccess') }]} />
    </div></Show>
    <div ref={scrollViewport} class="redeven-gateway-join-scroll">
        <div class="redeven-gateway-join-target"><Monitor class="h-4 w-4 shrink-0" /><span class="shrink-0 text-muted-foreground">{text('gatewayJoin.targetRuntime')}</span><strong class="truncate font-medium" title={props.targetLabel ?? props.targetID}>{props.targetLabel ?? props.targetID}</strong></div>
        <Show when={currentStep() === 0}>
          <section class="redeven-gateway-join-section redeven-gateway-connect-stage" aria-busy={busy()}>
            <div class="redeven-gateway-connect-heading">
              <span class="redeven-gateway-connect-icon" aria-hidden="true"><Monitor class="h-5 w-5" /></span>
              <h3 ref={connectionHeading} tabIndex={-1}>{text('gatewayJoin.connectEnvironment')}</h3>
            </div>
            <Show when={canConnect()}><p class="text-sm text-muted-foreground">{text('gatewayJoin.connectHelp')}</p></Show>
            {props.preparation}
            <Show when={statusError()}><p role="alert" class="text-sm text-error">{statusError()}</p></Show>
            <div class="redeven-gateway-step-actions">
              <Show when={canConnect()} fallback={props.preparationActions}>
                <Button class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked()}
                  onClick={() => void connect()}><StableText reserve={[text('gatewayJoin.connectAndContinue'), text('gatewayJoin.connecting'), text('common.retry')]}>{text(pending() === 'connecting' ? 'gatewayJoin.connecting' : statusError() ? 'common.retry' : 'gatewayJoin.connectAndContinue')}</StableText><ArrowRight class="h-4 w-4 shrink-0" aria-hidden="true" /></Button>
              </Show>
              {props.settingsAction}
            </div>
          </section>
        </Show>
        <section class="redeven-gateway-join-section" hidden={props.wizard && currentStep() !== 1}>
          <Show when={props.wizard}><h3>{text('gatewayJoin.gatewayInvitation')}</h3><p class="text-sm text-muted-foreground">{text('gatewayJoin.codeHelp')}</p></Show>
          <div class="redeven-gateway-join-address">
            <label class="redeven-gateway-join-field"><span>{text('gatewayJoin.address')}</span><Input ref={addressInput} value={address()} placeholder="https://gateway.example:7443" autocomplete="off" spellcheck={false} disabled={busy()}
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
          <label class="redeven-gateway-join-field"><span>{text('gatewayJoin.code')}</span><Input ref={codeInput} value={code()} autocomplete="off" spellcheck={false} disabled={busy()}
            onInput={event => { invalidate(); setCode(event.currentTarget.value); }} onKeyDown={event => { if (event.key === 'Enter' && !blocked() && !busy() && address().trim() && code().trim()) { event.preventDefault(); void verify(); } }} /></label>
        </section>
        <Show when={preview()}>{value => <section class="redeven-gateway-join-section" hidden={props.wizard && currentStep() !== 2}>
          <Show when={props.wizard}><h3 ref={confirmationHeading} tabIndex={-1}>{text('gatewayJoin.confirmAccess')}</h3></Show>
          <p class="font-medium text-primary">{text('gatewayJoin.verified')}</p>
          <dl class="redeven-gateway-join-summary"><div><span>{text('gatewayJoin.gateway')}</span><strong>{value().gateway_name}</strong></div><div><span>{text('gatewayJoin.targetRuntime')}</span><strong>{props.targetLabel ?? value().target_runtime_id}</strong></div><div><span>{text('gatewayJoin.expiry')}</span><strong>{new Date(value().expires_at_unix_ms).toLocaleTimeString(props.i18n.locale)}</strong></div></dl>
          <p class="text-sm text-muted-foreground">{text(purpose() === 'update-endpoints' ? 'gatewayJoin.endpointsHelp' : 'gatewayJoin.accessImpact')}</p>
          <Show when={purpose() === 'replace'}><p role="alert" class="text-sm text-warning">{text('gatewayJoin.replaceHelp')}</p></Show>
          <Show when={value().expires_at_unix_ms <= now()}><p role="alert" class="text-sm text-warning">{text('gatewayJoin.expired')}</p></Show>
        </section>}</Show>
      <Show when={props.wizard && currentStep() > 0 && blocked()}><div class="redeven-gateway-connection-notice" data-gateway-connection-blocked>
        {props.preparation}
        <Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()} onClick={() => { setStep(0); setStatusError(''); }}>{text('gatewayJoin.restoreConnection')}</Button>
      </div></Show>
      <Show when={error() || (currentStep() !== 0 && statusError())}><p role="alert" class="text-sm text-error">{error() || statusError()}</p></Show>
      <Show when={!props.wizard || currentStep() > 0}><div class="redeven-gateway-step-actions">
        <Show when={preview() && (!props.wizard || currentStep() === 2)} fallback={<Button class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || !address().trim() || !code().trim()} onClick={() => void verify()}><StableText reserve={[text('gatewayJoin.verify'),text('gatewayJoin.verifying')]}>{text(pending() === 'verifying' ? 'gatewayJoin.verifying' : 'gatewayJoin.verify')}</StableText></Button>}>
          <Button ref={confirmButton} class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || preview()!.expires_at_unix_ms <= now()} onClick={() => void act(purpose())}>{text('gatewayJoin.confirmEnable')}</Button>
        </Show>
      </div></Show>
    </div>
    <div class="redeven-gateway-join-actions">
      <Show when={props.wizard && currentStep() > 0}><Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()}
        onClick={() => { setStep(currentStep() - 1); setError(''); setStatusError(''); queueMicrotask(() => { if (currentStep() === 1) addressInput?.focus(); else connectionHeading?.focus({ preventScroll: true }); }); }}>{text('gatewayJoin.back')}</Button></Show>
      <Button class="cursor-pointer whitespace-nowrap" variant="ghost" onClick={close}>{text('common.cancel')}</Button>
    </div>
  </div>;
  return <Show when={props.embedded} fallback={<><Show when={!props.hideTrigger}><Button ref={trigger} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled} onClick={openDialog}>{text('gatewayJoin.title')}</Button></Show>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={text(purpose() === 'update-endpoints' ? 'gatewayJoin.updateEndpoints' : 'gatewayJoin.title')} bodyDescription={text('gatewayJoin.codeHelp')} closeLabel={text('common.close')} class="redeven-gateway-dialog redeven-gateway-join-dialog" contentClass="redeven-gateway-join-content">{body()}</Dialog>
  </>}>{body()}</Show>;
}
