import { Show } from 'solid-js';
import { Minus, Plus } from '@floegence/floe-webapp-core/icons';
import {
  WorkbenchThemeSelector,
  type WorkbenchThemeId,
} from '@floegence/floe-webapp-core/workbench';

export interface RedevenWorkbenchHudProps {
  scaleLabel: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  activeTheme?: WorkbenchThemeId;
  onSelectTheme?: (theme: WorkbenchThemeId) => void;
}

export function RedevenWorkbenchHud(props: RedevenWorkbenchHudProps) {
  return (
    <div class="workbench-hud" data-floe-canvas-interactive="true">
      <Show when={props.activeTheme && props.onSelectTheme}>
        <WorkbenchThemeSelector
          activeTheme={props.activeTheme!}
          onSelect={(theme) => props.onSelectTheme?.(theme)}
        />
        <div class="workbench-hud__divider" aria-hidden="true" />
      </Show>
      <button
        type="button"
        class="workbench-hud__button"
        aria-label="Zoom out"
        onClick={() => props.onZoomOut()}
      >
        <Minus class="w-3.5 h-3.5" />
      </button>
      <div class="workbench-hud__scale">{props.scaleLabel}</div>
      <button
        type="button"
        class="workbench-hud__button"
        aria-label="Zoom in"
        onClick={() => props.onZoomIn()}
      >
        <Plus class="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
