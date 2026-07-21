import type { FlowerChatContextChip, FlowerChatContextDisplay, FlowerChatContextTone } from '../contracts/flowerChatContextTypes';
import type { FlowerMessageReference } from '../contracts/flowerSurfaceContracts';
import {
  parseAskFlowerContextActionEnvelope,
  type ContextActionContextItem,
} from '../contextActionWire';
import { basenameFromPath, compact, formatBytes, processLabel, processSnapshotText } from './contextItemUtils';

const REFERENCE_DETAIL_CODE_POINTS = 96;

function referenceTone(kind: FlowerMessageReference['kind']): FlowerChatContextTone {
  switch (kind) {
    case 'text': return 'selection';
    case 'file': return 'file';
    case 'directory': return 'directory';
    case 'terminal': return 'terminal';
    case 'process': return 'process';
  }
}

function referenceTextPreview(text: string): string {
  const compacted = compact(text);
  const codePoints = Array.from(compacted);
  return codePoints.length <= REFERENCE_DETAIL_CODE_POINTS
    ? compacted
    : `${codePoints.slice(0, REFERENCE_DETAIL_CODE_POINTS).join('')}...`;
}

function buildCanonicalReferenceChip(
  reference: FlowerMessageReference,
  index: number,
): FlowerChatContextChip {
  const visibleText = 'text' in reference ? reference.text : undefined;
  const preview = visibleText
    ? referenceTextPreview(visibleText)
    : '';
  return {
    id: reference.reference_id,
    kind: reference.kind,
    tone: referenceTone(reference.kind),
    label: reference.label,
    detail: preview,
    truncated: reference.truncated,
    action: reference.kind === 'file' || reference.kind === 'directory'
      ? {
          type: 'open_canonical_reference',
          reference_id: reference.reference_id,
        }
      : visibleText
        ? {
          type: 'open_text_preview',
          title: reference.label,
          subtitle: '',
          body: visibleText,
          context_index: index,
          truncated: reference.truncated,
        }
        : null,
  };
}

export function parseChatMessageReferences(
  references: readonly FlowerMessageReference[] | undefined,
): FlowerChatContextDisplay | null {
  if (!references || references.length === 0) return null;
  return {
    authority: 'canonical_references',
    chips: references.map((reference, index) => buildCanonicalReferenceChip(reference, index)),
  };
}

// -- per-kind chip builders --

function buildFilePathChip(item: Extract<ContextActionContextItem, { kind: 'file_path' }>, index: number): FlowerChatContextChip {
  const label = basenameFromPath(item.path, 'file');
  const tone: FlowerChatContextTone = item.is_directory ? 'directory' : 'file';
  return {
    id: `ctx-${index}-${item.is_directory ? 'dir' : 'file'}`,
    kind: 'file_path',
    tone,
    label,
    detail: item.path,
    action: item.is_directory
      ? { type: 'open_linked_directory_browser', path: item.path, context_index: index }
      : { type: 'open_linked_file_preview', path: item.path, context_index: index },
  };
}

function buildTerminalSelectionChip(item: Extract<ContextActionContextItem, { kind: 'terminal_selection' }>, index: number): FlowerChatContextChip {
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
          context_index: index,
          source_path: item.working_dir,
        }
      : null,
  };
}

function buildProcessSnapshotChip(item: Extract<ContextActionContextItem, { kind: 'process_snapshot' }>, index: number): FlowerChatContextChip {
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
      context_index: index,
    },
  };
}

function buildTextSnapshotChip(item: Extract<ContextActionContextItem, { kind: 'text_snapshot' }>, index: number): FlowerChatContextChip {
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
      context_index: index,
    },
  };
}

function buildChip(item: ContextActionContextItem, index: number): FlowerChatContextChip {
  switch (item.kind) {
    case 'file_path': return buildFilePathChip(item, index);
    case 'terminal_selection': return buildTerminalSelectionChip(item, index);
    case 'process_snapshot': return buildProcessSnapshotChip(item, index);
    case 'text_snapshot': return buildTextSnapshotChip(item, index);
  }
}

// -- main parse function --

export function parseChatContextAction(rawAction: unknown): FlowerChatContextDisplay | null {
  try {
    const action = parseAskFlowerContextActionEnvelope(rawAction);
    if (!action) return null;
    const chips = action.context.map((item, index) => buildChip(item, index));

    if (chips.length === 0) return null;

    return {
      authority: 'queued_context_action',
      surface: action.source.surface,
      target: action.target.target_id,
      chips,
    };
  } catch {
    return null;
  }
}
