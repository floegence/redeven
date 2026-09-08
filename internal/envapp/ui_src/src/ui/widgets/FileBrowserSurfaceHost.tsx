import { Show, createEffect, createSignal } from 'solid-js';
import {
  DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY,
  DEFAULT_FILE_BROWSER_SURFACE_TITLE,
} from './createFileBrowserSurfaceController';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { useEnvAppFloatingWindowStack } from '../context/EnvAppFloatingWindowStackContext';

export function FileBrowserSurfaceHost() {
  const fileBrowserSurface = useFileBrowserSurfaceContext();
  const stack = useEnvAppFloatingWindowStack();
  const [windowSurface, setWindowSurface] = createSignal<HTMLElement | null>(null);
  createEffect(() => {
    const request = fileBrowserSurface.controller.surface();
    const surface = windowSurface();
    if (!request || !surface || !fileBrowserSurface.controller.open()) return;
    stack?.activate('file-browser');
    surface.focus({ preventScroll: true });
  });

  return (
    <PersistentFloatingWindow
      open={fileBrowserSurface.controller.open()}
      onOpenChange={fileBrowserSurface.controller.handleOpenChange}
      title={fileBrowserSurface.controller.surface()?.title ?? DEFAULT_FILE_BROWSER_SURFACE_TITLE}
      persistenceKey={fileBrowserSurface.controller.surface()?.persistenceKey ?? DEFAULT_FILE_BROWSER_SURFACE_PERSISTENCE_KEY}
      stackId="file-browser"
      surfaceRef={setWindowSurface}
      defaultSize={{ width: 760, height: 580 }}
      minSize={{ width: 420, height: 320 }}
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
