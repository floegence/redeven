// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildCodexPendingRequestViewModel,
  buildCodexSidebarSummary,
  buildCodexWorkbenchSummary,
  codexSupportsOperation,
  resolveCodexWorkingDir,
} from './viewModel';

describe('buildCodexWorkbenchSummary', () => {
  it('projects thread state into a Flower-aligned workbench summary without depending on Flower components', () => {
    const summary = buildCodexWorkbenchSummary({
      thread: {
        id: 'thread_1',
        preview: 'Align the workbench shell',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 10,
        updated_at_unix_s: Math.floor(Date.now() / 1000),
        status: 'running',
        active_flags: ['finalizing'],
        cwd: '/workspace/ui',
        name: 'Workbench alignment',
      },
      runtimeConfig: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
      },
      capabilities: {
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
          },
        ],
      },
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
      workingDirDraft: '/workspace/ui',
      modelDraft: '',
      tokenUsage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
      activeStatus: 'active',
      activeStatusFlags: ['finalizing'],
      pendingRequests: [
        {
          id: 'req_1',
          type: 'command_approval',
          thread_id: 'thread_1',
          turn_id: 'turn_1',
          item_id: 'item_1',
        },
      ],
    });

    expect(summary.threadTitle).toBe('Workbench alignment');
    expect(summary.workspaceLabel).toBe('/workspace/ui');
    expect(summary.modelLabel).toBe('GPT-5.4');
    expect(summary.statusLabel).toBe('working');
    expect(summary.statusFlags).toEqual(['finalizing']);
    expect(summary.contextLabel).toBe('95% context left');
    expect(summary.contextDetail).toContain('6.4k used');
    expect(summary.pendingRequestCount).toBe(1);
  });

  it('prefers the real working directory over thread path metadata', () => {
    const summary = buildCodexWorkbenchSummary({
      thread: {
        id: 'thread_1',
        preview: 'Trim noisy metadata',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 10,
        updated_at_unix_s: 20,
        status: 'running',
        active_flags: [],
        path: '/Users/demo/.codex/sessions/thread.jsonl',
        cwd: '/workspace/codex-ui',
        name: 'Metadata cleanup',
      },
      runtimeConfig: {
        cwd: '/workspace/codex-ui',
        model: 'gpt-5.4',
      },
      capabilities: {
        models: [
          {
            id: 'gpt-5.4',
            display_name: 'GPT-5.4',
          },
        ],
      },
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
      workingDirDraft: '',
      modelDraft: '',
      tokenUsage: null,
      activeStatus: 'running',
      activeStatusFlags: [],
      pendingRequests: [],
    });

    expect(summary.workspaceLabel).toBe('/workspace/codex-ui');
    expect(summary.modelLabel).toBe('GPT-5.4');
    expect(summary.contextLabel).toBe('');
  });
});

describe('resolveCodexWorkingDir', () => {
  it('prefers capability-derived cwd over an agent-home fallback when the draft is still empty', () => {
    expect(resolveCodexWorkingDir({
      workingDirDraft: '',
      runtimeConfig: {
        cwd: '/workspace',
      },
      capabilities: {
        effective_config: {
          cwd: '/workspace/codex-ui',
        },
      },
      thread: null,
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
    })).toBe('/workspace/codex-ui');
  });

  it('keeps a persisted thread cwd ahead of capability defaults', () => {
    expect(resolveCodexWorkingDir({
      workingDirDraft: '',
      runtimeConfig: {
        cwd: '/workspace/thread-ui',
      },
      capabilities: {
        effective_config: {
          cwd: '/workspace/default-ui',
        },
      },
      thread: {
        id: 'thread_1',
        preview: 'Persisted cwd',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 10,
        updated_at_unix_s: 20,
        status: 'idle',
        cwd: '/workspace/thread-ui',
      },
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
    })).toBe('/workspace/thread-ui');
  });
});

describe('buildCodexSidebarSummary', () => {
  it('keeps Codex host diagnostics compact and independent from Flower thread controls', () => {
    const summary = buildCodexSidebarSummary({
      status: {
        available: false,
        ready: false,
        binary_path: '',
      },
      pendingRequests: [],
      statusError: '',
    });

    expect(summary.hostReady).toBe(false);
    expect(summary.hostLabel).toBe('Install required');
    expect(summary.secondaryLabel).toContain('Install the host `codex` binary');
  });
});

describe('buildCodexPendingRequestViewModel', () => {
  it('normalizes approval and input requests into isolated Codex view models', () => {
    const inputRequest = buildCodexPendingRequestViewModel({
      id: 'req_input',
      type: 'user_input',
      thread_id: 'thread_1',
      turn_id: 'turn_1',
      item_id: 'item_1',
      questions: [{ id: 'q_1', header: 'Need answer', question: 'What should Codex inspect next?', is_other: false, is_secret: false }],
    });
    const approvalRequest = buildCodexPendingRequestViewModel({
      id: 'req_approval',
      type: 'command_approval',
      thread_id: 'thread_1',
      turn_id: 'turn_1',
      item_id: 'item_2',
      command: 'pnpm lint',
      cwd: '/workspace/ui',
    });

    expect(inputRequest.title).toBe('User input required');
    expect(inputRequest.decisionLabel).toBe('Submit response');
    expect(inputRequest.questionCount).toBe(1);
    expect(approvalRequest.title).toBe('Command approval required');
    expect(approvalRequest.command).toBe('pnpm lint');
    expect(approvalRequest.cwd).toBe('/workspace/ui');
  });
});

describe('codexSupportsOperation', () => {
  it('treats turn_steer as part of the default active browser surface operations', () => {
    expect(codexSupportsOperation(undefined, 'turn_steer')).toBe(true);
  });
});
