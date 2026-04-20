import { Minus, Plus } from '@floegence/floe-webapp-core/icons';

import { WorkbenchAppearanceButton } from '../WorkbenchAppearanceButton';
import type {
  WorkbenchAppearance,
  WorkbenchAppearanceTexture,
  WorkbenchAppearanceTone,
} from '../workbenchAppearance';

export interface RedevenWorkbenchHudProps {
  scaleLabel: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  appearance?: WorkbenchAppearance;
  onToneSelect?: (tone: WorkbenchAppearanceTone) => void;
  onTextureSelect?: (texture: WorkbenchAppearanceTexture) => void;
  onResetAppearance?: () => void;
}

export function RedevenWorkbenchHud(props: RedevenWorkbenchHudProps) {
  const hasAppearanceControls = Boolean(
    props.appearance && props.onToneSelect && props.onTextureSelect && props.onResetAppearance,
  );

  return (
    <div class="workbench-hud" data-floe-canvas-interactive="true">
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
      {hasAppearanceControls ? (
        <>
          <span class="workbench-hud__divider" aria-hidden="true" />
          <WorkbenchAppearanceButton
            appearance={props.appearance!}
            onToneSelect={props.onToneSelect!}
            onTextureSelect={props.onTextureSelect!}
            onReset={props.onResetAppearance!}
          />
        </>
      ) : null}
    </div>
  );
}
