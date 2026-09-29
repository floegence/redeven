import { Show, createSignal, createUniqueId } from 'solid-js';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FlowerManagedBrowser } from '../../../../../flower_ui/src/FlowerManagedBrowser';
import { ActivityBarBrowserIcon } from '../icons/ActivityBarDockIcons';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceService } from '../services/browserSourceContract';
import type { BrowserFailureCode, BrowserWorkspaceState } from '../services/browserWorkspaceController';

export function browserFailureMessage(code: BrowserFailureCode | undefined, messages: BrowserSourceMessages): string {
  const copy = messages.product;
  switch (code) {
    case 'BROWSER_SANDBOX_UNAVAILABLE': return messages.computer.browserSystemPrepare;
    case 'BROWSER_DEPENDENCIES_MISSING': return messages.computer.browserDependenciesMissing;
    case 'BROWSER_INSTALL_REQUIRED': return copy.installTitle;
    case 'BROWSER_DISABLED': return messages.computer.browserDisabledHint;
    case 'BROWSER_SERVICE_FAILED': return copy.recoveryDescription;
    case 'BROWSER_RECOVERY_BLOCKED': return copy.recoveryBlocked;
    case 'BROWSER_SOURCE_UNAVAILABLE': return copy.sourceUnavailable;
    case 'BROWSER_OPEN_TIMEOUT': return copy.openTimeout;
    case 'BROWSER_OUTCOME_UNKNOWN': return copy.outcomeUnknown;
    case 'BROWSER_DISCONNECTED': return copy.disconnected;
    default: return copy.openFailed;
  }
}

/** One recovery presentation for the embedded page and independent document. */
export function BrowserWorkspaceNotice(props: {
  state: BrowserWorkspaceState;
  title: string;
  messages: BrowserSourceMessages;
  service: BrowserSourceService;
  connected: boolean;
  retry(): Promise<void>;
  recover(): Promise<void>;
  chooseSource(): void;
}) {
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const descriptionID = createUniqueId();
  const selecting = () => props.state.phase === 'selecting';
  const setup = () => ['BROWSER_INSTALL_REQUIRED', 'BROWSER_DISABLED', 'BROWSER_SANDBOX_UNAVAILABLE'].includes(props.state.failure ?? '');
  const canRetry = () => props.state.phase !== 'selecting' && !['BROWSER_DEPENDENCIES_MISSING', 'BROWSER_OUTCOME_UNKNOWN', 'BROWSER_RECOVERY_BLOCKED'].includes(props.state.failure ?? '');
  const run = async (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    try { await action(); } catch { /* The view controller publishes the failure. */ } finally { setBusy(false); }
  };
  return <section class="redeven-browser-notice" classList={{ 'is-selecting': selecting() }} aria-busy={busy() || ['idle', 'opening'].includes(props.state.phase)}>
    <Show when={props.state.phase === 'failed' || props.state.phase === 'selecting'} fallback={<RedevenLoadingCurtain visible
      eyebrow={props.title} message={props.messages.computer.checking} class="redeven-browser-loading-curtain" />}>
      <div class="redeven-browser-notice-content">
        <Show when={selecting()}>
          <div class="redeven-browser-welcome-art" aria-hidden="true">
            <ActivityBarBrowserIcon size="4rem" />
          </div>
        </Show>
        <Show when={!selecting()}><span class="redeven-browser-status-icon" aria-hidden="true"><ActivityBarBrowserIcon size="1.75rem" /></span></Show>
        <h2>{selecting() ? props.messages.product.welcomeTitle : setup() || props.state.failure === 'BROWSER_DEPENDENCIES_MISSING' ? props.messages.product.installTitle : props.state.failure === 'BROWSER_SERVICE_FAILED' ? props.messages.product.recoverTitle : props.messages.product.connectionTitle}</h2>
        <Show when={!selecting()}><p id={descriptionID}>{browserFailureMessage(props.state.failure, props.messages)}</p></Show>
        <Show when={selecting()}><p id={descriptionID} class="redeven-browser-welcome-description">{props.messages.product.welcomeDescription}</p></Show>
        <Show when={setup()} fallback={<div class="redeven-browser-notice-actions">
          <Show when={props.state.failure === 'BROWSER_SERVICE_FAILED'} fallback={<Show when={canRetry()}><Button disabled={busy() || !props.connected} onClick={() => void run(props.retry)}>{props.messages.product.reconnectBrowser}</Button></Show>}>
            <Button disabled={busy() || !props.connected} onClick={() => setConfirming(true)}>{props.messages.product.recover}</Button>
          </Show>
          <Button variant={selecting() ? 'primary' : 'outline'} disabled={busy()} onClick={props.chooseSource}
            aria-describedby={descriptionID}>
            {selecting() ? props.messages.product.chooseSource : props.messages.product.sources}
            <Show when={selecting()}><ChevronRight class="size-4" aria-hidden="true" /></Show>
          </Button>
        </div>}>
          <FlowerManagedBrowser management={props.service.management} copy={props.messages.computer} canMutate={props.connected}
            requireEnabledForContinue installLabel={props.messages.product.installOpen}
            continuationKey={JSON.stringify(props.state.selection?.request)} onContinue={async enabled => { if (enabled) await props.retry(); }} />
          <Button variant="ghost" onClick={props.chooseSource}>{props.messages.product.sources}</Button>
        </Show>
      </div>
    </Show>
    <Show when={confirming()}><Dialog open title={props.messages.product.recover} closeLabel={props.messages.computer.close}
      bodyDescription={props.messages.product.recoveryDescription} onOpenChange={open => { if (!open) setConfirming(false); }}
      children={null} footer={<><Button variant="outline" onClick={() => setConfirming(false)}>{props.messages.computer.cancel}</Button>
        <Button disabled={busy()} onClick={() => { setConfirming(false); void run(props.recover); }}>{props.messages.product.recover}</Button></>} /></Show>
  </section>;
}
