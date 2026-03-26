// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildCodexPendingRequestViewModel,
  buildCodexSidebarSummary,
  buildCodexWorkbenchSummary,
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
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
      workingDirDraft: '/workspace/ui',
      modelDraft: '',
      activeStatus: 'running',
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
    expect(summary.modelLabel).toBe('gpt-5.4');
    expect(summary.statusLabel).toBe('running');
    expect(summary.statusFlags).toEqual(['finalizing']);
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
      status: {
        available: true,
        ready: true,
        agent_home_dir: '/workspace',
      },
      workingDirDraft: '',
      modelDraft: '',
      activeStatus: 'running',
      activeStatusFlags: [],
      pendingRequests: [],
    });

    expect(summary.workspaceLabel).toBe('/workspace/codex-ui');
    expect(summary.modelLabel).toBe('gpt-5.4');
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
