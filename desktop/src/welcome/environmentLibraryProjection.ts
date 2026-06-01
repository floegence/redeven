import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { GatewayRowModel } from './viewModel';
import { buildGatewayRowModel } from './viewModel';

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

export type GatewayLibraryRowRecord = Readonly<Record<string, GatewayRowModel>>;

export type GatewayLibraryRowGroups = Readonly<{
  ready_row_ids: readonly string[];
  attention_row_ids: readonly string[];
}>;

export function gatewayLibraryRows(
  entries: readonly DesktopEnvironmentEntry[],
): readonly GatewayRowModel[] {
  return entries
    .filter((entry) => entry.kind === 'gateway_environment')
    .map(buildGatewayRowModel);
}

export function gatewayLibraryRowRecord(
  rows: readonly GatewayRowModel[],
): GatewayLibraryRowRecord {
  const record: Record<string, GatewayRowModel> = {};
  for (const row of rows) {
    record[row.id] = row;
  }
  return record;
}

export function splitGatewayRowIDsByAttention(
  rowIDs: readonly string[],
  rowsByID: Readonly<Record<string, GatewayRowModel | undefined>>,
): GatewayLibraryRowGroups {
  const readyRowIDs: string[] = [];
  const attentionRowIDs: string[] = [];
  for (const rowID of rowIDs) {
    const row = rowsByID[rowID];
    if (!row) {
      continue;
    }
    if (row.status_tone === 'warning') {
      attentionRowIDs.push(rowID);
      continue;
    }
    readyRowIDs.push(rowID);
  }
  return {
    ready_row_ids: readyRowIDs,
    attention_row_ids: attentionRowIDs,
  };
}
