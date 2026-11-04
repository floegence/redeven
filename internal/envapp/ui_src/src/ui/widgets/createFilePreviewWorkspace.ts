import { batch, createRoot, createSignal, getOwner, onCleanup, runWithOwner } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createFilePreviewController, type FilePreviewController } from './createFilePreviewController';

export interface FilePreviewEntry {
  id: string;
  item: FileItem;
  controller: FilePreviewController;
}

/** One window, independent document owners. Switching never reloads a document. */
export function createFilePreviewWorkspace(params: Parameters<typeof createFilePreviewController>[0]) {
  const owner = getOwner();
  const [entries, setEntries] = createSignal<FilePreviewEntry[]>([]);
  const [activeId, setActiveId] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [pendingClose, setPendingClose] = createSignal<'all' | FilePreviewEntry | null>(null);
  const disposers = new Map<FilePreviewEntry, () => void>();
  const presentations = new Map<FilePreviewEntry, number>();
  const empty = createFilePreviewController(params);
  const active = () => entries().find(entry => entry.id === activeId());
  const activeController = () => active()?.controller ?? empty;
  const pendingEntries = () => pendingClose() === 'all' ? entries() : pendingClose() ? [pendingClose() as FilePreviewEntry] : [];
  const pendingDirty = () => pendingEntries().filter(entry => entry.controller.dirty());
  const pendingSaving = () => pendingEntries().some(entry => entry.controller.saving());

  const disposeEntry = (entry: FilePreviewEntry) => {
    disposers.get(entry)?.();
    disposers.delete(entry);
    presentations.delete(entry);
  };
  const retire = (entry: FilePreviewEntry) => {
    setEntries(current => current.filter(candidate => candidate !== entry));
    disposeEntry(entry);
  };
  const retainEntry = (entry: FilePreviewEntry) => {
    let released = false;
    presentations.set(entry, (presentations.get(entry) ?? 0) + 1);
    const release = entry.controller.retainContent();
    return () => {
      if (released) return;
      released = true;
      release();
      const count = (presentations.get(entry) ?? 1) - 1;
      presentations.set(entry, count);
      if (!entry.controller.open() && count === 0) retire(entry);
    };
  };
  const select = (id: string) => {
    if (pendingClose() || !open() || !entries().some(entry => entry.id === id)) return;
    setActiveId(id);
  };
  const closeAccepted = (targets: FilePreviewEntry[]) => {
    const current = entries();
    const remaining = current.filter(entry => !targets.includes(entry));
    const previousIndex = current.findIndex(entry => entry.id === activeId());
    batch(() => {
      setPendingClose(null);
      if (!remaining.length) setOpen(false);
      else if (!remaining.some(entry => entry.id === activeId())) setActiveId(remaining[Math.min(Math.max(previousIndex, 0), remaining.length - 1)].id);
      for (const entry of targets) {
        entry.controller.closePreview();
        if (entry.controller.closeConfirmOpen()) void entry.controller.confirmDiscardAndContinue();
        if (remaining.length || !presentations.get(entry)) retire(entry);
      }
    });
  };
  const reorder = (ids: string[]) => {
    if (!open() || pendingClose()) return;
    const current = entries();
    if (ids.length !== current.length || new Set(ids).size !== ids.length) return;
    const byId = new Map(current.map(entry => [entry.id, entry]));
    if (ids.some(id => !byId.has(id))) return;
    setEntries(ids.map(id => byId.get(id)!));
  };
  const requestClose = (id?: string) => {
    if (!open()) return;
    const targets = id ? entries().filter(entry => entry.id === id) : entries();
    if (!targets.length) return;
    if (targets.some(entry => entry.controller.dirty() || entry.controller.saving())) {
      setPendingClose(id ? targets[0] : 'all');
      return;
    }
    closeAccepted(targets);
  };
  const confirmClose = () => {
    if (!pendingClose() || pendingSaving()) return;
    closeAccepted(pendingEntries());
  };
  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;
    // A new explicit open cancels a pending dismissal; it never discards drafts.
    setPendingClose(null);
    const existing = entries().find(entry => entry.id === item.path && entry.controller.open());
    if (existing) { batch(() => { setActiveId(existing.id); setOpen(true); }); return; }
    for (const retired of entries().filter(entry => !entry.controller.open())) retire(retired);
    let entry!: FilePreviewEntry;
    runWithOwner(owner, () => createRoot(dispose => {
      entry = { id: item.path, item, controller: createFilePreviewController(params) };
      disposers.set(entry, dispose);
    }));
    const loading = entry.controller.openPreview(item);
    batch(() => { setEntries(current => [...current, entry]); setActiveId(entry.id); setOpen(true); });
    await loading;
  };
  onCleanup(() => { for (const dispose of disposers.values()) dispose(); disposers.clear(); presentations.clear(); });
  return { entries, activeId, active, activeController, open, openPreview, select, reorder, requestClose, pendingClose, pendingDirty, pendingSaving, confirmClose, cancelClose: () => setPendingClose(null), retainEntry };
}
export type FilePreviewWorkspace = ReturnType<typeof createFilePreviewWorkspace>;
