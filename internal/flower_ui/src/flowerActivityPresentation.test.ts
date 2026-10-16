import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import { describe, expect, it } from 'vitest';

import type { FlowerActivityItem, FlowerApprovalAction, FlowerSubagentSummary } from './contracts/flowerSurfaceContracts';
import { pendingApprovalCommandForActivityItem, presentFlowerActivityItem, safeWebFetchURL } from './flowerActivityPresentation';
import { toolActivityEnUS } from './toolActivityCopy';

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

it('shows explicit zero for a successful no-op instead of retaining argument preview counts', () => {
  const presentation = presentFlowerActivityItem(item({ tool_name: 'file.write', renderer: 'file',
    argument_preview: { additions: 99 }, payload: { display_name: 'same.txt', operation: 'write', change_type: 'noop' },
  }));
  expect(presentation.changeStats).toEqual({ additions: 0, deletions: 0 });
});

it('renders a typed tool image as authorized media without a unavailable-result notice', () => {
  const resource_ref = `image://${'c'.repeat(64)}/png`;
  const result = presentFlowerActivityItem(item({ tool_name: 'image.read', label: 'photo.png', renderer: 'structured', target_refs: [{ kind: 'tool_image', label: 'photo.png', resource_ref }] }));
  expect(result.detailBlocks).toContainEqual({ kind: 'image', resource_ref, name: 'photo.png' });
  expect(result.detailBlocks.some(block => block.kind === 'structured_rows' && block.notice)).toBe(false);
});


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

const missingResults = { kind: 'structured_rows', section: 'results', rows: [], notice: 'This record did not save result details.' };

describe('tool failure presentation', () => {
  it.each([
    { operation: 'exec', error: { message: 'Terminal process exited with code 255' } },
    { operation: 'exec', exit_code: 1, error: { message: 'Terminal process exited with code 255' } },
    { operation: 'write', timed_out: true, error: { message: 'Timed out' } },
    { operation: 'exec', exit_code: 255, error: { message: 'Terminal process exited with code 255', meta: { repair_action: 'Inspect the SSH target' } } },
  ])('keeps terminal errors without an equivalent result or with recovery advice: %j', payload => {
    const presentation = presentFlowerActivityItem(item({ renderer: 'terminal', status: 'error', payload }));
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message: payload.error.message } });
  });

  it('keeps a recorded partial-execution warning alongside the failure', () => {
    const presentation = presentFlowerActivityItem(item({ tool_name: 'inspect', renderer: 'structured', status: 'error',
      chips: [{ kind: 'partial_execution', label: 'Partial execution' }], payload: { error: { message: 'Stopped before all steps completed' } },
    }));
    expect(presentation.detailBlocks[0]).toMatchObject({ kind: 'structured_rows', notice: toolActivityEnUS.partialOutput });
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message: 'Stopped before all steps completed' } });
  });

  it('keeps a terminal failure out of a fallback operation title', () => {
    const presentation = presentFlowerActivityItem(item({ renderer: 'terminal', status: 'error', label: 'Run command',
      description: 'Session closed', payload: { operation: 'exec', error: { message: 'Session closed' } },
    }));
    expect(presentation.label).toBe('Run command');
    expect(presentation.meta).toBe('');
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message: 'Session closed' } });
  });

  it('does not fabricate a zero-line file result after a failed read', () => {
    const presentation = presentFlowerActivityItem(item({ tool_name: 'file.read', renderer: 'file', status: 'error',
      payload: { operation: 'read', display_name: 'report.txt', error: { message: 'Permission denied' } },
    }));
    expect(presentation.detailBlocks).toEqual([{ kind: 'error', error: { message: 'Permission denied' } }]);
  });

  it('does not repeat a question failure in its reason', () => {
    const presentation = presentFlowerActivityItem(item({ tool_name: 'ask_user', renderer: 'question', status: 'error',
      payload: { reason: 'Question validation failed', error: { message: 'Question validation failed' } },
    }));
    expect(presentation.detailBlocks[0]).toMatchObject({ kind: 'question', question: { reason: '' } });
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message: 'Question validation failed' } });
  });

  it('shows a failed command once through its output and localized exit result', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal', status: 'error', label: 'Check remote runtime',
      description: 'Terminal process exited with code 255',
      payload: { operation: 'exec', command: 'ssh udesk26 hostname', output: 'Permission denied (publickey).', exit_code: 255,
        error: { code: 'COMMAND_FAILED', message: 'Terminal process exited with code 255' } },
    }));
    expect(presentation.meta).toBe('');
    expect(presentation.detailBlocks.map(block => block.kind)).toEqual(['terminal_output']);
    expect(presentation.detailBlocks[0]).toMatchObject({ terminal: { output: 'Permission denied (publickey).', exit_code: 255 } });
  });

  it('retains a specific terminal failure after the command and output', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal', status: 'error', payload: { operation: 'exec', command: 'npm test', exit_code: 1,
        error: { code: 'TERMINAL_RUNTIME_FAILURE', message: 'Terminal output could not be drained.' } },
    }));
    expect(presentation.meta).toBe('');
    expect(presentation.detailBlocks.map(block => block.kind)).toEqual(['terminal_output', 'error']);
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ error: { message: 'Terminal output could not be drained.' } });
  });

  it('keeps a detailed timeout reason even when a timeout result is available', () => {
    const presentation = presentFlowerActivityItem(item({ renderer: 'terminal', status: 'error',
      payload: { timed_out: true, error: { code: 'TIMEOUT', message: 'Connection timed out while opening the SSH transport.' } },
    }));
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message: 'Connection timed out while opening the SSH transport.' } });
  });

  it.each(['file', 'patch', 'web_search', 'web_fetch', 'question', 'todos', 'subagent', 'subagent_operation', 'structured', 'computer', 'browser'] as const)(
    'places the %s failure after operation details without repeating the message in the summary', renderer => {
      const message = 'The requested resource is unavailable.';
      const presentation = presentFlowerActivityItem(item({ tool_name: renderer === 'web_search' ? 'okf.search' : 'inspect', renderer, status: 'error', description: message,
        payload: { operation: 'read', display_name: 'report.txt', content: 'partial content',
          query: 'report', url: 'https://example.test', questions: [{ id: 'choice', question: 'Choose a report' }],
          inputs: [{ content: 'report.txt', format: 'text' }], rows: [{ content: 'partial result', format: 'text' }],
          error: { message } },
      }));
      expect(presentation.meta).not.toContain(message);
      expect(presentation.detailBlocks.at(-1)).toMatchObject({ kind: 'error', error: { message } });
      expect(presentation.detailBlocks.filter(block => block.kind === 'error')).toHaveLength(1);
    },
  );

  it('does not repeat a structured failure as a result row, summary, or missing-output notice', () => {
    const message = 'Skill package could not be loaded.';
    const presentation = presentFlowerActivityItem(item({ tool_name: 'use_skill', renderer: 'structured', status: 'error',
      description: message, payload: { summary: message, rows: [{ content: message, format: 'text' }], error: { message } },
    }));
    expect(presentation.meta).toBe('');
    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([{ kind: 'error', error: { message } }]);
  });

  it('keeps recovery suggestions with a computer failure after partial output', () => {
    const presentation = presentFlowerActivityItem(item({ tool_name: 'computer.exec', renderer: 'computer', status: 'error',
      payload: { inputs: [{ content: 'await ui.observe()', format: 'code' }], rows: [{ content: 'Page loaded', format: 'text' }],
        error: { code: 'TARGET_UNAVAILABLE', message: 'The selected page was closed.', meta: { target_state: 'closed', repair_action: 'Select an available page', suggested_targets: ['Browser'] } } },
    }));
    expect(presentation.detailBlocks.map(block => block.kind)).toEqual(['structured_rows', 'structured_rows', 'error']);
    expect(presentation.detailBlocks.at(-1)).toMatchObject({ error: { code: 'TARGET_UNAVAILABLE', repair_action: 'Select an available page', suggested_targets: ['Browser'] } });
  });
});

describe('presentFlowerActivityItem', () => {
  it('shows the computer family and keeps concrete results ahead of script details', () => {
    const result = presentFlowerActivityItem(item({ tool_name: 'computer.exec', renderer: 'structured', label: 'Read weather',
      chips: [{ kind: 'browser_source', label: 'Browser', value: 'browser.connected' }],
      target_refs: [{ kind: 'computer_target', label: 'Chrome', resource_ref: 'browser-page' }],
      payload: { inputs: [{ content: 'await ui.observe()', format: 'code' }], rows_provided: true, rows: [{ title: 'Weather', meta: 'page', content: 'Beijing 23°C', format: 'text' }] } }));
    expect(result.label).toBe('BrowserUse: Read weather');
    expect(result.meta).toBe('');
    expect(result.detailBlocks[0]).toMatchObject({ kind: 'structured_rows', section: 'results' });
  });

  it.each(['selected', 'empty_page'])('does not invent expandable detail for a confirmed %s', outcome => {
    const result = presentFlowerActivityItem(item({ tool_name: outcome === 'selected' ? 'computer.select_target' : 'computer.observe', renderer: 'structured', label: 'Inspect Chrome',
      chips: [{ kind: 'computer_result', label: 'result', value: outcome }],
      target_refs: [{ kind: 'computer_target', label: 'Chrome', resource_ref: 'page' }], payload: { rows_provided: true } }));
    expect(result.detailBlocks).toEqual([]);
    expect(result.meta).not.toContain('Chrome');
    expect(result.suppressEmptyDisclosure).toBe(true);
  });

  it.each([
    ['computer.targets', 'Find pages and applications'],
    ['computer.select_target', 'Switch page or application'],
  ])('gives %s a readable action title', (tool, label) => {
    expect(presentFlowerActivityItem(item({ tool_name: tool, label: tool, renderer: 'structured' })).label).toBe(`ComputerUse: ${label}`);
  });

  it('keeps script intent and literal inputs alongside results and the exact frame', () => {
    const code = '  await ui.observe();\nlog("Search");\n';
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'computer.exec', renderer: 'structured', label: 'Locate the search field', status: 'error',
      target_refs: [{ kind: 'computer_target', label: 'Managed browser', resource_ref: 'browser-main' }],
      payload: { operation: 'execute', inputs: [{ content: code, format: 'code', language: 'javascript' }], rows_provided: true,
        rows: [{ content: 'Search field found\nClick stopped', format: 'code', language: 'text', truncated: true }], error: { message: 'Script stopped' } },
    }));
    expect(presentation.label).toBe('ComputerUse: Locate the search field');
    expect(presentation.meta).toBe('');
    expect(presentation.detailBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'structured_rows', section: 'inputs', rows: [expect.objectContaining({ content: code, language: 'javascript' })] }),
      expect.objectContaining({ kind: 'structured_rows', section: 'results', rows: [expect.objectContaining({ truncated: true })] }),
      expect.objectContaining({ kind: 'error' }),
    ]));
  });

  it.each(['success', 'error', 'canceled', 'waiting', 'running'] as const)('distinguishes saved empty output from historical absence while %s', (status) => {
    const base = item({ tool_name: 'computer.exec', renderer: 'structured', label: 'Inspect search', status });
    const saved = presentFlowerActivityItem({ ...base, payload: { inputs: [{ content: 'await ui.observe();', format: 'code' }], rows_provided: true } });
    const history = presentFlowerActivityItem(base);
    const active = status === 'waiting' || status === 'running';
    expect(JSON.stringify(saved)).toContain('await ui.observe();');
    expect(JSON.stringify(saved)).not.toContain('No output');
    expect(JSON.stringify(saved)).not.toContain('did not save');
    expect(JSON.stringify(history).includes('did not save the script')).toBe(!active);
    expect(JSON.stringify(history).includes('did not save result details')).toBe(!active);
  });

  it('shows a saved dedicated screenshot without its target-only result row', () => {
    const resource_ref = `computer://browser-main/${'a'.repeat(64)}`;
    const presentation = presentFlowerActivityItem(item({ tool_name: 'computer.screenshot', renderer: 'structured',
      target_refs: [{ kind: 'computer_frame', label: 'Browser page', resource_ref }],
      payload: { rows_provided: true, rows: [{ title: 'Browser page', content: '', format: 'text' }] },
    }));
    expect(presentation.detailBlocks).toEqual([{ kind: 'image', resource_ref, name: '' }]);
  });

  it('presents confirmed screenshot output without empty-output or platform-code noise', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'computer.click',
      renderer: 'structured',
      target_refs: [{ kind: 'computer_frame', label: 'Redeven Managed Browser', resource_ref: `computer://browser-main/${'a'.repeat(64)}` }],
      chips: [{ kind: 'execution_location', label: 'location', value: 'linux_headless_browser' }],
      payload: {
        action_summary: 'clicked the sign in button',
        safety: { level: 'routine' },
      },
    }));
    expect(presentation.label).toBe('ComputerUse: Click');
    expect(presentation.detailBlocks).toEqual([
      { kind: 'structured_rows', section: 'results', rows: [], notice: undefined },
      expect.objectContaining({ kind: 'image', resource_ref: `computer://browser-main/${'a'.repeat(64)}` }),
    ]);
  });

  it('localizes input labels while preserving the original query', () => {
    const result = presentFlowerActivityItem(item({ tool_name: 'rgrep', renderer: 'structured', label: 'useMemo',
      payload: { inputs: [{ title: 'query', content: 'useMemo', format: 'text' }], rows_provided: true },
    }), { tools: { ...toolActivityEnUS, searchFiles: '搜索文件内容', inputQuery: '搜索条件', noOutput: '没有输出' } });
    expect(result.label).toBe('搜索文件内容 useMemo');
    expect(JSON.stringify(result.detailBlocks)).toContain('搜索条件');
    expect(JSON.stringify(result.detailBlocks)).toContain('useMemo');
    expect(JSON.stringify(result.detailBlocks)).toContain('没有输出');
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
    expect(launcher.meta).toBe('');
  });

  it('joins a Subagent operation target to the exact thread summary', () => {
    const presentation = presentFlowerActivityItem(item({
      item_id: 'subagent:review-api',
      tool_name: 'subagents',
      renderer: 'subagent_operation',
      status: 'running',
      label: 'Review API boundary',
      payload: { action: 'wait', targets: [{ thread_id: 'child-thread-1' }], requested_count: 1 },
    }), {
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
    }), {
      subagentSummaries: [subagentSummary()],
    });

    expect(presentation.detailBlocks).toEqual([]);
  });

  it('keeps historical operation results independent of later child completion and reruns', () => {
    const operation = item({ tool_name: 'subagents', renderer: 'subagent_operation',
      payload: { action: 'wait', targets: [{ thread_id: 'child-thread-1' }], requested_count: 1, completed_count: 0, timed_out: true },
    });
    const completed = presentFlowerActivityItem(operation, {
      subagentSummaries: [subagentSummary({ status: 'completed', created_at_ms: 1000, updated_at_ms: 5000 })],
    });
    const rerunning = presentFlowerActivityItem(operation, {
      subagentSummaries: [subagentSummary({ status: 'running', created_at_ms: 1000, updated_at_ms: 65_000 })],
    });
    expect(completed.label).toBe('Wait timed out · 0/1 completed');
    expect(completed).toEqual(rerunning);
    expect(JSON.stringify(completed)).not.toContain('updated_at_ms');
  });

  it('preserves saved target status while current inventory only supplies missing task identity', () => {
    const operation = item({ tool_name: 'subagents', renderer: 'subagent_operation',
      payload: { action: 'spawn', targets: [{ thread_id: 'child-thread-1', status: 'running' }] },
    });
    const presentation = presentFlowerActivityItem(operation, {
      subagentSummaries: [subagentSummary({ status: 'completed', created_at_ms: 1000, updated_at_ms: 5000 })],
    });
    expect(presentation.label).toBe('Created subagent · Review API boundary');
    const detail = presentation.detailBlocks.find(block => block.kind === 'subagents');
    expect(detail).toMatchObject({ subagents: { items: [{ raw_status: 'running', open_messages: { thread_id: 'child-thread-1' } }] } });
    expect(JSON.stringify(detail)).not.toContain('elapsed_mode');
    expect(JSON.stringify(detail)).not.toContain('created_at_ms');
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

  it('uses the terminal timeout result without a duplicate error block', () => {
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
    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['terminal_output']);
    expect(presentation.detailBlocks[0]).toMatchObject({ terminal: { timed_out: true } });
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

    expect(presentation.detailBlocks.at(-1)).toEqual({
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
    }), {
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
    }), {
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

    expect(presentation.label).toBe('Search docs');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Search docs' });
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

    expect(presentation.detailBlocks.at(-1)).toEqual({
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
    expect(presentation.label).toBe('Web Search: Search latest release');
    expect(presentation.meta).toBe('1 source');
    expect(presentation.detailBlocks).toEqual([{kind:'web_operation',search:{
      results:[{title:'Release notes',url:'https://example.test/release',snippet:'The release is available.',source:''}],
    }}]);
    expect(presentation.detailLines).toEqual([]);
  });

  it('does not invent query text or expandable details for an opaque search', () => {
    for (const tool_name of ['web_search','web.search']) {
      const p = presentFlowerActivityItem(item({tool_name,renderer:'web_search',label:'Web search',payload:{status:'success'}}));
      expect(p.label).toBe('Web Search:');
      expect(p.meta).toBe('');
      expect(p.detailBlocks).toEqual([]);
    }
  });

  it('has no disclosure or missing-data filler for query-only, empty, open or find operations', () => {
    for (const payload of [
      {query:'weather'}, {query:'weather',results_provided:true,results:[]},
      {operation:'open_page',url:'https://example.test/page'},
      {operation:'find_in_page',url:'https://github.com/floegence/redeven',pattern:'Runtime'},
    ]) {
      const p = presentFlowerActivityItem(item({tool_name:'web_search',renderer:'web_search',payload}));
      expect(p.detailBlocks).toEqual([]);
      expect(p.meta).toBe('');
    }
  });

  it('names web operations and preserves actual query syntax and multi-query order', () => {
    const base = {tool_name:'web_search',renderer:'web_search' as const};
    expect(presentFlowerActivityItem(item({...base,payload:{operation:'open_page',url:'https://example.test/weather'}})).label).toBe('Web Search: Open page https://example.test/weather');
    expect(presentFlowerActivityItem(item({...base,payload:{operation:'find_in_page',url:'https://github.com/floegence/redeven',pattern:'Runtime'}})).label).toBe('Web Search: Find “Runtime” @site:github.com');
    const p = presentFlowerActivityItem(item({...base,status:'running',payload:{operation:'search',query:`site:github.com Runtime
Go Runtime`}}));
    expect(p.label).toBe('Web Search: Search site:github.com Runtime +1');
    expect(p.meta).toBe('Running');
  });

  it('uses the exact localized find title without changing the Web Search prefix', () => {
    const p = presentFlowerActivityItem(item({tool_name:'web_search',renderer:'web_search',payload:{operation:'find_in_page',url:'https://github.com/floegence/redeven',pattern:'Runtime'}}), {
      webSearch: {...DEFAULT_FLOWER_SURFACE_COPY.chat.webSearch, findInPage:'查找'},
    });
    expect(p.label).toBe('Web Search: 查找 “Runtime” @site:github.com');
  });

  it('preserves URL-only source order and snippets without synthesizing titles', () => {
    const p = presentFlowerActivityItem(item({tool_name:'web_search',renderer:'web_search',payload:{results:[
      {url:'https://example.test/docs',snippet:'Provider excerpt'},
      {title:'Second',url:'https://second.test'},
      {title:'No URL'},
    ]}}));
    expect(p.detailBlocks).toEqual([{kind:'web_operation',search:{results:[
      {title:'',url:'https://example.test/docs',snippet:'Provider excerpt',source:''},
      {title:'Second',url:'https://second.test',snippet:'',source:''},
    ]}}]);
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
    expect(empty.title).toEqual({ kind: 'plain', text: 'Fetch page' });
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

    expect(presentation.detailBlocks.at(-1)).toEqual({ kind: 'error', error: { message: 'blocked target' } });
    expect(presentation.detailBlocks[0]).toEqual(expect.objectContaining({ kind: 'web_fetch' }));
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
      target_refs: [{ kind: 'file', path: '/workspace/src/app.ts', label: 'app.ts#dcbdf9b8c27f' }],
      payload: {
        operation: 'read',
        display_name: 'app.ts',
        content: 'const value = 1;\n',
        line_offset: 7,
        line_count: 1,
        total_lines: 42,
        truncated: false,
      },
    }));

    expect(presentation.label).toBe('Read app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', display_name: 'app.ts' });
    expect(presentation.meta).not.toContain('#dcbdf9b8c27f');
    expect(presentation.primaryAction).toEqual({
      path: '/workspace/src/app.ts', target_kind: 'file',
      display_name: 'app.ts',
      can_preview: true,
      can_browse_directory: true,
    });
    expect(presentation.detailLines.some((line) => ['content', 'file_path', 'operation'].includes(line.label))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_read',
      action: {
        path: '/workspace/src/app.ts', target_kind: 'file',
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
      target_refs: [{ kind: 'file', path: '/workspace/src/app.ts', label: 'app.ts' }],
      payload: {
        operation: 'write',
        display_name: 'app.ts',
        change_type: 'update',
        additions: 1,
        deletions: 1,
        unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;',
      },
    }));

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
          path: '/workspace/src/app.ts', target_kind: 'file',
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
      target_refs: [{ kind: 'file', path: '/workspace/src/app.ts', label: 'app.ts' }],
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
    }));

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['file_read', 'error']);
    expect(presentation.detailBlocks.at(-1)).toEqual({
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
        { kind: 'file', path: '/workspace/src/app.ts', label: 'app.ts' },
        { kind: 'directory', path: '/workspace/src', label: 'old.ts' },
      ],
      payload: {
        operation: 'apply_patch',
        mutations: [
          {
            display_name: 'app.ts',
            target: {kind:'file',label:'app.ts',path:'/workspace/src/app.ts'},
            change_type: 'update',
            additions: 1,
            deletions: 1,
            unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
          {
            display_name: 'old.ts',
            target: {kind:'directory',label:'src',path:'/workspace/src'},
            change_type: 'delete',
            deletions: 1,
            unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
          },
        ],
      },
    }));

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
          action: { path: '/workspace/src/app.ts', target_kind: 'file', display_name: 'app.ts', can_preview: true, can_browse_directory: true },
        },
        {
          display_name: 'old.ts',
          change_type: 'delete',
          action: { path: '/workspace/src', target_kind: 'directory', display_name: 'old.ts', can_preview: false, can_browse_directory: true },
        },
      ],
    });
  });

  it('renders patch error details even when diff details are present', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      status: 'error',
      target_refs: [{ kind: 'file', path: '/workspace/src/app.ts', label: 'app.ts' }],
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
    }));

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['file_diff', 'error']);
    expect(presentation.detailBlocks.at(-1)).toEqual({
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
      target_refs: [{ kind: 'directory', path: '/workspace/src', label: 'old.ts' }],
      payload: {
        operation: 'apply_patch',
        mutations: [{
          display_name: 'old.ts',
          target: {kind:'directory',label:'src',path:'/workspace/src'},
          change_type: 'delete',
          unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
        }],
      },
    }));

    expect(presentation.label).toBe('Delete old.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Delete', display_name: 'old.ts' });
    expect(presentation.primaryAction).toEqual({
      path: '/workspace/src', target_kind: 'directory',
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

    expect(presentation.title).toEqual({ kind: 'plain', text: 'Run tool vendor internal call' });
    expect(presentation.detailLines).toEqual([]);
    expect(presentation.detailBlocks).toEqual([missingResults]);
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
    expect(presentation.detailBlocks).toEqual([missingResults]);
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
    expect(presentation.detailBlocks).toEqual([missingResults]);
    expect(JSON.stringify(presentation)).not.toContain('must-not-render');
  });

  it.each(['use_skill', 'okf.open'])('only omits duplicate skill headings when presenting %s results', (tool_name) => {
    const name = 'redeven-environment';
    const reason = 'Inspect the selected environment';
    const content = '# Redeven Environment\n\nObserve the selected environment before acting.';
    const inputs = [
      { title: 'name', content: name, format: 'text' },
      { title: 'reason', content: reason, format: 'text' },
    ];
    const presentation = presentFlowerActivityItem(item({
      tool_name,
      renderer: 'structured',
      label: name,
      payload: {
        inputs,
        rows: [{ title: name, meta: reason, content, format: 'markdown', truncated: true }],
        rows_provided: true,
      },
    }));

    expect(presentation.label).toContain(name);
    expect(presentation.detailBlocks).toEqual([
      { kind: 'structured_rows', section: 'inputs', rows: [
        { title: toolActivityEnUS.inputName, meta: '', content: name, format: 'text' },
        { title: toolActivityEnUS.inputReason, meta: '', content: reason, format: 'text' },
      ] },
      { kind: 'structured_rows', section: 'results', rows: [{
        title: tool_name === 'use_skill' ? '' : name,
        meta: tool_name === 'use_skill' ? '' : reason,
        content, format: 'markdown', truncated: true,
      }] },
    ]);
  });

  it('explains missing typed Skill details without inventing content', () => {
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
    expect(presentation.detailBlocks).toEqual([missingResults]);
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
      section: 'results',
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


describe('canvas activity readability', () => {
  it('names the operation instead of an opaque canvas identifier', () => {
    const p = presentFlowerActivityItem(item({ tool_name: 'tessiven.save', renderer: 'structured', label: '3629cc98-c6cc-45c3-ab28-c73b68949174' }));
    expect(p.label).toBe('Save canvas');
    expect(p.label).not.toContain('3629cc98');
  });
  it('keeps useful remote identity and hides the local execution protocol literal', () => {
    const p = presentFlowerActivityItem(item({ label: 'Inspect the layout', payload: { command: 'pwd', execution_location: 'local_runtime' }, chips: [{ kind: 'execution_location', label: 'local_runtime', value: 'local_runtime' }, { kind: 'target', label: 'SSH host', value: 'SSH host' }] }));
    expect(p.meta).toBe('SSH host');
  });
});
