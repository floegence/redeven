import type {
  FlowerTurnLauncherContextItem,
  FlowerTurnLauncherIntent,
} from '../../../../../flower_ui/src';
import {
  CONTEXT_ACTION_SCHEMA_VERSION,
  createCurrentRuntimeTarget,
  type ContextActionContextItem,
  type ContextActionEnvelope,
  type ContextActionExecutionContext,
  type ContextActionSurface,
  type ContextActionTarget,
} from './protocol';

export type EnvFlowerTurnLauncherContextItem = Exclude<
  FlowerTurnLauncherContextItem,
  Readonly<{ kind: 'environment' }> | Readonly<{ kind: 'attachment' }>
>;

export type EnvFlowerTurnLauncherIntent = Omit<FlowerTurnLauncherIntent, 'context_items' | 'source_surface'> & Readonly<{
  source_surface: ContextActionSurface;
  context_items: readonly EnvFlowerTurnLauncherContextItem[];
}>;

function toContextActionItem(item: EnvFlowerTurnLauncherContextItem): ContextActionContextItem {
  if (item.kind === 'file_path') {
    return {
      kind: 'file_path',
      path: item.path,
      is_directory: item.is_directory,
      root_label: item.root_label,
    };
  }
  if (item.kind === 'file_selection') {
    return {
      kind: 'file_selection',
      path: item.path,
      selection: item.selection,
      selection_chars: item.selection_chars,
    };
  }
  if (item.kind === 'terminal_selection') {
    return {
      kind: 'terminal_selection',
      working_dir: item.working_dir,
      selection: item.selection,
      selection_chars: item.selection_chars,
    };
  }
  if (item.kind === 'process_snapshot') {
    return {
      kind: 'process_snapshot',
      pid: item.pid,
      name: item.name,
      username: item.username,
      cpu_percent: item.cpu_percent,
      memory_bytes: item.memory_bytes,
      platform: item.platform,
      captured_at_ms: item.captured_at_ms,
    };
  }
  if (item.kind === 'text_snapshot') {
    return {
      kind: 'text_snapshot',
      title: item.title,
      detail: item.detail,
      content: item.content,
    };
  }
  const exhaustive: never = item;
  return exhaustive;
}
export function buildAskFlowerContextAction(params: {
  source: ContextActionSurface;
  context_items: readonly EnvFlowerTurnLauncherContextItem[];
  suggested_working_dir?: string;
  target?: ContextActionTarget;
  surfaceId?: string;
  executionContext?: ContextActionExecutionContext;
}): ContextActionEnvelope {
  return {
    schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
    action_id: 'assistant.ask.flower',
    provider: 'flower',
    target: params.target ?? createCurrentRuntimeTarget('auto'),
    source: {
      surface: params.source,
      surface_id: params.surfaceId,
    },
    execution_context: params.executionContext,
    context: params.context_items.map((item) => toContextActionItem(item)),
    presentation: {
      label: 'Ask Flower',
      priority: 100,
    },
    suggested_working_dir_abs: params.suggested_working_dir,
  };
}

export function attachAskFlowerContextAction<T extends EnvFlowerTurnLauncherIntent>(intent: T, surfaceId?: string): T {
  return {
    ...intent,
    context_action: buildAskFlowerContextAction({
      source: intent.source_surface,
      context_items: intent.context_items,
      suggested_working_dir: intent.suggested_working_dir,
      surfaceId,
    }),
  } as T;
}
