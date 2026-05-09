import { Motion } from 'solid-motionone';
import { Show, createMemo } from 'solid-js';

export type WorkbenchProgressCurtainStage =
  | 'connecting'
  | 'layout'
  | 'canvas'
  | 'ready';

export interface WorkbenchProgressCurtainProps {
  visible: boolean;
  stage: WorkbenchProgressCurtainStage;
  message?: string;
}

const CURTAIN_STATUS_TEXT: Record<WorkbenchProgressCurtainStage, string> = {
  connecting: 'Connecting workspace',
  layout: 'Loading layout',
  canvas: 'Preparing canvas',
  ready: 'Ready',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function WorkbenchProgressCurtain(props: WorkbenchProgressCurtainProps) {
  const statusText = createMemo(
    () => compact(props.message) || CURTAIN_STATUS_TEXT[props.stage],
  );

  return (
    <Show when={props.visible}>
      <div
        class="redeven-workbench-progress-curtain"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-redeven-workbench-progress-stage={props.stage}
      >
        <Motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, easing: 'ease-out' }}
        >
          <div class="redeven-workbench-progress-curtain__panel">
            <div class="redeven-workbench-progress-curtain__eyebrow">Workbench</div>
            <div
              class="redeven-workbench-progress-curtain__indicator"
              role="progressbar"
              aria-label={statusText()}
            >
              <div class="redeven-workbench-progress-curtain__indicator-bar" />
            </div>
            <div class="redeven-workbench-progress-curtain__message">{statusText()}</div>
          </div>
        </Motion.div>
      </div>
    </Show>
  );
}
