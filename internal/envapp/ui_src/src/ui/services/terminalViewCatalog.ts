import { batch, createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { splitWorkspaceItems, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { isTerminalViewLayout, viewSessionIds, vacateViewSessions } from './terminalViewLayout';
import type { RedevenV1Rpc } from '../protocol/redeven_v1/contract';
import type { TerminalView, TerminalViewSnapshot, TerminalViewsUpdateRequest } from '../protocol/redeven_v1/sdk/terminalViews';

type WorkspaceView = Omit<TerminalView, 'layout'> & { layout: SplitWorkspaceLayout };
type WorkspaceSnapshot = { revision: number; views: WorkspaceView[] };
type ViewDraft = Omit<WorkspaceView, 'revision' | 'createdAtMs' | 'updatedAtMs'>;

/** One environment-scoped projection; per-view revisions prevent lost concurrent edits. */
export function createTerminalViewCatalog(options: {
  scope: Accessor<string>;
  connected: Accessor<boolean>;
  enabled?: Accessor<boolean>;
  rpc: Pick<RedevenV1Rpc['terminal'], 'listViews' | 'updateViews' | 'onViewsChanged'>;
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
  const project = (source: WorkspaceSnapshot, pending: Map<string, ViewDraft | null>) => {
    const result = source.views.filter(view => pending.get(view.id) !== null).map(view => ({ ...view, ...(pending.get(view.id) ?? {}) }));
    for (const [id, draft] of pending) if (draft && !result.some(view => view.id === id)) result.push({ ...draft, revision: 0, createdAtMs: 0, updatedAtMs: 0 });
    return result;
  };
  const views = createMemo(() => project(snapshot(), drafts()));
  const accept = (next: TerminalViewSnapshot, discardDrafts = false) => {
    const owners = new Set<string>();
    const views = next.views.map(view => {
      // Layout validation belongs at the UI adapter, using the published owner.
      if (!isTerminalViewLayout(view.layout) || splitWorkspaceItems(view.layout).length > 32) throw new Error('Invalid terminal view layout');
      for (const id of viewSessionIds(view.layout)) {
        if (owners.has(id)) throw new Error('Duplicate terminal view membership');
        owners.add(id);
      }
      return { ...view, layout: view.layout };
    });
    if (next.revision < snapshot().revision) return;
    // A conflicting remote transfer must not publish two local owners while
    // unsaved drafts are retained. Explicit reload discards those drafts.
    owners.clear();
    for (const view of project({ ...next, views }, discardDrafts ? new Map() : drafts())) {
      for (const id of viewSessionIds(view.layout)) {
        if (owners.has(id)) throw new Error('Conflicting terminal view membership');
        owners.add(id);
      }
    }
    setSnapshot({ ...next, views });
  };
  const reload = async () => {
    if (saving() || !options.connected() || options.enabled?.() === false) return;
    const epoch = generation;
    setReady(false);
    try {
      const next = await options.rpc.listViews();
      if (disposed || epoch !== generation) return;
      batch(() => { accept(next, true); baseRevisions.clear(); setDrafts(new Map()); setError(null); setReady(true); });
    } catch { if (!disposed && epoch === generation) setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); }
  };
  const flush = async () => {
    if (saving() || error() || !ready() || !options.connected() || drafts().size === 0) return;
    const pending = new Map(drafts());
    const changes = [...pending].flatMap<TerminalViewsUpdateRequest['changes'][number]>(([id, draft]) => draft
      ? [{ ...draft, baseRevision: baseRevisions.get(id) ?? 0 }]
      : snapshot().views.some(view => view.id === id) ? [{ id, baseRevision: baseRevisions.get(id) ?? 0, delete: true as const }] : []);
    const epoch = generation;
    setSaving(true);
    try {
      const next = changes.length ? await options.rpc.updateViews({ changes }) : snapshot();
      if (disposed || epoch !== generation) return;
      batch(() => {
        accept(next);
        const remaining = new Map(drafts());
        for (const [id, draft] of pending) {
          if (remaining.get(id) === draft) { baseRevisions.delete(id); remaining.delete(id); }
          else baseRevisions.set(id, next.views.find(view => view.id === id)?.revision ?? 0);
        }
        setDrafts(remaining);
      });
    } catch { if (!disposed && epoch === generation) setError('save'); }
    finally { if (!disposed && epoch === generation) setSaving(false); }
  };
  const scope = createMemo(options.scope);
  const enabled = createMemo(() => options.enabled?.() !== false);
  let previousScope: string | undefined;
  let previousEnabled: boolean | undefined;
  createEffect(() => {
    const currentScope = scope();
    const currentEnabled = enabled();
    const connected = options.connected();
    // Reset authority before starting its request in the same lifecycle owner.
    // Independent effects can invalidate the newly issued request on hydration.
    if (currentScope !== previousScope || currentEnabled !== previousEnabled) {
      previousScope = currentScope;
      previousEnabled = currentEnabled;
      generation++; baseRevisions.clear(); setSnapshot({ revision: 0, views: [] }); setDrafts(new Map()); setReady(false); setSaving(false); setError(null);
    }
    if (!connected || !currentEnabled) return;
    const epoch = generation;
    let active = true;
    void options.rpc.listViews().then(next => {
      if (!active || disposed || epoch !== generation) return;
      accept(next); setReady(true); setError(current => current === 'load' ? null : current);
    }).catch(() => { if (active && !disposed && epoch === generation) setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); });
    const unsubscribe = options.rpc.onViewsChanged(next => {
      if (!active || disposed || epoch !== generation) return;
      try { accept(next); } catch { setError(current => current === 'save' || drafts().size > 0 ? 'save' : 'load'); }
    });
    onCleanup(() => { active = false; unsubscribe(); });
  });
  createEffect(() => {
    drafts(); saving(); error(); ready(); options.connected();
    if (timer) clearTimeout(timer);
    if (!saving() && !error() && ready() && options.connected() && drafts().size) timer = setTimeout(() => { void flush(); }, 180);
  });
  onCleanup(() => { disposed = true; generation++; if (timer) clearTimeout(timer); });
  return {
    views, ready, saving, pending: () => drafts().size > 0, error, reload,
    ownerOf: (sessionId: string) => views().find(view => viewSessionIds(view.layout).includes(sessionId)),
    put: (draft: ViewDraft) => {
      if (!ready() || options.enabled?.() === false) return;
      const next = new Map(drafts());
      const stage = (id: string, value: ViewDraft | null) => {
        if (!baseRevisions.has(id)) baseRevisions.set(id, snapshot().views.find(view => view.id === id)?.revision ?? 0);
        next.set(id, value);
      };
      const members = new Set(viewSessionIds(draft.layout));
      for (const other of views()) {
        if (other.id === draft.id) continue;
        const ids = viewSessionIds(other.layout);
        if (!ids.some(id => members.has(id))) continue;
        const layout = vacateViewSessions(other.layout, members);
        stage(other.id, { id: other.id, name: other.name, layout });
      }
      stage(draft.id, draft);
      setDrafts(next);
    },
    remove: (id: string) => {
      if (!ready() || options.enabled?.() === false) return;
      if (!baseRevisions.has(id)) baseRevisions.set(id, snapshot().views.find(view => view.id === id)?.revision ?? 0);
      setDrafts(current => new Map(current).set(id, null));
    },
  };
}
export type TerminalViewCatalog = ReturnType<typeof createTerminalViewCatalog>;
