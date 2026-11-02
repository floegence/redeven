import { batch, createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import { isSplitWorkspaceLayout, splitWorkspaceItems, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import type { RedevenV1Rpc } from '../protocol/redeven_v1/contract';
import type { TerminalView, TerminalViewSnapshot } from '../protocol/redeven_v1/sdk/terminalViews';

type WorkspaceView = Omit<TerminalView, 'layout'> & { layout: SplitWorkspaceLayout };
type WorkspaceSnapshot = { revision: number; views: WorkspaceView[] };
type ViewDraft = Omit<WorkspaceView, 'revision' | 'createdAtMs' | 'updatedAtMs'>;

/** One environment-scoped projection; per-view revisions prevent lost concurrent edits. */
export function createTerminalViewCatalog(options: {
  scope: Accessor<string>;
  connected: Accessor<boolean>;
  enabled?: Accessor<boolean>;
  rpc: Pick<RedevenV1Rpc['terminal'], 'listViews' | 'putView' | 'deleteView' | 'onViewsChanged'>;
}) {
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>({ revision: 0, views: [] });
  const [drafts, setDrafts] = createSignal<Map<string, ViewDraft | null>>(new Map());
  const [ready, setReady] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<'load' | 'save' | null>(null);
  const baseRevisions = new Map<string, number>();
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const views = createMemo(() => {
    const pending = drafts();
    const result = snapshot().views.filter(view => pending.get(view.id) !== null).map(view => ({ ...view, ...(pending.get(view.id) ?? {}) }));
    for (const [id, draft] of pending) if (draft && !result.some(view => view.id === id)) result.push({ ...draft, revision: 0, createdAtMs: 0, updatedAtMs: 0 });
    return result;
  });
  const accept = (next: TerminalViewSnapshot) => {
    const views = next.views.map(view => {
      // Layout validation belongs at the UI adapter, using the published owner.
      if (!isSplitWorkspaceLayout(view.layout) || splitWorkspaceItems(view.layout).length > 32) throw new Error('Invalid terminal view layout');
      return { ...view, layout: view.layout };
    });
    if (next.revision >= snapshot().revision) setSnapshot({ ...next, views });
  };
  const reload = async () => {
    if (saving() || !options.connected() || options.enabled?.() === false) return;
    const epoch = generation;
    setReady(false);
    try {
      const next = await options.rpc.listViews();
      if (disposed || epoch !== generation) return;
      batch(() => { accept(next); baseRevisions.clear(); setDrafts(new Map()); setError(null); setReady(true); });
    } catch { if (!disposed && epoch === generation) setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); }
  };
  const flush = async () => {
    if (saving() || error() || !ready() || !options.connected() || drafts().size === 0) return;
    const entry = drafts().entries().next().value!;
    const [id, draft] = entry;
    const base = snapshot().views.find(view => view.id === id);
    const epoch = generation;
    setSaving(true);
    try {
      const next = draft
        ? await options.rpc.putView({ ...draft, baseRevision: baseRevisions.get(id) ?? 0 })
        : base ? await options.rpc.deleteView({ id, baseRevision: baseRevisions.get(id) ?? 0 }) : snapshot();
      if (disposed || epoch !== generation) return;
      accept(next);
      if (drafts().get(id) === draft) baseRevisions.delete(id);
      else baseRevisions.set(id, next.views.find(view => view.id === id)?.revision ?? 0);
      setDrafts(current => {
        if (current.get(id) !== draft) return current;
        const remaining = new Map(current); remaining.delete(id); return remaining;
      });
    } catch { if (!disposed && epoch === generation) setError('save'); }
    finally { if (!disposed && epoch === generation) setSaving(false); }
  };
  createEffect(on(() => [options.scope(), options.enabled?.() !== false] as const, () => {
    generation++; baseRevisions.clear(); setSnapshot({ revision: 0, views: [] }); setDrafts(new Map()); setReady(false); setSaving(false); setError(null);
  }));
  createEffect(() => {
    options.scope();
    if (!options.connected() || options.enabled?.() === false) return;
    const epoch = generation;
    void options.rpc.listViews().then(next => {
      if (disposed || epoch !== generation) return;
      accept(next); setReady(true); setError(current => current === 'load' ? null : current);
    }).catch(() => { if (!disposed && epoch === generation) setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); });
    const unsubscribe = options.rpc.onViewsChanged(next => {
      if (epoch !== generation) return;
      try { accept(next); } catch { setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); }
    });
    onCleanup(unsubscribe);
  });
  createEffect(() => {
    drafts(); saving(); error(); ready(); options.connected();
    if (timer) clearTimeout(timer);
    if (!saving() && !error() && ready() && options.connected() && drafts().size) timer = setTimeout(() => { void flush(); }, 180);
  });
  onCleanup(() => { disposed = true; generation++; if (timer) clearTimeout(timer); });
  return {
    views, ready, saving, pending: () => drafts().size > 0, error, reload,
    put: (draft: ViewDraft) => {
      if (!ready() || options.enabled?.() === false) return;
      if (!baseRevisions.has(draft.id)) baseRevisions.set(draft.id, snapshot().views.find(view => view.id === draft.id)?.revision ?? 0);
      setDrafts(current => new Map(current).set(draft.id, draft));
    },
    remove: (id: string) => {
      if (!ready() || options.enabled?.() === false) return;
      if (!baseRevisions.has(id)) baseRevisions.set(id, snapshot().views.find(view => view.id === id)?.revision ?? 0);
      setDrafts(current => new Map(current).set(id, null));
    },
  };
}
export type TerminalViewCatalog = ReturnType<typeof createTerminalViewCatalog>;
