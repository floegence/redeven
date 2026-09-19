import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { buildGatewayRowModel, type GatewayRowModel } from './viewModel';

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
