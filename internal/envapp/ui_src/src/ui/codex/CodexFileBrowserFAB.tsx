import { Motion } from 'solid-motionone';
import { Folder } from '@floegence/floe-webapp-core/icons';

import { createFileBrowserFABModel } from '../widgets/createFileBrowserFABModel';

export interface CodexFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  containerRef?: HTMLElement;
}

export function CodexFileBrowserFAB(props: CodexFileBrowserFABProps) {
  const fab = createFileBrowserFABModel({
    workingDir: () => props.workingDir,
    homePath: () => props.homePath,
    containerRef: () => props.containerRef,
    allowHomeFallback: true,
  });

  return (
    <div class="redeven-fab-file-browser codex-page-file-browser-fab" style={fab.fabStyle()}>
      <Motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, easing: 'ease-out' }}
      >
        <button
          class="redeven-fab-file-browser-btn"
          title="Browse files"
          disabled={!fab.canOpenBrowser()}
          aria-disabled={fab.canOpenBrowser() ? undefined : 'true'}
          onPointerDown={fab.onPointerDown}
          onPointerMove={fab.onPointerMove}
          onPointerUp={fab.onPointerUp}
        >
          <Folder class="w-5 h-5" />
        </button>
      </Motion.div>
    </div>
  );
}
