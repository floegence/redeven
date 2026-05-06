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
      schema_version: 1,
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
});
