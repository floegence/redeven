import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Check, Copy, FileText, Pencil, Plus, Trash, X } from '@floegence/floe-webapp-core/icons';
import { Motion } from 'solid-motionone';
import {
  bringNotesItemToFront,
  clearNotesTrashTopic,
  connectNotesEventStream,
  createNotesItem,
  createNotesTopic,
  deleteNotesItem,
  deleteNotesTopic,
  getNotesSnapshot,
  restoreNotesItem,
  updateNotesItem,
  updateNotesTopic,
} from '../services/notesApi';
import {
  FloatingContextMenu,
  FLOATING_CONTEXT_MENU_WIDTH_PX,
  estimateFloatingContextMenuHeight,
  type FloatingContextMenuItem,
} from '../widgets/FloatingContextMenu';
import {
  NOTE_COLOR_TOKENS,
  applyNotesEvent,
  centerViewportOnWorldPoint,
  computeBoardBounds,
  createDefaultNotesSnapshot,
  groupTrashItems,
  mergeBoardBounds,
  normalizeNotesSnapshot,
  noteBucketMetrics,
  promoteLocalItem,
  removeSnapshotItem,
  replaceSnapshotItem,
  replaceSnapshotTopic,
  replaceSnapshotTrashItem,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomViewportAtPoint,
  type NoteColorToken,
  type NotesEvent,
  type NotesItem,
  type NotesPoint,
  type NotesRect,
  type NotesSnapshot,
  type NotesTopic,
  type NotesTrashGroup,
  type NotesTrashItem,
  type NotesViewport,
} from './notesModel';
import { NOTE_COLOR_LABELS, NotesAnimalIcon, NotesOverlayIcon, NotesTrashCanIcon } from './notesAppearance';

const LONG_PRESS_MS = 430;
const PAN_THRESHOLD_PX = 6;
const MOBILE_BREAKPOINT_PX = 960;

type ContextMenuState = Readonly<{
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  noteID: string | null;
}>;

type BoardGesture = {
  pointerId: number;
  pointerType: string;
  noteID: string | null;
  startClientX: number;
  startClientY: number;
  startViewport: NotesViewport;
  dragged: boolean;
  contextOpened: boolean;
  longPressTimer: number | null;
};

type PinchGesture = {
  startDistance: number;
  startScale: number;
  midpointX: number;
  midpointY: number;
};

export interface NotesOverlayProps {
  open: boolean;
  onClose: () => void;
}

function formatTrashTimestamp(unixMs: number): string {
  const value = Number(unixMs);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function eventFromInteractiveTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.closest('[data-notes-interactive="true"]')) return true;
  const tag = element.tagName.toLowerCase();
  return tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'a';
}

function touchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function touchMidpoint(touches: TouchList): NotesPoint {
  if (touches.length < 2) return { x: 0, y: 0 };
  const a = touches[0];
  const b = touches[1];
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function clampMenuPosition(clientX: number, clientY: number, itemCount: number): NotesPoint {
  const height = estimateFloatingContextMenuHeight(itemCount);
  return {
    x: Math.max(12, Math.min(clientX, window.innerWidth - FLOATING_CONTEXT_MENU_WIDTH_PX - 16)),
    y: Math.max(12, Math.min(clientY, window.innerHeight - height - 16)),
  };
}

function notePreviewText(item: NotesItem): string {
  const preview = String(item.preview_text ?? '').trim();
  if (preview) return preview;
  return 'Empty note';
}

function noteTrashProjection(item: NotesItem, topic: NotesTopic | undefined): NotesTrashItem {
  return {
    ...item,
    topic_name: topic?.name ?? 'Untitled topic',
    topic_icon_key: topic?.icon_key ?? 'fox',
    topic_icon_accent: topic?.icon_accent ?? 'ember',
    topic_sort_order: topic?.sort_order ?? 0,
    deleted_at_unix_ms: Date.now(),
  };
}

export function NotesOverlay(props: NotesOverlayProps) {
  const notify = useNotification();
  const [snapshot, setSnapshot] = createSignal<NotesSnapshot>(createDefaultNotesSnapshot());
  const [loading, setLoading] = createSignal(false);
  const [streaming, setStreaming] = createSignal<'idle' | 'live' | 'reconnecting'>('idle');
  const [activeTopicID, setActiveTopicID] = createSignal('');
  const [viewport, setViewport] = createSignal<NotesViewport>({ x: 240, y: 120, scale: 1 });
  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 });
  const [isMobile, setIsMobile] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(false);
  const [trashOpen, setTrashOpen] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  const [copiedNoteID, setCopiedNoteID] = createSignal<string | null>(null);
  const [editingNoteID, setEditingNoteID] = createSignal<string | null>(null);
  const [editorBody, setEditorBody] = createSignal('');
  const [editorColor, setEditorColor] = createSignal<NoteColorToken>('sage');
  const [creatingTopic, setCreatingTopic] = createSignal(false);
  const [newTopicName, setNewTopicName] = createSignal('');
  const [renamingTopicID, setRenamingTopicID] = createSignal<string | null>(null);
  const [renamingTopicName, setRenamingTopicName] = createSignal('');

  let viewportRef: HTMLDivElement | undefined;
  let trashPanelRef: HTMLDivElement | undefined;
  let contextMenuRef: HTMLDivElement | undefined;
  let editorTextareaRef: HTMLTextAreaElement | undefined;
  let createTopicInputRef: HTMLInputElement | undefined;
  let renameTopicInputRef: HTMLInputElement | undefined;
  let copiedTimer: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let gesture: BoardGesture | null = null;
  let pinchGesture: PinchGesture | null = null;

  const topics = createMemo(() => snapshot().topics);
  const items = createMemo(() => snapshot().items);
  const trashItems = createMemo(() => snapshot().trash_items);

  const activeTopic = createMemo(() => topics().find((topic) => topic.topic_id === activeTopicID()) ?? topics()[0] ?? null);

  const activeItems = createMemo(() => {
    const topic = activeTopic();
    if (!topic) return [] as NotesItem[];
    return items().filter((item) => item.topic_id === topic.topic_id);
  });

  const trashGroups = createMemo<NotesTrashGroup[]>(() => groupTrashItems(trashItems()));

  const liveItemCountByTopic = createMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items()) {
      counts.set(item.topic_id, (counts.get(item.topic_id) ?? 0) + 1);
    }
    return counts;
  });

  const trashItemCountByTopic = createMemo(() => {
    const counts = new Map<string, number>();
    for (const item of trashItems()) {
      counts.set(item.topic_id, (counts.get(item.topic_id) ?? 0) + 1);
    }
    return counts;
  });

  const boardBounds = createMemo<NotesRect>(() => computeBoardBounds(activeItems()));
  const minimapBounds = createMemo<NotesRect>(() => {
    const visible = visibleWorldRect(viewport(), viewportSize().width || 1, viewportSize().height || 1);
    return mergeBoardBounds(boardBounds(), visible);
  });

  const editingNote = createMemo(() => {
    const noteID = editingNoteID();
    if (!noteID) return null;
    return items().find((item) => item.note_id === noteID) ?? null;
  });

  function clearCopiedState(): void {
    if (copiedTimer != null) {
      window.clearTimeout(copiedTimer);
      copiedTimer = null;
    }
    setCopiedNoteID(null);
  }

  function scheduleCopiedState(noteID: string): void {
    clearCopiedState();
    setCopiedNoteID(noteID);
    copiedTimer = window.setTimeout(() => {
      copiedTimer = null;
      setCopiedNoteID((current) => (current === noteID ? null : current));
    }, 1500);
  }

  function closeTransientWindows(options?: { keepTrash?: boolean }): void {
    setContextMenu(null);
    if (!options?.keepTrash) setTrashOpen(false);
  }

  function syncLayoutMode(): void {
    const mobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    setIsMobile(mobile);
    setRailOpen((current) => (mobile ? current : true));
  }

  function applySnapshot(nextSnapshot: NotesSnapshot, options?: { preserveActiveTopic?: boolean }): void {
    const normalized = normalizeNotesSnapshot(nextSnapshot);
    setSnapshot(normalized);
    const currentTopicID = options?.preserveActiveTopic ? activeTopicID() : '';
    const nextTopicID = currentTopicID && normalized.topics.some((topic) => topic.topic_id === currentTopicID)
      ? currentTopicID
      : normalized.topics[0]?.topic_id ?? '';
    setActiveTopicID(nextTopicID);
  }

  async function refreshSnapshot(options?: { preserveActiveTopic?: boolean }): Promise<void> {
    const next = await getNotesSnapshot();
    applySnapshot(next, options);
  }

  function ensureViewportOrigin(): void {
    const width = viewportSize().width;
    const height = viewportSize().height;
    if (!width || !height) return;
    setViewport((current) => {
      if (current.x !== 240 || current.y !== 120 || current.scale !== 1) return current;
      return {
        x: Math.round(width * (isMobile() ? 0.18 : 0.28)),
        y: Math.round(height * 0.18),
        scale: 1,
      };
    });
  }

  function applyEvent(event: NotesEvent): void {
    setSnapshot((current) => normalizeNotesSnapshot(applyNotesEvent(current, event)));
  }

  async function startNotesStream(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        setStreaming('reconnecting');
        await connectNotesEventStream({
          afterSeq: snapshot().seq,
          signal,
          onEvent: (event) => {
            setStreaming('live');
            applyEvent(event);
          },
        });
        if (signal.aborted) return;
      } catch {
        if (signal.aborted) return;
      }
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 900);
        signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  async function loadNotes(signal: AbortSignal): Promise<void> {
    setLoading(true);
    try {
      const next = await getNotesSnapshot();
      if (signal.aborted) return;
      applySnapshot(next, { preserveActiveTopic: true });
      ensureViewportOrigin();
      setLoading(false);
      setStreaming('live');
      void startNotesStream(signal);
    } catch (error) {
      if (!signal.aborted) {
        setLoading(false);
        setStreaming('idle');
        notify.error('Notes unavailable', error instanceof Error ? error.message : String(error));
      }
    }
  }

  function openNoteEditor(item: NotesItem): void {
    setEditingNoteID(item.note_id);
    setEditorBody(item.body);
    setEditorColor(item.color_token);
    setContextMenu(null);
    setTrashOpen(false);
    queueMicrotask(() => editorTextareaRef?.focus());
  }

  function closeNoteEditor(): void {
    setEditingNoteID(null);
  }

  async function saveNoteEditor(): Promise<void> {
    const note = editingNote();
    if (!note) return;
    try {
      const updated = await updateNotesItem(note.note_id, {
        body: editorBody(),
        color_token: editorColor(),
      });
      setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotItem(current, updated)));
      closeNoteEditor();
    } catch (error) {
      notify.error('Save failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function createTopic(): Promise<void> {
    const name = newTopicName().trim();
    if (!name) return;
    try {
      const topic = await createNotesTopic({ name });
      setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotTopic(current, topic)));
      setActiveTopicID(topic.topic_id);
      setCreatingTopic(false);
      setNewTopicName('');
      if (isMobile()) setRailOpen(false);
    } catch (error) {
      notify.error('Topic failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function commitTopicRename(topic: NotesTopic): Promise<void> {
    const name = renamingTopicName().trim();
    setRenamingTopicID(null);
    if (!name || name === topic.name) return;
    try {
      const updated = await updateNotesTopic(topic.topic_id, { name });
      setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotTopic(current, updated)));
    } catch (error) {
      notify.error('Rename failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteTopicByID(topicID: string): Promise<void> {
    try {
      await deleteNotesTopic(topicID);
      await refreshSnapshot({ preserveActiveTopic: false });
      closeNoteEditor();
    } catch (error) {
      notify.error('Delete failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function createNoteAt(worldX: number, worldY: number, body: string, options?: { openEditor?: boolean }): Promise<void> {
    const topic = activeTopic();
    if (!topic) {
      notify.error('Topic required', 'Create a topic first.');
      return;
    }
    try {
      const item = await createNotesItem({
        topic_id: topic.topic_id,
        body,
        x: Math.round(worldX),
        y: Math.round(worldY),
      });
      setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotItem(current, item)));
      if (options?.openEditor) {
        openNoteEditor(item);
      }
    } catch (error) {
      notify.error('Note failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function createNoteFromClipboard(worldX: number, worldY: number): Promise<void> {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notify.error('Paste failed', 'Clipboard permission denied.');
      return;
    }
    if (!String(text ?? '').trim()) {
      notify.error('Clipboard empty', 'Copy some text first.');
      return;
    }
    await createNoteAt(worldX, worldY, text, { openEditor: false });
  }

  async function copyNote(note: NotesItem): Promise<void> {
    setSnapshot((current) => normalizeNotesSnapshot(promoteLocalItem(current, note.note_id)));
    void bringNotesItemToFront(note.note_id)
      .then((item) => setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotItem(current, item))))
      .catch(() => void refreshSnapshot({ preserveActiveTopic: true }));

    try {
      await navigator.clipboard.writeText(note.body);
      scheduleCopiedState(note.note_id);
    } catch {
      notify.error('Copy failed', 'Clipboard permission denied.');
    }
  }

  async function deleteNote(note: NotesItem): Promise<void> {
    const topic = topics().find((candidate) => candidate.topic_id === note.topic_id);
    setSnapshot((current) => normalizeNotesSnapshot(replaceSnapshotTrashItem(removeSnapshotItem(current, note.note_id), noteTrashProjection(note, topic))));
    if (editingNoteID() === note.note_id) closeNoteEditor();
    try {
      await deleteNotesItem(note.note_id);
    } catch (error) {
      notify.error('Delete failed', error instanceof Error ? error.message : String(error));
      await refreshSnapshot({ preserveActiveTopic: true });
    }
  }

  async function restoreTrashItem(item: NotesTrashItem): Promise<void> {
    try {
      const restored = await restoreNotesItem(item.note_id);
      setActiveTopicID(restored.topic_id);
      await refreshSnapshot({ preserveActiveTopic: true });
      if (isMobile()) setTrashOpen(false);
    } catch (error) {
      notify.error('Restore failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function clearTrashGroup(group: NotesTrashGroup): Promise<void> {
    try {
      await clearNotesTrashTopic(group.topic_id);
      await refreshSnapshot({ preserveActiveTopic: true });
    } catch (error) {
      notify.error('Clear failed', error instanceof Error ? error.message : String(error));
    }
  }

  function boardPointFromClient(clientX: number, clientY: number): NotesPoint {
    const rect = viewportRef?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(viewport(), {
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  function openContextMenuAt(clientX: number, clientY: number, noteID: string | null): void {
    const boardPoint = boardPointFromClient(clientX, clientY);
    const baseItems = activeTopic() ? 2 : 0;
    const itemCount = noteID ? baseItems + 2 : Math.max(1, baseItems);
    const clamped = clampMenuPosition(clientX, clientY, itemCount);
    setContextMenu({
      x: clamped.x,
      y: clamped.y,
      worldX: boardPoint.x,
      worldY: boardPoint.y,
      noteID,
    });
    setTrashOpen(false);
  }

  function beginGesture(event: PointerEvent, noteID: string | null): void {
    if (event.button !== 0) return;
    if (eventFromInteractiveTarget(event.target)) return;
    closeTransientWindows({ keepTrash: true });
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      noteID,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewport(),
      dragged: false,
      contextOpened: false,
      longPressTimer: null,
    };
    if (gesture.pointerType !== 'mouse') {
      gesture.longPressTimer = window.setTimeout(() => {
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gesture.contextOpened = true;
        openContextMenuAt(gesture.startClientX, gesture.startClientY, gesture.noteID);
      }, LONG_PRESS_MS);
    }
  }

  function endGesture(pointerID: number): BoardGesture | null {
    if (!gesture || gesture.pointerId !== pointerID) return null;
    const current = gesture;
    if (current.longPressTimer != null) {
      window.clearTimeout(current.longPressTimer);
    }
    gesture = null;
    return current;
  }

  createEffect(() => {
    syncLayoutMode();
    const onResize = () => syncLayoutMode();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  createEffect(() => {
    if (!viewportRef) return;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
      ensureViewportOrigin();
    });
    resizeObserver.observe(viewportRef);
    onCleanup(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    });
  });

  createEffect(() => {
    if (!props.open) {
      setContextMenu(null);
      setTrashOpen(false);
      closeNoteEditor();
      clearCopiedState();
      return;
    }
    const abortController = new AbortController();
    void loadNotes(abortController.signal);
    onCleanup(() => abortController.abort());
  });

  createEffect(() => {
    const active = activeTopic();
    if (!active && topics().length > 0) {
      setActiveTopicID(topics()[0]!.topic_id);
    }
    if (active && renamingTopicID() && active.topic_id !== renamingTopicID()) {
      setRenamingTopicID(null);
    }
  });

  createEffect(() => {
    if (trashOpen() && trashItems().length === 0) {
      setTrashOpen(false);
    }
  });

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (contextMenu()) {
          setContextMenu(null);
          return;
        }
        if (editingNoteID()) {
          closeNoteEditor();
          return;
        }
        if (trashOpen()) {
          setTrashOpen(false);
          return;
        }
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  createEffect(() => {
    if (!props.open) return;
    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.startClientX;
      const dy = event.clientY - gesture.startClientY;
      if (!gesture.dragged && Math.hypot(dx, dy) >= PAN_THRESHOLD_PX) {
        gesture.dragged = true;
        if (gesture.longPressTimer != null) {
          window.clearTimeout(gesture.longPressTimer);
          gesture.longPressTimer = null;
        }
      }
      if (!gesture.dragged) return;
      setViewport({
        x: gesture.startViewport.x + dx,
        y: gesture.startViewport.y + dy,
        scale: gesture.startViewport.scale,
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      const current = endGesture(event.pointerId);
      if (!current || current.contextOpened || current.dragged) return;
      if (!current.noteID) return;
      const note = items().find((candidate) => candidate.note_id === current.noteID);
      if (note) void copyNote(note);
    };
    const onPointerCancel = (event: PointerEvent) => {
      void event;
      endGesture(event.pointerId);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    onCleanup(() => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
    });
  });

  createEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (contextMenu() && contextMenuRef && target && !contextMenuRef.contains(target)) {
        setContextMenu(null);
      }
      if (trashOpen() && trashPanelRef && target && !trashPanelRef.contains(target)) {
        const toggle = target.closest('[data-notes-trash-toggle="true"]');
        if (!toggle) setTrashOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown, true));
  });

  const contextMenuItems = createMemo<FloatingContextMenuItem[]>(() => {
    const state = contextMenu();
    if (!state) return [];
    const menuItems: FloatingContextMenuItem[] = [];
    const topicReady = Boolean(activeTopic());

    menuItems.push({
      id: 'new',
      kind: 'action',
      label: 'New note',
      icon: FileText,
      disabled: !topicReady,
      onSelect: () => {
        setContextMenu(null);
        void createNoteAt(state.worldX, state.worldY, '', { openEditor: true });
      },
    });
    menuItems.push({
      id: 'paste',
      kind: 'action',
      label: 'Paste here',
      icon: Copy,
      disabled: !topicReady,
      onSelect: () => {
        setContextMenu(null);
        void createNoteFromClipboard(state.worldX, state.worldY);
      },
    });

    if (state.noteID) {
      menuItems.push({ id: 'sep-delete', kind: 'separator' });
      menuItems.push({
        id: 'delete',
        kind: 'action',
        label: 'Delete note',
        icon: Trash,
        destructive: true,
        onSelect: () => {
          setContextMenu(null);
          const note = items().find((candidate) => candidate.note_id === state.noteID);
          if (note) void deleteNote(note);
        },
      });
    }

    return menuItems;
  });

  function wheelZoom(event: WheelEvent): void {
    if (!viewportRef) return;
    if ((event.target instanceof HTMLElement) && eventFromInteractiveTarget(event.target)) return;
    event.preventDefault();
    const rect = viewportRef.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const scaleDelta = Math.exp(-event.deltaY * 0.0015);
    setViewport((current) => zoomViewportAtPoint(current, current.scale * scaleDelta, anchorX, anchorY));
  }

  function onViewportTouchStart(event: TouchEvent): void {
    if (event.touches.length < 2) {
      pinchGesture = null;
      return;
    }
    event.preventDefault();
    const midpoint = touchMidpoint(event.touches);
    pinchGesture = {
      startDistance: touchDistance(event.touches),
      startScale: viewport().scale,
      midpointX: midpoint.x,
      midpointY: midpoint.y,
    };
  }

  function onViewportTouchMove(event: TouchEvent): void {
    if (!pinchGesture || event.touches.length < 2 || !viewportRef) return;
    event.preventDefault();
    const distance = touchDistance(event.touches);
    if (!distance || !pinchGesture.startDistance) return;
    const midpoint = touchMidpoint(event.touches);
    const rect = viewportRef.getBoundingClientRect();
    const anchorX = midpoint.x - rect.left;
    const anchorY = midpoint.y - rect.top;
    const nextScale = pinchGesture.startScale * (distance / pinchGesture.startDistance);
    setViewport((current) => zoomViewportAtPoint(current, nextScale, anchorX, anchorY));
  }

  function onViewportTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) pinchGesture = null;
  }

  const editorPosition = createMemo(() => {
    const note = editingNote();
    const rect = viewportRef?.getBoundingClientRect();
    if (!note || !rect) return { left: 32, top: 32 };
    const metrics = noteBucketMetrics(note.size_bucket);
    const point = worldToScreen(viewport(), { x: note.x, y: note.y });
    const noteWidth = metrics.width * viewport().scale;
    const leftCandidate = rect.left + point.x + noteWidth + 18;
    const topCandidate = rect.top + point.y;
    const width = Math.min(320, Math.max(280, rect.width * 0.32));
    let left = leftCandidate;
    if (left + width > window.innerWidth - 16) {
      left = rect.left + point.x - width - 18;
    }
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    const top = Math.max(16, Math.min(topCandidate, window.innerHeight - 320));
    return { left, top, width };
  });

  const minimapViewportRect = createMemo(() => visibleWorldRect(viewport(), viewportSize().width || 1, viewportSize().height || 1));

  function focusTopicCenter(worldX: number, worldY: number): void {
    setViewport((current) => centerViewportOnWorldPoint(current, worldX, worldY, viewportSize().width || 1, viewportSize().height || 1));
  }

  return (
    <Show when={props.open}>
      <div class="notes-overlay" onContextMenu={(event) => event.preventDefault()}>
        <div class="notes-overlay__scrim" />

        <aside class={cn('notes-overlay__rail', railOpen() ? 'is-open' : 'is-closed')}>
          <div class="notes-overlay__rail-head">
            <button
              type="button"
              class="notes-overlay__brand"
              aria-label="Notes topics"
              data-notes-interactive="true"
              onClick={() => {
                if (isMobile()) setRailOpen((current) => !current);
              }}
            >
              <NotesOverlayIcon class="h-4 w-4" />
              <span>Notes</span>
            </button>
            <button
              type="button"
              class="notes-overlay__icon-button"
              aria-label="Create topic"
              data-notes-interactive="true"
              onClick={() => {
                setCreatingTopic(true);
                setRenamingTopicID(null);
                queueMicrotask(() => createTopicInputRef?.focus());
              }}
            >
              <Plus class="h-3.5 w-3.5" />
            </button>
          </div>

          <Show when={creatingTopic()}>
            <div class="notes-overlay__topic-create" data-notes-interactive="true">
              <input
                ref={createTopicInputRef}
                value={newTopicName()}
                class="notes-overlay__topic-input"
                placeholder="New topic"
                data-notes-interactive="true"
                onInput={(event) => setNewTopicName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createTopic();
                  }
                  if (event.key === 'Escape') {
                    setCreatingTopic(false);
                    setNewTopicName('');
                  }
                }}
              />
              <div class="notes-overlay__topic-create-actions">
                <button type="button" class="notes-overlay__text-action" data-notes-interactive="true" onClick={() => void createTopic()}>Add</button>
                <button
                  type="button"
                  class="notes-overlay__text-action"
                  data-notes-interactive="true"
                  onClick={() => {
                    setCreatingTopic(false);
                    setNewTopicName('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </Show>

          <div class="notes-overlay__topic-list">
            <For each={topics()}>
              {(topic) => {
                const liveCount = liveItemCountByTopic().get(topic.topic_id) ?? 0;
                const trashCount = trashItemCountByTopic().get(topic.topic_id) ?? 0;
                const active = () => activeTopic()?.topic_id === topic.topic_id;
                const renaming = () => renamingTopicID() === topic.topic_id;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    class={cn('notes-overlay__topic-row', active() && 'is-active')}
                    aria-current={active() ? 'true' : undefined}
                    data-notes-interactive="true"
                    onClick={() => {
                      setActiveTopicID(topic.topic_id);
                      if (isMobile()) setRailOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveTopicID(topic.topic_id);
                        if (isMobile()) setRailOpen(false);
                      }
                    }}
                  >
                    <span class="notes-overlay__topic-icon" data-accent={topic.icon_accent}>
                      <NotesAnimalIcon iconKey={topic.icon_key} class="h-4.5 w-4.5" />
                    </span>
                    <span class="notes-overlay__topic-copy">
                      <Show
                        when={renaming()}
                        fallback={<span class="notes-overlay__topic-name">{topic.name}</span>}
                      >
                        <input
                          ref={renameTopicInputRef}
                          value={renamingTopicName()}
                          class="notes-overlay__topic-input notes-overlay__topic-input--row"
                          data-notes-interactive="true"
                          onClick={(event) => event.stopPropagation()}
                          onInput={(event) => setRenamingTopicName(event.currentTarget.value)}
                          onBlur={() => void commitTopicRename(topic)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void commitTopicRename(topic);
                            }
                            if (event.key === 'Escape') {
                              setRenamingTopicID(null);
                            }
                          }}
                        />
                      </Show>
                      <span class="notes-overlay__topic-meta">
                        <span>{liveCount}</span>
                        <Show when={trashCount > 0}>
                          <span>{trashCount}</span>
                        </Show>
                      </span>
                    </span>
                    <span class="notes-overlay__topic-actions">
                      <button
                        type="button"
                        class="notes-overlay__inline-icon"
                        aria-label={`Rename ${topic.name}`}
                        data-notes-interactive="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenamingTopicID(topic.topic_id);
                          setRenamingTopicName(topic.name);
                          queueMicrotask(() => renameTopicInputRef?.focus());
                        }}
                      >
                        <Pencil class="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        class="notes-overlay__inline-icon notes-overlay__inline-icon--danger"
                        aria-label={`Delete ${topic.name}`}
                        data-notes-interactive="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteTopicByID(topic.topic_id);
                        }}
                      >
                        <Trash class="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                );
              }}
            </For>

            <Show when={!topics().length && !creatingTopic()}>
              <div class="notes-overlay__empty-rail">Create your first topic to start pinning notes.</div>
            </Show>
          </div>
        </aside>

        <div
          ref={viewportRef}
          class="notes-overlay__viewport"
          onWheel={wheelZoom}
          onContextMenu={(event) => {
            event.preventDefault();
            if (eventFromInteractiveTarget(event.target)) return;
            openContextMenuAt(event.clientX, event.clientY, null);
          }}
          onPointerDown={(event) => beginGesture(event, null)}
          onTouchStart={onViewportTouchStart}
          onTouchMove={onViewportTouchMove}
          onTouchEnd={onViewportTouchEnd}
          onTouchCancel={onViewportTouchEnd}
        >
          <div class="notes-overlay__hud">
            <button
              type="button"
              class="notes-overlay__hud-topic"
              aria-label={isMobile() ? 'Open topics' : 'Active topic'}
              data-notes-interactive="true"
              onClick={() => {
                if (isMobile()) setRailOpen((current) => !current);
              }}
            >
              <Show when={activeTopic()} fallback={<span>No topic</span>}>
                {(topic) => (
                  <>
                    <span class="notes-overlay__topic-icon notes-overlay__topic-icon--hud" data-accent={topic().icon_accent}>
                      <NotesAnimalIcon iconKey={topic().icon_key} class="h-4.5 w-4.5" />
                    </span>
                    <span class="notes-overlay__hud-topic-copy">
                      <span class="notes-overlay__hud-topic-name">{topic().name}</span>
                      <span class="notes-overlay__hud-topic-state" data-state={streaming()}>
                        {Math.round(viewport().scale * 100)}%
                      </span>
                    </span>
                  </>
                )}
              </Show>
            </button>

            <button
              type="button"
              class="notes-overlay__close"
              aria-label="Close notes overlay"
              data-notes-interactive="true"
              onClick={props.onClose}
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <Show when={loading()}>
            <div class="notes-overlay__loading">Loading notes…</div>
          </Show>

          <div
            class="notes-overlay__board"
            style={{
              transform: `translate3d(${viewport().x}px, ${viewport().y}px, 0) scale(${viewport().scale})`,
            }}
          >
            <For each={activeItems()}>
              {(item) => {
                const metrics = noteBucketMetrics(item.size_bucket);
                const copied = () => copiedNoteID() === item.note_id;
                return (
                  <div
                    class={cn('notes-note', copied() && 'is-copied')}
                    data-color={item.color_token}
                    data-size={String(item.size_bucket)}
                    style={{
                      width: `${metrics.width}px`,
                      height: `${metrics.height}px`,
                      transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
                      'z-index': String(item.z_index),
                      '--notes-preview-lines': String(metrics.preview_lines),
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginGesture(event, item.note_id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openContextMenuAt(event.clientX, event.clientY, item.note_id);
                    }}
                  >
                    <div class="notes-note__surface">
                      <div class="notes-note__toolbar">
                        <span class="notes-note__eyebrow">{item.character_count || 0}</span>
                        <span class="notes-note__toolbar-actions">
                          <button
                            type="button"
                            class="notes-overlay__inline-icon"
                            aria-label="Edit note"
                            data-notes-interactive="true"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              openNoteEditor(item);
                            }}
                          >
                            <Pencil class="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            class="notes-overlay__inline-icon notes-overlay__inline-icon--danger"
                            aria-label="Delete note"
                            data-notes-interactive="true"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteNote(item);
                            }}
                          >
                            <Trash class="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                      <div class="notes-note__body">{notePreviewText(item)}</div>
                      <Show when={copied()}>
                        <Motion.div
                          class="notes-note__copied"
                          initial={{ opacity: 0, scale: 0.88 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.18, easing: 'ease-out' }}
                        >
                          <Check class="h-5 w-5" />
                          <span>Copied</span>
                        </Motion.div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>

            <Show when={activeTopic() && !activeItems().length && !loading()}>
              <div class="notes-overlay__empty-board">Right click anywhere to create the first note in this topic.</div>
            </Show>
          </div>

          <NotesMinimap
            bounds={minimapBounds}
            items={activeItems}
            viewportRect={minimapViewportRect}
            onFocusPoint={focusTopicCenter}
          />

          <Show when={!trashOpen()}>
            <button
              type="button"
              class="notes-overlay__trash-dock"
              aria-label="Open trash"
              data-notes-interactive="true"
              data-notes-trash-toggle="true"
              onClick={() => {
                setTrashOpen(true);
                setContextMenu(null);
              }}
            >
              <NotesTrashCanIcon class="h-8 w-8" />
              <Show when={trashItems().length > 0}>
                <span class="notes-overlay__trash-count">{trashItems().length}</span>
              </Show>
            </button>
          </Show>

          <Show when={trashOpen()}>
            <Motion.div
              ref={trashPanelRef}
              class="notes-trash"
              data-notes-interactive="true"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, easing: 'ease-out' }}
            >
              <div class="notes-trash__head">
                <span class="notes-trash__title">
                  <NotesTrashCanIcon class="h-5 w-5" />
                </span>
                <button
                  type="button"
                  class="notes-overlay__close notes-overlay__close--panel"
                  aria-label="Close trash"
                  data-notes-interactive="true"
                  onClick={() => setTrashOpen(false)}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
              <div class="notes-trash__content">
                <For each={trashGroups()}>
                  {(group) => (
                    <section class="notes-trash__group">
                      <div class="notes-trash__group-head">
                        <div class="notes-trash__group-title">
                          <span class="notes-overlay__topic-icon notes-overlay__topic-icon--hud" data-accent={group.topic_icon_accent}>
                            <NotesAnimalIcon iconKey={group.topic_icon_key} class="h-4.5 w-4.5" />
                          </span>
                          <span>{group.topic_name}</span>
                        </div>
                        <button
                          type="button"
                          class="notes-overlay__text-action notes-overlay__text-action--danger"
                          data-notes-interactive="true"
                          onClick={() => void clearTrashGroup(group)}
                        >
                          Clear
                        </button>
                      </div>
                      <div class="notes-trash__grid">
                        <For each={group.items}>
                          {(item) => {
                            const metrics = noteBucketMetrics(item.size_bucket);
                            return (
                              <div
                                class="notes-note notes-note--trash"
                                data-color={item.color_token}
                                data-size={String(item.size_bucket)}
                                style={{
                                  width: `${metrics.width}px`,
                                  height: `${metrics.height}px`,
                                  '--notes-preview-lines': String(metrics.preview_lines),
                                }}
                              >
                                <div class="notes-note__surface">
                                  <div class="notes-note__toolbar notes-note__toolbar--trash">
                                    <span class="notes-note__eyebrow">{formatTrashTimestamp(item.deleted_at_unix_ms)}</span>
                                    <button
                                      type="button"
                                      class="notes-overlay__inline-icon"
                                      aria-label="Restore note"
                                      data-notes-interactive="true"
                                      onClick={() => void restoreTrashItem(item)}
                                    >
                                      <Copy class="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                  <div class="notes-note__body">{notePreviewText(item)}</div>
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
                <Show when={!trashGroups().length}>
                  <div class="notes-trash__empty">Trash is empty.</div>
                </Show>
              </div>
            </Motion.div>
          </Show>
        </div>

        <Show when={contextMenu()}>
          <FloatingContextMenu
            x={contextMenu()!.x}
            y={contextMenu()!.y}
            items={contextMenuItems()}
            menuRef={(element) => {
              contextMenuRef = element;
            }}
          />
        </Show>

        <Show when={editingNote()}>
          <Motion.div
            class="notes-editor"
            data-notes-interactive="true"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18, easing: 'ease-out' }}
            style={{
              left: `${editorPosition().left}px`,
              top: `${editorPosition().top}px`,
              width: `${editorPosition().width}px`,
            }}
          >
            <div class="notes-editor__head">
              <span>Edit note</span>
              <button
                type="button"
                class="notes-overlay__close notes-overlay__close--panel"
                aria-label="Close note editor"
                data-notes-interactive="true"
                onClick={closeNoteEditor}
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="notes-editor__colors">
              <For each={NOTE_COLOR_TOKENS}>
                {(token) => (
                  <button
                    type="button"
                    class={cn('notes-editor__color', editorColor() === token && 'is-active')}
                    data-color={token}
                    data-notes-interactive="true"
                    aria-label={`Use ${NOTE_COLOR_LABELS[token]}`}
                    onClick={() => setEditorColor(token)}
                  />
                )}
              </For>
            </div>
            <textarea
              ref={editorTextareaRef}
              class="notes-editor__textarea"
              value={editorBody()}
              data-notes-interactive="true"
              spellcheck={false}
              onInput={(event) => setEditorBody(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void saveNoteEditor();
                }
              }}
            />
            <div class="notes-editor__actions">
              <button type="button" class="notes-overlay__text-action" data-notes-interactive="true" onClick={() => void saveNoteEditor()}>Save</button>
              <button type="button" class="notes-overlay__text-action" data-notes-interactive="true" onClick={closeNoteEditor}>Cancel</button>
            </div>
          </Motion.div>
        </Show>
      </div>
    </Show>
  );
}

function NotesMinimap(props: {
  bounds: Accessor<NotesRect>;
  items: Accessor<NotesItem[]>;
  viewportRect: Accessor<NotesRect>;
  onFocusPoint: (worldX: number, worldY: number) => void;
}) {
  const width = 170;
  const height = 118;
  let activePointerID: number | null = null;

  const scale = createMemo(() => {
    const bounds = props.bounds();
    return Math.min(
      width / Math.max(1, bounds.maxX - bounds.minX),
      height / Math.max(1, bounds.maxY - bounds.minY),
    );
  });

  function mapX(worldX: number): number {
    return (worldX - props.bounds().minX) * scale();
  }

  function mapY(worldY: number): number {
    return (worldY - props.bounds().minY) * scale();
  }

  function focusFromClientPosition(clientX: number, clientY: number, rect: DOMRect): void {
    const localX = Math.max(0, Math.min(width, clientX - rect.left));
    const localY = Math.max(0, Math.min(height, clientY - rect.top));
    const worldX = props.bounds().minX + localX / scale();
    const worldY = props.bounds().minY + localY / scale();
    props.onFocusPoint(worldX, worldY);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLDivElement;
    activePointerID = event.pointerId;
    target.setPointerCapture(event.pointerId);
    focusFromClientPosition(event.clientX, event.clientY, target.getBoundingClientRect());
  }

  function onPointerMove(event: PointerEvent) {
    if (activePointerID !== event.pointerId) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLDivElement;
    focusFromClientPosition(event.clientX, event.clientY, target.getBoundingClientRect());
  }

  function endPointer(event: PointerEvent) {
    if (activePointerID !== event.pointerId) return;
    const target = event.currentTarget as HTMLDivElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    activePointerID = null;
  }

  return (
    <div
      class="notes-minimap"
      data-notes-interactive="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    >
      <svg viewBox={`0 0 ${width} ${height}`} class="notes-minimap__svg" aria-hidden="true">
        <For each={props.items()}>
          {(item) => {
            const metrics = noteBucketMetrics(item.size_bucket);
            return (
              <rect
                class="notes-minimap__note"
                data-color={item.color_token}
                x={mapX(item.x)}
                y={mapY(item.y)}
                width={Math.max(7, metrics.width * scale())}
                height={Math.max(5, metrics.height * scale())}
                rx="2"
              />
            );
          }}
        </For>
        <rect
          class="notes-minimap__viewport"
          x={mapX(props.viewportRect().minX)}
          y={mapY(props.viewportRect().minY)}
          width={Math.max(22, (props.viewportRect().maxX - props.viewportRect().minX) * scale())}
          height={Math.max(18, (props.viewportRect().maxY - props.viewportRect().minY) * scale())}
          rx="4"
        />
      </svg>
    </div>
  );
}
