import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { Button, StableText } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../../shared/i18n';
import { runtimeServiceAIIsPreparing, type RuntimeServiceSnapshot } from '../../shared/runtimeService';
import { runtimeFlowerBlocker } from '../../shared/runtimeFlowerAccess';
import { FlowerSoftAuraIcon } from '../../../../internal/flower_ui/src/icons/FlowerSoftAuraIcon';

export function DesktopFlowerRuntimeBoundary(props: {
  snapshot?: RuntimeServiceSnapshot;
  i18n: DesktopI18n;
  onRecover: (code: 'runtime_update_required' | 'desktop_update_required') => Promise<void>;
  onBack: () => void;
  onStartupAction?: (action: 'stop' | 'retry') => Promise<void>;
  embedded?: boolean;
  children: JSX.Element;
}) {
  const [pending, setPending] = createSignal(false);
  const [startupPending, setStartupPending] = createSignal<'stop' | 'retry' | null>(null);
  const [startupFailed, setStartupFailed] = createSignal(false);
  const stopping = () => startupPending() === 'stop' || props.snapshot?.ai_readiness?.state === 'stopping';
  const canRetry = () => props.snapshot?.ai_readiness?.state === 'stopped' || (props.snapshot?.ai_readiness?.state === 'blocked' && props.snapshot.ai_readiness.safe_to_retry === true && props.snapshot.ai_readiness.reason_code !== 'generation_close_failed');
  const startupAction = async (action: 'stop' | 'retry') => {
    if (startupPending() || !props.onStartupAction) return;
    setStartupPending(action);
    setStartupFailed(false);
    try { await props.onStartupAction(action); } catch { setStartupFailed(true); } finally { setStartupPending(null); }
  };
  const blocker = createMemo(() => {
    const value = runtimeFlowerBlocker(props.snapshot);
    return value?.code === 'runtime_not_ready' ? null : value;
  });
  // Runtime shell readiness precedes AI publication. The existing Welcome
  // snapshots own readiness; only preparation controls may run before AI publication.
  const availability = createMemo(() => {
    if (props.snapshot?.open_readiness?.state === 'blocked') return 'blocked';
    if (runtimeFlowerBlocker(props.snapshot)?.code === 'runtime_not_ready') return 'preparing';
    if (runtimeServiceAIIsPreparing(props.snapshot)) return 'preparing';
    switch (props.snapshot?.ai_readiness?.state) {
      case 'ready':
      case 'degraded':
        return 'ready';
      default:
        return 'blocked';
    }
  });
  const recover = async () => {
    const code = blocker()?.code;
    if (!code || code === 'runtime_not_ready' || pending()) return;
    setPending(true);
    try { await props.onRecover(code); } finally { setPending(false); }
  };
  const startupDetail = createMemo(() => {
    if (stopping()) return props.i18n.t('flowerRuntime.startupPhase.stopping');
    const state = props.snapshot?.ai_readiness?.state;
    switch (state) {
      case 'inspecting': return props.i18n.t('flowerRuntime.startupPhase.inspecting');
      case 'backing_up': return props.i18n.t('flowerRuntime.startupPhase.backing_up');
      case 'optimizing': return props.i18n.t('flowerRuntime.startupPhase.optimizing');
      case 'migrating': return props.i18n.t('flowerRuntime.startupPhase.migrating');
      case 'indexing': return props.i18n.t('flowerRuntime.startupPhase.indexing');
      case 'preparing': return props.i18n.t('flowerRuntime.startupPhase.preparing');
      case 'verifying': return props.i18n.t('flowerRuntime.startupPhase.verifying');
      case 'recovering': return props.i18n.t('flowerRuntime.startupPhase.recovering');
      case 'restoring': return props.i18n.t('flowerRuntime.startupPhase.restoring');
      default: return props.i18n.t('flowerRuntime.startupPhase.starting');
    }
  });
  const unavailableDetail = () => props.i18n.t(props.snapshot?.ai_readiness?.reason_code === 'generation_close_failed' ? 'flowerRuntime.restartDetail' : props.snapshot?.ai_readiness?.state === 'stopped' ? 'flowerRuntime.stoppedDetail' : 'flowerRuntime.unavailableDetail');
  return <Show when={blocker()} fallback={(
    <Show when={availability() === 'ready'} fallback={(
      <div class="flower-warmup h-full" data-flower-runtime-availability={availability()} data-flower-runtime-embedded={props.embedded ? 'true' : undefined}>
        <div class="flower-warmup-panel">
          <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14" />
          <div class="flower-warmup-copy" role="status" aria-live="polite" aria-busy={availability() === 'preparing'}>
            <h2>{props.i18n.t(availability() === 'preparing' ? 'flowerSurface.chat.warmupTitle' : 'flowerRuntime.unavailableTitle')}</h2>
            <p data-flower-startup-phase={availability() === 'preparing' ? props.snapshot?.ai_readiness?.state : undefined}>{availability() === 'preparing' ? startupDetail() : unavailableDetail()}</p>
          </div>
          <Show when={availability() === 'preparing'}>
            <div class="flower-warmup-indicator" aria-hidden="true"><div class="flower-warmup-indicator-bar" /></div>
          </Show>
          <Show when={availability() === 'preparing' && (props.snapshot?.ai_readiness?.work_total ?? 0) > 0}>
            <p class="text-xs tabular-nums text-muted-foreground" role="status">{props.i18n.t('flowerRuntime.workProgress', { completed: Math.min(props.snapshot?.ai_readiness?.work_completed ?? 0, props.snapshot!.ai_readiness!.work_total!), total: props.snapshot!.ai_readiness!.work_total! })}</p>
          </Show>
          <Show when={startupFailed()}><p role="alert">{props.i18n.t('flowerRuntime.startupActionFailed')}</p></Show>
          <div class="flex flex-wrap justify-center gap-2">
          <Show when={props.onStartupAction && (props.snapshot?.ai_readiness?.stoppable || stopping())}>
            <Button variant="outline" disabled={!!startupPending() || stopping()} onClick={() => void startupAction('stop')}>
              <StableText reserve={[props.i18n.t('flowerRuntime.stopPreparation'), props.i18n.t('flowerRuntime.stoppingPreparation')]}>{props.i18n.t(stopping() ? 'flowerRuntime.stoppingPreparation' : 'flowerRuntime.stopPreparation')}</StableText>
            </Button>
          </Show>
          <Show when={props.onStartupAction && canRetry()}><Button disabled={!!startupPending()} onClick={() => void startupAction('retry')}>{props.i18n.t('flowerRuntime.prepareAgain')}</Button></Show>
          <Button variant="outline" onClick={props.onBack}>{props.i18n.t('shell.backToEnvironments')}</Button>
          </div>
        </div>
      </div>
    )}>{props.children}</Show>
  )}>{(blocked) => (
    <div class="flex h-full min-h-0 items-center justify-center p-8" data-flower-runtime-blocker={blocked().code} data-flower-runtime-embedded={props.embedded ? 'true' : undefined}>
      <div class="w-full max-w-lg space-y-4 rounded-xl border border-border/60 bg-background p-6" role="status" aria-live="polite">
        <h2 class="text-lg font-semibold">{props.i18n.t(blocked().code === 'desktop_update_required' ? 'flowerRuntime.desktopTitle' : 'flowerRuntime.runtimeTitle')}</h2>
        <p class="text-[length:var(--floe-type-body)] leading-[var(--floe-line-body)] text-muted-foreground">{props.i18n.t(blocked().code === 'desktop_update_required' ? 'flowerRuntime.desktopDetail' : 'flowerRuntime.runtimeDetail')}</p>
        <p class="break-all font-mono text-xs text-muted-foreground">{props.i18n.t('flowerRuntime.connectedBuild', { version: props.snapshot?.runtime_version || '—', commit: props.snapshot?.runtime_commit?.slice(0, 12) || '—' })}</p>
        <div class="flex flex-wrap gap-2">
          <Button disabled={pending()} onClick={() => void recover()}>{props.i18n.t(blocked().code === 'desktop_update_required' ? 'environmentAction.updateRedevenDesktop' : 'environmentAction.updateRuntime')}</Button>
          <Button variant="outline" onClick={props.onBack}>{props.i18n.t('shell.backToEnvironments')}</Button>
        </div>
      </div>
    </div>
  )}</Show>;
}
