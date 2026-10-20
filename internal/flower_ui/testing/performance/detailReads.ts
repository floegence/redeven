import { createRuntimeFlowerSurfaceAdapter } from '../../src/runtimeFlowerSurfaceAdapter';
import { createThreadDetailLoader, type ThreadDetailTarget } from '../../src/threadDetailLoader';
import { streamingFixture } from '../streamingFixture';

/** Synthetic, local qualification only; production reads carry no measurement state. */
export async function qualifyDetailReads() {
  const fixture = streamingFixture(610, 220);
  const samples: Record<string, { wait: number; transfer: number; parse: number; mapping: number }[]> = { short: [], long: [] };
  const counts = { demands: 0, requests: 0, cancelled: 0, completed: 0 };
  const target = (revision = 1): ThreadDetailTarget => ({ epoch: 1, activityRevision: revision, settingsRevision: 1, runtimeKey: 'running', source: 'qualification' });
  const unavailable = async (): Promise<never> => { throw new Error('Outside detail read qualification'); };
  for (const kind of ['short', 'long']) {
    const id = 'qualification-' + kind;
    const current = { ...fixture.current(), thread_id: id, items: kind === 'short' ? fixture.current().items?.slice(0, 2) : fixture.current().items, queue: [] };
    const raw = { current, thread: { thread_id: id, title: 'Synthetic ' + kind, title_status: 'ready', title_generation: 1,
      model_id: 'fixture/model', working_dir: '/workspace', settings_revision: 1, created_at_unix_ms: 1, updated_at_unix_ms: 2,
      read_status: fixture.thread.read_status } };
    const response = await fetch('/qualification-detail/' + id, { method: 'POST', body: JSON.stringify(raw) });
    if (!response.ok) throw new Error('Could not seed synthetic detail');
  }
  let measured = false;
  let delay = false;
  let transportEnd = 0;
  let sample = { wait: 0, transfer: 0, parse: 0, mapping: 0 };
  const adapter = createRuntimeFlowerSurfaceAdapter({
    runtime: fixture.adapter.runtime, mapperOptions: { runtimeID: 'qualification', runtimeKind: 'env_local', sourceLabel: 'Synthetic', targetLabels: [] },
    loadSettings: fixture.adapter.loadSettings, saveDefaultPermission: fixture.adapter.saveDefaultPermission,
    saveModelProfile: fixture.adapter.saveModelProfile, persistDefaultModel: fixture.adapter.persistDefaultModel,
    resolveHandler: fixture.adapter.resolveHandler, launchTurn: unavailable, retryThread: unavailable, stopThread: unavailable, submitInput: unavailable,
    transport: { listThreads: unavailable, loadSubagentDetail: unavailable, markThreadRead: unavailable, patchThread: unavailable, forkThread: unavailable, submitApproval: unavailable,
      loadThread: async (id, signal) => {
        counts.requests++;
        const aborted = () => { counts.cancelled++; };
        signal.addEventListener('abort', aborted, { once: true });
        try {
          const start = performance.now();
          const response = await fetch('/qualification-detail/' + id + (delay ? '?delay=40' : ''), { signal });
          const headers = performance.now();
          const body = await response.text();
          const received = performance.now();
          const raw: unknown = JSON.parse(body);
          transportEnd = performance.now();
          sample = { wait: headers - start, transfer: received - headers, parse: transportEnd - received, mapping: 0 };
          return raw;
        } finally { signal.removeEventListener('abort', aborted); }
      },
    },
  });
  const errors: unknown[] = [];
  const loader = createThreadDetailLoader({ onLoading: () => undefined, onError: (_id, _target, error) => errors.push(error),
    read: async (id, _target, signal) => {
      const view = await adapter.loadThread(id, signal);
      counts.completed++;
      if (measured) { sample.mapping = performance.now() - transportEnd; samples[id.slice('qualification-'.length)]!.push(sample); }
      return view;
    },
  });
  const request = (kind: string, revision = 1, signal?: AbortSignal) => { counts.demands++; return loader.request('qualification-' + kind, target(revision), signal); };
  try {
    for (const kind of ['short', 'long']) {
      await request(kind);
      measured = true;
      for (let i = 0; i < 30; i++) { loader.invalidate('qualification-' + kind); if (!await request(kind)) throw new Error('Detail measurement failed'); }
      measured = false;
    }
    const baseline = { ...counts };
    delay = true;
    const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    for (let i = 0; i < 12; i++) {
      const navigation = new AbortController();
      const first = request('short', 1, navigation.signal); await tick();
      const confirmation = request('short', 1);
      const next = request('short', 2); const latest = request('short', 3);
      navigation.abort();
      const result = await Promise.all([first, confirmation, next, latest]);
      if (result[0] !== null || result.slice(1).some(value => !value)) throw new Error('Shared consumer settlement failed');
      const old = new AbortController();
      const abandoned = request('long', 1, old.signal); await tick(); old.abort();
      if (await abandoned !== null) throw new Error('Abandoned read was accepted');
      await request('short', 4);
    }
    if (errors.length) throw new Error('Read qualification emitted an error');
    const rapid = Object.fromEntries(Object.keys(counts).map(key => [key, counts[key as keyof typeof counts] - baseline[key as keyof typeof counts]]));
    const percentiles = (values: number[]) => { values.sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1] }; };
    return { samples: 30, milliseconds: Object.fromEntries(Object.entries(samples).map(([kind, rows]) => [kind,
      Object.fromEntries(['wait', 'transfer', 'parse', 'mapping'].map(key => [key, percentiles(rows.map(row => row[key as keyof typeof row]))]))])),
      rapid: { ...rapid, coalesced: rapid.demands! - rapid.requests! }, note: 'Built renderer, real loopback HTTP, synthetic 2/610 items; excludes backend processing.' };
  } finally { loader.dispose(); }
}
