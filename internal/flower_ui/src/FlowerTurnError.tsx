import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { ChevronRight, Copy } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, StableText } from '@floegence/floe-webapp-core/ui';
import type { FlowerThreadError } from './contracts/flowerSurfaceContracts';
import { writeTextToClipboard } from './clipboard';

/** Historical diagnostics open outside the measured conversation layout. */
export function FlowerTurnError(props: {
  load: (signal: AbortSignal) => Promise<FlowerThreadError | null>;
  summary: (error: FlowerThreadError) => JSX.Element;
  loadingLabel: string;
  failedLabel: string;
  retryLabel: string;
  detailsLabel: string;
  copyLabel: string;
  copiedLabel: string;
  closeLabel: string;
  onCopyError: (error: unknown) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<FlowerThreadError>();
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  createEffect(() => {
    if (!open()) return;
    void revision();
    const controller = new AbortController();
    setError(undefined); setFailed(false);
    void props.load(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value) setError(value); else setFailed(true);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    onCleanup(() => controller.abort());
  });
  const setDialogOpen = (value: boolean) => {
    if (value) setCopied(false);
    setOpen(value);
  };
  const copyDetails = async () => {
    try {
      const value = error();
      if (!value) return;
      await writeTextToClipboard(value.detail || value.message);
      setCopied(true);
    } catch (error) { props.onCopyError(error); }
  };
  return <>
    <button type="button" class="flower-turn-error-trigger" aria-haspopup="dialog"
      aria-expanded={open()} onClick={() => setDialogOpen(true)}>
      {props.detailsLabel}<ChevronRight size={12} aria-hidden="true" />
    </button>
    <Dialog open={open()} onOpenChange={setDialogOpen} title={props.detailsLabel}
      closeLabel={props.closeLabel} presentation="dialog" class="flower-turn-error-dialog"
      contentClass="flower-turn-error-content"
      footer={<Show when={error()}><Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyDetails()}>
        <StableText reserve={[props.copiedLabel, props.copyLabel]}>{copied() ? props.copiedLabel : props.copyLabel}</StableText>
      </Button></Show>}>
      <Show when={open()}>
        <Show when={error()} fallback={<Show when={failed()} fallback={<p role="status">{props.loadingLabel}</p>}>
          <p role="alert">{props.failedLabel}</p><Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}>{props.retryLabel}</Button>
        </Show>}>{value => <>
          <div class="flower-turn-error-summary">{props.summary(value())}</div>
          <Show when={value().detail}><pre class="flower-turn-error-detail">{value().detail}</pre></Show>
        </>}</Show>
      </Show>
    </Dialog>
  </>;
}
