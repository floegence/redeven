import { Motion } from 'solid-motionone';
import { Show, createMemo } from 'solid-js';

export type RedevenLoadingCurtainSurface = 'component' | 'page' | 'fullscreen';

export interface RedevenLoadingCurtainProps {
  visible: boolean;
  message?: string;
  eyebrow?: string;
  surface?: RedevenLoadingCurtainSurface;
  blocking?: boolean;
  class?: string;
  testId?: string;
  progressLabel?: string;
  dataStage?: string;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function RedevenLoadingCurtain(props: RedevenLoadingCurtainProps) {
  const surface = createMemo(() => props.surface ?? 'component');
  const blocking = createMemo(() => props.blocking ?? true);
  const message = createMemo(() => compact(props.message) || 'Loading...');
  const eyebrow = createMemo(() => compact(props.eyebrow) || 'Loading');
  const progressLabel = createMemo(() => compact(props.progressLabel) || message());

  return (
    <Show when={props.visible}>
      <div
        class={joinClasses(
          'redeven-loading-curtain',
          `redeven-loading-curtain--${surface()}`,
          !blocking() && 'redeven-loading-curtain--passive',
          props.class,
        )}
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid={props.testId}
        data-redeven-loading-curtain-surface={surface()}
        data-redeven-loading-curtain-stage={compact(props.dataStage) || undefined}
      >
        <Motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, easing: 'ease-out' }}
        >
          <div class="redeven-loading-curtain__panel">
            <div class="redeven-loading-curtain__eyebrow">{eyebrow()}</div>
            <div
              class="redeven-loading-curtain__indicator"
              role="progressbar"
              aria-label={progressLabel()}
            >
              <div class="redeven-loading-curtain__indicator-bar" />
            </div>
            <div class="redeven-loading-curtain__message">{message()}</div>
          </div>
        </Motion.div>
      </div>
    </Show>
  );
}
