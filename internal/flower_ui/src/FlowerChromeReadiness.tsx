import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Check, ChevronRight, Info, MonitorPointer, Refresh } from '@floegence/floe-webapp-core/icons';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerChromeDiagnostic, FlowerChromeStatus } from './contracts/flowerSurfaceContracts';
import { chromeConnectionDiagnostic, chromeDiagnosticPresentation } from './chromeConnectionDiagnostic';

// Both Chrome entry points present the Runtime's existing readiness snapshot.
// This surface never prepares an extension or infers a desktop login session.
export function FlowerChromeReadiness(props: {
  status?: FlowerChromeStatus; diagnostic?: FlowerChromeDiagnostic;
  environmentName?: string; platform?: string; copy: FlowerComputerCopy;
  showConnectionStatus?: boolean; children?: JSX.Element;
  onRetry?: () => void; retryLabel?: string; retryDisabled?: boolean;
}) {
  const [copied, setCopied] = createSignal<string>();
  const [copyFailed, setCopyFailed] = createSignal(false);
  let diagnosticInput: HTMLTextAreaElement | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const diagnostic = () => props.diagnostic ? chromeConnectionDiagnostic(props.diagnostic, props.diagnostic.stage) : undefined;
  const presentation = () => diagnostic() ? chromeDiagnosticPresentation(diagnostic()!, props.copy) : undefined;
  const hostname = () => props.status?.hostname || props.environmentName;
  const platform = () => props.status?.platform || props.platform;
  const connected = () => !!props.status?.profiles.length;
  const diagnosticText = () => JSON.stringify({ environment: hostname(), runtime_version: props.status?.runtime_version,
    platform: platform(), browser_installed: props.status?.browser_installed, ...diagnostic() }, null, 2);
  const copyDiagnostics = () => {
    const text = diagnosticText();
    void navigator.clipboard.writeText(text).then(() => {
      if (!disposed) { setCopied(text); setCopyFailed(false); }
    }, () => { if (!disposed) { setCopyFailed(true); diagnosticInput?.focus(); diagnosticInput?.select(); } });
  };
  const title = () => presentation()?.title || (props.status?.error === 'extension_update_required' ? props.copy.setupUpdateTitle
    : !props.status ? props.copy.unknown : connected() ? props.copy.connected : props.copy.chromeOffline);
  const hint = () => presentation()?.hint || (props.status?.error === 'extension_update_required' ? props.copy.setupUpdateHint
    : !props.status ? props.copy.loadFailed : connected() ? props.copy.chromeOnlineHint : props.copy.chromeConnectHint);
  return <section class="flower-chrome-readiness" data-chrome-readiness>
    <div class="flower-chrome-facts">
      <Show when={hostname()}><div class="flower-computer-environment" aria-label={props.copy.environmentTitle}>
        <span class="flower-computer-host"><MonitorPointer aria-hidden="true" />{hostname()}</span>
        <Show when={platform()}><span class="flower-computer-platform">{platform() === 'darwin' ? 'macOS' : platform() === 'linux' ? 'Linux' : platform()}</span></Show>
      </div></Show>
      <Show when={props.status?.browser_installed !== undefined}><span class="flower-chrome-browser-state" data-ready={props.status?.browser_installed}>
        <Show when={props.status?.browser_installed} fallback={<Info aria-hidden="true" />}><Check aria-hidden="true" /></Show>
        {props.status?.browser_installed ? props.copy.chromeBrowserDetected : props.copy.chromeBrowserMissing}
      </span></Show>
      <Show when={diagnostic() && !connected()}><span class="flower-chrome-connection-state">{props.copy.chromeOffline}</span></Show>
    </div>
    <Show when={diagnostic() || props.showConnectionStatus}>
      <div class="flower-chrome-status" data-chrome-diagnostic={diagnostic() ? '' : undefined} data-tone={diagnostic() ? 'attention' : connected() ? 'positive' : 'neutral'}>
        <Show when={connected() && !diagnostic()} fallback={<Info class="flower-chrome-status-icon" aria-hidden="true" />}><Check class="flower-chrome-status-icon" aria-hidden="true" /></Show>
        <div class="flower-chrome-status-copy" role={diagnostic() ? 'alert' : 'status'}>
          <Show when={!diagnostic() || presentation()?.title}><p class="flower-chrome-status-title">{title()}</p></Show>
          <p class="flower-chrome-status-hint">{hint()}</p>
        </div>
      </div>
      <div class="flower-chrome-status-actions">
        <details class="flower-chrome-details">
          <summary><ChevronRight aria-hidden="true" />{props.copy.details}</summary>
          <div class="flower-chrome-details-body">
            <Show when={presentation()?.steps}><p>{presentation()!.steps}</p></Show>
            {props.children}
            <Show when={diagnostic()}><details class="flower-chrome-diagnostics">
              <summary>{props.copy.chromeDiagnostics}</summary>
              <textarea ref={diagnosticInput} readOnly aria-label={props.copy.chromeDiagnostics} class="flower-settings-text-input mt-2 min-h-32 w-full resize-y font-mono text-xs" value={diagnosticText()} onFocus={event => event.currentTarget.select()} />
              <Button size="sm" variant="ghost" onClick={copyDiagnostics}>{copied() === diagnosticText() ? props.copy.chromeDiagnosticCopied : props.copy.chromeCopyDiagnostics}</Button>
              <Show when={copyFailed()}><p role="status">{props.copy.chromeDiagnosticCopyFailed}</p></Show>
            </details></Show>
          </div>
        </details>
        <Show when={props.onRetry}><Button class="flower-chrome-recheck" size="sm" variant="ghost" disabled={props.retryDisabled} onClick={() => props.onRetry?.()}><Refresh class="size-3.5" />{props.retryLabel || props.copy.refresh}</Button></Show>
      </div>
    </Show>
  </section>;
}
