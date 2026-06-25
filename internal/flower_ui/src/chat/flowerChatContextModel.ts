import type { FlowerChatContextChip, FlowerChatContextDisplay, FlowerChatContextTone } from '../contracts/flowerChatContextTypes';
import { basenameFromPath, compact, formatBytes, processLabel, processSnapshotText } from './contextItemUtils';

// -- validation helpers (moved from FlowerSurface.tsx) --

function trimString(value: string): string {
  return value.trim();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? trimString(value) : '';
}

type OptionalRecordString = Readonly<{ ok: boolean; value: string }>;

function optionalRecordString(record: Record<string, unknown> | null | undefined, key: string): OptionalRecordString {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) return { ok: true, value: '' };
  const value = record[key];
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, value: '' };
  return { ok: true, value: trimString(value) };
}

function recordNumber(record: Record<string, unknown> | null | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// -- validation constant sets (moved from FlowerSurface.tsx) --

const ASK_FLOWER_CONTEXT_TARGET_LOCALITIES = new Set(['auto', 'current_runtime', 'remote_runtime', 'local_model_remote_target']);
const ASK_FLOWER_CONTEXT_SOURCE_SURFACES = new Set([
  'desktop_welcome_environment_card',
  'file_browser',
  'terminal',
  'file_preview',
  'monitoring',
  'git_browser',
  'editor_preview',
]);
const ASK_FLOWER_CONTEXT_RUNTIME_HINTS = new Set(['', 'auto', 'local_environment', 'env_local']);
const ASK_FLOWER_CONTEXT_SESSION_SOURCES = new Set([
  '',
  'local_runtime',
  'provider_environment',
  'ssh_environment',
  'external_local_ui',
  'runtime_gateway',
  'region_sandbox',
]);

// -- context item input types (discriminated union) --

type FilePathInput = Readonly<{ kind: 'file_path'; path: string; is_directory: boolean; root_label?: string }>;
type FileSelectionInput = Readonly<{ kind: 'file_selection'; path: string; selection: string; selection_chars: number }>;
type TerminalSelectionInput = Readonly<{ kind: 'terminal_selection'; working_dir: string; selection: string; selection_chars: number }>;
type ProcessSnapshotInput = Readonly<{ kind: 'process_snapshot'; pid: number; name: string; username: string; cpu_percent: number; memory_bytes: number; platform?: string; captured_at_ms?: number }>;
type TextSnapshotInput = Readonly<{ kind: 'text_snapshot'; title: string; detail?: string; content: string }>;

type ContextItemInput = FilePathInput | FileSelectionInput | TerminalSelectionInput | ProcessSnapshotInput | TextSnapshotInput;

// -- type guard for each kind --

function isContextItemInput(raw: Record<string, unknown>): ContextItemInput | null {
  const kind = raw.kind;
  switch (kind) {
    case 'file_path': return isFilePathInput(raw) ? raw : null;
    case 'file_selection': return isFileSelectionInput(raw) ? raw : null;
    case 'terminal_selection': return isTerminalSelectionInput(raw) ? raw : null;
    case 'process_snapshot': return isProcessSnapshotInput(raw) ? raw : null;
    case 'text_snapshot': return isTextSnapshotInput(raw) ? raw : null;
    default: return null;
  }
}

function isFilePathInput(raw: Record<string, unknown>): raw is FilePathInput {
  return typeof raw.path === 'string'
    && typeof raw.is_directory === 'boolean';
}

function isFileSelectionInput(raw: Record<string, unknown>): raw is FileSelectionInput {
  return typeof raw.path === 'string'
    && typeof raw.selection === 'string'
    && typeof raw.selection_chars === 'number';
}

function isTerminalSelectionInput(raw: Record<string, unknown>): raw is TerminalSelectionInput {
  return typeof raw.working_dir === 'string'
    && typeof raw.selection === 'string'
    && typeof raw.selection_chars === 'number';
}

function isProcessSnapshotInput(raw: Record<string, unknown>): raw is ProcessSnapshotInput {
  return typeof raw.pid === 'number'
    && typeof raw.name === 'string'
    && typeof raw.username === 'string'
    && typeof raw.cpu_percent === 'number'
    && typeof raw.memory_bytes === 'number';
}

function isTextSnapshotInput(raw: Record<string, unknown>): raw is TextSnapshotInput {
  return typeof raw.title === 'string'
    && typeof raw.content === 'string';
}

// -- per-kind chip builders --

function buildFilePathChip(item: FilePathInput, index: number): FlowerChatContextChip {
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

function buildFileSelectionChip(item: FileSelectionInput, index: number): FlowerChatContextChip {
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

function buildTerminalSelectionChip(item: TerminalSelectionInput, index: number): FlowerChatContextChip {
  const selection = compact(item.selection);
  return {
    id: `ctx-${index}-terminal`,
    kind: 'terminal_selection',
    tone: 'terminal',
    label: selection ? 'Selected output' : 'Terminal',
    detail: compact(item.working_dir) || 'Terminal',
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

function buildProcessSnapshotChip(item: ProcessSnapshotInput, index: number): FlowerChatContextChip {
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

function buildTextSnapshotChip(item: TextSnapshotInput, index: number): FlowerChatContextChip {
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

function buildChip(item: ContextItemInput, index: number): FlowerChatContextChip {
  switch (item.kind) {
    case 'file_path': return buildFilePathChip(item, index);
    case 'file_selection': return buildFileSelectionChip(item, index);
    case 'terminal_selection': return buildTerminalSelectionChip(item, index);
    case 'process_snapshot': return buildProcessSnapshotChip(item, index);
    case 'text_snapshot': return buildTextSnapshotChip(item, index);
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
    const action = recordValue(rawAction);
    if (!action) return null;

    if (
      recordNumber(action, 'schema_version') !== 2
      || recordString(action, 'action_id') !== 'assistant.ask.flower'
      || recordString(action, 'provider') !== 'flower'
    ) {
      return null;
    }

    const source = recordValue(action.source);
    const target = recordValue(action.target);
    const rawExecutionContext = action.execution_context;

    if (rawExecutionContext !== null && rawExecutionContext !== undefined && !recordValue(rawExecutionContext)) {
      return null;
    }

    const rawContext = action.context;
    if (rawContext !== null && rawContext !== undefined && !Array.isArray(rawContext)) {
      return null;
    }

    const executionContext = recordValue(rawExecutionContext);
    const surface = recordString(source, 'surface');
    const targetID = recordString(target, 'target_id');
    const locality = recordString(target, 'locality');
    const runtimeHint = optionalRecordString(executionContext, 'runtime_hint');
    const sessionSource = optionalRecordString(executionContext, 'session_source');

    if (!targetID || !runtimeHint.ok || !sessionSource.ok) {
      return null;
    }

    if (
      !ASK_FLOWER_CONTEXT_TARGET_LOCALITIES.has(locality)
      || !ASK_FLOWER_CONTEXT_SOURCE_SURFACES.has(surface)
      || !ASK_FLOWER_CONTEXT_RUNTIME_HINTS.has(runtimeHint.value)
      || !ASK_FLOWER_CONTEXT_SESSION_SOURCES.has(sessionSource.value)
    ) {
      return null;
    }

    const contextItems = Array.isArray(rawContext) ? rawContext.map(recordValue) : [];
    if (contextItems.some((item) => item == null)) {
      return null;
    }

    const chips: FlowerChatContextChip[] = [];

    for (let i = 0; i < contextItems.length; i++) {
      const rawItem = contextItems[i]!;
      const typed = isContextItemInput(rawItem);

      if (typed) {
        chips.push(buildChip(typed, i));
      } else {
        const customBuilder = customBuilders.get(String(rawItem.kind ?? ''));
        if (customBuilder) {
          const chip = customBuilder(rawItem, i);
          if (chip) chips.push(chip);
        }
        // Unknown kinds are silently skipped
      }
    }

    if (chips.length === 0) return null;

    return { surface, target: targetID, chips };
  } catch {
    return null;
  }
}
