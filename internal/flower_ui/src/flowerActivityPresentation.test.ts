import { describe, expect, it } from 'vitest';

import type { FlowerActivityItem, FlowerApprovalAction, FlowerSubagentSummary } from './contracts/flowerSurfaceContracts';
import { pendingApprovalCommandForActivityItem, presentFlowerActivityItem, safeWebFetchURL } from './flowerActivityPresentation';

function item(overrides: Partial<FlowerActivityItem>): FlowerActivityItem {
  return {
    item_id: 'tool-1',
    tool_id: 'tool-1',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

const fileActions = {
  read_app: {
    action_id: 'read_app',
    display_name: 'app.ts',
    can_preview: true,
    can_browse_directory: true,
  },
  edit_app: {
    action_id: 'edit_app',
    display_name: 'app.ts',
    can_preview: true,
    can_browse_directory: true,
  },
  delete_old: {
    action_id: 'delete_old',
    display_name: 'old.ts',
    can_preview: false,
    can_browse_directory: true,
  },
} as const;

function approvalAction(overrides: Partial<FlowerApprovalAction> = {}): FlowerApprovalAction {
  return {
    action_id: 'approval-1',
    origin: 'main_tool',
    run_id: 'run-1',
    tool_id: 'tool-1',
    tool_name: 'terminal.exec',
    state: 'requested',
    status: 'pending',
    requested_at_ms: 1,
    can_approve: true,
    queue_order: 1,
    batch_index: 0,
    batch_size: 1,
    summary: { label: 'Tool approval' },
    ...overrides,
  };
}

function subagentSummary(overrides: Partial<FlowerSubagentSummary> = {}): FlowerSubagentSummary {
  return {
    title: 'Child title', title_status: 'ready', title_generation: 1,
    parent_thread_id: 'parent-thread-1',
    thread_id: 'child-thread-1',
    task_name: 'Review API boundary',
    task_description: 'Review the API boundary and identify contract risks.',
    agent_type: 'reviewer',
    status: 'running',
    can_send_input: true,
    can_interrupt: true,
    can_close: true,
    ...overrides,
  };
}

describe('presentFlowerActivityItem', () => {
  it('presents computer actions with target, action, location, and frame metadata', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'computer.click',
      renderer: 'computer',
      payload: {
        target_name: 'Redeven Managed Browser',
        action_summary: 'clicked the sign in button',
        execution_location: 'linux_headless_browser',
        after_frame: 'https://example.test/frame.png',
        safety: { level: 'routine' },
      },
    }));
    expect(presentation.label).toBe('clicked the sign in button');
    expect(presentation.detailBlocks).toEqual([
      expect.objectContaining({ kind: 'computer', target: 'Redeven Managed Browser', frame: 'https://example.test/frame.png' }),
    ]);
  });

  it('shows actual terminal target and execution location without guessing from the command', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      chips: [{ kind: 'target', label: 'target', value: 'ssh:host:actual' }, { kind: 'execution_location', label: 'location', value: 'ssh_target' }],
      payload: { command: 'uname -a', execution_location: 'ssh_target' },
    }));
    expect(presentation.meta).toBe('ssh:host:actual · ssh_target');
    const launcher = presentFlowerActivityItem(item({
      renderer: 'terminal',
      payload: { command: 'redeven targets exec --target ssh:host:remote --json -- uname', execution_location: 'local_runtime' },
    }));
    expect(launcher.meta).toBe('local_runtime');
  });

  it('joins a Subagent operation target to the exact thread summary', () => {
    const presentation = presentFlowerActivityItem(item({
      item_id: 'subagent:review-api',
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'running',
      label: 'Review API boundary',
      payload: { action: 'wait', targets: [{ thread_id: 'child-thread-1' }], requested_count: 1 },
    }), undefined, {
      subagentSummaries: [subagentSummary()],
    });

    expect(presentation.detailBlocks).toEqual([
      expect.objectContaining({
        kind: 'subagents',
        subagents: expect.objectContaining({
          items: [expect.objectContaining({
            name: 'Review API boundary',
            description: 'Review the API boundary and identify contract risks.',
            raw_status: 'running',
            open_messages: { thread_id: 'child-thread-1' },
          })],
        }),
      }),
    ]);
  });

  it('does not use unrelated thread subagent summaries for an activity item', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      label: 'Unrelated task',
      payload: { action: 'list', targets: [] },
    }), undefined, {
      subagentSummaries: [subagentSummary()],
    });

    expect(presentation.detailBlocks).toEqual([]);
  });

  it('projects the matching approval command for a waiting activity item', () => {
    const command = pendingApprovalCommandForActivityItem(item({
      status: 'waiting',
      requires_approval: true,
      approval_state: 'requested',
      label: 'Tool approval',
      payload: {},
    }), [approvalAction({
      tool_id: 'tool-1',
      summary: { label: 'pwd', command: 'pwd' },
    })]);

    expect(command).toBe('pwd');
  });

  it('does not borrow a command for settled or unrelated activity items', () => {
    const action = approvalAction({ tool_id: 'other-tool', summary: { label: 'ls', command: 'ls' } });
    expect(pendingApprovalCommandForActivityItem(item({
      status: 'success',
      requires_approval: true,
      approval_state: 'approved',
    }), [action])).toBe('');
    expect(pendingApprovalCommandForActivityItem(item({
      status: 'waiting',
      requires_approval: true,
      approval_state: 'requested',
    }), [action])).toBe('');
  });

  it('presents declined execution without failure or cancellation details', () => {
    const declined = item({
      status: 'declined',
      severity: 'quiet',
      needs_attention: false,
      requires_approval: false,
      approval_state: 'rejected',
      renderer: 'terminal',
      label: 'rm -f generated.tmp',
      payload: { command: 'rm -f generated.tmp' },
    });

    const presentation = presentFlowerActivityItem(declined);
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Run command' });
    expect(presentation.detailBlocks).toEqual([
      expect.objectContaining({ kind: 'terminal_output', terminal: expect.objectContaining({ status: 'declined', output: '' }) }),
    ]);
    expect(JSON.stringify(presentation)).not.toContain('error');
    expect(pendingApprovalCommandForActivityItem(declined, [approvalAction()])).toBe('');
  });

  it.each([
    { name: 'structured', renderer: 'structured' },
    { name: 'terminal', renderer: 'terminal' },
    { name: 'file', renderer: 'file' },
    { name: 'patch', renderer: 'patch' },
    { name: 'todos', renderer: 'todos' },
    { name: 'web_search', renderer: 'web_search' },
    { name: 'web_fetch', renderer: 'web_fetch' },
    { name: 'question', renderer: 'question' },
    { name: 'subagents', renderer: undefined, toolName: 'subagents' },
  ] as const)('does not expose approved lifecycle state in $name presentation', ({ renderer, toolName }) => {
    const presentation = presentFlowerActivityItem(item({
      renderer,
      ...(toolName ? { tool_name: toolName } : {}),
      label: 'Visible activity',
      requires_approval: true,
      approval_state: 'approved',
      payload: {},
    }));

    expect(JSON.stringify(presentation).toLowerCase()).not.toContain('approval');
    expect(JSON.stringify(presentation).toLowerCase()).not.toContain('approved');
  });

  it('never exposes approval state as activity presentation detail', () => {
    for (const approvalState of ['requested', 'approved', 'rejected', 'timed_out', 'canceled'] as const) {
      const presentation = presentFlowerActivityItem(item({
        renderer: 'terminal',
        label: 'date +%s',
        requires_approval: true,
        approval_state: approvalState,
        payload: {
          command: 'date +%s',
          output: '1785682449',
          exit_code: 0,
        },
      }));

      expect(presentation.label).toBe('Run command');
      expect(presentation.detailLines).toHaveLength(0);
      expect(JSON.stringify(presentation.detailBlocks).toLowerCase()).not.toContain('approval');
      expect(JSON.stringify(presentation.detailBlocks)).not.toContain(`"approval_state":"${approvalState}"`);
    }
  });

  it('uses a semantic title and keeps the command in terminal detail', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'running',
      label: 'npm run build -- --mode production',
      payload: {
        command: 'npm run build -- --mode production',
        status: 'running',
        process_id: 'tp_123',
        workdir: '/workspace/private',
        exit_code: 0,
        output: 'built\n',
		first_seq: 1,
		last_seq: 1,
		latest_seq: 1,
		has_more: false,
		truncated: false,
        stdin: 'secret',
      },
      chips: [{ kind: 'exit_code', label: 'exit', value: '0', tone: 'neutral' }],
    }));

    expect(presentation.label).toBe('Run command');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Run command' });
    expect(presentation.meta).not.toContain('npm run build -- --mode production');
    expect(presentation.meta).not.toContain('exit 0');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'terminal_output',
      terminal: {
        command: 'npm run build -- --mode production',
        output: 'built\n',
        process_id: 'tp_123',
        exit_code: 0,
		first_seq: 1,
		last_seq: 1,
		has_more: false,
      },
    });
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('command');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('process');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('output');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('workdir');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('stdin');
  });

  it('uses the user-facing description in the semantic terminal title', () => {
    const command = 'printf flower-decision-surface-live';
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'waiting',
      requires_approval: true,
      approval_state: 'requested',
      description: `运行 ${command}`,
      payload: { command },
    }));

    expect(presentation.title).toEqual({ kind: 'plain', text: `运行 ${command}` });
    expect(presentation.meta).not.toContain(command);
  });

  it('does not expose an internal terminal label when only a command is available', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      label: 'terminal.exec',
      payload: {
        command: 'pnpm run test:browser -- src/ui/FlowerSurface.activityDisclosure.browser.test.tsx',
      },
    }));

    expect(presentation.label).toBe('Run command');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'terminal_output',
      terminal: { command: 'pnpm run test:browser -- src/ui/FlowerSurface.activityDisclosure.browser.test.tsx' },
    });
  });

  it('presents terminal read intent and preserves the real command in detail', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'terminal.read',
      renderer: 'terminal',
      label: 'Check the latest Docker build output again',
      description: 'Check the latest Docker build output again',
      payload: {
        command: 'docker compose up --build -d',
        process_id: 'tp_build',
		output: 'building...\n',
		first_seq: 2,
		last_seq: 2,
		latest_seq: 2,
		has_more: false,
		truncated: false,
      },
    }));

    expect(presentation.label).toBe('Check the latest Docker build output again');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Check the latest Docker build output again' });
    expect(presentation.meta).not.toContain('docker compose up --build -d');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'terminal_output',
      terminal: {
        command: 'docker compose up --build -d',
		output: 'building...\n',
        process_id: 'tp_build',
		first_seq: 2,
		last_seq: 2,
		has_more: false,
      },
    });
  });

  it('renders terminal failures as a semantic error block before output', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'error',
      label: 'curl -sL https://example.test',
      payload: {
        command: 'curl -sL https://example.test',
        status: 'timeout',
        duration_ms: 30000,
        timed_out: true,
        error: {
          code: 'TIMEOUT',
          message: 'Tool execution timed out after 30000 ms',
          retryable: true,
        },
      },
    }));

    expect(presentation.detailLines).toHaveLength(0);
    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['error', 'terminal_output']);
    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'error',
      error: { message: 'Tool execution timed out after 30000 ms' },
    });
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('TIMEOUT');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('retryable');
  });

  it('keeps payload result status out of compact meta when it conflicts with the item status', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'error',
      label: 'curl -sL https://example.test',
      payload: {
        command: 'curl -sL https://example.test',
        status: 'success',
        error: {
          code: 'UNKNOWN',
          message: 'The final activity item failed.',
          retryable: false,
        },
      },
    }));

    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'error',
      error: { message: 'The final activity item failed.' },
    });
    expect(presentation.meta).not.toContain('success');
  });

  it('uses canonical terminal item status even when payload status is stale running', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'canceled',
      label: 'npm test',
      payload: {
        command: 'npm test',
        status: 'running',
        process_id: 'tp_stale',
        output: 'stopped\n',
      },
    }));

    expect(presentation.meta).not.toContain('running');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'terminal_output',
      terminal: {
        status: 'canceled',
        process_id: 'tp_stale',
      },
    });
  });

  it('keeps real running descriptions without terminal execution chips in compact meta text', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'running',
      description: 'Compiling the workspace',
      payload: {
        command: 'python3 fetch.py',
        duration_ms: 512,
      },
    }));

    expect(presentation.title).toEqual({ kind: 'plain', text: 'Compiling the workspace' });
    expect(presentation.meta).toBe('');
    expect(presentation.meta).not.toContain('512ms');
  });

  it('presents terminal termination without exposing the internal tool name', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'terminal.terminate',
      renderer: 'terminal',
      description: '停止挂起的维基百科搜索请求',
      payload: {},
    }), undefined, {
      terminal: {
        runCommand: '运行命令',
        readCommandOutput: '查看命令输出',
        writeCommandInput: '向命令发送输入',
        terminateCommand: '终止命令执行',
      },
    });

    expect(presentation.label).toBe('停止挂起的维基百科搜索请求');
    expect(JSON.stringify(presentation)).not.toContain('terminal.terminate');
    expect(presentation.detailBlocks[0]?.kind).toBe('terminal_output');
  });

  it('routes every terminal tool through the semantic terminal presenter', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      label: 'Resolve workspace status',
      tool_name: 'terminal.exec',
    }));

    expect(presentation.label).toBe('Resolve workspace status');
  });

  it('renders subagent tool activity as delegation instead of raw structured payload', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      label: 'subagents',
      payload: {
        action: 'spawn',
        status: 'success',
        targets: [{
          thread_id: 'child-thread-1',
          task_name: 'Review API boundary',
          task_description: 'Review the API boundary and identify contract risks.',
          status: 'running',
        }],
        requested_count: 1,
      },
    }));

    expect(presentation.label).toBe('Created subagent · Review API boundary');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Created subagent · Review API boundary' });
    expect(presentation.meta).toBe('Review the API boundary and identify contract risks.');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`).join('\n')).not.toContain('child-thread-1');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'subagents',
      subagents: {
        action: 'spawn',
        task_preview: 'Review the API boundary and identify contract risks.',
        items: [{
          name: 'Review API boundary',
          description: 'Review the API boundary and identify contract risks.',
          agent_type: '',
          raw_status: 'running',
          show_status: true,
          open_messages: {
            thread_id: 'child-thread-1',
          },
        }],
      },
    });
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('Mission only');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('Reading contracts');
  });

  it.each([
    ['spawn', 'Creating subagent', 'Created subagent', 'Failed to create subagent'],
    ['wait', 'Waiting for 2 subagents', '2 subagents completed', 'Wait for subagents · Failed'],
    ['list', 'List subagents · Running', 'List subagents · Completed', 'List subagents · Failed'],
    ['inspect', 'Inspect subagents · Running', 'Inspect subagents · Completed', 'Inspect subagents · Failed'],
    ['send_input', 'Steer subagent · Running', 'Steer subagent · Completed', 'Steer subagent · Failed'],
    ['close', 'Close subagent · Running', 'Close subagent · Completed', 'Close subagent · Failed'],
    ['close_all', 'Close subagents · Running', 'Close subagents · Completed', 'Close subagents · Failed'],
  ] as const)('formats %s titles from action and execution state', (action, runningTitle, successTitle, failedTitle) => {
    const targets = [
      { task_name: 'One', status: action === 'wait' ? 'running' : 'completed' },
      { task_name: 'Two', status: action === 'wait' ? 'running' : 'completed' },
    ];
    const running = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'running',
      payload: { action, targets, requested_count: 2 },
    }));
    const success = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'success',
      payload: {
        action,
        targets: targets.map((target) => ({ ...target, status: 'completed' })),
        requested_count: 2,
        completed_count: 2,
      },
    }));
    const failed = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'error',
      payload: { action, error: { code: 'failed', message: 'failed' } },
    }));

    expect(running.label).toBe(runningTitle);
    expect(success.label).toBe(successTitle);
    expect(failed.label).toBe(failedTitle);
  });

  it('names the exact Subagent in create progress, success, and failure titles', () => {
    const present = (status: 'running' | 'success' | 'error') => presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status,
      payload: {
        action: 'spawn',
        targets: [{ task_name: 'Research model releases', status: status === 'error' ? 'failed' : 'running' }],
        ...(status === 'error' ? { error: { message: 'creation failed' } } : {}),
      },
    })).label;

    expect(present('running')).toBe('Creating subagent · Research model releases');
    expect(present('success')).toBe('Created subagent · Research model releases');
    expect(present('error')).toBe('Failed to create subagent · Research model releases');
  });

  it('uses a neutral title for an unknown Subagent operation without guessing from its label', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      label: 'Wait for reviewer',
      payload: { action: 'unknown_action' },
    }));

    expect(presentation.label).toBe('Subagent operation');
  });

  it('renders subagent timeline activity from visible payload routing ids', () => {
    const presentation = presentFlowerActivityItem(item({
      item_id: 'subagent:review-api',
      tool_name: 'subagents',
      renderer: 'subagent',
      label: 'Review API boundary',
      payload: {
        thread_id: 'child-thread-1',
        task_name: 'Review API boundary',
        task_description: 'Review the API boundary and identify contract risks.',
        agent_type: 'reviewer',
        fork_mode: 'none',
        status: 'completed',
      },
    }));

    expect(presentation.label).toBe('Subagent');
    expect(presentation.meta).toBe('Review API boundary · Review the API boundary and identify contract risks.');
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'subagents',
      subagents: {
        items: [{
          name: 'Review API boundary',
          description: 'Review the API boundary and identify contract risks.',
          agent_type: 'reviewer',
          raw_status: 'completed',
          show_status: false,
          open_messages: {
            thread_id: 'child-thread-1',
          },
        }],
      },
    });
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('Mission only');
  });

  it('renders subagent wait details as concise task rows without handoff diagnostics', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      label: 'subagents',
      payload: {
        action: 'wait',
        status: 'success',
        targets: [{
          task_name: 'Review API boundary',
          task_description: 'Review the API boundary and identify contract risks.',
          status: 'completed',
        }],
        requested_count: 1,
        completed_count: 1,
      },
    }));

    const block = presentation.detailBlocks[0];
    expect(block.kind).toBe('subagents');
    if (block.kind !== 'subagents') return;
    expect(block.subagents.items).toEqual([
      expect.objectContaining({
        name: 'Review API boundary',
        description: 'Review the API boundary and identify contract risks.',
        agent_type: '',
        raw_status: 'completed',
        show_status: true,
      }),
    ]);
    expect(JSON.stringify(block)).not.toContain('child-thread-1');
    expect(JSON.stringify(block)).not.toContain('Mission only');
    expect(JSON.stringify(block)).not.toContain('Delegated subagents finished wait');
    expect(JSON.stringify(block)).not.toContain('Reviewed API boundary');
    expect(JSON.stringify(block)).not.toContain('reading tests');
  });

  it('does not render unknown subagent diagnostics or control flags', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      label: 'subagents',
      payload: {
        action: 'inspect',
        targets: [{
          agent_type: 'custom-profile',
          status: 'paused_elsewhere',
          accepted: true,
          can_close: false,
        }],
      },
    }));

    expect(presentation.meta).toBe('');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('custom-profile');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('paused_elsewhere');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('accepted');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('can_close');
  });

  it('names every target in a three-Subagent wait without exposing ids', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'running',
      payload: {
        action: 'wait',
        targets: [
          { thread_id: 'thread-big-tech' },
          { thread_id: 'thread-models' },
          { thread_id: 'thread-policy' },
        ],
        requested_count: 3,
      },
    }), undefined, {
      subagentSummaries: [
        subagentSummary({ thread_id: 'thread-big-tech', task_name: 'Big Tech AI News' }),
        subagentSummary({ thread_id: 'thread-models', task_name: 'AI Models and Products' }),
        subagentSummary({ thread_id: 'thread-policy', task_name: 'AI Policy and Business' }),
      ],
    });

    expect(presentation.title).toEqual({ kind: 'plain', text: 'Waiting for 3 subagents' });
    expect(presentation.meta).toBe('Big Tech AI News · AI Models and Products · +1');
    const block = presentation.detailBlocks[0];
    expect(block?.kind).toBe('subagents');
    if (!block || block.kind !== 'subagents') return;
    expect(block.subagents.items.map((entry) => entry.name)).toEqual([
      'Big Tech AI News',
      'AI Models and Products',
      'AI Policy and Business',
    ]);
  });

  it('uses terminal wait outcomes instead of the generic Subagents title', () => {
    const completed = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      payload: {
        action: 'wait',
        targets: [{ task_name: 'One', status: 'completed' }, { task_name: 'Two', status: 'completed' }],
        requested_count: 2,
        completed_count: 2,
      },
    }));
    expect(completed.label).toBe('2 subagents completed');

    const timedOut = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      payload: {
        action: 'wait',
        targets: [{ task_name: 'One', status: 'completed' }, { task_name: 'Two', status: 'running' }],
        requested_count: 2,
        completed_count: 1,
        timed_out: true,
      },
    }));
    expect(timedOut.label).toBe('Wait timed out · 1/2 completed');

    const partial = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      payload: {
        action: 'wait',
        targets: [{ task_name: 'One', status: 'completed' }, { task_name: 'Two', status: 'running' }],
        requested_count: 2,
        completed_count: 1,
      },
    }));
    expect(partial.label).toBe('Wait timed out · 1/2 completed');
  });

  it('does not render unrelated nested result ids as delegation', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web.search',
      renderer: 'structured',
      label: 'Search docs',
      payload: {
        items: [{ id: 'result-1', title: 'Search result' }],
      },
    }));

    expect(presentation.label).toBe('Web search "Search docs"');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Web search "Search docs"' });
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('thread');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('profile');
  });

  it('renders web search errors as a semantic failure reason', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web.search',
      renderer: 'web_search',
      status: 'error',
      label: 'latest release',
      payload: {
        query: 'latest release',
        error: {
          code: 'NETWORK',
          message: 'Search provider failed',
          retryable: true,
        },
      },
    }));

    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'error',
      error: { message: 'Search provider failed' },
    });
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('NETWORK');
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('retryable');
  });

  it('renders canonical web search facts without duplicating answer citations', () => {
    const presentation = presentFlowerActivityItem(item({tool_name:'web_search', renderer:'web_search', label:'Web search', payload:{
      operation:'search', query:'latest release', results_provided:true,
      results:[{title:'Release notes',url:'https://example.test/release',snippet:'The release is available.'}],
      sources:[{title:'Answer citation',url:'https://example.test/answer'}],
    }}));
    expect(presentation.label).toBe('Search · latest release');
    expect(presentation.meta).toBe('1 source');
    expect(presentation.detailBlocks).toEqual([{kind:'web_operation',search:{query:'latest release',url:'',pattern:'',notice:'',
      results:[{title:'Release notes',url:'https://example.test/release',snippet:'The release is available.',source:''}],
    }}]);
    expect(presentation.detailLines).toEqual([]);
  });

  it('does not invent query text or expandable details for an opaque search', () => {
    for (const tool_name of ['web_search','web.search']) {
      const p = presentFlowerActivityItem(item({tool_name,renderer:'web_search',label:'Web search',payload:{status:'success'}}));
      expect(p.label).toBe('Web search');
      expect(p.meta).toBe('Done · Details not provided');
      expect(p.detailBlocks).toEqual([]);
    }
  });

  it('distinguishes unavailable sources from an explicitly empty list', () => {
    for (const provided of [false,true]) {
      const p = presentFlowerActivityItem(item({tool_name:'web_search',renderer:'web_search',payload:{query:'weather',results_provided:provided}}));
      const block = p.detailBlocks[0];
      expect(block.kind).toBe('web_operation');
      if (block.kind === 'web_operation') expect(block.search.notice).toBe(provided ? 'No sources returned' : 'Source details not provided');
    }
  });

  it('names web operations and preserves multi-query order', () => {
    const base = {tool_name:'web_search',renderer:'web_search' as const};
    expect(presentFlowerActivityItem(item({...base,payload:{operation:'open_page',url:'https://example.test/weather'}})).label).toBe('Open page · example.test');
    expect(presentFlowerActivityItem(item({...base,payload:{operation:'find_in_page',url:'https://example.test/weather',pattern:'forecast'}})).label).toBe('Find on page · “forecast” · example.test');
    const p = presentFlowerActivityItem(item({...base,status:'running',payload:{operation:'search',query:'weather\nforecast'}}));
    expect(p.label).toBe('Search · weather');
    expect(p.meta).toBe('2 queries · Running');
  });

  it('renders the requested URL and bounded preview without page icon data', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web_fetch',
      renderer: 'web_fetch',
      status: 'success',
      payload: {
        url: 'https://example.test/start',
        final_url: 'https://docs.example.test/page',
        status_code: 200,
        content_type: 'text/html',
        format: 'markdown',
        content_preview: '# Preview\n\n[Safe link](https://example.test)',
        preview_truncated: true,
        bytes_read: 4096,
        truncated: true,
        content: 'must not reach activity UI',
        body: 'legacy content must not reach activity UI',
      },
    }));

    expect(presentation.title).toEqual({
      kind: 'web_fetch',
      url: 'https://example.test/start',
    });
    expect(presentation.detailBlocks).toEqual([{
      kind: 'web_fetch',
      fetch: {
        url: 'https://example.test/start',
        final_url: 'https://docs.example.test/page',
        status_code: 200,
        content_type: 'text/html',
        format: 'markdown',
        content_preview: '# Preview\n\n[Safe link](https://example.test)',
        preview_truncated: true,
        bytes_read: 4096,
        truncated: true,
      },
    }]);
    expect(JSON.stringify(presentation)).not.toContain('must not reach');
  });

  it('uses target refs for old records and never exposes an empty disclosure', () => {
    const legacy = presentFlowerActivityItem(item({
      tool_name: 'web_fetch',
      renderer: 'web_fetch',
      label: 'Web fetch',
      payload: undefined,
      target_refs: [{ kind: 'url', label: 'example.test', uri: 'https://example.test/legacy' }],
    }));
    expect(legacy.title).toEqual({ kind: 'web_fetch', url: 'https://example.test/legacy' });
    expect(legacy.detailBlocks).toEqual([expect.objectContaining({
      kind: 'web_fetch',
      fetch: expect.objectContaining({ url: 'https://example.test/legacy' }),
    })]);

    const empty = presentFlowerActivityItem(item({
      tool_name: 'web_fetch',
      renderer: 'web_fetch',
      label: 'Web fetch',
      payload: undefined,
      target_refs: undefined,
    }));
    expect(empty.title).toEqual({ kind: 'plain', text: 'Web fetch' });
    expect(empty.detailBlocks).toEqual([]);
  });

  it('keeps web fetch failures in the shared error style and rejects unsafe links', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web_fetch',
      renderer: 'web_fetch',
      status: 'error',
      payload: {
        url: 'https://example.test',
        format: 'markdown',
        error: { message: 'blocked target' },
      },
    }));

    expect(presentation.detailBlocks[0]).toEqual({ kind: 'error', error: { message: 'blocked target' } });
    expect(presentation.detailBlocks[1]).toEqual(expect.objectContaining({ kind: 'web_fetch' }));
    expect(safeWebFetchURL('https://example.test/page')).toBe('https://example.test/page');
    expect(safeWebFetchURL('https://user:secret@example.test/page')).toBe('');
    expect(safeWebFetchURL('javascript:alert(1)')).toBe('');
  });

  it('renders question payloads as prompts and choices', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'ask_user',
      renderer: 'question',
      label: 'Choose target',
      payload: {
        reason_code: 'needs_user_choice',
        required_from_user: ['target'],
        questions: [{
          id: 'target',
          question: 'Which target should I inspect?',
          choices: [{ label: 'Local', description: 'This Mac' }],
        }],
      },
    }));

    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'question',
      question: {
        reason: 'needs_user_choice',
        required: ['target'],
        contains_secret: false,
        answers: [],
        questions: [{
          id: 'target',
          question: 'Which target should I inspect?',
          choices: [{ label: 'Local', description: 'This Mac' }],
          write_label: '',
        }],
      },
    });
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('questions');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('reason');
  });

  it('renders safe answered question summaries and redacts secret answers', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'ask_user',
      renderer: 'question',
      status: 'success',
      label: 'Choose target',
      payload: {
        questions: [
          { id: 'target', question: 'Which target?' },
          { id: 'token', question: 'Access token?' },
        ],
        answers: [
          { question_id: 'target', values: ['Local'] },
          { question_id: 'token', redacted: true },
        ],
      },
    }));

    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'question',
      question: {
        answers: [
          { question_id: 'target', values: ['Local'], redacted: false },
          { question_id: 'token', values: [], redacted: true },
        ],
      },
    });
    expect(JSON.stringify(presentation)).not.toContain('secret-value');
  });

  it('renders the published Floret v7 todo items payload', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'write_todos',
      renderer: 'todos',
      label: 'Update todos',
      payload: {
        operation: 'write',
        items: [
          { text: 'Inspect the live timeline', status: 'completed' },
          { text: 'Verify the expanded details', status: 'in_progress' },
        ],
      },
    }));

    expect(presentation.meta).toContain('1/2 completed');
    expect(presentation.detailBlocks).toContainEqual({
      kind: 'todos',
      items: [
        { content: 'Inspect the live timeline', status: 'completed' },
        { content: 'Verify the expanded details', status: 'in_progress' },
      ],
    });
  });

  it('renders file reads as an explicit Read action with file_read details', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      label: 'app.ts#dcbdf9b8c27f#e1703606242a',
      target_refs: [{ kind: 'file_action:read_app', label: 'app.ts#dcbdf9b8c27f' }],
      payload: {
        operation: 'read',
        display_name: 'app.ts',
        content: 'const value = 1;\n',
        line_offset: 7,
        line_count: 1,
        total_lines: 42,
        truncated: false,
      },
    }), fileActions);

    expect(presentation.label).toBe('Read app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', display_name: 'app.ts' });
    expect(presentation.meta).not.toContain('#dcbdf9b8c27f');
    expect(presentation.primaryAction).toEqual({
      action_id: 'read_app',
      display_name: 'app.ts',
      can_preview: true,
      can_browse_directory: true,
    });
    expect(presentation.detailLines.some((line) => ['content', 'file_path', 'operation'].includes(line.label))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_read',
      action: {
        action_id: 'read_app',
        display_name: 'app.ts',
        can_preview: true,
        can_browse_directory: true,
      },
      content: 'const value = 1;\n',
      line_offset: 7,
      line_count: 1,
      total_lines: 42,
      truncated: false,
    }]);
  });

  it('strips content-ref suffixes from file labels when display_name is absent', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      label: 'a.md#dcbdf9b8c27f#e1703606242a',
      payload: {
        operation: 'read',
        content: 'hello\n',
        line_offset: 1,
        line_count: 1,
        total_lines: 1,
      },
    }));

    expect(presentation.label).toBe('Read a.md');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', display_name: 'a.md' });
  });

  it('renders file writes as Edit with unified patch data only', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.write',
      renderer: 'file',
      target_refs: [{ kind: 'file_action:edit_app', label: 'app.ts' }],
      payload: {
        operation: 'write',
        display_name: 'app.ts',
        change_type: 'update',
        additions: 1,
        deletions: 1,
        unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;',
      },
    }), fileActions);

    expect(presentation.label).toBe('Edit app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', display_name: 'app.ts' });
    expect(presentation.changeStats).toEqual({ additions: 1, deletions: 1 });
    expect(presentation.detailLines.some((line) => line.value.includes('unified_diff') || line.value.includes('file_path'))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_diff',
      files: [{
        display_name: 'app.ts',
        old_path: '',
        new_path: '',
        change_type: 'update',
        action: {
          action_id: 'edit_app',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
        additions: 1,
        deletions: 1,
        patch_text: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;',
        truncated: false,
        diff_unavailable_reason: '',
      }],
    }]);
  });

  it('does not repeat file protocol fields beside the user-facing title', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.write',
      renderer: 'file',
      label: 'weather_gd.py',
      chips: [
        { kind: 'operation', label: 'operation', value: 'write' },
        { kind: 'display_name', label: 'display name', value: 'weather_gd.py' },
        { kind: 'change_type', label: 'create' },
      ],
      payload: {
        operation: 'write',
        display_name: 'weather_gd.py',
        change_type: 'create',
      },
    }));

    expect(presentation.label).toBe('Edit weather_gd.py');
    expect(presentation.meta).toBe('');
    expect(presentation.changeStats).toBeUndefined();
    expect(presentation.detailBlocks).toEqual([]);
  });

  it('renders file error details even when a file detail block is present', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      status: 'error',
      label: 'app.ts',
      target_refs: [{ kind: 'file_action:read_app', label: 'app.ts' }],
      payload: {
        operation: 'read',
        display_name: 'app.ts',
        content: 'partial\n',
        line_offset: 1,
        line_count: 1,
        total_lines: 10,
        status: 'error',
        error: {
          code: 'PERMISSION_DENIED',
          message: 'permission denied',
          retryable: false,
        },
      },
    }), fileActions);

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['error', 'file_read']);
    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'error',
      error: { message: 'permission denied' },
    });
    expect(presentation.detailLines).toHaveLength(0);
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('PERMISSION_DENIED');
  });

  it('renders multi-file apply_patch as Edit N files and keeps per-file actions', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      target_refs: [
        { kind: 'file_action:edit_app', label: 'app.ts' },
        { kind: 'file_action:delete_old', label: 'old.ts' },
      ],
      payload: {
        operation: 'apply_patch',
        mutations: [
          {
            display_name: 'app.ts',
            change_type: 'update',
            additions: 1,
            deletions: 1,
            unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
          {
            display_name: 'old.ts',
            change_type: 'delete',
            deletions: 1,
            unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
          },
        ],
      },
    }), fileActions);

    expect(presentation.label).toBe('Edit 2 files');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', display_name: '2 files' });
    expect(presentation.primaryAction).toBeUndefined();
    expect(presentation.changeStats).toEqual({ additions: 1, deletions: 2 });
    expect(presentation.detailLines.some((line) => line.value.includes('patch'))).toBe(false);
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'file_diff',
      files: [
        {
          display_name: 'app.ts',
          change_type: 'update',
          action: { action_id: 'edit_app', display_name: 'app.ts', can_preview: true, can_browse_directory: true },
        },
        {
          display_name: 'old.ts',
          change_type: 'delete',
          action: { action_id: 'delete_old', display_name: 'old.ts', can_preview: false, can_browse_directory: true },
        },
      ],
    });
  });

  it('renders patch error details even when diff details are present', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      status: 'error',
      target_refs: [{ kind: 'file_action:edit_app', label: 'app.ts' }],
      payload: {
        operation: 'apply_patch',
        status: 'error',
        mutations: [{
          display_name: 'app.ts',
          change_type: 'update',
          unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
        }],
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'patch failed',
          retryable: false,
        },
      },
    }), fileActions);

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['error', 'file_diff']);
    expect(presentation.detailBlocks[0]).toEqual({
      kind: 'error',
      error: { message: 'patch failed' },
    });
    expect(presentation.detailLines).toHaveLength(0);
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('INVALID_ARGUMENTS');
  });

  it('renders single-file apply_patch deletion as Delete', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      target_refs: [{ kind: 'file_action:delete_old', label: 'old.ts' }],
      payload: {
        operation: 'apply_patch',
        mutations: [{
          display_name: 'old.ts',
          change_type: 'delete',
          unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
        }],
      },
    }), fileActions);

    expect(presentation.label).toBe('Delete old.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Delete', display_name: 'old.ts' });
    expect(presentation.primaryAction).toEqual({
      action_id: 'delete_old',
      display_name: 'old.ts',
      can_preview: false,
      can_browse_directory: true,
    });
  });

  it('does not invent raw fallback detail rows for empty structured payloads', () => {
    const presentation = presentFlowerActivityItem(item({
      payload: undefined,
      renderer: undefined,
      label: undefined,
    }));

    expect(presentation.label).toBe('Run command');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Run command' });
    expect(presentation.meta).toBe('');
    expect(presentation.detailLines).toHaveLength(0);
    expect(presentation.detailBlocks[0]?.kind).toBe('terminal_output');
  });

  it('uses a neutral semantic fallback without exposing unknown protocol JSON', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'vendor.internal_call',
      renderer: 'structured',
      label: undefined,
      payload: {
        query: 'release notes',
        data: { token: 'must-not-render', nested: ['raw', 'protocol'] },
        result: { internal_id: 'opaque' },
      },
    }));

    expect(presentation.title).toEqual({ kind: 'plain', text: 'Called vendor internal call' });
    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain('must-not-render');
    expect(JSON.stringify(presentation)).not.toContain('internal_id');
  });

  it.each([
    {
      tool_name: 'rgrep',
      label: 'activity contract',
      payload: {
        query: 'activity contract',
        paths: ['internal/flower_ui', 'internal/ai'],
        glob: ['*.ts', '*.go'],
        match_count: 4,
        matches: [{ path: 'internal/ai/floret_tools.go', line: 12, text: 'private protocol row' }],
        data: { internal_cursor: 'must-not-render' },
      },
    },
    {
      tool_name: 'find',
      label: 'FlowerSurface.tsx',
      payload: {
        root: 'internal',
        name: 'FlowerSurface.tsx',
        type: 'file',
        result_count: 1,
        results: [{ path: 'internal/flower_ui/src/FlowerSurface.tsx', private_id: 'must-not-render' }],
        result: { transport_shape: 'must-not-render' },
      },
    },
  ])('does not invent structured details for legacy $tool_name payloads', ({ tool_name, label, payload }) => {
    const presentation = presentFlowerActivityItem(item({
      tool_name,
      renderer: 'structured',
      label,
      payload,
    }));

    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain('must-not-render');
    expect(JSON.stringify(presentation)).not.toContain('private protocol row');
  });

  it('does not let an unknown tool label expose complex protocol fields', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'vendor.internal_call',
      renderer: 'structured',
      label: 'Inspect release metadata',
      payload: {
        query: 'release metadata',
        data: { token: 'must-not-render' },
        result: { internal_id: 'must-not-render' },
      },
    }));

    expect(presentation.title).toEqual({ kind: 'plain', text: 'Inspect release metadata' });
    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain('must-not-render');
  });

  it('leaves successful Skill content empty for the safe disclosure fallback', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'use_skill',
      renderer: 'structured',
      label: 'frontend-design',
      payload: {
        operation: 'use_skill',
        name: 'frontend-design',
        content: 'Loaded frontend design guidance.',
        content_ref: 'content_123',
        activation_id: 'act_123',
        already_active: false,
      },
    }));

    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([]);
    expect(JSON.stringify(presentation)).not.toContain('content_123');
    expect(JSON.stringify(presentation)).not.toContain('act_123');
  });

  it('keeps a failed Skill activity expandable when it has a real error', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'use_skill',
      renderer: 'structured',
      status: 'error',
      label: 'frontend-design',
      payload: {
        operation: 'use_skill',
        status: 'error',
        error: { message: 'Skill package could not be loaded.' },
      },
    }));

    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'error',
      error: { message: 'Skill package could not be loaded.' },
    }]);
  });

  it('renders only typed structured rows for OKF details', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'okf.search',
      renderer: 'structured',
      label: 'OKF search results',
      payload: {
        operation: 'okf.search',
        status: 'success',
        name: 'repeated title',
        query: 'must-not-be-invented',
        rows: [{
          title: 'Flower runtime',
          meta: 'Architecture · Summary',
          content: 'The current-view boundary.',
          format: 'text',
        }],
      },
    }));

    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'structured_rows',
      rows: [{
        title: 'Flower runtime',
        meta: 'Architecture · Summary',
        content: 'The current-view boundary.',
        format: 'text',
      }],
    }]);
    expect(JSON.stringify(presentation.detailBlocks)).not.toContain('must-not-be-invented');
  });
});

describe('terminal interaction facts', () => {
  it.each(['write', 'read', 'terminate'] as const)('keeps %s expandable without command or output', (operation) => {
    const value = presentFlowerActivityItem(item({ renderer: 'terminal', tool_name: 'custom.terminal', label: '检查 GPU/LM Studio 诊断输出', payload: { operation } }));
    expect(value.label).toBe('检查 GPU/LM Studio 诊断输出');
    expect(value.detailBlocks).toContainEqual(expect.objectContaining({ kind: 'terminal_output', terminal: expect.objectContaining({ operation, output: '' }) }));
  });
  it('excludes interactive input and echoed output from write detail', () => {
    const value = presentFlowerActivityItem(item({ renderer: 'terminal', label: '向 SSH 登录会话提交密码', payload: { operation: 'write', command: 'ssh host', input: 'password', stdin: 'secret', output: 'password', input_bytes: 9 } }));
    expect(value.label).toBe('向 SSH 登录会话提交密码');
    const raw = JSON.stringify(value);
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('secret');
    expect(value.detailBlocks).toContainEqual(expect.objectContaining({ terminal: expect.objectContaining({ command: 'ssh host' }) }));
  });
  it('keeps output and execution outcomes without projecting diagnostic metadata or duplicate intent', () => {
    const value = presentFlowerActivityItem(item({ renderer: 'terminal', description: 'Check diagnostics', payload: {
      operation: 'read', output: 'GPU ready', exit_code: 2, timed_out: true, terminated: true,
      input_bytes: 12, total_bytes: 23, execution_location: 'local_runtime', duration_ms: 50,
      first_seq: 1, last_seq: 2, latest_seq: 3, has_more: true,
    } }));
    const detail = value.detailBlocks.find((block) => block.kind === 'terminal_output');
    expect(detail).toMatchObject({ terminal: { output: 'GPU ready', exit_code: 2, timed_out: true, terminated: true, first_seq: 1, last_seq: 2, has_more: true } });
    for (const field of ['purpose', 'input_bytes', 'total_bytes', 'execution_location', 'duration_ms', 'latest_seq']) {
      expect(detail && 'terminal' in detail ? detail.terminal : {}).not.toHaveProperty(field);
    }
  });
  it('uses the typed operation when no semantic text was authored', () => {
    const value = presentFlowerActivityItem(item({ renderer: 'terminal', tool_name: 'custom.terminal', payload: { operation: 'write' } }));
    expect(value.label).toBe('Send input to command');
  });
  it('preserves intent and drained cursors across serialized history', () => {
    const history = item({ renderer: 'terminal', label: '再次检查诊断输出', payload: { operation: 'read', output: 'GPU ready', first_seq: 3, last_seq: 4, latest_seq: 4, has_more: false } });
    const before = presentFlowerActivityItem(history);
    expect(presentFlowerActivityItem(JSON.parse(JSON.stringify(history)))).toEqual(before);
    expect(before.detailBlocks).toContainEqual(expect.objectContaining({ terminal: expect.objectContaining({ first_seq: 3, last_seq: 4, has_more: false }) }));
  });
});
