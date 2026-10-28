import { $RAW } from 'solid-js/store';
import type {
  FlowerThreadSnapshot,
  FlowerThreadSummary,
  FlowerThreadReadStatus,
  FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerRuntimeUpdate,
} from './contracts/flowerSurfaceContracts';
import { mergeThreadTitle, threadTitleSnapshot, type ThreadTitleSnapshot } from './threadTitleSnapshot';
import { retainEqualValue, retainThreadPresentation } from './presentationIdentity';
import { retainThreadFileActivityTargets } from './fileActivityTargets';
import { FlowerLiveSyncError } from './flowerLiveWire';
import { createRuntimeThreadRecord, type RuntimeThreadRecord } from './runtimeThreadRecord';

type ThreadDetail = Omit<FlowerThreadSnapshot, keyof ThreadTitleSnapshot>;
type ThreadDetailView = Readonly<{ thread: ThreadDetail; version: number; contentRevision?: number }>;

function detailOnly(thread: ThreadDetail): ThreadDetail {
  const { title: _title, title_status: _status, title_generation: _generation, ...detail } = thread as FlowerThreadSnapshot;
  return detail;
}

function adjunctOnly(thread: ThreadDetail): ThreadDetail {
  if ('title' in thread || 'title_status' in thread || 'title_generation' in thread) {
    throw new Error('Flower contract error: adjunct updates cannot author titles.');
  }
  return thread;
}

export type ThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  version: number;
  contentRevision?: number;
}>;

export type ThreadViewAcceptance = 'accepted' | 'unchanged' | 'stale';

export type ThreadViewReceiveResult = Readonly<{
  cache: ThreadCache;
  state: ThreadViewAcceptance;
  runtimeState: ThreadViewAcceptance;
  activityState: ThreadViewAcceptance;
  settingsState: ThreadViewAcceptance;
  observations?: readonly FlowerRuntimeCurrentView[];
}>;

export function classifyThreadView(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  if (candidate.version > current.version) return 'accepted';
  if (candidate.version < current.version) return 'stale';
  if (candidate.thread.history_window && JSON.stringify(candidate.thread.history_window) !== JSON.stringify(current.thread.history_window)) return 'accepted';
  return 'unchanged';
}

function classifyThreadSettings(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  const currentRevision = threadSettingsRevision(current.thread);
  const candidateRevision = threadSettingsRevision(candidate.thread);
  if (candidateRevision > currentRevision) return 'accepted';
  if (candidateRevision < currentRevision) return 'stale';
  return 'unchanged';
}

function classifyThreadActivity(
  current: ThreadDetailView | undefined,
  candidate: ThreadDetailView,
): ThreadViewAcceptance {
  if (!current) return 'accepted';
  const currentRevision = threadSnapshotRevision(current.thread);
  const candidateRevision = threadSnapshotRevision(candidate.thread);
  if (candidateRevision > currentRevision) return 'accepted';
  if (candidateRevision < currentRevision) return 'stale';
  return 'unchanged';
}

function mergeThreadSettings<T extends ThreadDetail>(
  runtime: T,
  settings: ThreadDetail,
): T {
  return {
    ...runtime,
    model_id: settings.model_id,
    working_dir: settings.working_dir,
    pinned_at_ms: settings.pinned_at_ms,
    pin_rank: settings.pin_rank,
    permission_type: settings.permission_type,
    reasoning_selection: settings.reasoning_selection,
    reasoning_capability: settings.reasoning_capability,
    settings_revision: settings.settings_revision,
  };
}

function mergeThreadActivity<T extends ThreadDetail>(
  runtime: T,
  activity: ThreadDetail,
): T {
  return {
    ...runtime,
    updated_at_ms: Math.max(runtime.updated_at_ms, activity.updated_at_ms),
    read_status: mergeThreadReadStatus(runtime.read_status, activity.read_status),
  };
}

export function mergeThreadReadStatus(
  current: FlowerThreadReadStatus | undefined,
  candidate: FlowerThreadReadStatus | undefined,
  activityRevision = 0,
): FlowerThreadReadStatus {
  const activity = Math.max(activityRevision, current?.snapshot.activity_revision ?? 0, candidate?.snapshot.activity_revision ?? 0);
  const seen = Math.max(current?.read_state.last_seen_activity_revision ?? 0, candidate?.read_state.last_seen_activity_revision ?? 0);
  return { is_unread: activity > seen, snapshot: { activity_revision: activity }, read_state: { last_seen_activity_revision: seen } };
}

function mergeNewerSummaryMetadata<T extends ThreadDetail>(
  base: T,
  candidate: ThreadDetail,
): T {
  const withActivity = mergeThreadActivity(base, candidate);
  const baseSettingsRevision = threadSettingsRevision(withActivity);
  const candidateSettingsRevision = threadSettingsRevision(candidate);
  return candidateSettingsRevision > baseSettingsRevision
    ? mergeThreadSettings(withActivity, candidate)
    : withActivity;
}

function aggregateAcceptance(
  runtimeState: ThreadViewAcceptance,
  activityState: ThreadViewAcceptance,
  settingsState: ThreadViewAcceptance,
  titleState: ThreadViewAcceptance,
): ThreadViewAcceptance {
  if (runtimeState === 'accepted' || activityState === 'accepted' || settingsState === 'accepted' || titleState === 'accepted') return 'accepted';
  if (runtimeState === 'unchanged' || activityState === 'unchanged' || settingsState === 'unchanged') return 'unchanged';
  return 'stale';
}

export function threadSnapshotRevision(thread: ThreadDetail | undefined): number {
  if (!thread) return 0;
  return Math.max(
    0,
    Math.floor(Number(thread.updated_at_ms) || 0),
    Math.floor(Number(thread.read_status?.snapshot.activity_revision) || 0),
  );
}

export function threadSettingsRevision(thread: ThreadDetail | undefined): number {
  return Math.max(0, Math.floor(Number(thread?.settings_revision) || 0));
}

function threadRuntimeStateKey(thread: FlowerThreadSnapshot): string {
  return [
    thread.status,
    thread.active_run_id?.trim() ?? '',
    thread.approval_pending ? '1' : '0',
    String(Math.max(0, Math.floor(Number(thread.approval_pending_count) || 0))),
  ].join('\x1f');
}

export function threadSummaryNeedsDetail(
  summary: FlowerThreadSnapshot | undefined,
  detail: FlowerThreadSnapshot | undefined,
  contentRevision = detail?.updated_at_ms ?? 0,
): boolean {
  if (!summary) return false;
  if (!detail) return true;
  const summaryRevision = threadSnapshotRevision(summary);
  const detailRevision = contentRevision;
  if (summaryRevision > detailRevision) return true;
  const summarySettingsRevision = threadSettingsRevision(summary);
  const detailSettingsRevision = threadSettingsRevision(detail);
  if (summarySettingsRevision > detailSettingsRevision) return true;
  if (summaryRevision < detailRevision || summarySettingsRevision < detailSettingsRevision) return false;
  return threadRuntimeStateKey(summary) !== threadRuntimeStateKey(detail);
}

type CacheEntry = {
  view: ThreadDetailView;
  usedAt: number;
  retainedBytes: number;
  runtime?: RuntimeThreadRecord;
};

export type ThreadCache = {
  readonly selectedId: string | null;
  readonly summaries: ReadonlyMap<string, FlowerThreadSnapshot>;
  readonly views: ReadonlyMap<string, ThreadView>;
  select(id: string | null): ThreadCache;
  retainDetails(ids: readonly string[]): ThreadCache;
  invalidateRuntimeVersions(): ThreadCache;
  replaceSummary(summary: FlowerThreadSummary): ThreadCache;
  replaceSummaries(summaries: readonly FlowerThreadSummary[]): ThreadCache;
  resetRootSummaries(summaries: readonly FlowerThreadSummary[]): ThreadCache;
  beginRuntimeRead(id: string): () => void;
  runtimeItemIDs(threadID: string): readonly string[];
  readingItemIDs(threadID: string): readonly string[];
  runtimeItem(threadID: string, itemID: string): FlowerRuntimeCurrentItem | undefined;
  runtimePreviewItem(threadID: string, itemID: string): FlowerRuntimeCurrentItem | undefined;
  bodyOffset(threadID: string, itemID: string): number | undefined;
  appendBody(threadID: string, chunk: import('./contracts/flowerSurfaceContracts').FlowerHistoryBodyChunk): import('./runtimeThreadRecord').HistoryBodyAppendResult;
  hydrateItem(threadID: string, expected: FlowerRuntimeCurrentItem, loaded: FlowerRuntimeCurrentItem): boolean;
  receiveView(
    view: ThreadView,
    options?: Readonly<{ preserveSummary?: boolean; current?: FlowerRuntimeCurrentView; installedBaseline?: boolean }>,
  ): ThreadViewReceiveResult;
  receiveCurrent(view: ThreadDetailView, options?: Readonly<{ preserveSummary?: boolean; current?: FlowerRuntimeCurrentView; installedBaseline?: boolean }>): ThreadViewReceiveResult;
  receiveUpdate(update: FlowerRuntimeUpdate, options?: Readonly<{ installedInterest?: boolean }>): Readonly<{ cache: ThreadCache; observation?: FlowerRuntimeCurrentView; accepted: boolean }>;
  updateDetailAdjuncts(id: string, update: (thread: ThreadDetail) => ThreadDetail): ThreadCache;
  updateSummaryAdjuncts(id: string, update: (thread: ThreadDetail) => ThreadDetail): ThreadCache;
  evict(id: string): ThreadCache;
  applyReadStatus(id: string, status: FlowerThreadReadStatus): ThreadCache;
};

const MAX_VIEWS = 12;
const MAX_DETAIL_BYTES = 32 << 20;

// Account for retained JS strings and object slots without allocating another
// serialized transcript. This runs at baseline/navigation boundaries, never
// once per streaming token. Shared object references are counted once.
function retainedBytes(...roots: unknown[]): number {
  const seen = new Set<object>();
  const pending = [...roots];
  let bytes = 0;
  while (pending.length) {
    // Size accounting must not create subscriptions or walk reactive proxy
    // descriptors for every previously visited row on each history handoff.
    const candidate = pending.pop();
    const value = candidate && typeof candidate === 'object'
      ? (candidate as { [$RAW]?: unknown })[$RAW] ?? candidate : candidate;
    if (typeof value === 'string') bytes += value.length * 2;
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value); bytes += 32;
      for (const [key, child] of Object.entries(value)) {
        bytes += key.length * 2 + 8;
        if (typeof child !== 'function') pending.push(child);
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') bytes += 8;
  }
  return bytes;
}

function pruneDetails(views: Map<string, CacheEntry>, selected: string | null, retained: ReadonlySet<string>, reads: BaselineReads) {
  let bytes = [...views.values()].reduce((sum, entry) => sum + entry.retainedBytes, 0);
  const candidates = [...views].filter(([id]) => id !== selected && !retained.has(id) && !reads.has(id))
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [id, entry] of candidates) {
    if (views.size <= MAX_VIEWS && bytes <= MAX_DETAIL_BYTES) break;
    views.delete(id); bytes -= entry.retainedBytes;
  }
}
type BaselineReads = Map<string, { readers: number; updates: FlowerRuntimeUpdate[] }>;

function summaryOnly(thread: FlowerThreadSnapshot): FlowerThreadSnapshot {
  const summary = { ...thread, messages: [] };
  delete summary.history_window;
  delete summary.current_execution;
  delete summary.turns;
  delete summary.queued_turns;
  delete summary.restored_inputs;
  delete summary.model_context;
  delete summary.context_usage;
  delete summary.context_compactions;
  delete summary.timeline_decorations;
  delete summary.subagents;
  delete summary.approval_actions;
  delete summary.input_request;
  delete summary.error;
  return summary;
}

function receiveSummary(
  current: FlowerThreadSnapshot | undefined,
  incoming: FlowerThreadSummary,
): FlowerThreadSnapshot {
  const candidate: FlowerThreadSnapshot = { ...incoming, read_status: mergeThreadReadStatus(current?.read_status, incoming.read_status, Math.max(incoming.updated_at_ms, incoming.read_status?.snapshot.activity_revision ?? 0)) };
  const title = mergeThreadTitle(current, candidate);
  if (!current) return summaryOnly({ ...candidate, ...title });
  const activityIsStale = Math.max(incoming.updated_at_ms, incoming.read_status?.snapshot.activity_revision ?? 0) < threadSnapshotRevision(current);
  return retainEqualValue(current, summaryOnly({ ...(activityIsStale
    ? mergeNewerSummaryMetadata(current, candidate)
    : mergeNewerSummaryMetadata(candidate, current)), ...title }));
}

// Title overlays are derived from immutable cache entries. Unrelated summary
// updates must not manufacture new detail objects for every cached thread.
const titledViews = new WeakMap<ThreadDetailView, ThreadView>();
function titledView(view: ThreadDetailView, summary: FlowerThreadSnapshot): ThreadView {
  const previous = titledViews.get(view);
  if (previous && previous.thread.title === summary.title
    && previous.thread.title_status === summary.title_status
    && previous.thread.title_generation === summary.title_generation
    && previous.thread.read_status === summary.read_status) return previous;
  const result = { ...view, thread: { ...view.thread, ...threadTitleSnapshot(summary), read_status: summary.read_status } };
  titledViews.set(view, result);
  return result;
}

function createCache(
  selectedId: string | null,
  summaries: Map<string, FlowerThreadSnapshot>,
  views: Map<string, CacheEntry>,
  clock: number,
  reads: BaselineReads = new Map(),
  retainedIDs: ReadonlySet<string> = new Set(),
): ThreadCache {
  const receive = (view: ThreadDetailView, title: ThreadTitleSnapshot | undefined, options?: Readonly<{ preserveSummary?: boolean; current?: FlowerRuntimeCurrentView; installedBaseline?: boolean }>): ThreadViewReceiveResult => {
    const id = view.thread.thread_id.trim();
    if (!id) return {
      cache,
      state: 'stale',
      runtimeState: 'stale',
      activityState: 'stale',
      settingsState: 'stale',
    };
    const stored = views.get(id)?.view;
    const enriched = stored ? retainThreadFileActivityTargets(view.thread, stored.thread) : undefined;
    const navigationChanged = !!stored && enriched !== stored.thread;
    const current = stored && navigationChanged ? { ...stored, thread: enriched! } : stored;
    const classified = classifyThreadView(current, view);
    if (classified === 'stale' && options?.current?.window && reads.has(id) && !options.installedBaseline) throw new FlowerLiveSyncError('History read was overtaken by a newer baseline.');
    const runtimeState = classified === 'unchanged' && options?.current?.window && reads.has(id) ? 'accepted' : classified;
    const activityState = classifyThreadActivity(current, view);
    const settingsState = classifyThreadSettings(current, view);
    const currentSummary = summaries.get(id);
    const acceptedTitle = title ? mergeThreadTitle(currentSummary, title) : threadTitleSnapshot(currentSummary ?? { title: '', title_status: 'unset', title_generation: 0 });
    const titleState = !currentSummary || acceptedTitle.title_generation !== currentSummary.title_generation
      || acceptedTitle.title_status !== currentSummary.title_status || acceptedTitle.title !== currentSummary.title ? 'accepted' : 'unchanged';
    const readChanged = view.thread.read_status.read_state.last_seen_activity_revision > (currentSummary?.read_status.read_state.last_seen_activity_revision ?? 0);
    const incomingContentRevision = view.contentRevision ?? threadSnapshotRevision(view.thread);
    // Continuous native updates already cover an older HTTP actor snapshot.
    // Its activity watermark can confirm retained content without replacing the
    // newer lifecycle. Reconnect resets version to zero before any such claim.
    const nativeCoversRead = Boolean(current?.version && views.get(id)?.runtime && options?.current
      && options.current.view_version === view.version && view.version <= current.version);
    const contentRevision = current && runtimeState === 'stale' && !nativeCoversRead ? current.contentRevision
      : runtimeState === 'accepted' ? incomingContentRevision
        : Math.max(current?.contentRevision ?? 0, incomingContentRevision);
    const runtimeView = current && runtimeState !== 'accepted' ? current : view;
    // A same-version authoritative read can confirm a lifecycle already applied
    // by native updates while a concurrently delivered summary still differs.
    const summaryChanged = !options?.preserveSummary && (runtimeState !== 'stale' || nativeCoversRead) && currentSummary
      && incomingContentRevision >= threadSnapshotRevision(currentSummary)
      && threadSettingsRevision(view.thread) >= threadSettingsRevision(currentSummary)
      && threadRuntimeStateKey(runtimeView.thread as FlowerThreadSnapshot) !== threadRuntimeStateKey(currentSummary);
    const state = summaryChanged || navigationChanged || readChanged || contentRevision !== current?.contentRevision ? 'accepted' : aggregateAcceptance(runtimeState, activityState, settingsState, titleState);
    if (state !== 'accepted') return {
      cache,
      state,
      runtimeState,
      activityState,
      settingsState,
    };
    const activityThread = current && activityState !== 'accepted' ? current.thread : view.thread;
    const settingsThread = current && settingsState !== 'accepted' ? current.thread : view.thread;
    const mergedView: ThreadDetailView = {
      version: runtimeView.version,
      contentRevision,
      thread: retainThreadPresentation(current?.thread, { ...mergeThreadSettings(
        mergeThreadActivity(mergeThreadActivity(runtimeView.thread, activityThread), view.thread),
        settingsThread,
      ), read_only_reason: settingsState === 'accepted' ? view.thread.read_only_reason : runtimeView.thread.read_only_reason }),
    };
    const runtime = runtimeState === 'accepted' && options?.current
      ? createRuntimeThreadRecord(options.current, { ...mergedView.thread, ...acceptedTitle }, views.get(id)?.runtime) : views.get(id)?.runtime;
    const initializedView = runtimeState === 'accepted' && options?.current && runtime
      ? { ...mergedView, get version() { return runtime.version; }, thread: runtime.initializeThread() } : runtime ? { ...mergedView, get version() { return runtime.version; }, thread: runtime.syncAdjuncts(mergedView.thread as FlowerThreadSnapshot) } : mergedView;
    const next = new Map(views);
    // Live traffic is not a user visit. Background updates cannot displace
    // the displayed thread or outrank previously visited conversations.
    next.set(id, { view: initializedView, runtime, retainedBytes: retainedBytes(initializedView.thread, runtime?.readingState().records ?? options?.current), usedAt: views.get(id)?.usedAt ?? (id === selectedId || retainedIDs.has(id) ? clock + 1 : 0) });
    pruneDetails(next, selectedId, retainedIDs, reads);
    const summary = new Map(summaries);
    const metadata = options?.preserveSummary && currentSummary
      ? mergeNewerSummaryMetadata(currentSummary, mergedView.thread)
      : mergeNewerSummaryMetadata(mergedView.thread, currentSummary ?? mergedView.thread);
    summary.set(id, retainEqualValue(currentSummary, summaryOnly({ ...metadata, ...acceptedTitle })));
    let acceptedCache = createCache(selectedId, summary, next, clock + 1, reads, retainedIDs);
    const observations: FlowerRuntimeCurrentView[] = [];
    if (runtimeState === 'accepted' && options?.current) {
      const pending = reads.get(id)?.updates.splice(0) ?? [];
      const owner = reads.get(id);
      reads.delete(id);
      for (const update of pending) {
        const received = acceptedCache.receiveUpdate(update);
        acceptedCache = received.cache;
        if (received.observation) observations.push(received.observation);
      }
      if (owner) reads.set(id, owner);
    }
    return {
      cache: acceptedCache,
      observations,
      state,
      runtimeState,
      activityState,
      settingsState,
    };
  };
  const touch = (id: string): Map<string, CacheEntry> => {
    const next = new Map(views);
    const entry = next.get(id);
    if (entry) next.set(id, { ...entry, usedAt: clock + 1 });
    return next;
  };
  const cache: ThreadCache = {
    selectedId,
    summaries,
    readingItemIDs(threadID) { return views.get(threadID)?.runtime?.readingItemIDs() ?? []; },
    runtimeItemIDs(threadID) { return views.get(threadID)?.runtime?.itemIDs() ?? []; },
    runtimeItem(threadID, itemID) { return views.get(threadID)?.runtime?.item(itemID); },
    runtimePreviewItem(threadID, itemID) { return views.get(threadID)?.runtime?.previewItem(itemID); },
    bodyOffset(threadID, itemID) { return views.get(threadID)?.runtime?.bodyOffset(itemID); },
    appendBody(threadID, chunk) { return views.get(threadID)?.runtime?.appendBody(chunk) ?? 'superseded'; },
    hydrateItem(threadID, expected, loaded) { return views.get(threadID)?.runtime?.hydrate(expected, loaded) ?? false; },
    beginRuntimeRead(id) {
      const entry = reads.get(id);
      const owned = entry ?? { readers: 0, updates: [] };
      owned.readers++;
      reads.set(id, owned);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (reads.get(id) === owned && --owned.readers <= 0) reads.delete(id);
      };
    },
    views: new Map([...views.entries()].flatMap(([id, entry]) => {
      const summary = summaries.get(id);
      return summary ? [[id, entry.runtime ? { ...entry.view, get version() { return entry.view.version; }, thread: entry.runtime.syncMetadata({ ...entry.view.thread, ...threadTitleSnapshot(summary), read_status: summary.read_status }) } : titledView(entry.view, summary)] as const] : [];
    })),
    select(id) {
      const nextID = id == null || id.trim() === '' ? null : id.trim();
      const next = touch(nextID ?? '');
      const previous = selectedId ? next.get(selectedId) : undefined;
      if (previous) next.set(selectedId!, { ...previous, retainedBytes: retainedBytes(previous.view.thread,
        previous.runtime?.readingState().records) });
      pruneDetails(next, nextID, retainedIDs, reads);
      return createCache(nextID, summaries, next, clock + 1, reads, retainedIDs);
    },
    retainDetails(ids) {
      const nextIDs = new Set(ids.map(id => id.trim()).filter(Boolean));
      if (nextIDs.size >= MAX_VIEWS) throw new Error('Too many displayed thread details.');
      if (nextIDs.size === retainedIDs.size && [...nextIDs].every(id => retainedIDs.has(id))) return this;
      const nextViews = new Map(views);
      for (const id of retainedIDs) {
        const entry = nextViews.get(id);
        if (entry && !nextIDs.has(id)) nextViews.set(id, { ...entry, retainedBytes: retainedBytes(entry.view.thread,
          entry.runtime?.readingState().records) });
      }
      for (const id of nextIDs) {
        const entry = nextViews.get(id);
        if (entry && !retainedIDs.has(id)) nextViews.set(id, { ...entry, usedAt: clock + 1 });
      }
      pruneDetails(nextViews, selectedId, nextIDs, reads);
      return createCache(selectedId, summaries, nextViews, clock + 1, reads, nextIDs);
    },
    replaceSummary(summary) {
      const id = summary.thread_id.trim();
      if (!id) return this;
      const next = new Map(summaries);
      // Summary state never carries or inherits detail content.
      next.set(id, receiveSummary(summaries.get(id), summary));
      return createCache(selectedId, next, views, clock + 1, reads, retainedIDs);
    },
    replaceSummaries(nextSummaries) {
      const next = new Map<string, FlowerThreadSnapshot>();
      for (const summary of nextSummaries) {
        const id = summary.thread_id.trim();
        if (id) next.set(id, receiveSummary(summaries.get(id), summary));
      }
      // Root inventory owns root membership, not explicitly displayed children.
      for (const id of retainedIDs) {
        const retained = summaries.get(id);
        if (retained && !next.has(id)) next.set(id, retained);
      }
      const nextViews = new Map([...views].filter(([id]) => next.has(id)));
      return createCache(selectedId, next, nextViews, clock + 1, reads, retainedIDs);
    },
    resetRootSummaries(nextSummaries) {
      const replaced = this.replaceSummaries(nextSummaries);
      return replaced.selectedId && !replaced.summaries.has(replaced.selectedId) && !retainedIDs.has(replaced.selectedId)
        ? replaced.select(null) : replaced;
    },
    receiveView(view, options) {
      return receive({ ...view, thread: detailOnly(view.thread) }, threadTitleSnapshot(view.thread), options);
    },
    receiveCurrent(view, options) {
      return receive({ ...view, contentRevision: view.contentRevision ?? views.get(view.thread.thread_id)?.view.contentRevision ?? 0, thread: detailOnly(view.thread) }, undefined, options);
    },
    receiveUpdate(update, options) {
      const entry = views.get(update.thread_id);
      const pending = reads.get(update.thread_id);
      if (pending && entry?.view.thread.history_window && !options?.installedInterest) {
        if (pending.updates.length >= 64) throw new FlowerLiveSyncError('Flower baseline update queue overflow.');
        pending.updates.push(update);
        return { cache, accepted: false };
      }
      // Unvisited threads retain only workspace summaries. Reconnection also
      // fences old actor versions until the normal detail read establishes them.
      if (!entry?.runtime || entry.view.version === 0) {
        const pending = reads.get(update.thread_id);
        if (pending) {
          if (pending.updates.length >= 64) throw new FlowerLiveSyncError('Flower baseline update queue overflow.');
          pending.updates.push(update);
        }
        return { cache, accepted: false };
      }
      const summary = summaries.get(update.thread_id);
      if (!summary) return { cache, accepted: false };
      const base = entry.runtime.initializeThread();
      const applied = entry.runtime.apply(base, update);
      if (!applied) return { cache, accepted: false };
      // Indexed records publish their own affected fields. Workspace selection,
      // summaries and cache membership did not change.
      return { cache, observation: applied.observation, accepted: true };
    },
    updateDetailAdjuncts(id, update) {
      const threadID = id.trim();
      const current = views.get(threadID);
      if (!threadID || !current) return this;
      const next = new Map(views);
      const adjunct = retainThreadPresentation(current.view.thread, mergeThreadActivity(adjunctOnly(update(detailOnly(current.view.thread))), current.view.thread));
      next.set(threadID, {
        ...current,
        view: { ...current.view, get version() { return current.view.version; }, thread: current.runtime ? current.runtime.syncAdjuncts(adjunct as FlowerThreadSnapshot) : adjunct },
      });
      return createCache(selectedId, summaries, next, clock + 1, reads, retainedIDs);
    },
    updateSummaryAdjuncts(id, update) {
      const threadID = id.trim();
      if (!threadID) return this;
      const nextSummaries = new Map(summaries);
      const currentSummary = nextSummaries.get(threadID);
      if (currentSummary) nextSummaries.set(threadID, summaryOnly({ ...mergeThreadActivity(adjunctOnly(update(detailOnly(currentSummary))), currentSummary), ...threadTitleSnapshot(currentSummary) }));
      if (!currentSummary) return this;
      // Adjunct updates never author titles or replace runtime detail.
      return createCache(selectedId, nextSummaries, views, clock + 1, reads, retainedIDs);
    },
    invalidateRuntimeVersions() {
      reads.clear();
      // Floret versions order notifications within one Runtime process only.
      const next = new Map([...views].map(([id, entry]) => [id, {
        ...entry, view: { ...entry.view, version: 0 },
      }]));
      return createCache(selectedId, summaries, next, clock, reads, retainedIDs);
    },
    applyReadStatus(id, status) {
      const current = summaries.get(id);
      if (!current) return this;
      const next = new Map(summaries);
      next.set(id, receiveSummary(current, { ...current, read_status: status }));
      return createCache(selectedId, next, views, clock + 1, reads, retainedIDs);
    },
    evict(id) {
      reads.delete(id);
      const nextSummaries = new Map(summaries);
      const nextViews = new Map(views);
      nextSummaries.delete(id);
      nextViews.delete(id);
      return createCache(selectedId === id ? null : selectedId, nextSummaries, nextViews, clock + 1, reads, retainedIDs);
    },
  };
  return cache;
}

export function createThreadCache(): ThreadCache {
  return createCache(null, new Map(), new Map(), 0);
}
