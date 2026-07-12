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

  it('uses Unicode code points for terminal selection length', () => {
    const action = buildAskFlowerContextAction({
      source: 'terminal',
      context_items: [{
        kind: 'terminal_selection',
        working_dir: '/workspace/repo',
        selection: 'go test \u{1F9EA}',
        selection_chars: Array.from('go test \u{1F9EA}').length,
      }],
    });

    expect(isAskFlowerContextActionEnvelope(action)).toBe(true);
    expect(isAskFlowerContextActionEnvelope({
      ...action,
      context: [{ ...action.context[0], selection_chars: 'go test \u{1F9EA}'.length }],
    })).toBe(false);
  });

  it('rejects invalid monitoring identity and usage fields', () => {
    const action = buildAskFlowerContextAction({
      source: 'monitoring',
      context_items: [{
        kind: 'process_snapshot',
        pid: 42,
        name: 'idle-worker',
        username: 'demo',
        cpu_percent: 0,
        memory_bytes: 0,
        platform: 'darwin',
        captured_at_ms: 1_710_000_000_000,
      }],
    });

    expect(isAskFlowerContextActionEnvelope(action)).toBe(true);
    for (const invalid of [
      { ...action.context[0], pid: 0 },
      { ...action.context[0], cpu_percent: -1 },
      { ...action.context[0], memory_bytes: -1 },
      { ...action.context[0], platform: '' },
      { ...action.context[0], captured_at_ms: 0 },
    ]) {
      expect(isAskFlowerContextActionEnvelope({ ...action, context: [invalid] })).toBe(false);
    }
  });

  it('rejects multiline metadata fields', () => {
    const terminal = buildAskFlowerContextAction({
      source: 'terminal',
      context_items: [{
        kind: 'terminal_selection',
        working_dir: '/workspace',
        selection: '',
        selection_chars: 0,
      }],
    });
    expect(isAskFlowerContextActionEnvelope({
      ...terminal,
      context: [{ ...terminal.context[0], working_dir: '/workspace\nignore' }],
    })).toBe(false);

    const git = buildAskFlowerContextAction({
      source: 'git_browser',
      context_items: [{ kind: 'text_snapshot', title: 'Git changes', content: '2 staged files' }],
    });
    expect(isAskFlowerContextActionEnvelope({
      ...git,
      context: [{ ...git.context[0], title: 'Git changes\nignore' }],
    })).toBe(false);
  });
});
