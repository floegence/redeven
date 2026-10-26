import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { localGatewaySuggestions } from './localGatewaySuggestions';
import { Monitor, ArrowRight } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, Input, KeyedFor, StableText, Stepper, Tabs, TabPanel } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { GatewayJoinPreview, GatewayMembershipOperation, GatewayEnrollmentPurpose } from '../shared/gatewayJoin';
import type { DesktopI18n } from '../shared/i18n';

let nextConnectionToken = Date.now();
export type RuntimeGatewayPreparationResult = Readonly<{ ok: boolean; authenticationRequired?: boolean }>;

/** Verification belongs to the selected Runtime; only a verified preview can be confirmed. */
export function RuntimeGatewayJoinPanel(props: Readonly<{
  targetID: DesktopCloudRuntimeLinkTargetID; targetLabel?: string; i18n: DesktopI18n; disabled?: boolean;
  gateways?: readonly DesktopGatewaySource[]; address?: string; code?: string; focusOwner?: () => void;
  purpose?: GatewayEnrollmentPurpose; embedded?: boolean; onClose?: () => void; openRequest?: number; hideTrigger?: boolean;
  connectionRequest?: number; wizard?: boolean; canConnect?: boolean; submissionBlocked?: boolean; runtimeStartedAtUnixMS?: number;
  managementCoordinates?: string; settingsAction?: JSX.Element; preparation?: JSX.Element; preparationActions?: JSX.Element;
  preparationAction?: Readonly<{ label: string; disabled: boolean; run: (sshPassword?: string) => Promise<RuntimeGatewayPreparationResult> }>;
  authorityKey?: string;
  suspended?: boolean;
  onPreparationRequired?: (failure: 'runtime_not_started' | 'SECURITY_RESTART_REQUIRED' | 'SETTINGS_RUNTIME_INCOMPATIBLE') => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const [address, setAddress] = createSignal(props.address ?? '');
  const [code, setCode] = createSignal(props.code ?? '');
  const [preview, setPreview] = createSignal<GatewayJoinPreview>();
  const [previewInvalidated, setPreviewInvalidated] = createSignal(false);
  const [pending, setPending] = createSignal<'preparing' | 'connecting' | 'verifying' | 'joining' | null>(null);
  const busy = () => pending() !== null;
  const [error, setError] = createSignal('');
  const [statusError, setStatusError] = createSignal('');
  const [authenticationRequired, setAuthenticationRequired] = createSignal(false);
  const [password, setPassword] = createSignal('');
  const [connectionLost, setConnectionLost] = createSignal(false);
  let passwordInput: HTMLInputElement | undefined;
  let connection: { runtime_target_id: DesktopCloudRuntimeLinkTargetID; connection_token: number } | undefined;
  const connectionScope = () => connection ??= { runtime_target_id: props.targetID, connection_token: ++nextConnectionToken };
  const releaseConnection = () => {
    const previous = connection;
    connection = undefined;
    setPassword(''); setAuthenticationRequired(false); setConnectionLost(false);
    if (previous) void window.redevenDesktopLauncher?.performAction({ kind: 'close_runtime_gateway', ...previous }).catch(() => undefined);
  };
  const purpose = () => props.purpose ?? 'join';
  const canConnect = () => props.canConnect !== false;
  const blocked = () => props.suspended === true || props.submissionBlocked === true;
  const runtimeStart = createMemo(() => props.runtimeStartedAtUnixMS);
  const managementCoordinates = createMemo(() => props.managementCoordinates);
  const authorityKey = createMemo(() => props.authorityKey);
  const [step, setStep] = createSignal(0);
  const currentStep = createMemo(() => props.wizard ? step() : preview() ? 2 : 1);
  const [now, setNow] = createSignal(Date.now());
  let generation = 0, statusGeneration = 0;
  let trigger: HTMLButtonElement | undefined, addressInput: HTMLInputElement | undefined, savedGatewayInput: HTMLSelectElement | undefined, codeInput: HTMLInputElement | undefined, confirmButton: HTMLButtonElement | undefined;
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
  const suggestions = createMemo(() => localGatewaySuggestions(props.gateways ?? [], props.targetID));
  type AddressMode = 'saved' | 'new';
  const initialSavedAddress = () => suggestions().find(suggestion => suggestion.address === initialAddress().trim())?.address ?? '';
  const [addressMode, setAddressMode] = createSignal<AddressMode>(suggestions().length && (!initialAddress().trim() || initialSavedAddress()) ? 'saved' : 'new');
  const [savedAddress, setSavedAddress] = createSignal(initialSavedAddress());
  const addressTabsID = createUniqueId();
  const savedTabID = `${addressTabsID}-saved-tab`, newTabID = `${addressTabsID}-new-tab`;
  const savedPanelID = `${addressTabsID}-saved-panel`, newPanelID = `${addressTabsID}-new-panel`;
  const selectedSavedAddress = createMemo(() => suggestions().find(suggestion => suggestion.address === savedAddress())?.address ?? '');
  const effectiveAddress = createMemo(() => addressMode() === 'saved' ? selectedSavedAddress() : address().trim());
  const focusAddress = () => (addressMode() === 'saved' ? savedGatewayInput : addressInput)?.focus();
  const changeAddressMode = (mode: AddressMode) => {
    if (mode === addressMode()) return;
    setAddressMode(mode);
    invalidate();
  };
  const updateSavedAddress = (value: string) => {
    const previousAddress = effectiveAddress();
    setSavedAddress(value);
    if (previousAddress !== value) invalidate();
  };
  const manualAddressField = () => <label class="redeven-gateway-join-field"><span>{text('gatewayJoin.address')}</span><Input ref={addressInput} value={address()} placeholder="https://gateway.example:7443" autocomplete="off" spellcheck={false} disabled={busy()}
    onInput={event => { invalidate(); setAddress(event.currentTarget.value); }} /></label>;
  const invalidate = () => { generation++; setPreview(undefined); setPending(null); setError(''); };
  const chooseInitialAddress = (value: string) => {
    const matching = suggestions().find(suggestion => suggestion.address === value.trim());
    setAddress(value);
    setSavedAddress(matching?.address ?? '');
    setAddressMode(matching ? 'saved' : value.trim() || !suggestions().length ? 'new' : 'saved');
  };
  createEffect(on(suggestions, available => {
    const selected = savedAddress();
    if (selected && !available.some(suggestion => suggestion.address === selected)) {
      setSavedAddress('');
      if (addressMode() === 'saved') invalidate();
    }
    if (!available.length && addressMode() === 'saved') {
      setAddressMode('new');
      invalidate();
    }
  }, { defer: true }));
  createEffect(on(currentStep, () => {
    if (props.wizard && scrollViewport) scrollViewport.scrollTop = 0;
  }, { defer: true }));
  createEffect(on([initialAddress, initialCode, initialPurpose], ([nextAddress, nextCode]) => {
    if (open()) return;
    invalidate(); chooseInitialAddress(nextAddress); setCode(nextCode);
  }));
  // IMPORTANT: Identity changes revoke verification, never the user's draft or current step.
  createEffect(on([targetID, managementCoordinates, authorityKey], () => {
    releaseConnection();
    generation++; statusGeneration++; clearTimeout(timer); setPending(null);
    if (open()) { setPreviewInvalidated(true); setError(text('gatewayJoin.changed')); }
  }, { defer: true }));
  const close = () => { invalidate(); statusGeneration++; clearTimeout(timer); releaseConnection(); setCode(''); setStep(0); setOpen(false); props.onClose?.();
    queueMicrotask(() => trigger?.isConnected ? trigger.focus() : props.focusOwner?.()); };
  onCleanup(() => { generation++; statusGeneration++; clearTimeout(timer); clearInterval(expiryTimer); releaseConnection(); });
  const focusConnection = () => authenticationRequired() ? passwordInput?.focus() : connectionHeading?.focus({ preventScroll: true });
  const openDialog = () => { setOpen(true); if (!blocked() && !props.wizard) void refresh(); queueMicrotask(() => { if (props.wizard) focusConnection(); else if (!blocked()) focusAddress(); }); };
  createEffect(on(() => props.suspended === true, suspended => {
    if (suspended) {
      generation++; statusGeneration++; clearTimeout(timer); setPending(null); releaseConnection();
      setConnectionLost(true); setPreviewInvalidated(true);
    } else {
      setConnectionLost(true);
      queueMicrotask(() => { if (currentStep() === 0 || connectionLost()) focusConnection(); });
    }
  }, { defer: true }));
  let observedRuntimeStart = props.runtimeStartedAtUnixMS;
  createEffect(on(runtimeStart, value => {
    if (!value) return;
    if (observedRuntimeStart && value !== observedRuntimeStart) {
      generation++;
      if (pending() !== 'preparing') { statusGeneration++; setPending(null); }
      setPreviewInvalidated(true);
      setError(text('gatewayJoin.changed'));
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
  const connectionFailure = (failure?: string) => {
    if (props.onPreparationRequired && (failure === 'runtime_not_started' || failure === 'SECURITY_RESTART_REQUIRED' || failure === 'SETTINGS_RUNTIME_INCOMPATIBLE')) {
      clearTimeout(timer); setConnectionLost(true); setAuthenticationRequired(false); setPassword(''); setStatusError('');
      if (preview()) setPreviewInvalidated(true);
      props.onPreparationRequired(failure);
      return true;
    }
    const needsPassword = failure === 'SSH_AUTHENTICATION_REQUIRED';
    const rejectedPassword = needsPassword && authenticationRequired() && password() !== '';
    const transportFailure = needsPassword || ['RUNTIME_CONTROL_UNREACHABLE', 'RUNTIME_CONTROL_TIMEOUT', 'GATEWAY_CONNECTION_CLOSED', 'runtime_not_started'].includes(failure ?? '');
    if (!transportFailure) return false;
    clearTimeout(timer);
    if (failure === 'GATEWAY_CONNECTION_CLOSED') releaseConnection();
    setConnectionLost(true); setAuthenticationRequired(needsPassword); setPassword('');
    setStatusError(text(rejectedPassword ? 'gatewayJoin.sshAuthenticationFailed' : needsPassword ? 'gatewayJoin.sshAuthenticationRequired' : 'gatewayJoin.connectFailed'));
    if (preview()) setPreviewInvalidated(true);
    if (needsPassword) queueMicrotask(() => passwordInput?.focus());
    return true;
  };
  const passwordHelpID = createUniqueId();
  const passwordField = () => <Show when={authenticationRequired()}>
    <label class="redeven-gateway-join-field"><span>{text('gatewayJoin.sshPassword')}</span>
      <Input ref={passwordInput} type="password" autocomplete="current-password" value={password()} disabled={busy()}
        aria-describedby={passwordHelpID} onInput={event => setPassword(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && password() && !busy()) { event.preventDefault(); void (canConnect() ? connect() : prepare()); } }} />
    </label>
    <p id={passwordHelpID} class="text-sm text-muted-foreground">{text('gatewayJoin.sshPasswordHelp')}</p>
  </Show>;
  async function prepare() {
    const action = props.preparationAction;
    if (!action || action.disabled || props.suspended || busy() || authenticationRequired() && !password()) return;
    const current = ++statusGeneration;
    setPending('preparing'); setStatusError('');
    try {
      const result = await action.run(authenticationRequired() ? password() : undefined);
      if (current !== statusGeneration) return;
      if (result.authenticationRequired) connectionFailure('SSH_AUTHENTICATION_REQUIRED');
      else {
        setAuthenticationRequired(false); setPassword('');
        if (result.ok) { generation++; setPreviewInvalidated(true); }
      }
    } finally { if (current === statusGeneration) { setPending(null); setPassword(''); } }
  }
  async function connect() {
    if (!canConnect() || blocked() || busy() || authenticationRequired() && !password()) return;
    const current = ++statusGeneration;
    setPending('connecting'); setStatusError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({ kind: 'manage_runtime_gateway', ...connectionScope(), operation: 'status',
        ...(authenticationRequired() ? { ssh_password: password() } : {}) });
      if (current !== statusGeneration) return;
      if (!result?.ok || !result.gateway_membership) {
        if (!connectionFailure(result && !result.ok ? result.gateway_error_code ?? result.code : undefined)) setStatusError(text('gatewayJoin.connectFailed'));
        return;
      }
      setPassword(''); setAuthenticationRequired(false); setConnectionLost(false);
      if (!props.wizard && open()) { clearTimeout(timer); timer = setTimeout(() => void refresh(), 3000); }
      if (preview() && preview()!.expires_at_unix_ms <= Date.now()) { setPreview(undefined); setError(text('gatewayJoin.expired')); }
      setStep(preview() ? 2 : 1);
      queueMicrotask(() => preview() ? focusConfirmation() : focusAddress());
    } catch { if (current === statusGeneration) connectionFailure('RUNTIME_CONTROL_UNREACHABLE'); }
    finally { if (current === statusGeneration) { setPending(null); setPassword(''); } }
  }
  createEffect(() => {
    const request = props.connectionRequest ?? 0;
    if (canConnect() && !blocked() && !busy() && request > lastConnectionRequest) { lastConnectionRequest = request; void connect(); }
  });
  async function refresh() {
    if (blocked() || connectionLost()) return;
    const current = ++statusGeneration;
    clearTimeout(timer);
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',...connectionScope(),operation:'status'});
      if (current !== statusGeneration) return;
      if (result?.ok && result.gateway_membership) { setStatusError(''); }
      else if (!connectionFailure(result && !result.ok ? result.gateway_error_code ?? result.code : undefined)) setStatusError(text('gatewayJoin.failed'));
    } catch { if (current === statusGeneration) setStatusError(text('gatewayJoin.failed')); }
    finally { if (current === statusGeneration && open() && !connectionLost()) timer = setTimeout(() => void refresh(),3000); }
  }
  async function verify() {
    if (blocked() || busy() || connectionLost()) return;
    invalidate(); const current = generation; const start = runtimeStart(); setPending('verifying');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',...connectionScope(),operation:'preview',address:effectiveAddress(),code:code(),purpose:purpose()});
      if (current !== generation) return;
      if (start && runtimeStart() && start !== runtimeStart()) { setError(text('gatewayJoin.changed')); return; }
      if (!result?.ok || !result.gateway_preview) {
        const failure = result && !result.ok ? result.gateway_error_code ?? result.code : undefined;
        if (!connectionFailure(failure)) setError(errorText(failure));
        return;
      }
      setPreview(result.gateway_preview); setPreviewInvalidated(false); setNow(Date.now()); if (props.wizard) setStep(2);
      queueMicrotask(focusConfirmation);
    } catch { if (current === generation) setError(text('gatewayJoin.unreachable')); }
    finally { if (current === generation) setPending(null); }
  }
  async function act(operation: GatewayMembershipOperation) {
    const consent = preview();
    if (blocked() || connectionLost() || busy() || !consent || previewInvalidated() || consent.expires_at_unix_ms <= Date.now() || consent.purpose !== purpose() || operation !== purpose()) return;
    const current = generation; setPending('joining'); setError('');
    try {
      const result = await window.redevenDesktopLauncher?.performAction({kind:'manage_runtime_gateway',...connectionScope(),operation,
        ...(['join','replace','update-endpoints'].includes(operation) ? {preview_id:preview()?.preview_id} : {})});
      if (current !== generation) return;
      if (!result?.ok || !result.gateway_membership) {
        const code = result && !result.ok ? result.gateway_error_code ?? result.code : undefined;
        if (!connectionFailure(code)) setError(errorText(code));
        if (code === 'GATEWAY_PREVIEW_CHANGED' || code === 'GATEWAY_PREVIEW_EXPIRED') {
          setPreviewInvalidated(true);
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
            {passwordField()}
            <div class="redeven-gateway-step-actions">
              <Show when={canConnect()} fallback={<>
                {props.preparationActions}
                <Show when={props.preparationAction}>{action => <Button class="cursor-pointer whitespace-nowrap"
                  disabled={busy() || action().disabled || authenticationRequired() && !password()} onClick={() => void prepare()}>
                  <StableText reserve={[action().label]}>{action().label}</StableText>
                </Button>}</Show>
              </>}>
                <Button class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || authenticationRequired() && !password()}
                  onClick={() => void connect()}><StableText reserve={[text('gatewayJoin.connectAndContinue'), text('gatewayJoin.connecting'), text('common.retry')]}>{text(pending() === 'connecting' ? 'gatewayJoin.connecting' : statusError() ? 'common.retry' : 'gatewayJoin.connectAndContinue')}</StableText><ArrowRight class="h-4 w-4 shrink-0" aria-hidden="true" /></Button>
              </Show>
              {props.settingsAction}
            </div>
          </section>
        </Show>
        <section class="redeven-gateway-join-section" hidden={props.wizard && currentStep() !== 1}>
          <Show when={props.wizard}><h3>{text('gatewayJoin.gatewayInvitation')}</h3><p class="text-sm text-muted-foreground">{text('gatewayJoin.codeHelp')}</p></Show>
          <div class="redeven-gateway-join-address">
            <Show when={suggestions().length}>
              <Tabs items={[
                { id: 'saved', domId: savedTabID, panelId: savedPanelID, label: text('gatewayDiscovery.savedGateway') },
                { id: 'new', domId: newTabID, panelId: newPanelID, label: text('gatewayDiscovery.enterAddress') },
              ]} activeId={addressMode()} onChange={id => changeAddressMode(id as AddressMode)}
                features={{ indicator: { mode: 'slider', animated: true, thicknessPx: 2 } }}
                slotClassNames={{ tab: 'redeven-gateway-source-tab', indicator: 'redeven-gateway-source-indicator' }}
                ariaLabel={text('gatewayJoin.address')} class="redeven-gateway-source-tabs" />
              <TabPanel id={savedPanelID} labelledBy={savedTabID} active={addressMode() === 'saved'} keepMounted class="redeven-gateway-source-panel">
                <label class="redeven-gateway-join-field"><span>{text('gatewayDiscovery.savedGateway')}</span><select ref={savedGatewayInput} data-gateway-picker class="redeven-gateway-local-picker" value={selectedSavedAddress()} disabled={busy()}
                  onChange={event => { const value = event.currentTarget.value; updateSavedAddress(value); if (value) queueMicrotask(() => codeInput?.focus()); }}>
                  <option value="">{text('gatewayDiscovery.chooseSavedGateway')}</option>
                  <KeyedFor each={suggestions()} by={suggestion => suggestion.address}>{suggestion => <option value={suggestion().address}>{suggestion().name} · {new URL(suggestion().address).host}</option>}</KeyedFor>
                </select></label>
              </TabPanel>
              <TabPanel id={newPanelID} labelledBy={newTabID} active={addressMode() === 'new'} keepMounted class="redeven-gateway-source-panel">
                {manualAddressField()}
              </TabPanel>
            </Show>
            <Show when={!suggestions().length}>{manualAddressField()}</Show>
          </div>
          <label class="redeven-gateway-join-field"><span>{text('gatewayJoin.code')}</span><Input ref={codeInput} value={code()} autocomplete="off" spellcheck={false} disabled={busy()}
            onInput={event => { invalidate(); setCode(event.currentTarget.value); }} onKeyDown={event => { if (event.key === 'Enter' && !blocked() && !busy() && effectiveAddress() && code().trim()) { event.preventDefault(); void verify(); } }} /></label>
        </section>
        <Show when={preview()}>{value => <section class="redeven-gateway-join-section" hidden={currentStep() !== 2}>
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
      <Show when={currentStep() > 0 && connectionLost() && !blocked()}><section class="redeven-gateway-join-section">
        {passwordField()}
        <Button class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || authenticationRequired() && !password()} onClick={() => void connect()}>{text('gatewayJoin.restoreConnection')}</Button>
      </section></Show>
      <Show when={!props.wizard || currentStep() > 0}><div class="redeven-gateway-step-actions">
        <Show when={preview() && (!props.wizard || currentStep() === 2)} fallback={<Button class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || connectionLost() || !effectiveAddress() || !code().trim()} onClick={() => void verify()}><StableText reserve={[text('gatewayJoin.verify'),text('gatewayJoin.verifying')]}>{text(pending() === 'verifying' ? 'gatewayJoin.verifying' : 'gatewayJoin.verify')}</StableText></Button>}>
          <Button ref={confirmButton} class="cursor-pointer whitespace-nowrap" disabled={busy() || blocked() || connectionLost() || previewInvalidated() || preview()!.expires_at_unix_ms <= now()} onClick={() => void act(purpose())}>{text('gatewayJoin.confirmEnable')}</Button>
        </Show>
        <Show when={preview() && (previewInvalidated() || preview()!.expires_at_unix_ms <= now())}><Button variant="outline" disabled={busy() || blocked() || connectionLost()} onClick={() => void verify()}>{text('gatewayJoin.verify')}</Button></Show>
      </div></Show>
    </div>
    <div class="redeven-gateway-join-actions">
      <Show when={props.wizard && currentStep() > 0}><Button class="cursor-pointer whitespace-nowrap" variant="outline" disabled={busy()}
        onClick={() => { setStep(currentStep() - 1); setError(''); setStatusError(''); queueMicrotask(() => { if (currentStep() === 1) focusAddress(); else connectionHeading?.focus({ preventScroll: true }); }); }}>{text('gatewayJoin.back')}</Button></Show>
      <Button class="cursor-pointer whitespace-nowrap" variant="ghost" onClick={close}>{text('common.cancel')}</Button>
    </div>
  </div>;
  return <Show when={props.embedded} fallback={<><Show when={!props.hideTrigger}><Button ref={trigger} class="mt-2 cursor-pointer" size="sm" variant="outline" disabled={props.disabled} onClick={openDialog}>{text('gatewayJoin.title')}</Button></Show>
    <Dialog open={open()} onOpenChange={value => { if (!value) close(); }} title={text(purpose() === 'update-endpoints' ? 'gatewayJoin.updateEndpoints' : 'gatewayJoin.title')} bodyDescription={text('gatewayJoin.codeHelp')} closeLabel={text('common.close')} class="redeven-gateway-dialog redeven-gateway-join-dialog" contentClass="redeven-gateway-join-content">{body()}</Dialog>
  </>}>{body()}</Show>;
}
