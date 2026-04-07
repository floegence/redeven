// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesOverlay } from './NotesOverlay';
import {
  NOTES_OVERLAY_VIEWPORT_ATTR,
  NOTES_OVERLAY_VIEWPORT_CSS_VARS,
} from './notesOverlayViewport';
import type { NotesEvent, NotesItem, NotesSnapshot, NotesTopic, NotesTrashItem } from './notesModel';

const notificationState = vi.hoisted(() => ({
  error: vi.fn(),
}));

const notesApiState = vi.hoisted(() => ({
  getNotesSnapshot: vi.fn(),
  createNotesTopic: vi.fn(),
  updateNotesTopic: vi.fn(),
  deleteNotesTopic: vi.fn(),
  createNotesItem: vi.fn(),
  updateNotesItem: vi.fn(),
  bringNotesItemToFront: vi.fn(),
  deleteNotesItem: vi.fn(),
  restoreNotesItem: vi.fn(),
  deleteNotesTrashItemPermanently: vi.fn(),
  clearNotesTrashTopic: vi.fn(),
  connectNotesEventStream: vi.fn(),
  streamArgs: null as
    | null
    | {
        afterSeq?: number;
        onEvent: (event: NotesEvent) => void;
        signal: AbortSignal;
      },
}));

const notesUIState = vi.hoisted(() => ({
  lastProps: null as
    | null
    | {
        open: boolean;
        controller: any;
        onClose: () => void;
        interactionMode?: string;
      },
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => notificationState,
}));

vi.mock('@floegence/floe-webapp-core/notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floegence/floe-webapp-core/notes')>();
  return {
    ...actual,
    NotesOverlay: (props: any) => {
      notesUIState.lastProps = props;
      return <div data-testid="shared-notes-overlay" data-open={String(props.open)} />;
    },
    NotesOverlayIcon: (props: any) => <svg {...props} />,
  };
});

vi.mock('../services/notesApi', () => ({
  getNotesSnapshot: notesApiState.getNotesSnapshot,
  createNotesTopic: notesApiState.createNotesTopic,
  updateNotesTopic: notesApiState.updateNotesTopic,
  deleteNotesTopic: notesApiState.deleteNotesTopic,
  createNotesItem: notesApiState.createNotesItem,
  updateNotesItem: notesApiState.updateNotesItem,
  bringNotesItemToFront: notesApiState.bringNotesItemToFront,
  deleteNotesItem: notesApiState.deleteNotesItem,
  restoreNotesItem: notesApiState.restoreNotesItem,
  deleteNotesTrashItemPermanently: notesApiState.deleteNotesTrashItemPermanently,
  clearNotesTrashTopic: notesApiState.clearNotesTrashTopic,
  connectNotesEventStream: notesApiState.connectNotesEventStream,
}));

function baseTopic(overrides: Partial<NotesTopic> = {}): NotesTopic {
  return {
    topic_id: 'topic-1',
    name: 'Research',
    icon_key: 'fox',
    icon_accent: 'ember',
    sort_order: 1,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    deleted_at_unix_ms: 0,
    ...overrides,
  };
}

function baseItem(overrides: Partial<NotesItem> = {}): NotesItem {
  return {
    note_id: 'note-1',
    topic_id: 'topic-1',
    body: 'Primary note body',
    preview_text: 'Primary note body',
    character_count: 17,
    size_bucket: 2,
    style_version: 'note/v1',
    color_token: 'sage',
    x: 120,
    y: 90,
    z_index: 1,
    created_at_unix_ms: 2,
    updated_at_unix_ms: 2,
    ...overrides,
  };
}

function baseTrashItem(overrides: Partial<NotesTrashItem> = {}): NotesTrashItem {
  return {
    ...baseItem(),
    topic_name: 'Research',
    topic_icon_key: 'fox',
    topic_icon_accent: 'ember',
    topic_sort_order: 1,
    deleted_at_unix_ms: 7,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<NotesSnapshot> = {}): NotesSnapshot {
  return {
    seq: 1,
    retention_hours: 72,
    topics: [baseTopic()],
    items: [baseItem()],
    trash_items: [],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('Redeven NotesOverlay adapter', () => {
  beforeEach(() => {
    notesUIState.lastProps = null;
    notesApiState.streamArgs = null;
    notesApiState.getNotesSnapshot.mockReset();
    notesApiState.createNotesTopic.mockReset();
    notesApiState.updateNotesTopic.mockReset();
    notesApiState.deleteNotesTopic.mockReset();
    notesApiState.createNotesItem.mockReset();
    notesApiState.updateNotesItem.mockReset();
    notesApiState.bringNotesItemToFront.mockReset();
    notesApiState.deleteNotesItem.mockReset();
    notesApiState.restoreNotesItem.mockReset();
    notesApiState.deleteNotesTrashItemPermanently.mockReset();
    notesApiState.clearNotesTrashTopic.mockReset();
    notesApiState.connectNotesEventStream.mockReset();

    notesApiState.getNotesSnapshot.mockResolvedValue(baseSnapshot());
    notesApiState.createNotesTopic.mockImplementation(async ({ name }: { name: string }) =>
      baseTopic({ topic_id: 'topic-2', name, sort_order: 2 }),
    );
    notesApiState.updateNotesTopic.mockImplementation(async (topicID: string, input: { name: string }) =>
      baseTopic({ topic_id: topicID, name: input.name }),
    );
    notesApiState.deleteNotesTopic.mockResolvedValue(undefined);
    notesApiState.createNotesItem.mockImplementation(async (input: { topic_id: string; body: string; x: number; y: number }) =>
      baseItem({
        note_id: 'note-2',
        topic_id: input.topic_id,
        body: input.body,
        preview_text: input.body,
        character_count: input.body.length,
        x: input.x,
        y: input.y,
        z_index: 2,
      }),
    );
    notesApiState.updateNotesItem.mockImplementation(async (noteID: string, input: { body?: string }) =>
      baseItem({
        note_id: noteID,
        body: input.body ?? 'Primary note body',
        preview_text: input.body ?? 'Primary note body',
        character_count: (input.body ?? 'Primary note body').length,
      }),
    );
    notesApiState.bringNotesItemToFront.mockImplementation(async (noteID: string) =>
      baseItem({
        note_id: noteID,
        z_index: 9,
        updated_at_unix_ms: 9,
      }),
    );
    notesApiState.deleteNotesItem.mockResolvedValue(undefined);
    notesApiState.restoreNotesItem.mockImplementation(async (noteID: string) =>
      baseItem({
        note_id: noteID,
        x: 640,
        y: 320,
        updated_at_unix_ms: 12,
      }),
    );
    notesApiState.deleteNotesTrashItemPermanently.mockResolvedValue(undefined);
    notesApiState.clearNotesTrashTopic.mockResolvedValue(undefined);
    notesApiState.connectNotesEventStream.mockImplementation(async (args: { afterSeq?: number; onEvent: (event: NotesEvent) => void; signal: AbortSignal }) => {
      notesApiState.streamArgs = args;
      await new Promise<void>((resolve) => {
        args.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });
  });

  afterEach(() => {
    document.body.removeAttribute(NOTES_OVERLAY_VIEWPORT_ATTR);
    for (const cssVarName of Object.values(NOTES_OVERLAY_VIEWPORT_CSS_VARS)) {
      document.body.style.removeProperty(cssVarName);
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('hydrates the shared NotesOverlay controller only when the overlay opens and applies SSE events', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [open, setOpen] = createSignal(false);
    render(() => <NotesOverlay open={open()} onClose={() => undefined} />, host);
    await settle();

    expect(notesApiState.getNotesSnapshot).not.toHaveBeenCalled();
    expect(notesUIState.lastProps?.open).toBe(false);
    expect(notesUIState.lastProps?.interactionMode).toBe('floating');

    setOpen(true);
    await settle();

    expect(notesApiState.getNotesSnapshot).toHaveBeenCalledTimes(1);
    expect(notesUIState.lastProps?.open).toBe(true);
    expect(notesUIState.lastProps?.interactionMode).toBe('floating');
    expect(notesApiState.streamArgs?.afterSeq).toBe(1);

    const controller = notesUIState.lastProps?.controller;
    expect(controller).toBeTruthy();
    expect(controller.connectionState?.()).toBe('live');
    expect(controller.snapshot().topics.map((topic: NotesTopic) => topic.topic_id)).toEqual(['topic-1']);

    notesApiState.streamArgs?.onEvent({
      seq: 2,
      type: 'item.updated',
      entity_kind: 'item',
      entity_id: 'note-1',
      created_at_unix_ms: 5,
      payload: {
        item: baseItem({
          body: 'Updated from stream',
          preview_text: 'Updated from stream',
          character_count: 19,
          updated_at_unix_ms: 5,
        }),
      },
    });
    await settle();

    expect(controller.snapshot().seq).toBe(2);
    expect(controller.snapshot().items[0]?.body).toBe('Updated from stream');
  });

  it('publishes and clears the shell viewport contract on document.body while the overlay is open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const viewportHost = document.createElement('div');
    const initialInnerWidth = window.innerWidth;
    const initialInnerHeight = window.innerHeight;
    Object.defineProperty(viewportHost, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 40,
        left: 64,
        right: 1216,
        bottom: 768,
        width: 1152,
        height: 728,
        x: 64,
        y: 40,
        toJSON: () => ({}),
      }),
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });

    try {
      const [open, setOpen] = createSignal(false);
      const dispose = render(() => <NotesOverlay open={open()} onClose={() => undefined} viewportHost={viewportHost} />, host);
      await settle();

      expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBeNull();

      setOpen(true);
      await settle();

      expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBe('active');
      expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.top)).toBe('40px');
      expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.left)).toBe('64px');
      expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width)).toBe('1152px');
      expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.height)).toBe('728px');

      setOpen(false);
      await settle();

      expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBeNull();
      expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width)).toBe('');

      dispose();
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: initialInnerWidth,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: initialInnerHeight,
      });
    }
  });

  it('forwards the shell close callback to the shared floating notes overlay', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onClose = vi.fn();

    render(() => <NotesOverlay open onClose={onClose} />, host);
    await settle();

    expect(notesUIState.lastProps?.open).toBe(true);
    notesUIState.lastProps?.onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps item mutations inside the Redeven controller adapter while preserving runtime authority', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot
      .mockResolvedValueOnce(baseSnapshot())
      .mockResolvedValueOnce(
        baseSnapshot({
          seq: 2,
          items: [
            baseItem({
              x: 640,
              y: 320,
              updated_at_unix_ms: 12,
            }),
          ],
          trash_items: [],
        }),
      );

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const controller = notesUIState.lastProps?.controller;
    expect(controller).toBeTruthy();

    const created = await controller.createNote({
      topic_id: 'topic-1',
      body: 'Fresh note',
      x: 420,
      y: 260,
    });
    expect(created.note_id).toBe('note-2');
    expect(notesApiState.createNotesItem).toHaveBeenCalledWith({
      topic_id: 'topic-1',
      body: 'Fresh note',
      x: 420,
      y: 260,
    });
    expect(controller.snapshot().items.map((item: NotesItem) => item.note_id)).toEqual(['note-1', 'note-2']);

    const beforeFront = controller.snapshot().items.find((item: NotesItem) => item.note_id === 'note-1')?.z_index;
    const frontPromise = controller.bringNoteToFront('note-1');
    const optimisticFront = controller.snapshot().items.find((item: NotesItem) => item.note_id === 'note-1')?.z_index;
    expect(optimisticFront).toBeGreaterThan(beforeFront ?? 0);
    await frontPromise;
    expect(controller.snapshot().items.find((item: NotesItem) => item.note_id === 'note-1')?.z_index).toBe(9);

    await controller.deleteNote('note-1');
    expect(notesApiState.deleteNotesItem).toHaveBeenCalledWith('note-1');
    expect(controller.snapshot().items.find((item: NotesItem) => item.note_id === 'note-1')).toBeUndefined();
    expect(controller.snapshot().trash_items.find((item: NotesTrashItem) => item.note_id === 'note-1')).toBeTruthy();

    const restored = await controller.restoreNote('note-1');
    expect(restored.x).toBe(640);
    expect(notesApiState.restoreNotesItem).toHaveBeenCalledWith('note-1');
    expect(notesApiState.getNotesSnapshot).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().items[0]?.x).toBe(640);
    expect(controller.snapshot().trash_items).toHaveLength(0);
  });

  it('keeps topic and trash mutations on the shared controller contract', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot
      .mockResolvedValueOnce(
        baseSnapshot({
          trash_items: [baseTrashItem()],
        }),
      )
      .mockResolvedValueOnce(baseSnapshot());

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const controller = notesUIState.lastProps?.controller;
    expect(controller).toBeTruthy();

    const createdTopic = await controller.createTopic({ name: 'Archive' });
    expect(createdTopic.topic_id).toBe('topic-2');
    expect(controller.activeTopicID()).toBe('topic-2');
    expect(controller.snapshot().topics.map((topic: NotesTopic) => topic.topic_id)).toEqual(['topic-1', 'topic-2']);

    const renamedTopic = await controller.updateTopic('topic-2', { name: 'Archive 2' });
    expect(renamedTopic.name).toBe('Archive 2');
    expect(controller.snapshot().topics.find((topic: NotesTopic) => topic.topic_id === 'topic-2')?.name).toBe('Archive 2');

    expect(controller.deleteTrashedNotePermanently).toBeTypeOf('function');
    await controller.deleteTrashedNotePermanently?.('note-1');
    expect(notesApiState.deleteNotesTrashItemPermanently).toHaveBeenCalledWith('note-1');
    expect(controller.snapshot().trash_items).toHaveLength(0);

    await controller.clearTrashTopic('topic-1');
    expect(notesApiState.clearNotesTrashTopic).toHaveBeenCalledWith('topic-1');
    expect(controller.snapshot().trash_items).toHaveLength(0);
  });
});
