import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../src/composer/createFlowerComposerDraftCoordinator';
import { createRuntimeFlowerSurfaceAdapter } from '../../src/runtimeFlowerSurfaceAdapter';
import { flowerLiveWireFixture } from '../../src/test/flowerLiveWireFixture';
import { streamingFixture } from '../streamingFixture';
import '../../src/styles/flower.css';

const id = new URLSearchParams(location.search).get('thread')!;
const readStatus = { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } };
async function api(op: string, body?: unknown, threadID = id) {
  const response = await fetch('/fixture?op=' + op + '&id=' + encodeURIComponent(threadID), {
    method: body ? 'POST' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(await response.text());
  const value = await response.json();
  // The production HTTP handler adds viewer-owned read metadata after Service.
  if (value.thread) value.thread = { ...value.thread, read_status: readStatus };
  if (value.threads) value.threads = value.threads.map((thread: object) => ({ ...thread, read_status: readStatus }));
  return value;
}
const defaults = streamingFixture().adapter;
const unavailable = async (): Promise<never> => { throw new Error('Outside qualification scope'); };
const adapter = createRuntimeFlowerSurfaceAdapter({
  runtime: defaults.runtime,
  mapperOptions: { runtimeID: 'fixture', runtimeKind: 'env_local', sourceLabel: 'Isolated runtime', targetLabels: [] },
  loadSettings: defaults.loadSettings, saveDefaultPermission: defaults.saveDefaultPermission,
  saveModelProfile: defaults.saveModelProfile, persistDefaultModel: defaults.persistDefaultModel,
  resolveHandler: defaults.resolveHandler,
  transport: {
    listThreads: () => api('list'),
    loadThread: threadID => api('detail', undefined, threadID),
    loadSubagentDetail: unavailable,
    markThreadRead: async () => ({ read_status: readStatus }),
    patchThread: unavailable, forkThread: unavailable, submitApproval: unavailable,
    async *connectLiveStream({ signal }) {
      yield* flowerLiveWireFixture({ schema_version: 1, kind: 'ready', summaries: (await api('list')).threads });
      while (!signal.aborted) {
        const detail = await api('detail');
        yield* flowerLiveWireFixture({ schema_version: 1, kind: 'thread.batch', thread_id: id, current: detail.current });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
  },
  launchTurn: unavailable, retryThread: unavailable,
  stopThread: threadID => api('stop', undefined, threadID),
  submitInput: input => api('respond', input),
});
const [notice, setNotice] = createSignal('');
document.getElementById('root')!.style.height = '100vh';
render(() => <FloeProvider>
  <Show when={notice()}><div role="alert">{notice()}</div></Show>
  <FlowerSurface adapter={adapter} notify={message => setNotice(message.message)}
    draftCoordinator={createFlowerComposerDraftCoordinator()}
    focusThreadRequest={{ request_id: 'qualification', thread_id: id }} />
</FloeProvider>, document.getElementById('root')!);
