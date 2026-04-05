// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesOverlay } from './NotesOverlay';
import type { NotesItem, NotesSnapshot } from './notesModel';

const notificationState = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
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
  clearNotesTrashTopic: vi.fn(),
  connectNotesEventStream: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  useNotification: () => notificationState,
}));

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div {...props}>{props.children}</div>,
  },
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
  clearNotesTrashTopic: notesApiState.clearNotesTrashTopic,
  connectNotesEventStream: notesApiState.connectNotesEventStream,
}));

function baseSnapshot(): NotesSnapshot {
  return {
    seq: 1,
    retention_hours: 72,
    topics: [
      {
        topic_id: 'topic-1',
        name: 'Research',
        icon_key: 'fox',
        icon_accent: 'ember',
        sort_order: 1,
        created_at_unix_ms: 1,
        updated_at_unix_ms: 1,
        deleted_at_unix_ms: 0,
      },
    ],
    items: [
      {
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
      },
    ],
    trash_items: [],
  };
}

function restoredItem(): NotesItem {
  return {
    ...baseSnapshot().items[0]!,
    updated_at_unix_ms: 8,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('NotesOverlay', () => {
  beforeEach(() => {
    if (typeof PointerEvent === 'undefined') {
      // JSDOM exposes MouseEvent but not always PointerEvent.
      (globalThis as typeof globalThis & { PointerEvent?: typeof MouseEvent }).PointerEvent = MouseEvent as typeof PointerEvent;
    }
    if (typeof ResizeObserver === 'undefined') {
      (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = (() => undefined) as typeof HTMLElement.prototype.setPointerCapture;
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = (() => undefined) as typeof HTMLElement.prototype.releasePointerCapture;
    }
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = (() => true) as typeof HTMLElement.prototype.hasPointerCapture;
    }

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
        readText: vi.fn(async () => 'Clipboard note'),
      },
    });

    notesApiState.getNotesSnapshot.mockResolvedValue(baseSnapshot());
    notesApiState.createNotesTopic.mockResolvedValue(undefined);
    notesApiState.updateNotesTopic.mockResolvedValue(undefined);
    notesApiState.deleteNotesTopic.mockResolvedValue(undefined);
    notesApiState.createNotesItem.mockResolvedValue(undefined);
    notesApiState.updateNotesItem.mockResolvedValue(undefined);
    notesApiState.bringNotesItemToFront.mockResolvedValue({ ...baseSnapshot().items[0]!, z_index: 2, updated_at_unix_ms: 3 });
    notesApiState.deleteNotesItem.mockResolvedValue(undefined);
    notesApiState.restoreNotesItem.mockResolvedValue(restoredItem());
    notesApiState.clearNotesTrashTopic.mockResolvedValue(undefined);
    notesApiState.connectNotesEventStream.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('copies a note on the first click and shows the copied state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const note = host.querySelector('.notes-note') as HTMLDivElement | null;
    expect(note).toBeTruthy();

    note!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, clientY: 80, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 80, pointerId: 1 }));
    await settle();

    expect((navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('Primary note body');
    expect(notesApiState.bringNotesItemToFront).toHaveBeenCalledWith('note-1');
    expect(host.textContent).toContain('Copied');
  });

  it('treats dragging a note as canvas pan instead of copy', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const note = host.querySelector('.notes-note') as HTMLDivElement | null;
    expect(note).toBeTruthy();

    note!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 50, pointerId: 2 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 78, clientY: 96, pointerId: 2 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 78, clientY: 96, pointerId: 2 }));
    await settle();

    expect((navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Copied');
  });

  it('moves deleted notes into trash and restores them through the trash panel', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    notesApiState.getNotesSnapshot
      .mockResolvedValueOnce(baseSnapshot())
      .mockResolvedValueOnce({
        ...baseSnapshot(),
        seq: 2,
        items: [restoredItem()],
        trash_items: [],
      });

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const deleteButton = host.querySelector('button[aria-label="Delete note"]') as HTMLButtonElement | null;
    expect(deleteButton).toBeTruthy();
    deleteButton!.click();
    await settle();

    expect(notesApiState.deleteNotesItem).toHaveBeenCalledWith('note-1');

    const trashDock = host.querySelector('button[aria-label="Open trash"]') as HTMLButtonElement | null;
    expect(trashDock).toBeTruthy();
    trashDock!.click();
    await settle();

    expect(host.textContent).toContain('Research');

    const restoreButton = host.querySelector('button[aria-label="Restore note"]') as HTMLButtonElement | null;
    expect(restoreButton).toBeTruthy();
    restoreButton!.click();
    await settle();

    expect(notesApiState.restoreNotesItem).toHaveBeenCalledWith('note-1');
    expect(notesApiState.getNotesSnapshot).toHaveBeenCalledTimes(2);
    expect(host.querySelector('button[aria-label="Open trash"]')).toBeTruthy();
  });

  it('collapses the topic rail on mobile and reopens it from the HUD', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const rail = host.querySelector('.notes-overlay__rail') as HTMLElement | null;
    expect(rail?.className).toContain('is-closed');

    const hudButton = host.querySelector('button[aria-label="Open topics"]') as HTMLButtonElement | null;
    expect(hudButton).toBeTruthy();
    hudButton!.click();
    await settle();

    expect(rail?.className).toContain('is-open');
  });

  it('updates the viewport continuously while dragging on the minimap', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <NotesOverlay open onClose={() => undefined} />, host);
    await settle();

    const board = host.querySelector('.notes-overlay__board') as HTMLDivElement | null;
    const minimap = host.querySelector('.notes-minimap') as HTMLDivElement | null;
    expect(board).toBeTruthy();
    expect(minimap).toBeTruthy();

    Object.defineProperty(minimap!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 170,
        bottom: 118,
        width: 170,
        height: 118,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    const initialTransform = board!.style.transform;

    minimap!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 18, pointerId: 7 }));
    await settle();
    const afterDownTransform = board!.style.transform;

    minimap!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 138, clientY: 94, pointerId: 7 }));
    await settle();
    const afterMoveTransform = board!.style.transform;

    minimap!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 138, clientY: 94, pointerId: 7 }));
    await settle();

    expect(afterDownTransform).not.toBe(initialTransform);
    expect(afterMoveTransform).not.toBe(afterDownTransform);
  });
});
