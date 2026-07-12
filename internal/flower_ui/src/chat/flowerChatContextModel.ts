import type { FlowerChatContextChip, FlowerChatContextDisplay, FlowerChatContextTone } from '../contracts/flowerChatContextTypes';
import {
  parseAskFlowerContextActionEnvelope,
  type PersistedContextActionItem,
} from '../contextActionWire';
import { basenameFromPath, compact, formatBytes, processLabel, processSnapshotText } from './contextItemUtils';

// -- per-kind chip builders --

function buildFilePathChip(item: Extract<PersistedContextActionItem, { kind: 'file_path' }>, index: number): FlowerChatContextChip {
  const label = basenameFromPath(item.path, 'file');
  const tone: FlowerChatContextTone = item.is_directory ? 'directory' : 'file';
  return {
    id: `ctx-${index}-${item.is_directory ? 'dir' : 'file'}`,
    kind: 'file_path',
    tone,
    label,
    detail: item.path,
    action: item.is_directory
      ? { type: 'open_directory_browser', path: item.path }
      : { type: 'open_file_preview', path: item.path },
  };
}

function buildFileSelectionChip(item: Extract<PersistedContextActionItem, { kind: 'file_selection' }>, index: number): FlowerChatContextChip {
  const label = basenameFromPath(item.path, 'file');
  return {
    id: `ctx-${index}-selection`,
    kind: 'file_selection',
    tone: 'selection',
    label: 'Selected content',
    detail: label,
    action: {
      type: 'open_text_preview',
      title: 'Selected content',
      subtitle: label,
      body: item.selection,
      source_path: item.path,
    },
  };
}

function buildTerminalSelectionChip(item: Extract<PersistedContextActionItem, { kind: 'terminal_selection' }>, index: number): FlowerChatContextChip {
  const selection = compact(item.selection);
  const workingDir = compact(item.working_dir) || 'Terminal';
  const metadataOnly = !selection && item.selection_chars > 0;
  return {
    id: `ctx-${index}-terminal`,
    kind: 'terminal_selection',
    tone: 'terminal',
    label: selection ? 'Selected output' : 'Terminal context',
    detail: metadataOnly
      ? `${workingDir} · ${item.selection_chars.toLocaleString()} characters · content not included`
      : `${workingDir}${selection ? '' : ' · no selection'}`,
    action: selection
      ? {
          type: 'open_text_preview',
          title: 'Terminal output',
          subtitle: compact(item.working_dir) || 'Terminal',
          body: item.selection,
          source_path: item.working_dir,
        }
      : null,
  };
}

function buildUnsupportedChip(item: Extract<PersistedContextActionItem, { kind: 'unsupported' }>, index: number): FlowerChatContextChip {
  return {
    id: `ctx-${index}-unsupported`,
    kind: item.original_kind,
    tone: 'snapshot',
    label: 'Unsupported linked context',
    detail: item.original_kind,
    action: null,
  };
}

function buildProcessSnapshotChip(item: Extract<PersistedContextActionItem, { kind: 'process_snapshot' }>, index: number): FlowerChatContextChip {
  const subtitle = `${compact(item.username) || 'system'} · ${Number(item.cpu_percent ?? 0).toFixed(1)}% CPU · ${formatBytes(Number(item.memory_bytes ?? 0))}`;
  return {
    id: `ctx-${index}-process`,
    kind: 'process_snapshot',
    tone: 'process',
    label: processLabel(item),
    detail: subtitle,
    action: {
      type: 'open_process_preview',
      title: 'Process snapshot',
      subtitle,
      body: processSnapshotText(item),
      pid: Math.trunc(Number(item.pid ?? 0)),
    },
  };
}

function buildTextSnapshotChip(item: Extract<PersistedContextActionItem, { kind: 'text_snapshot' }>, index: number): FlowerChatContextChip {
  const label = compact(item.title) || 'Snapshot';
  const detail = compact(item.detail) || '';
  return {
    id: `ctx-${index}-snapshot`,
    kind: 'text_snapshot',
    tone: 'snapshot',
    label,
    detail,
    action: {
      type: 'open_text_preview',
      title: label,
      subtitle: detail,
      body: item.content,
    },
  };
}

function buildChip(item: PersistedContextActionItem, index: number): FlowerChatContextChip {
  switch (item.kind) {
    case 'file_path': return buildFilePathChip(item, index);
    case 'file_selection': return buildFileSelectionChip(item, index);
    case 'terminal_selection': return buildTerminalSelectionChip(item, index);
    case 'process_snapshot': return buildProcessSnapshotChip(item, index);
    case 'text_snapshot': return buildTextSnapshotChip(item, index);
    case 'unsupported': return buildUnsupportedChip(item, index);
  }
}

// -- extensibility: runtime builder registration --

type ContextChipBuilderFn = (item: Record<string, unknown>, index: number) => FlowerChatContextChip | null;

const customBuilders = new Map<string, ContextChipBuilderFn>();

export function registerChatContextChipBuilder(kind: string, builder: ContextChipBuilderFn): void {
  customBuilders.set(kind, builder);
}

// -- main parse function --

export function parseChatContextAction(rawAction: unknown): FlowerChatContextDisplay | null {
  try {
    const action = parseAskFlowerContextActionEnvelope(rawAction, 'persisted-display');
    if (!action) return null;

    const chips: FlowerChatContextChip[] = [];
    for (let i = 0; i < action.context.length; i++) {
      const item = action.context[i]!;
      if (item.kind !== 'unsupported') {
        chips.push(buildChip(item, i));
        continue;
      }
      const rawItem = Array.isArray((rawAction as { context?: unknown }).context)
        ? (rawAction as { context: unknown[] }).context[i]
        : null;
      const customBuilder = customBuilders.get(item.original_kind);
      const customChip = customBuilder && rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)
        ? customBuilder(rawItem as Record<string, unknown>, i)
        : null;
      chips.push(customChip ?? buildUnsupportedChip(item, i));
    }

    if (chips.length === 0) return null;

    return { surface: action.source.surface, target: action.target.target_id, chips };
  } catch {
    return null;
  }
}
