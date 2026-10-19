import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../src/composer/createFlowerComposerDraftCoordinator';
import { createRuntimeFlowerSurfaceAdapter } from '../../src/runtimeFlowerSurfaceAdapter';
import { streamingFixture } from '../streamingFixture';
import '../../src/styles/flower.css';

const id = new URLSearchParams(location.search).get('thread')!;
const readStatus = { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } };
async function api(op: string, threadID = id, body?: unknown) {
  const response = await fetch('/fixture?op=' + op + '&id=' + encodeURIComponent(threadID), {
    method: body ? 'POST' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(await response.text());
  const value = await response.json();
  // The product HTTP boundary adds viewer-owned read metadata after Service.
  if (value.thread) value.thread = { ...value.thread, read_status: readStatus };
  if (value.threads) value.threads = value.threads.map((thread: object) => ({ ...thread, read_status: readStatus }));
  return value;
}
const defaults = streamingFixture().adapter;
const unavailable = async (): Promise<never> => { throw new Error('Outside qualification scope'); };
const adapter = createRuntimeFlowerSurfaceAdapter({
  runtime: defaults.runtime,
  canMutate: false,
  mapperOptions: { runtimeID: 'fixture', runtimeKind: 'env_local', sourceLabel: 'Isolated runtime', targetLabels: [] },
  loadSettings: defaults.loadSettings, saveDefaultPermission: defaults.saveDefaultPermission,
  saveModelProfile: defaults.saveModelProfile, persistDefaultModel: defaults.persistDefaultModel,
  resolveHandler: defaults.resolveHandler,
  transport: {
    listThreads: () => api('list'),
    ...(!new URLSearchParams(location.search).has('history') ? { connectLiveStream: async function* ({ signal }: { signal: AbortSignal }) {
      const response = await fetch('/live', { signal });
      if (!response.ok || !response.body) throw new Error('Live stream unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) {
            yield { data: pending.slice(0, end) };
            pending = pending.slice(end + 1);
          }
        }
      } finally { await reader.cancel(); }
    }
    } : {}),
    loadThread: threadID => api('detail', threadID),
    forkThread: unavailable,

    loadSubagentDetail: unavailable,
    markThreadRead: async () => ({ read_status: readStatus }),
    patchThread: unavailable, submitApproval: unavailable,
  },
  launchTurn: unavailable, retryThread: unavailable, stopThread: unavailable, submitInput: unavailable,
});
const loadThread = adapter.loadThread;
const qualified = { ...adapter, loadThread: async (threadID: string) => { try { return await loadThread(threadID); } catch (error) { console.error('qualification detail:', String(error)); throw error; } } };
const [notice, setNotice] = createSignal('');
document.getElementById('root')!.style.height = '100vh';
render(() => <FloeProvider>
  <Show when={notice()}><div role="status">{notice()}</div></Show>
  <FlowerSurface adapter={qualified} notify={message => setNotice(message.message)}
    draftCoordinator={createFlowerComposerDraftCoordinator()}
    focusThreadRequest={{ request_id: 'qualification', thread_id: id }} />
</FloeProvider>, document.getElementById('root')!);
