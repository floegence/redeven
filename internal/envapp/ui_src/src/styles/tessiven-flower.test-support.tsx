import { onCleanup } from 'solid-js';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerSurfaceAdapter } from '../../../../flower_ui/src';
import type { CanvasFlowerSurfaceProps } from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { adapter, liveBootstrap, thread } from '../ui/FlowerSurface.media.test-support';

export function canvasFlowerAdapter(): FlowerSurfaceAdapter {
  return {
    ...adapter(true), listThreads: async () => [],
    loadThread: async id => liveBootstrap(thread({ thread_id: id }), 1),
    launchTurn: async input => ({ client_request_id: input.client_request_id, thread_id: input.thread_id ?? 'canvas-thread',
      current: { thread_id: input.thread_id ?? 'canvas-thread', view_version: 1, activity: 'idle', queue: [], interactions: [],
        items: [{ id: `user:${input.client_request_id}`, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: input.prompt }] },
    }),
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 1, kind: 'ready', summaries: [] };
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  };
}
export function CanvasFlowerTestSurface(props: CanvasFlowerSurfaceProps & { adapter: FlowerSurfaceAdapter }) {
  const drafts = createFlowerComposerDraftCoordinator();
  onCleanup(() => drafts.dispose());
  return <FlowerSurface adapter={props.adapter} draftCoordinator={drafts} presentation="companion"
    engaged={props.engaged} transcriptVisible={props.transcriptVisible} embeddedConversation={props.embeddedConversation}
    notify={() => {}} />;
}
