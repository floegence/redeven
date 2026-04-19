import { Show } from 'solid-js';
import {
  DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY,
  DEFAULT_FILE_BROWSER_SURFACE_TITLE,
} from './createFileBrowserSurfaceController';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export function FileBrowserSurfaceHost() {
  const fileBrowserSurface = useFileBrowserSurfaceContext();

  return (
    <PersistentFloatingWindow
      open={fileBrowserSurface.controller.open()}
      onOpenChange={fileBrowserSurface.controller.handleOpenChange}
      title={fileBrowserSurface.controller.surface()?.title ?? DEFAULT_FILE_BROWSER_SURFACE_TITLE}
      persistenceKey={fileBrowserSurface.controller.surface()?.persistenceKey ?? DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY}
      defaultSize={{ width: 760, height: 580 }}
      minSize={{ width: 420, height: 320 }}
      zIndex={ENV_APP_FLOATING_LAYER.fileBrowserSurface}
    >
      <div class="h-full min-h-0 overflow-hidden bg-background">
        <Show when={fileBrowserSurface.controller.surface()} keyed>
          {(browser) => (
            <RemoteFileBrowser
              stateScope={browser.stateScope}
              initialPathOverride={browser.path}
              homePathOverride={browser.homePath}
            />
          )}
        </Show>
      </div>
    </PersistentFloatingWindow>
  );
}
