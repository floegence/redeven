import { describe, expect, it } from 'vitest';
import { buildAskFlowerContextAction } from './askFlower';

describe('Ask Flower context actions', () => {
  it('maps terminal selection context into the shared envelope', () => {
    const action = buildAskFlowerContextAction({
      source: 'terminal',
      suggestedWorkingDirAbs: '/workspace/repo',
      contextItems: [
        {
          kind: 'terminal_selection',
          workingDir: '/workspace/repo',
          selection: 'npm test',
          selectionChars: 8,
        },
      ],
    });

    expect(action).toMatchObject({
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: {
        target_id: 'current',
        locality: 'auto',
      },
      source: {
        surface: 'terminal',
      },
      context: [
        {
          kind: 'terminal_selection',
          working_dir: '/workspace/repo',
          selection: 'npm test',
          selection_chars: 8,
        },
      ],
      suggested_working_dir_abs: '/workspace/repo',
    });
  });

  it('carries execution context as routing hints, not permissions', () => {
    const action = buildAskFlowerContextAction({
      source: 'file_browser',
      suggestedWorkingDirAbs: '/workspace/repo',
      executionContext: {
        current_target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        source_env_public_id: 'env_a',
        runtime_hint: 'auto',
        session_source: 'provider_environment',
      },
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/repo',
          isDirectory: true,
          rootLabel: 'Workspace',
        },
      ],
    });

    expect(action.execution_context).toEqual({
      current_target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
      source_env_public_id: 'env_a',
      runtime_hint: 'auto',
      session_source: 'provider_environment',
    });
    expect(JSON.stringify(action)).not.toContain('can_write');
    expect(JSON.stringify(action)).not.toContain('grant');
  });
});
