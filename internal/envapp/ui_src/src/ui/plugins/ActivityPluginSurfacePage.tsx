import { useViewActivation } from '@floegence/floe-webapp-core';
import { Show, type Accessor, type JSX } from 'solid-js';

import type { PluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';
import { PluginSurfaceContainer, type PluginSurfaceResolver } from './PluginSurfaceContainer';

export type ActivityPluginSurfacePageProps = Readonly<{
  resolveSurface?: PluginSurfaceResolver;
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  target: Accessor<PluginSurfaceLaunchTarget | null>;
  registerClose: (close: (() => Promise<boolean>) | null) => void;
  onRetirementError: (error: unknown) => void;
}>;

export function ActivityPluginSurfacePage(props: ActivityPluginSurfacePageProps): JSX.Element {
  const activation = useViewActivation();

  return (
    <div class="h-full min-h-0 w-full" data-activity-plugin-surface-page>
      <Show when={props.target()} keyed>
        {(target) => (
          <PluginSurfaceContainer resolveSurface={props.resolveSurface}
            coordinator={props.coordinator}
            confirmationQueue={props.confirmationQueue}
            target={target}
            visible={activation.active()}
            registerClose={props.registerClose}
            onRetirementError={props.onRetirementError}
          />
        )}
      </Show>
    </div>
  );
}
