import { fetchGatewayJSON, prepareGatewayRequestInit } from './gatewayApi';
import type { NoteColorToken, NotesEvent, NotesItem, NotesSnapshot, NotesTopic } from '../notes/notesModel';

export type CreateTopicInput = Readonly<{
  name: string;
}>;

export type UpdateTopicInput = Readonly<{
  name: string;
}>;

export type CreateNoteInput = Readonly<{
  topic_id: string;
  headline?: string;
  title?: string;
  body: string;
  color_token?: NoteColorToken;
  x: number;
  y: number;
}>;

export type UpdateNoteInput = Readonly<{
  headline?: string;
  title?: string;
  body?: string;
  color_token?: NoteColorToken;
  x?: number;
  y?: number;
}>;

type TopicResponse = Readonly<{
  topic: NotesTopic;
}>;

type ItemResponse = Readonly<{
  item: NotesItem;
}>;

export async function getNotesSnapshot(): Promise<NotesSnapshot> {
  return fetchGatewayJSON<NotesSnapshot>('/_redeven_proxy/api/notes/snapshot', { method: 'GET' });
}

export async function createNotesTopic(input: CreateTopicInput): Promise<NotesTopic> {
  const out = await fetchGatewayJSON<TopicResponse>('/_redeven_proxy/api/notes/topics', {
    method: 'POST',
    body: JSON.stringify({ name: String(input.name ?? '') }),
  });
  return out.topic;
}

export async function updateNotesTopic(topicID: string, input: UpdateTopicInput): Promise<NotesTopic> {
  const out = await fetchGatewayJSON<TopicResponse>(`/_redeven_proxy/api/notes/topics/${encodeURIComponent(String(topicID ?? '').trim())}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: String(input.name ?? '') }),
  });
  return out.topic;
}

export async function deleteNotesTopic(topicID: string): Promise<void> {
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/notes/topics/${encodeURIComponent(String(topicID ?? '').trim())}`, {
    method: 'DELETE',
  });
}

export async function createNotesItem(input: CreateNoteInput): Promise<NotesItem> {
  const out = await fetchGatewayJSON<ItemResponse>('/_redeven_proxy/api/notes/items', {
    method: 'POST',
    body: JSON.stringify({
      topic_id: String(input.topic_id ?? '').trim(),
      headline: input.headline,
      title: input.title,
      body: String(input.body ?? ''),
      color_token: input.color_token,
      x: input.x,
      y: input.y,
    }),
  });
  return out.item;
}

export async function updateNotesItem(noteID: string, input: UpdateNoteInput): Promise<NotesItem> {
  const out = await fetchGatewayJSON<ItemResponse>(`/_redeven_proxy/api/notes/items/${encodeURIComponent(String(noteID ?? '').trim())}`, {
    method: 'PATCH',
    body: JSON.stringify({
      headline: input.headline,
      title: input.title,
      body: input.body,
      color_token: input.color_token,
      x: input.x,
      y: input.y,
    }),
  });
  return out.item;
}

export async function bringNotesItemToFront(noteID: string): Promise<NotesItem> {
  const out = await fetchGatewayJSON<ItemResponse>(`/_redeven_proxy/api/notes/items/${encodeURIComponent(String(noteID ?? '').trim())}/front`, {
    method: 'POST',
  });
  return out.item;
}

export async function deleteNotesItem(noteID: string): Promise<void> {
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/notes/items/${encodeURIComponent(String(noteID ?? '').trim())}`, {
    method: 'DELETE',
  });
}

export async function restoreNotesItem(noteID: string): Promise<NotesItem> {
  const out = await fetchGatewayJSON<ItemResponse>(`/_redeven_proxy/api/notes/items/${encodeURIComponent(String(noteID ?? '').trim())}/restore`, {
    method: 'POST',
  });
  return out.item;
}

export async function clearNotesTrashTopic(topicID: string): Promise<void> {
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/notes/trash/topics/${encodeURIComponent(String(topicID ?? '').trim())}`, {
    method: 'DELETE',
  });
}

export async function deleteNotesTrashItemPermanently(noteID: string): Promise<void> {
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/notes/trash/items/${encodeURIComponent(String(noteID ?? '').trim())}`, {
    method: 'DELETE',
  });
}

export async function connectNotesEventStream(args: {
  afterSeq?: number;
  signal: AbortSignal;
  onEvent: (event: NotesEvent) => void;
}): Promise<void> {
  const response = await fetch(
    `/_redeven_proxy/api/notes/events?after_seq=${encodeURIComponent(String(args.afterSeq ?? 0))}`,
    await prepareGatewayRequestInit({
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: args.signal,
    }),
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Notes event stream unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    args.onEvent(JSON.parse(payload) as NotesEvent);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        flushBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const finalBlock = buffer.trim();
    if (finalBlock) flushBlock(finalBlock);
  } finally {
    reader.releaseLock();
  }
}
