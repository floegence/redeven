import { cn } from '@floegence/floe-webapp-core';
import {
  Dialog as FloeDialog,
  type DialogProps,
} from '@floegence/floe-webapp-core/ui';
import type { JSX } from 'solid-js';

import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export interface EnvAppDrawerProps extends Omit<DialogProps, 'globalZIndex'> {
  bodyClass?: string;
}

export function EnvAppDrawer(props: EnvAppDrawerProps): JSX.Element {
  return (
    <FloeDialog
      {...props}
      class={cn('env-app-drawer-panel', props.class)}
      globalZIndex={ENV_APP_FLOATING_LAYER.productModal}
    >
      <div
        aria-hidden="true"
        data-env-app-drawer-interaction-boundary="true"
        data-redeven-desktop-titlebar-no-drag="true"
        class="pointer-events-none absolute inset-0"
      />
      <div
        data-floe-dialog-surface-host="true"
        data-floe-surface-portal-layer="true"
        class={cn('relative z-[1] min-h-0', props.bodyClass)}
      >
        {props.children}
      </div>
    </FloeDialog>
  );
}
