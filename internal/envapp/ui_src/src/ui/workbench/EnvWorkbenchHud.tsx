import { Minus, Plus } from '@floegence/floe-webapp-core/icons';

export interface EnvWorkbenchHudProps {
  scaleLabel: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
}

export function EnvWorkbenchHud(props: EnvWorkbenchHudProps) {
  return (
    <div class="workbench-hud" data-floe-canvas-interactive="true">
      <button
        type="button"
        class="workbench-hud__button"
        aria-label="Zoom out"
        onClick={() => props.onZoomOut()}
      >
        <Minus class="h-3.5 w-3.5" />
      </button>
      <div class="workbench-hud__scale">{props.scaleLabel}</div>
      <button
        type="button"
        class="workbench-hud__button"
        aria-label="Zoom in"
        onClick={() => props.onZoomIn()}
      >
        <Plus class="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
