import type { AskFlowerContextItem, AskFlowerIntent, AskFlowerIntentSource } from '../pages/askFlowerIntent';
import {
  CONTEXT_ACTION_SCHEMA_VERSION,
  createCurrentRuntimeTarget,
  type ContextActionContextItem,
  type ContextActionEnvelope,
} from './protocol';

function toContextActionItem(item: AskFlowerContextItem): ContextActionContextItem {
  if (item.kind === 'file_path') {
    return {
      kind: 'file_path',
      path: item.path,
      is_directory: item.isDirectory,
    };
  }
  if (item.kind === 'file_selection') {
    return {
      kind: 'file_selection',
      path: item.path,
      selection: item.selection,
      selection_chars: item.selectionChars,
    };
  }
  if (item.kind === 'terminal_selection') {
    return {
      kind: 'terminal_selection',
      working_dir: item.workingDir,
      selection: item.selection,
      selection_chars: item.selectionChars,
    };
  }
  if (item.kind === 'process_snapshot') {
    return {
      kind: 'process_snapshot',
      pid: item.pid,
      name: item.name,
      username: item.username,
      cpu_percent: item.cpuPercent,
      memory_bytes: item.memoryBytes,
      platform: item.platform,
      captured_at_ms: item.capturedAtMs,
    };
  }
  return {
    kind: 'text_snapshot',
    title: item.title,
    detail: item.detail,
    content: item.content,
  };
}
export function buildAskFlowerContextAction(params: {
  source: AskFlowerIntentSource;
  contextItems: AskFlowerContextItem[];
  suggestedWorkingDirAbs?: string;
  surfaceId?: string;
}): ContextActionEnvelope {
  return {
    schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
    action_id: 'assistant.ask.flower',
    provider: 'flower',
    target: createCurrentRuntimeTarget('auto'),
    source: {
      surface: params.source,
      surface_id: params.surfaceId,
    },
    context: params.contextItems.map((item) => toContextActionItem(item)),
    presentation: {
      label: 'Ask Flower',
      priority: 100,
    },
    suggested_working_dir_abs: params.suggestedWorkingDirAbs,
  };
}

export function attachAskFlowerContextAction(intent: AskFlowerIntent, surfaceId?: string): AskFlowerIntent {
  return {
    ...intent,
    contextAction: buildAskFlowerContextAction({
      source: intent.source,
      contextItems: intent.contextItems,
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
      surfaceId,
    }),
  };
}
