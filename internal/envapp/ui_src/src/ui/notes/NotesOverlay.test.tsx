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
  info: vi.fn(),
  success: vi.fn(),
}));

const clipboardState = vi.hoisted(() => ({
  writeTextToClipboard: vi.fn(),
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
        allowGlobalHotkeys?: readonly string[];
      },
  editorOpen: false,
  manualPasteOpen: false,
  contextMenuOpen: false,
  topicRenameOpen: false,
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
      return props.open ? (
        <div
          class="notes-overlay"
          aria-label="Notes overlay"
          data-notes-interaction-mode={String(props.interactionMode ?? '')}
        >
          <div class="notes-overlay__frame" data-floe-notes-boundary="true">
            <aside class="notes-overlay__rail" data-floe-canvas-interactive="true">
              <form class="notes-topic-composer notes-overlay__topic-composer">
                <input data-testid="notes-topic-input" placeholder="Add topic" />
              </form>
              {notesUIState.topicRenameOpen ? (
                <form class="notes-topic-row__editor">
                  <button type="button">Save topic name</button>
                </form>
              ) : null}
            </aside>
            <div class="notes-page__canvas">
              <div class="notes-canvas__field">
                {props.controller
                  .snapshot()
                  .items.filter((item: NotesItem) => item.topic_id === props.controller.activeTopicID())
                  .map((item: NotesItem) => (
                    <article class="notes-note" data-floe-notes-note-id={item.note_id}>
                      <div class="notes-note__surface">
                        <button type="button" class="notes-note__body" data-testid={`note-${item.note_id}`}>
                          {item.body}
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            </div>
            {notesUIState.contextMenuOpen ? (
              <div class="notes-context-menu" data-floe-notes-boundary="true" />
            ) : null}
            {notesUIState.editorOpen ? (
              <div class="notes-flyout notes-flyout--editor" data-floe-notes-boundary="true">
                <button type="button">Close editor</button>
              </div>
            ) : null}
            {notesUIState.manualPasteOpen ? (
              <div class="notes-flyout notes-flyout--paste" data-floe-notes-boundary="true">
                <button type="button">Close paste</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div data-testid="shared-notes-overlay" data-open={String(props.open)} />
      );
    },
    NotesOverlayIcon: (props: any) => <svg {...props} />,
  };
});

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard: clipboardState.writeTextToClipboard,
}));

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
    title: '',
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

function buildTopicItems(count: number, overrides?: {
  topicID?: string;
  startCreatedAt?: number;
}): NotesItem[] {
  const topicID = overrides?.topicID ?? 'topic-1';
  const startCreatedAt = overrides?.startCreatedAt ?? 1;
  return Array.from({ length: count }, (_, index) =>
    baseItem({
      note_id: `note-${index + 1}`,
      topic_id: topicID,
      body: `Body ${index + 1}`,
      preview_text: `Body ${index + 1}`,
      character_count: `Body ${index + 1}`.length,
      created_at_unix_ms: startCreatedAt + index,
      updated_at_unix_ms: startCreatedAt + index,
      z_index: index + 1,
      x: 120 + index * 24,
      y: 90 + index * 16,
    }),
  );
}

let renderDisposers: Array<() => void> = [];

function mountIntoHost(renderer: () => any, host: HTMLElement): () => void {
  const dispose = render(renderer, host);
  renderDisposers.push(dispose);
  return dispose;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('Redeven NotesOverlay adapter', () => {
  beforeEach(() => {
    renderDisposers = [];
    notesUIState.lastProps = null;
    notesUIState.editorOpen = false;
    notesUIState.manualPasteOpen = false;
    notesUIState.contextMenuOpen = false;
    notesUIState.topicRenameOpen = false;
    notesApiState.streamArgs = null;
    clipboardState.writeTextToClipboard.mockReset();
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
    notesApiState.createNotesItem.mockImplementation(
      async (input: { topic_id: string; headline?: string; title?: string; body: string; x: number; y: number }) =>
      baseItem({
        note_id: 'note-2',
        topic_id: input.topic_id,
        title: input.headline ?? input.title ?? '',
        headline: input.headline ?? input.title ?? '',
        body: input.body,
        preview_text: input.body,
        character_count: (input.headline ?? input.title ?? '').length + input.body.length,
        x: input.x,
        y: input.y,
        z_index: 2,
      }),
    );
    notesApiState.updateNotesItem.mockImplementation(
      async (noteID: string, input: { headline?: string; title?: string; body?: string }) =>
      baseItem({
        note_id: noteID,
        title: input.headline ?? input.title ?? '',
        headline: input.headline ?? input.title ?? '',
        body: input.body ?? 'Primary note body',
        preview_text: input.body ?? 'Primary note body',
        character_count:
          (input.headline ?? input.title ?? '').length + (input.body ?? 'Primary note body').length,
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
    clipboardState.writeTextToClipboard.mockResolvedValue(undefined);
    notesApiState.connectNotesEventStream.mockImplementation(async (args: { afterSeq?: number; onEvent: (event: NotesEvent) => void; signal: AbortSignal }) => {
      notesApiState.streamArgs = args;
      await new Promise<void>((resolve) => {
        args.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });
  });

  afterEach(() => {
    for (const dispose of renderDisposers.splice(0)) {
      dispose();
    }
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
    mountIntoHost(() => <NotesOverlay open={open()} onClose={() => undefined} />, host);
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
      const dispose = mountIntoHost(
        () => <NotesOverlay open={open()} onClose={() => undefined} viewportHost={viewportHost} />,
        host,
      );
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
      renderDisposers = renderDisposers.filter((entry) => entry !== dispose);
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

    mountIntoHost(() => <NotesOverlay open onClose={onClose} />, host);
    await settle();

    expect(notesUIState.lastProps?.open).toBe(true);
    notesUIState.lastProps?.onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('forwards the shell toggle keybind into the shared floating notes hotkey allowlist', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} toggleKeybind="mod+." />, host);
    await settle();

    expect(notesUIState.lastProps?.interactionMode).toBe('floating');
    expect(notesUIState.lastProps?.allowGlobalHotkeys).toEqual(['mod+.']);
  });

  it('does not let Redeven digit shortcuts swallow the shell toggle keybind after board interaction', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} toggleKeybind="mod+." />, host);
    await settle();

    const bubbleSpy = vi.fn();
    const bubbleHandler = (event: KeyboardEvent) => bubbleSpy(event.key);
    window.addEventListener('keydown', bubbleHandler);

    const overlay = document.querySelector('.notes-overlay') as HTMLElement | null;
    const noteBody = document.querySelector('[data-testid="note-note-1"]') as HTMLButtonElement | null;
    expect(overlay).toBeTruthy();
    expect(noteBody).toBeTruthy();

    overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    noteBody?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '.',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(bubbleSpy.mock.calls.map(([key]) => key)).toEqual(['.']);
    expect(clipboardState.writeTextToClipboard).not.toHaveBeenCalled();

    window.removeEventListener('keydown', bubbleHandler);
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

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const controller = notesUIState.lastProps?.controller;
    expect(controller).toBeTruthy();

    const created = await controller.createNote({
      topic_id: 'topic-1',
      headline: 'Launch checklist',
      body: 'Fresh note',
      x: 420,
      y: 260,
    });
    expect(created.note_id).toBe('note-2');
    expect(notesApiState.createNotesItem).toHaveBeenCalledWith({
      topic_id: 'topic-1',
      headline: 'Launch checklist',
      body: 'Fresh note',
      x: 420,
      y: 260,
    });
    expect(created.title).toBe('Launch checklist');
    expect(created.headline).toBe('Launch checklist');
    expect(controller.snapshot().items.map((item: NotesItem) => item.note_id)).toEqual(['note-1', 'note-2']);

    const updated = await controller.updateNote('note-2', {
      headline: 'Renamed checklist',
      body: 'Fresh note updated',
    });
    expect(notesApiState.updateNotesItem).toHaveBeenCalledWith('note-2', {
      headline: 'Renamed checklist',
      body: 'Fresh note updated',
    });
    expect(updated.title).toBe('Renamed checklist');
    expect(updated.headline).toBe('Renamed checklist');

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

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
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

  it('decorates active-topic notes with continuous numbers and renumbers after deletes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot.mockResolvedValueOnce(
      baseSnapshot({
        topics: [
          baseTopic(),
          baseTopic({ topic_id: 'topic-2', name: 'Archive', sort_order: 2 }),
        ],
        items: [
          baseItem({ note_id: 'note-2', body: 'Later note', created_at_unix_ms: 6, updated_at_unix_ms: 6, z_index: 2 }),
          baseItem({ note_id: 'note-1', body: 'Earlier note', created_at_unix_ms: 3, updated_at_unix_ms: 3, z_index: 1 }),
          baseItem({
            note_id: 'note-3',
            topic_id: 'topic-2',
            body: 'Other topic note',
            created_at_unix_ms: 1,
            updated_at_unix_ms: 1,
            z_index: 1,
          }),
        ],
      }),
    );

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const firstNote = document.querySelector<HTMLElement>('[data-floe-notes-note-id="note-1"]');
    const secondNote = document.querySelector<HTMLElement>('[data-floe-notes-note-id="note-2"]');
    expect(firstNote?.dataset.redevenNoteIndex).toBe('1');
    expect(secondNote?.dataset.redevenNoteIndex).toBe('2');
    expect(document.querySelector('[data-floe-notes-note-id="note-3"]')).toBeNull();

    const controller = notesUIState.lastProps?.controller;
    await controller.deleteNote('note-1');
    await settle();

    const renumberedSecondNote = document.querySelector<HTMLElement>('[data-floe-notes-note-id="note-2"]');
    expect(renumberedSecondNote?.dataset.redevenNoteIndex).toBe('1');
  });

  it('copies the matching note when a number shortcut is pressed in board browse mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot.mockResolvedValueOnce(
      baseSnapshot({
        items: [
          baseItem({ note_id: 'note-1', body: 'First body', created_at_unix_ms: 1, updated_at_unix_ms: 1, z_index: 1 }),
          baseItem({ note_id: 'note-2', body: 'Second body', created_at_unix_ms: 2, updated_at_unix_ms: 2, z_index: 2 }),
        ],
      }),
    );

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const overlay = document.querySelector('.notes-overlay') as HTMLElement | null;
    expect(overlay).toBeTruthy();
    overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
    await settle();

    expect(clipboardState.writeTextToClipboard).toHaveBeenCalledWith('Second body');
    expect(notificationState.success).toHaveBeenCalledWith('Copied', 'Note #2 copied to clipboard.');
    expect(document.querySelector('[data-floe-notes-note-id="note-2"]')?.classList.contains('is-redeven-copied')).toBe(true);
  });

  it('waits for an additional digit when the first shortcut digit is ambiguous', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot.mockResolvedValueOnce(
      baseSnapshot({
        items: buildTopicItems(12),
      }),
    );

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const overlay = document.querySelector('.notes-overlay') as HTMLElement | null;
    overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    await settle();

    expect(clipboardState.writeTextToClipboard).not.toHaveBeenCalled();
    expect(document.querySelector('[data-floe-notes-note-id="note-1"]')?.classList.contains('is-redeven-shortcut-pending')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
    await settle();

    expect(clipboardState.writeTextToClipboard).toHaveBeenCalledWith('Body 12');
    expect(notificationState.success).toHaveBeenCalledWith('Copied', 'Note #12 copied to clipboard.');
  });

  it('disables number shortcuts while the user is typing in notes inputs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot.mockResolvedValueOnce(
      baseSnapshot({
        items: buildTopicItems(2),
      }),
    );

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const topicInput = document.querySelector('[data-testid="notes-topic-input"]') as HTMLInputElement | null;
    expect(topicInput).toBeTruthy();
    topicInput?.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    await settle();

    expect(clipboardState.writeTextToClipboard).not.toHaveBeenCalled();
    expect(notificationState.success).not.toHaveBeenCalled();
  });

  it('disables number shortcuts while note editor surfaces are open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    notesUIState.editorOpen = true;

    notesApiState.getNotesSnapshot.mockResolvedValueOnce(
      baseSnapshot({
        items: buildTopicItems(2),
      }),
    );

    mountIntoHost(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const overlay = document.querySelector('.notes-overlay') as HTMLElement | null;
    overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    await settle();

    expect(clipboardState.writeTextToClipboard).not.toHaveBeenCalled();
    expect(notificationState.success).not.toHaveBeenCalled();
  });
});
