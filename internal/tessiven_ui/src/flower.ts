import { secureRandomUUID } from '@floegence/floe-webapp-core';
import {
  CONTEXT_ACTION_SCHEMA_VERSION,
  type ContextActionEnvelope,
} from '../../flower_ui/src/contextActionWire';
import type { FlowerTurnLauncherIntent } from '../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { Selection, TessivenText } from './types';

export function tessivenFlowerIntent(
  selection: Selection | null,
  t: TessivenText,
): FlowerTurnLauncherIntent {
  const action: ContextActionEnvelope | undefined = selection
    ? {
        schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
        action_id: 'assistant.ask.flower',
        provider: 'flower',
        target: { target_id: 'local:local', locality: 'current_runtime' },
        source: { surface: 'tessiven', surface_id: selection.canvas_id },
        context: [{ kind: 'tessiven_selection', ...selection }],
        presentation: { label: 'Tessiven', priority: 100 },
      }
    : undefined;
  return {
    id: `tessiven-${secureRandomUUID()}`,
    source_surface: 'tessiven',
    context_items: selection
      ? [
          {
            kind: 'text_snapshot',
            title: 'Tessiven',
            content: `${selection.canvas_id} · ${t('version', { version: selection.version_id })}`,
            detail: selection.object_refs.join(', '),
          },
        ]
      : [],
    context_action: action,
    ...(selection ? {} : { initial_prompt: t('createWithFlowerPrompt') }),
  };
}
