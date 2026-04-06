import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import {
  applyNotesEvent,
  createDefaultNotesSnapshot,
  normalizeNotesSnapshot,
  promoteLocalItem,
  removeSnapshotItem,
  removeSnapshotTrashItem,
  replaceSnapshotItem,
  replaceSnapshotTopic,
  replaceSnapshotTrashItem,
  type NotesConnectionState,
  type NotesController,
  type NotesEvent,
  type NotesItem,
  type NotesSnapshot,
  type NotesTopic,
  type NotesTrashItem,
  type NotesViewport,
} from '@floegence/floe-webapp-core/notes';
import {
  bringNotesItemToFront,
  clearNotesTrashTopic,
  connectNotesEventStream,
  createNotesItem,
  createNotesTopic,
  deleteNotesItem,
  deleteNotesTrashItemPermanently,
  deleteNotesTopic,
  getNotesSnapshot,
  restoreNotesItem,
  updateNotesItem,
  updateNotesTopic,
} from '../services/notesApi';

const DEFAULT_VIEWPORT: NotesViewport = { x: 240, y: 120, scale: 1 };

function resolveActiveTopicID(
  snapshot: NotesSnapshot,
  currentTopicID: string,
  preferredTopicID?: string,
): string {
  const candidate = preferredTopicID || currentTopicID;
  if (candidate && snapshot.topics.some((topic) => topic.topic_id === candidate)) {
    return candidate;
  }
  return snapshot.topics[0]?.topic_id ?? '';
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

export function useRedevenNotesController(open: Accessor<boolean>): NotesController {
  const notify = useNotification();
  const [snapshot, setSnapshotSignal] = createSignal<NotesSnapshot>(createDefaultNotesSnapshot());
  const [activeTopicID, setActiveTopicIDSignal] = createSignal('');
  const [viewport, setViewportSignal] = createSignal<NotesViewport>(DEFAULT_VIEWPORT);
  const [loading, setLoadingSignal] = createSignal(false);
  const [connectionState, setConnectionStateSignal] = createSignal<NotesConnectionState>('idle');

  function commitSnapshot(
    nextSnapshot: NotesSnapshot,
    options?: {
      preserveActiveTopic?: boolean;
      preferredTopicID?: string;
    },
  ): NotesSnapshot {
    const normalized = normalizeNotesSnapshot(nextSnapshot);
    const nextTopicID = resolveActiveTopicID(
      normalized,
      options?.preserveActiveTopic ? activeTopicID() : '',
      options?.preferredTopicID,
    );
    setSnapshotSignal(normalized);
    setActiveTopicIDSignal(nextTopicID);
    return normalized;
  }

  function applyRuntimeEvent(event: NotesEvent): void {
    commitSnapshot(applyNotesEvent(snapshot(), event), { preserveActiveTopic: true });
  }

  async function refreshSnapshot(options?: {
    preserveActiveTopic?: boolean;
    preferredTopicID?: string;
  }): Promise<NotesSnapshot> {
    const nextSnapshot = await getNotesSnapshot();
    return commitSnapshot(nextSnapshot, options);
  }

  async function startNotesStream(signal: AbortSignal): Promise<void> {
    let connectedOnce = false;

    while (!signal.aborted) {
      try {
        if (connectedOnce) {
          setConnectionStateSignal('reconnecting');
        }
        await connectNotesEventStream({
          afterSeq: snapshot().seq,
          signal,
          onEvent: (event) => {
            setConnectionStateSignal('live');
            applyRuntimeEvent(event);
          },
        });
        if (signal.aborted) return;
        connectedOnce = true;
      } catch {
        if (signal.aborted) return;
        connectedOnce = true;
        setConnectionStateSignal('reconnecting');
      }

      await new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(resolve, 900);
        signal.addEventListener(
          'abort',
          () => {
            globalThis.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  async function loadNotes(signal: AbortSignal): Promise<void> {
    setLoadingSignal(true);
    try {
      await refreshSnapshot({ preserveActiveTopic: true });
      if (signal.aborted) return;
      setLoadingSignal(false);
      setConnectionStateSignal('live');
      void startNotesStream(signal);
    } catch (error) {
      if (!signal.aborted) {
        setLoadingSignal(false);
        setConnectionStateSignal('idle');
        notify.error('Notes unavailable', error instanceof Error ? error.message : String(error));
      }
    }
  }

  createEffect(() => {
    if (!open()) {
      setLoadingSignal(false);
      setConnectionStateSignal('idle');
      return;
    }

    const abortController = new AbortController();
    void loadNotes(abortController.signal);

    onCleanup(() => {
      abortController.abort();
      setConnectionStateSignal('idle');
    });
  });

  return {
    snapshot,
    activeTopicID,
    setActiveTopicID: (topicID) => {
      setActiveTopicIDSignal((current) =>
        snapshot().topics.some((topic) => topic.topic_id === topicID) ? topicID : current,
      );
    },
    viewport,
    setViewport: (nextViewport) => setViewportSignal(nextViewport),
    loading,
    connectionState,
    createTopic: async (input) => {
      const topic = await createNotesTopic(input);
      commitSnapshot(replaceSnapshotTopic(snapshot(), topic), {
        preserveActiveTopic: true,
        preferredTopicID: topic.topic_id,
      });
      return topic;
    },
    updateTopic: async (topicID, input) => {
      const topic = await updateNotesTopic(topicID, input);
      commitSnapshot(replaceSnapshotTopic(snapshot(), topic), { preserveActiveTopic: true });
      return topic;
    },
    deleteTopic: async (topicID) => {
      await deleteNotesTopic(topicID);
      await refreshSnapshot({ preserveActiveTopic: false });
    },
    createNote: async (input) => {
      const item = await createNotesItem(input);
      commitSnapshot(replaceSnapshotItem(snapshot(), item), { preserveActiveTopic: true });
      return item;
    },
    updateNote: async (noteID, input) => {
      const item = await updateNotesItem(noteID, input);
      commitSnapshot(replaceSnapshotItem(snapshot(), item), { preserveActiveTopic: true });
      return item;
    },
    bringNoteToFront: async (noteID) => {
      commitSnapshot(promoteLocalItem(snapshot(), noteID), { preserveActiveTopic: true });
      try {
        const item = await bringNotesItemToFront(noteID);
        commitSnapshot(replaceSnapshotItem(snapshot(), item), { preserveActiveTopic: true });
        return item;
      } catch (error) {
        await refreshSnapshot({ preserveActiveTopic: true });
        throw error;
      }
    },
    deleteNote: async (noteID) => {
      const currentSnapshot = snapshot();
      const note = currentSnapshot.items.find((item) => item.note_id === noteID);
      const topic = currentSnapshot.topics.find((item) => item.topic_id === note?.topic_id);
      if (note) {
        commitSnapshot(
          replaceSnapshotTrashItem(
            removeSnapshotItem(currentSnapshot, noteID),
            noteTrashProjection(note, topic),
          ),
          { preserveActiveTopic: true },
        );
      }
      try {
        await deleteNotesItem(noteID);
      } catch (error) {
        await refreshSnapshot({ preserveActiveTopic: true });
        throw error;
      }
    },
    restoreNote: async (noteID) => {
      const item = await restoreNotesItem(noteID);
      await refreshSnapshot({
        preserveActiveTopic: true,
        preferredTopicID: item.topic_id,
      });
      return item;
    },
    clearTrashTopic: async (topicID) => {
      await clearNotesTrashTopic(topicID);
      await refreshSnapshot({ preserveActiveTopic: true });
    },
    deleteTrashedNotePermanently: async (noteID) => {
      commitSnapshot(removeSnapshotTrashItem(snapshot(), noteID), { preserveActiveTopic: true });
      try {
        await deleteNotesTrashItemPermanently(noteID);
      } catch (error) {
        await refreshSnapshot({ preserveActiveTopic: true });
        throw error;
      }
    },
  };
}
