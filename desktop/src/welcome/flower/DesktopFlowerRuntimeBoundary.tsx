import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../../shared/i18n';
import type { RuntimeServiceSnapshot } from '../../shared/runtimeService';
import { runtimeFlowerBlocker } from '../../shared/runtimeFlowerAccess';

export function DesktopFlowerRuntimeBoundary(props: {
  snapshot?: RuntimeServiceSnapshot;
  i18n: DesktopI18n;
  onRecover: (code: 'runtime_update_required' | 'desktop_update_required') => Promise<void>;
  onBack: () => void;
  children: JSX.Element;
}) {
  const [pending, setPending] = createSignal(false);
  const blocker = createMemo(() => {
    const value = runtimeFlowerBlocker(props.snapshot);
    return value?.code === 'runtime_not_ready' ? null : value;
  });
  const recover = async () => {
    const code = blocker()?.code;
    if (!code || code === 'runtime_not_ready' || pending()) return;
    setPending(true);
    try { await props.onRecover(code); } finally { setPending(false); }
  };
  return <Show when={blocker()} fallback={props.children}>{(blocked) => (
    <div class="flex h-full min-h-0 items-center justify-center p-8" data-flower-runtime-blocker={blocked().code}>
      <div class="w-full max-w-lg space-y-4 rounded-xl border border-border/60 bg-background p-6" role="status" aria-live="polite">
        <h2 class="text-lg font-semibold">{props.i18n.t(blocked().code === 'desktop_update_required' ? 'flowerRuntime.desktopTitle' : 'flowerRuntime.runtimeTitle')}</h2>
        <p class="text-sm leading-6 text-muted-foreground">{props.i18n.t(blocked().code === 'desktop_update_required' ? 'flowerRuntime.desktopDetail' : 'flowerRuntime.runtimeDetail')}</p>
        <p class="break-all font-mono text-xs text-muted-foreground">{props.i18n.t('flowerRuntime.connectedBuild', { version: props.snapshot?.runtime_version || '—', commit: props.snapshot?.runtime_commit?.slice(0, 12) || '—' })}</p>
        <div class="flex flex-wrap gap-2">
          <Button disabled={pending()} onClick={() => void recover()}>{props.i18n.t(blocked().code === 'desktop_update_required' ? 'environmentAction.updateRedevenDesktop' : 'environmentAction.updateRuntime')}</Button>
          <Button variant="outline" onClick={props.onBack}>{props.i18n.t('shell.backToEnvironments')}</Button>
        </div>
      </div>
    </div>
  )}</Show>;
}
