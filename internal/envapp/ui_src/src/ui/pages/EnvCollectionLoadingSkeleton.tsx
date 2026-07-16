import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { SkeletonCard } from '@floegence/floe-webapp-core/loading';

const INITIAL_LOADING_DELAY_MS = 150;

export function EnvCollectionLoadingSkeleton(props: {
  visible: boolean;
  message: string;
  testId: string;
}) {
  const [delayedVisible, setDelayedVisible] = createSignal(false);

  createEffect(() => {
    if (!props.visible) {
      setDelayedVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setDelayedVisible(true), INITIAL_LOADING_DELAY_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show when={delayedVisible()}>
      <div
        class="redeven-collection-loading-skeleton min-h-[200px]"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy="true"
        data-testid={props.testId}
      >
        <span class="sr-only">{props.message}</span>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          <SkeletonCard class="min-h-[12.5rem]" />
          <SkeletonCard class="hidden min-h-[12.5rem] md:block" />
          <SkeletonCard class="hidden min-h-[12.5rem] lg:block" />
        </div>
      </div>
    </Show>
  );
}
