// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyNotesEvent,
  computeBoardBounds,
  groupTrashItems,
  normalizeNotesSnapshot,
  noteBucketMetrics,
  visibleWorldRect,
  worldToScreen,
  zoomViewportAtPoint,
  type NotesEvent,
  type NotesSnapshot,
  type NotesTopic,
  type NotesTrashItem,
} from './notesModel';

const NOTES_MODEL_PATH = path.resolve(process.cwd(), 'src/ui/notes/notesModel.ts');

function topic(overrides?: Partial<NotesTopic>): NotesTopic {
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

function snapshot(): NotesSnapshot {
  return normalizeNotesSnapshot({
    seq: 2,
    retention_hours: 72,
    topics: [
      topic({ topic_id: 'topic-2', name: 'Zeta', sort_order: 2 }),
      topic({ topic_id: 'topic-1', name: 'Alpha', sort_order: 1 }),
    ],
    items: [
      {
        note_id: 'note-2',
        topic_id: 'topic-1',
        title: 'Second note',
        body: 'second',
        preview_text: 'second',
        character_count: 6,
        size_bucket: 2,
        style_version: 'note/v1',
        color_token: 'graphite',
        x: 260,
        y: 140,
        z_index: 4,
        created_at_unix_ms: 2,
        updated_at_unix_ms: 2,
      },
      {
        note_id: 'note-1',
        topic_id: 'topic-1',
        title: 'First note',
        body: 'first',
        preview_text: 'first',
        character_count: 5,
        size_bucket: 1,
        style_version: 'note/v1',
        color_token: 'sage',
        x: 20,
        y: 30,
        z_index: 1,
        created_at_unix_ms: 1,
        updated_at_unix_ms: 1,
      },
    ],
    trash_items: [],
  });
}

function trashItem(overrides?: Partial<NotesTrashItem>): NotesTrashItem {
  return {
    note_id: 'trash-1',
    topic_id: 'topic-1',
    title: 'Deleted note',
    body: 'deleted',
    preview_text: 'deleted',
    character_count: 7,
    size_bucket: 3,
    style_version: 'note/v1',
    color_token: 'amber',
    x: 12,
    y: 22,
    z_index: 2,
    created_at_unix_ms: 5,
    updated_at_unix_ms: 6,
    topic_name: 'Research',
    topic_icon_key: 'fox',
    topic_icon_accent: 'ember',
    topic_sort_order: 1,
    deleted_at_unix_ms: 7,
    ...overrides,
  };
}

describe('notesModel', () => {
  it('re-exports the canonical Notes DSL from floe-webapp-core instead of duplicating it locally', () => {
    const source = fs.readFileSync(path.resolve(NOTES_MODEL_PATH), 'utf-8');

    expect(source).toContain("from '@floegence/floe-webapp-core/notes'");
  });

  it('normalizes snapshot ordering for topics and items', () => {
    const value = snapshot();

    expect(value.topics.map((entry) => entry.topic_id)).toEqual(['topic-1', 'topic-2']);
    expect(value.items.map((entry) => entry.note_id)).toEqual(['note-1', 'note-2']);
  });

  it('applies topic.deleted events by removing active board data and adding trash', () => {
    const event: NotesEvent = {
      seq: 9,
      type: 'topic.deleted',
      entity_kind: 'topic',
      entity_id: 'topic-1',
      topic_id: 'topic-1',
      created_at_unix_ms: 9,
      payload: {
        topic: {
          ...topic(),
          deleted_at_unix_ms: 9,
        },
        trash_items: [
          trashItem({ note_id: 'note-1', deleted_at_unix_ms: 9 }),
          trashItem({ note_id: 'note-2', deleted_at_unix_ms: 10, color_token: 'graphite' }),
        ],
      },
    };

    const next = applyNotesEvent(snapshot(), event);

    expect(next.seq).toBe(9);
    expect(next.topics.map((entry) => entry.topic_id)).toEqual(['topic-2']);
    expect(next.items).toHaveLength(0);
    expect(next.trash_items.map((entry) => entry.note_id)).toEqual(['note-2', 'note-1']);
  });

  it('groups trash by topic in newest-first order', () => {
    const groups = groupTrashItems([
      trashItem({ note_id: 'a', topic_id: 'topic-1', deleted_at_unix_ms: 15 }),
      trashItem({ note_id: 'b', topic_id: 'topic-2', topic_name: 'Archive', topic_sort_order: 2, deleted_at_unix_ms: 20 }),
      trashItem({ note_id: 'c', topic_id: 'topic-1', deleted_at_unix_ms: 19 }),
    ]);

    expect(groups.map((entry) => entry.topic_id)).toEqual(['topic-2', 'topic-1']);
    expect(groups[1]?.items.map((entry) => entry.note_id)).toEqual(['c', 'a']);
  });

  it('expands board bounds to include large distant notes for minimap coverage', () => {
    const metrics = noteBucketMetrics(5);
    const bounds = computeBoardBounds([
      snapshot().items[0]!,
      {
        ...snapshot().items[1]!,
        note_id: 'far',
        x: 1800,
        y: -900,
        size_bucket: 5,
      },
    ]);

    expect(bounds.maxX).toBeGreaterThan(1800 + metrics.width);
    expect(bounds.minY).toBeLessThan(-900);
  });

  it('keeps the zoom anchor stable while changing scale', () => {
    const initial = { x: 220, y: 140, scale: 1 };
    const anchorScreen = { x: 320, y: 260 };
    const worldBefore = visibleWorldRect(initial, 640, 480);
    const next = zoomViewportAtPoint(initial, 1.5, anchorScreen.x, anchorScreen.y);
    const anchoredWorld = visibleWorldRect(next, 640, 480);

    expect(worldToScreen(next, {
      x: (anchorScreen.x - initial.x) / initial.scale,
      y: (anchorScreen.y - initial.y) / initial.scale,
    })).toEqual(anchorScreen);
    expect(anchoredWorld.maxX - anchoredWorld.minX).toBeLessThan(worldBefore.maxX - worldBefore.minX);
  });
});
