import { createEffect, onCleanup, type Accessor } from 'solid-js';
import { Portal } from 'solid-js/web';

import { CodexFeatureProvider } from './CodexFeatureProvider';
import { CodexPage } from './CodexPage';
import { CodexSidebar } from './CodexSidebar';

type CodexActivitySurfaceProps = Readonly<{
  sidebarHost: Accessor<HTMLElement | null>;
}>;

export function CodexActivitySurface(props: CodexActivitySurfaceProps) {
  const sidebarMount = document.createElement('div');
  sidebarMount.dataset.codexActivitySidebarPortal = '';
  sidebarMount.style.display = 'contents';

  createEffect(() => {
    const host = props.sidebarHost();
    if (host) {
      host.append(sidebarMount);
      return;
    }
    sidebarMount.remove();
  });

  onCleanup(() => {
    sidebarMount.remove();
  });

  return (
    <CodexFeatureProvider>
      <CodexPage />
      <Portal
        mount={sidebarMount}
        ref={(element) => {
          element.style.display = 'contents';
        }}
      >
        <CodexSidebar />
      </Portal>
    </CodexFeatureProvider>
  );
}
