import { StableText, Button } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Check, ChevronRight, Info, Refresh } from '@floegence/floe-webapp-core/icons';
import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerChromeDiagnostic, FlowerChromeStatus } from './contracts/flowerSurfaceContracts';
import { FlowerComputerEnvironmentIdentity } from './FlowerComputerIdentity';
import { chromeConnectionDiagnostic, chromeDiagnosticPresentation } from './chromeConnectionDiagnostic';

// Both Chrome entry points present the Runtime's existing readiness snapshot.
// This surface never prepares an extension or infers a desktop login session.
export function FlowerChromeReadiness(props: {
  status?: FlowerChromeStatus; diagnostic?: FlowerChromeDiagnostic;
  environmentName?: string; platform?: string; copy: FlowerComputerCopy;
  children?: JSX.Element;
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
  const needsAttention = () => Boolean(diagnostic()) || props.status?.error === 'extension_update_required';
  const title = () => presentation()?.title || props.copy.setupUpdateTitle;
  const hint = () => presentation()?.hint || props.copy.setupUpdateHint;
  return <section class="flower-chrome-readiness" data-chrome-readiness>
    <div class="flower-chrome-facts">
      <Show when={hostname()}><FlowerComputerEnvironmentIdentity name={hostname()!} platform={platform()} label={props.copy.environmentTitle} /></Show>
      <Show when={!connected() && props.status?.browser_installed !== undefined}><span class="flower-chrome-browser-state" data-ready={props.status?.browser_installed}>
        <Show when={props.status?.browser_installed} fallback={<Info aria-hidden="true" />}><Check aria-hidden="true" /></Show>
        {props.status?.browser_installed ? props.copy.chromeBrowserDetected : props.copy.chromeBrowserMissing}
      </span></Show>
      <Show when={diagnostic() && !connected()}><span class="flower-chrome-connection-state">{props.copy.chromeOffline}</span></Show>
    </div>
    <Show when={needsAttention()}>
      <div class="flower-chrome-status" data-chrome-diagnostic={diagnostic() ? '' : undefined} data-tone="attention">
        <Info class="flower-chrome-status-icon" aria-hidden="true" />
        <div class="flower-chrome-status-copy" role="alert">
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
              <Button size="sm" variant="ghost" class="redeven-copy-action" data-copied={copied() === diagnosticText() || undefined} onClick={copyDiagnostics}><StableText reserve={[props.copy.chromeDiagnosticCopied, props.copy.chromeCopyDiagnostics]}>{copied() === diagnosticText() ? props.copy.chromeDiagnosticCopied : props.copy.chromeCopyDiagnostics}</StableText></Button>
              <Show when={copyFailed()}><p role="status">{props.copy.chromeDiagnosticCopyFailed}</p></Show>
            </details></Show>
          </div>
        </details>
        <Show when={props.onRetry}><Button class="flower-chrome-recheck" size="sm" variant="ghost" disabled={props.retryDisabled} onClick={() => props.onRetry?.()}><Refresh class="size-3.5" />{props.retryLabel || props.copy.refresh}</Button></Show>
      </div>
    </Show>
  </section>;
}
