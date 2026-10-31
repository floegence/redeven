import { Show, batch, createEffect, createSignal, createUniqueId, on, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Check, MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import type { FlowerSurfaceCopy } from './copy';
import type { LiveTransportState } from './liveTransport';

/** Flower observation feedback. This owns presentation only, never recovery. */
export function FlowerSyncNotice(props: {
  state: LiveTransportState;
  stopUnconfirmed: boolean;
  confirmed: boolean;
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
      setAwaitingConfirmation(status === 'ready' && !confirmed);
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
  onCleanup(() => { if (timer !== undefined) clearTimeout(timer); });
  return <Show when={visible()}>
    <div ref={root} class="flower-workspace-sync flower-chat-notice"
      role={failed() ? 'alert' : 'status'} aria-live="polite"
      data-flower-sync-state={props.state.status} data-collapsed={collapsed() ? 'true' : undefined}
      data-restored={restored() ? 'true' : undefined}
      onMouseLeave={settleAfterInteraction} onFocusOut={settleAfterInteraction}
      onKeyDown={event => { if (event.key === 'Escape' && expanded()) { event.stopPropagation(); close(); } }}>
      <Show when={!collapsed()} fallback={<button ref={compactButton} type="button" class="flower-sync-compact"
        aria-label={props.copy.syncDetails} onClick={() => { setCollapsed(false); queueMicrotask(() => detailButton?.focus({ preventScroll: true })); }}>
        <span class="flower-sync-dot" aria-hidden="true" />{label()}
      </button>}>
        <div class="flower-sync-bar">
          <span class="flower-sync-label"><Show when={restored()} fallback={<span class="flower-sync-dot" aria-hidden="true" />}><Check class="size-3.5" aria-hidden="true" /></Show>{label()}</span>
          <Show when={!restored()}><Button ref={retryButton} size="sm" variant="ghost" class="flower-sync-retry" aria-disabled={busy()} onClick={() => { if (!busy()) props.onResync(); }}>{props.copy.syncResync}</Button></Show>
          <button ref={detailButton} type="button" class="flower-sync-details-toggle" aria-label={props.copy.syncDetails}
            aria-expanded={expanded()} aria-controls={id} onClick={() => setExpanded(value => !value)}><MoreHorizontal class="size-4" aria-hidden="true" /></button>
        </div>
        <Show when={expanded()}><div id={id} class="flower-sync-details">
          <p>{restored() ? props.copy.syncRestored : props.message}</p>
          <p>{props.copy.syncReadOnly}</p>
          <div class="flower-sync-detail-actions"><Button size="sm" variant="ghost" class="flower-sync-minimize" onClick={() => { setExpanded(false); setCollapsed(true); queueMicrotask(() => compactButton?.focus({ preventScroll: true })); }}>{props.copy.syncCollapse}</Button>
            <Button size="sm" variant="ghost" class="flower-sync-close" onClick={close}>{props.copy.syncCloseDetails}</Button></div>
        </div></Show>
      </Show>
    </div>
  </Show>;
}
