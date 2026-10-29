import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import type { FlowerSurfaceAdapter, FlowerTaskFiles, FlowerTaskMaterial } from './contracts/flowerSurfaceContracts';
import { retainKeyedItems } from './presentationIdentity';

export type TaskFileFilter = 'all' | 'results' | 'uploads';
type Source = 'files' | 'materials';

/** Dialog-owned discovery: bounded canonical pages, no second inventory or transcript. */
export function createTaskFileListing(props: {
  open: boolean; threadID: string; adapter: FlowerSurfaceAdapter;
}, query: Accessor<string>, filter: Accessor<TaskFileFilter>, nearEnd: Accessor<boolean>, browsing: Accessor<boolean>, process: Accessor<boolean>) {
  const [data, setData] = createSignal<FlowerTaskFiles>();
  const [materials, setMaterials] = createSignal<readonly FlowerTaskMaterial[]>([]);
  const [materialCursor, setMaterialCursor] = createSignal<string>();
  const [ready, setReady] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [owner, setOwner] = createSignal(0);
  let active: AbortController | undefined;
  let currentThread: string | undefined, currentRuntime: string | undefined;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = { files: new Set<string>(), materials: new Set<string>() };
  const matches = (name: string, title = '') => (name + ' ' + title).toLocaleLowerCase().includes(query().trim().toLocaleLowerCase());
  const files = createMemo(() => process() || filter() === 'uploads' ? [] : (data()?.files ?? []).filter(file => matches(file.name, file.title)));
  const visibleMaterials = createMemo(() => !process() && filter() === 'results' ? [] : materials().filter(item =>
    item.kind === (process() ? 'media' : 'input') && matches(item.name)));
  const nextSource = (): Source | undefined => {
    if (!process() && filter() !== 'uploads' && data()?.next_cursor) return 'files';
    if ((process() || filter() !== 'results') && materialCursor()) return 'materials';
    return undefined;
  };
  const hasMore = createMemo(() => Boolean(nextSource()));
  const publish = async (source: Source, reset: boolean, controller: AbortController, generation: number) => {
    const cursor = reset ? undefined : source === 'files' ? data()?.next_cursor : materialCursor();
    const isCurrent = () => generation === epoch && !controller.signal.aborted;
    if (!reset && (!cursor || seen[source].has(cursor))) throw new Error('File cursor did not advance.');
    if (source === 'files') {
      const page = await props.adapter.loadTaskFiles!(props.threadID, cursor, controller.signal);
      if (!isCurrent()) return;
      if (page.next_cursor && (page.next_cursor === cursor || seen.files.has(page.next_cursor))) throw new Error('File cursor did not advance.');
      setData(previous => ({ ...page, files: retainKeyedItems(previous?.files ?? [],
        [...new Map([...(reset ? [] : previous?.files ?? []), ...page.files].map(file => [file.file_path, file])).values()], file => file.file_path) }));
    } else {
      const page = await props.adapter.loadTaskMaterials!(props.threadID, cursor, controller.signal);
      if (!isCurrent()) return;
      if (page.next_cursor && (page.next_cursor === cursor || seen.materials.has(page.next_cursor))) throw new Error('Material cursor did not advance.');
      setMaterials(previous => retainKeyedItems(previous,
        [...new Map([...(reset ? [] : previous), ...page.items].map(item => [item.id, item])).values()], item => item.id));
      setMaterialCursor(page.next_cursor);
    }
    if (cursor) seen[source].add(cursor);
  };
  const refresh = () => setRevision(value => value + 1);
  createEffect(() => {
    const open = props.open, thread = props.threadID, runtime = props.adapter.runtime?.runtime_id;
    const loaders = [props.adapter.loadTaskFiles, props.adapter.loadTaskMaterials];
    void revision();
    const generation = ++epoch;
    active?.abort(); clearTimeout(timer); timer = undefined;
    const changed = thread !== currentThread || runtime !== currentRuntime;
    currentThread = thread; currentRuntime = runtime;
    if (changed) {
      setData(undefined); setMaterials([]); setMaterialCursor(undefined); setReady(false); setOwner(value => value + 1);
    }
    setLoading(false); setFailed(false);
    seen.files.clear(); seen.materials.clear();
    if (!open || !thread) return;
    const controller = new AbortController(); active = controller; setLoading(true);
    const reads = (['files', 'materials'] as const).filter((_, index) => loaders[index]);
    // Both sources can complete independently; a failed source never hides a successful one.
    void Promise.allSettled(reads.map(source => untrack(() => publish(source, true, controller, generation)))).then(results => {
      if (generation !== epoch || controller.signal.aborted) return;
      setFailed(results.some(result => result.status === 'rejected'));
      setReady(true); setLoading(false);
    });
  });
  const more = async () => {
    const source = nextSource();
    if (!props.open || !browsing() || loading() || failed() || !source) return;
    const controller = new AbortController(), generation = epoch;
    active = controller; setLoading(true);
    try { await publish(source, false, controller, generation); }
    catch { if (generation === epoch && !controller.signal.aborted) setFailed(true); }
    finally { if (generation === epoch && !controller.signal.aborted) setLoading(false); }
  };
  createEffect(() => {
    const shouldRead = props.open && browsing() && ready() && !loading() && !failed() && hasMore()
      && (Boolean(query().trim()) || nearEnd() || files().length + visibleMaterials().length === 0);
    clearTimeout(timer); timer = undefined;
    if (shouldRead) timer = setTimeout(() => { timer = undefined; void more(); }, 16);
  });
  onCleanup(() => { epoch++; active?.abort(); clearTimeout(timer); });
  return { data, materials, files, visibleMaterials, ready, loading, failed, hasMore, refresh, owner };
}
