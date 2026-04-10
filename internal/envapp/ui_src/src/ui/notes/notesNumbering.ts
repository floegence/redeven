import type { NotesItem, NotesSnapshot } from './notesModel';

export interface NumberedNote {
  readonly note: NotesItem;
  readonly index: number;
  readonly label: string;
}

export type NoteDigitSequenceResolution =
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'pending'; exactMatch: NumberedNote | null }>
  | Readonly<{ kind: 'ready'; match: NumberedNote }>;

export function sortNotesForNumbering(notes: readonly NotesItem[]): NotesItem[] {
  return [...notes].sort((left, right) =>
    left.created_at_unix_ms !== right.created_at_unix_ms
      ? left.created_at_unix_ms - right.created_at_unix_ms
      : left.note_id.localeCompare(right.note_id),
  );
}

export function numberNotesInTopic(
  snapshot: Pick<NotesSnapshot, 'items'>,
  topicID: string,
): NumberedNote[] {
  return sortNotesForNumbering(snapshot.items.filter((item) => item.topic_id === topicID)).map(
    (note, index) => ({
      note,
      index: index + 1,
      label: String(index + 1),
    }),
  );
}

export function normalizeNoteCopyText(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

export function resolveNoteDigitSequence(
  sequence: string,
  numberedNotes: readonly NumberedNote[],
): NoteDigitSequenceResolution {
  const normalized = String(sequence ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return { kind: 'invalid' };
  }

  const exactMatch = numberedNotes.find((entry) => entry.label === normalized) ?? null;
  const hasLongerPrefix = numberedNotes.some(
    (entry) => entry.label.startsWith(normalized) && entry.label !== normalized,
  );

  if (exactMatch && !hasLongerPrefix) {
    return { kind: 'ready', match: exactMatch };
  }

  if (exactMatch || hasLongerPrefix) {
    return { kind: 'pending', exactMatch };
  }

  return { kind: 'invalid' };
}
