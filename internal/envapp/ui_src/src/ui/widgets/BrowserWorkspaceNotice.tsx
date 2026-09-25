import { Show, createSignal } from 'solid-js';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { FlowerManagedBrowser } from '../../../../../flower_ui/src/FlowerManagedBrowser';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceService } from '../services/browserSourceContract';
import type { BrowserFailureCode, BrowserWorkspaceState } from '../services/browserWorkspaceController';

export function browserFailureMessage(code: BrowserFailureCode | undefined, messages: BrowserSourceMessages): string {
  const copy = messages.product;
  switch (code) {
    case 'BROWSER_INSTALL_REQUIRED': return copy.installTitle;
    case 'BROWSER_DISABLED': return messages.computer.browserDisabledHint;
    case 'BROWSER_SERVICE_FAILED': return copy.recoverTitle;
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
  const setup = () => ['BROWSER_INSTALL_REQUIRED', 'BROWSER_DISABLED'].includes(props.state.failure ?? '');
  const canRetry = () => !['BROWSER_SOURCE_UNAVAILABLE', 'BROWSER_OUTCOME_UNKNOWN', 'BROWSER_RECOVERY_BLOCKED'].includes(props.state.failure ?? '');
  const run = async (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    try { await action(); } catch { /* The view controller publishes the failure. */ } finally { setBusy(false); }
  };
  return <section class="redeven-browser-notice" aria-busy={busy() || props.state.phase !== 'failed'}>
    <Show when={props.state.phase === 'failed'} fallback={<RedevenLoadingCurtain visible
      eyebrow={props.title} message={props.messages.computer.checking} class="redeven-browser-loading-curtain" />}>
      <div class="redeven-browser-notice-content">
        <h2>{browserFailureMessage(props.state.failure, props.messages)}</h2>
        <Show when={setup()} fallback={<div class="redeven-browser-notice-actions">
          <Show when={props.state.failure === 'BROWSER_SERVICE_FAILED'} fallback={<Show when={canRetry()}><Button disabled={busy() || !props.connected} onClick={() => void run(props.retry)}>{props.messages.product.retry}</Button></Show>}>
            <Button disabled={busy() || !props.connected} onClick={() => setConfirming(true)}>{props.messages.product.recover}</Button>
          </Show>
          <Button variant="outline" disabled={busy()} onClick={props.chooseSource}>{props.messages.product.sources}</Button>
        </div>}>
          <FlowerManagedBrowser management={props.service.management} copy={props.messages.computer} canMutate={props.connected}
            requireEnabledForContinue installLabel={props.messages.product.installOpen}
            continuationKey={JSON.stringify(props.state.selection.request)} onContinue={async enabled => { if (enabled) await props.retry(); }} />
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
