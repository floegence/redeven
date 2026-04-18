import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type EnvironmentLibraryEntryRecord = Readonly<Record<string, DesktopEnvironmentEntry>>;

export type EnvironmentLibraryEntryGroups = Readonly<{
  pinned_entry_ids: readonly string[];
  regular_entry_ids: readonly string[];
}>;

export function environmentLibraryEntryRecord(
  entries: readonly DesktopEnvironmentEntry[],
): EnvironmentLibraryEntryRecord {
  const record: Record<string, DesktopEnvironmentEntry> = {};
  for (const entry of entries) {
    record[entry.id] = entry;
  }
  return record;
}

export function splitPinnedEnvironmentEntryIDs(
  entryIDs: readonly string[],
  entriesByID: Readonly<Record<string, DesktopEnvironmentEntry | undefined>>,
): EnvironmentLibraryEntryGroups {
  const pinnedEntryIDs: string[] = [];
  const regularEntryIDs: string[] = [];

  for (const entryID of entryIDs) {
    const entry = entriesByID[entryID];
    if (!entry) {
      continue;
    }
    if (entry.pinned) {
      pinnedEntryIDs.push(entryID);
      continue;
    }
    regularEntryIDs.push(entryID);
  }

  return {
    pinned_entry_ids: pinnedEntryIDs,
    regular_entry_ids: regularEntryIDs,
  };
}
