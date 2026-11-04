import { Show, batch, createEffect, createSignal, createUniqueId, on, onCleanup } from 'solid-js';
import { Button, createFloatingPresence } from '@floegence/floe-webapp-core/ui';
import { Check, ChevronDown, Refresh } from '@floegence/floe-webapp-core/icons';
import type { FlowerSurfaceCopy } from './copy';
import type { LiveTransportState } from './liveTransport';

/** Flower observation feedback. This owns presentation only, never recovery. */
export function FlowerSyncNotice(props: {
  state: LiveTransportState;
  stopUnconfirmed: boolean;
  confirmed: boolean;
  explainFailure?: boolean;
  message: string;
  copy: FlowerSurfaceCopy['chat'];
  onResync: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(false);
  const [restored, setRestored] = createSignal(false);
  const [settlePending, setSettlePending] = createSignal(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = createSignal(false);
  const [recoveryVisible, setRecoveryVisible] = createSignal(false);
  const id = createUniqueId();
  let root: HTMLDivElement | undefined;
  let detailButton: HTMLButtonElement | undefined;
  let compactButton: HTMLButtonElement | undefined;
  let retryButton: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hadFailure = false;
  const failed = () => props.state.status === 'failed' || props.stopUnconfirmed;
  const busy = () => props.state.status === 'connecting' || props.state.status === 'reconnecting'
    || awaitingConfirmation();
  const visible = () => failed() || busy() || restored() || recoveryVisible();
  const presence = createFloatingPresence({ open: visible, element: () => root });
  const label = () => failed() ? props.copy.syncPaused : restored() ? props.copy.syncRestored : props.copy.syncWorking;
  const close = () => { setExpanded(false); detailButton?.focus({ preventScroll: true }); };
  const settle = () => {
    if (expanded() || root?.contains(document.activeElement) || root?.matches(':hover')) { setSettlePending(true); return; }
    batch(() => { setSettlePending(false); setRestored(false); setRecoveryVisible(false); });
  };
  const settleAfterInteraction = () => { if (settlePending()) queueMicrotask(settle); };
  createEffect(on(() => [props.state.status, props.stopUnconfirmed, props.confirmed] as const, ([status, unconfirmed, confirmed]) => {
    batch(() => {
      if (status === 'failed' || status === 'reconnecting' || unconfirmed) { hadFailure = true; setRecoveryVisible(true); }
      if (!hadFailure) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined; setSettlePending(false);
      // A failed Stop confirmation has settled; keep explicit Resync actionable.
      setAwaitingConfirmation(status === 'ready' && !confirmed && !unconfirmed);
      if (status !== 'ready' || unconfirmed || !confirmed) { setRestored(false); return; }
      if (document.activeElement === retryButton) detailButton?.focus({ preventScroll: true });
      hadFailure = false; setRestored(true);
      timer = setTimeout(settle, 2600);
    });
  }));
  createEffect(() => {
    if (!expanded()) return;
    const outside = (event: PointerEvent) => { if (!root?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });
  createEffect(on(() => failed() && props.explainFailure, explain => {
    // When no transcript is available, expose the reason in this same notice.
    // There is still one recovery action and no second empty-state error owner.
    if (explain) { setCollapsed(false); setExpanded(true); }
  }));
  onCleanup(() => { if (timer !== undefined) clearTimeout(timer); });
  return <Show when={presence.mounted()}>
    <div ref={root} class="flower-workspace-sync flower-chat-notice"
      role={failed() ? 'alert' : 'status'} aria-live="polite" aria-atomic="true"
      data-state={presence.state()} inert={presence.exiting()}
      data-flower-sync-state={props.state.status} data-collapsed={collapsed() ? 'true' : undefined}
      data-restored={restored() ? 'true' : undefined}
      onMouseLeave={settleAfterInteraction} onFocusOut={settleAfterInteraction}
      onKeyDown={event => { if (event.key === 'Escape' && expanded()) { event.stopPropagation(); close(); } }}>
      <Show when={!collapsed()} fallback={<Button ref={compactButton} size="sm" variant="ghost" class="flower-sync-compact"
        aria-label={props.copy.syncDetails} onClick={() => { setCollapsed(false); queueMicrotask(() => detailButton?.focus({ preventScroll: true })); }}>
        <span class="flower-sync-dot" aria-hidden="true" />{label()}
      </Button>}>
        <div class="flower-sync-bar">
          <span class="flower-sync-label"><Show when={restored()} fallback={<span class="flower-sync-dot" aria-hidden="true" />}><Check class="size-3.5" aria-hidden="true" /></Show>{label()}</span>
          <Show when={!restored()}><Button ref={retryButton} size="sm" variant="ghost" class="flower-sync-retry" aria-disabled={busy()} aria-busy={busy()}
            onClick={() => { if (!busy()) props.onResync(); }}>
            <Refresh class={busy() ? 'size-3.5 flower-sync-spinner' : 'size-3.5'} aria-hidden="true" />
            {busy() ? props.copy.syncWorking : props.copy.syncResync}
          </Button></Show>
          <Button ref={detailButton} size="sm" variant="ghost" class="flower-sync-details-toggle" aria-label={props.copy.syncDetails}
            aria-expanded={expanded()} aria-controls={id} onClick={() => setExpanded(value => !value)}><ChevronDown class="size-4 flower-sync-chevron" aria-hidden="true" /></Button>
        </div>
        <div id={id} class="flower-sync-disclosure" data-expanded={expanded() ? 'true' : undefined} inert={!expanded()} aria-hidden={!expanded()}>
          <div class="flower-sync-disclosure-clip"><div class="flower-sync-details">
          <p>{restored() ? props.copy.syncRestored : props.message}</p>
          <p>{props.copy.syncReadOnly}</p>
          <div class="flower-sync-detail-actions"><Button size="sm" variant="ghost" class="flower-sync-minimize" onClick={() => { setExpanded(false); setCollapsed(true); queueMicrotask(() => compactButton?.focus({ preventScroll: true })); }}>{props.copy.syncCollapse}</Button>
            <Button size="sm" variant="ghost" class="flower-sync-close" onClick={close}>{props.copy.syncCloseDetails}</Button></div>
        </div></div></div>
      </Show>
    </div>
  </Show>;
}
