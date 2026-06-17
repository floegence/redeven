import { describe, expect, it } from 'vitest';
import { buildAskFlowerContextAction } from './askFlower';
import {
  isAskFlowerContextActionEnvelope,
  requireAskFlowerContextActionEnvelope,
} from './protocol';

describe('Ask Flower context actions', () => {
  it('maps terminal selection context into the shared envelope', () => {
    const action = buildAskFlowerContextAction({
      source: 'terminal',
      suggested_working_dir: '/workspace/repo',
      context_items: [
        {
          kind: 'terminal_selection',
          working_dir: '/workspace/repo',
          selection: 'npm test',
          selection_chars: 8,
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
      suggested_working_dir: '/workspace/repo',
      executionContext: {
        current_target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        source_env_public_id: 'env_a',
        runtime_hint: 'auto',
        session_source: 'provider_environment',
      },
      context_items: [
        {
          kind: 'file_path',
          path: '/workspace/repo',
          is_directory: true,
          root_label: 'Workspace',
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

  it('supports desktop welcome environment cards through the shared envelope', () => {
    const action = buildAskFlowerContextAction({
      source: 'desktop_welcome_environment_card',
      target: {
        target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        locality: 'auto',
      },
      surfaceId: 'env_a',
      executionContext: {
        current_target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        source_env_public_id: 'env_a',
        runtime_hint: 'auto',
        session_source: 'provider_environment',
      },
      context_items: [
        {
          kind: 'text_snapshot',
          title: 'Demo Environment',
          detail: 'Provider · Online',
          content: 'Environment: Demo Environment\nEnv public ID: env_a',
        },
      ],
    });

    expect(action).toMatchObject({
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: {
        target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        locality: 'auto',
      },
      source: {
        surface: 'desktop_welcome_environment_card',
        surface_id: 'env_a',
      },
      context: [{
        kind: 'text_snapshot',
        title: 'Demo Environment',
        detail: 'Provider · Online',
      }],
    });
  });

  it('rejects malformed Ask Flower envelopes at the UI boundary', () => {
    const valid = buildAskFlowerContextAction({
      source: 'terminal',
      executionContext: {
        session_source: 'runtime_gateway',
      },
      context_items: [{
        kind: 'terminal_selection',
        working_dir: '/workspace/repo',
        selection: 'npm test',
        selection_chars: 8,
      }],
    });

    expect(isAskFlowerContextActionEnvelope(valid)).toBe(true);
    expect(isAskFlowerContextActionEnvelope({
      ...valid,
      target: {
        ...valid.target,
        locality: 'old_locality',
      },
    })).toBe(false);
    expect(isAskFlowerContextActionEnvelope({
      ...valid,
      source: {
        surface: 'unknown_surface',
      },
    })).toBe(false);
    expect(isAskFlowerContextActionEnvelope({
      ...valid,
      execution_context: {
        session_source: 'unknown_session',
      },
    })).toBe(false);
    expect(isAskFlowerContextActionEnvelope({
      ...valid,
      context: [{
        kind: 'text_snapshot',
        title: 'Missing content',
      }],
    })).toBe(false);
    expect(() => requireAskFlowerContextActionEnvelope({
      ...valid,
      provider: 'codex',
    })).toThrow('Invalid Flower context action.');
  });
});
