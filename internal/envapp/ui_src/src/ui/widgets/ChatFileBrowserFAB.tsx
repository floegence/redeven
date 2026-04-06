// Floating browser FAB for the chat page.
// The FAB lives inside the message area and can be dragged to any edge.
import { Show } from 'solid-js';
import { Motion } from 'solid-motionone';
import { Folder } from '@floegence/floe-webapp-core/icons';
import { createFileBrowserFABModel } from './createFileBrowserFABModel';

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
  /** Ref to the container element that bounds the FAB drag area. */
  containerRef?: HTMLElement;
}

export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const fab = createFileBrowserFABModel({
    workingDir: () => props.workingDir,
    homePath: () => props.homePath,
    containerRef: () => props.containerRef,
  });

  return (
    <Show when={(props.enabled ?? true) && !fab.fileBrowserSurface.controller.open()}>
      <div class="redeven-fab-file-browser" style={fab.fabStyle()}>
        <Motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, easing: 'ease-out' }}
        >
          <button
            class="redeven-fab-file-browser-btn"
            title="Browse files"
            onPointerDown={fab.onPointerDown}
            onPointerMove={fab.onPointerMove}
            onPointerUp={fab.onPointerUp}
          >
            <Folder class="w-5 h-5" />
          </button>
        </Motion.div>
      </div>
    </Show>
  );
}
