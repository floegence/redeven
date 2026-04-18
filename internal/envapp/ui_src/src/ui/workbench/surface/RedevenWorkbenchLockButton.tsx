import { Motion } from 'solid-motionone';
import { Lock, Unlock } from '@floegence/floe-webapp-core/icons';

import { WORKBENCH_EASING_OUT, WORKBENCH_MOTION_DURATION_FAST } from './workbenchMotion';

export interface RedevenWorkbenchLockButtonProps {
  locked: boolean;
  onToggle: () => void;
  shortcutLabel?: string;
}

export function RedevenWorkbenchLockButton(props: RedevenWorkbenchLockButtonProps) {
  const label = () =>
    props.locked ? 'Unlock canvas' : 'Lock canvas';

  return (
    <button
      type="button"
      class="workbench-lock-button"
      classList={{ 'is-locked': props.locked }}
      aria-label={props.shortcutLabel ? `${label()} (${props.shortcutLabel})` : label()}
      aria-pressed={props.locked}
      data-floe-canvas-interactive="true"
      onClick={() => props.onToggle()}
    >
      <span class="workbench-lock-button__icon">
        <Motion.span
          class="workbench-lock-button__icon-swap"
          animate={{ rotate: props.locked ? 0 : -14 }}
          transition={{ duration: WORKBENCH_MOTION_DURATION_FAST, easing: WORKBENCH_EASING_OUT }}
        >
          {props.locked ? <Lock class="w-4 h-4" /> : <Unlock class="w-4 h-4" />}
        </Motion.span>
      </span>
      {props.shortcutLabel ? (
        <span class="workbench-lock-button__kbd">{props.shortcutLabel}</span>
      ) : null}
    </button>
  );
}
