import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../../shared/i18n';
import { runtimeServiceAIIsPreparing, type RuntimeServiceSnapshot } from '../../shared/runtimeService';
import { runtimeFlowerBlocker } from '../../shared/runtimeFlowerAccess';
import { FlowerSoftAuraIcon } from '../../../../internal/flower_ui/src/icons/FlowerSoftAuraIcon';

export function DesktopFlowerRuntimeBoundary(props: {
  snapshot?: RuntimeServiceSnapshot;
  i18n: DesktopI18n;
  onRecover: (code: 'runtime_update_required' | 'desktop_update_required') => Promise<void>;
  onBack: () => void;
  embedded?: boolean;
  children: JSX.Element;
}) {
  const [pending, setPending] = createSignal(false);
  const blocker = createMemo(() => {
    const value = runtimeFlowerBlocker(props.snapshot);
    return value?.code === 'runtime_not_ready' ? null : value;
  });
  // Runtime shell readiness precedes AI publication. The existing Welcome
  // snapshots own readiness; no Flower requests may race service startup.
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
  return <Show when={blocker()} fallback={(
    <Show when={availability() === 'ready'} fallback={(
      <div class="flower-warmup h-full" data-flower-runtime-availability={availability()} data-flower-runtime-embedded={props.embedded ? 'true' : undefined}>
        <div class="flower-warmup-panel">
          <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-14 w-14" />
          <div class="flower-warmup-copy" role="status" aria-live="polite" aria-busy={availability() === 'preparing'}>
            <h2>{props.i18n.t(availability() === 'preparing' ? 'flowerSurface.chat.warmupTitle' : 'flowerRuntime.unavailableTitle')}</h2>
            <p>{props.i18n.t(availability() === 'preparing' ? 'flowerRuntime.preparingDetail' : 'flowerRuntime.unavailableDetail')}</p>
          </div>
          <Show when={availability() === 'preparing'}>
            <div class="flower-warmup-indicator" aria-hidden="true"><div class="flower-warmup-indicator-bar" /></div>
          </Show>
          <Button variant="outline" onClick={props.onBack}>{props.i18n.t('shell.backToEnvironments')}</Button>
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
