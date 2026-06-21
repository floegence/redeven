// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerActivityStatus,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface navigation activity', () => {
  it('renders file activity actions and unified patch lines inline', async () => {
    const previewFile = vi.fn(async () => {});
    const browseFolder = vi.fn(async () => {});
    const activityThread = thread({
      thread_id: 'thread-file-activity',
      title: 'File activity',
      messages: [
        {
          id: 'm-file',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 20,
          blocks: [
            {
              type: 'markdown',
              content: 'I will edit the file.',
            },
            activityTimeline({
              file_actions: {
                edit_app: {
                  action_id: 'edit_app',
                  display_name: 'app.ts',
                  can_preview: true,
                  can_browse_directory: true,
                },
              },
              items: [activityItem({
                item_id: 'tool-write',
                tool_id: 'tool-write',
                tool_name: 'file.write',
                renderer: 'file',
                label: 'app.ts#dcbdf9b8c27f',
                payload: {
                  operation: 'write',
                  display_name: 'app.ts',
                  file_action_id: 'edit_app',
                  change_type: 'update',
                  additions: 1,
                  deletions: 1,
                  unified_diff: [
                    '--- a/src/app.ts',
                    '+++ b/src/app.ts',
                    '@@ -1,1 +1,1 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                  ].join('\n'),
                },
              })],
            }),
            {
              type: 'markdown',
              content: 'Done.',
            },
          ],
        },
      ],
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [activityThread]),
      loadThread: vi.fn(async () => liveBootstrap(activityThread)),
      openFilePreview: previewFile,
      openFileBrowser: browseFolder,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-file-activity"] button')));
    (host.querySelector('[data-thread-id="thread-file-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-activity-item-id="tool-write"]')));

    expect(host.textContent).toContain('I will edit the file.');
    expect(host.textContent).toContain('Done.');
    expect(host.textContent).not.toContain('#dcbdf9b8c27f');
    expect(host.querySelectorAll('.flower-activity-inline-line > .flower-activity-file-actions button')).toHaveLength(2);
    const preview = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
    const browser = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
    expect(preview?.disabled).toBe(false);
    expect(browser?.disabled).toBe(false);

    const toggle = host.querySelector('[data-flower-activity-item-id="tool-write"] .flower-activity-inline-button') as HTMLButtonElement;
    toggle.click();
    await waitFor(() => Boolean(host.querySelector('.flower-activity-file-diff-line-del')));
    expect(host.querySelector('.flower-activity-file-diff-line-del')?.textContent).toContain('-const value = 1;');
    expect(host.querySelector('.flower-activity-file-diff-line-add')?.textContent).toContain('+const value = 2;');

    preview?.click();
    browser?.click();
    expect(previewFile).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
    expect(browseFolder).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
  });

  it('renders streaming assistant output with bottom thinking text and a wide transcript stack', async () => {
    const streamingThread = thread({
      thread_id: 'thread-streaming',
      title: 'Streaming answer',
      created_at_ms: 5_000,
      updated_at_ms: 5_200,
      status: 'running',
      messages: [
        {
          id: 'm-user-streaming',
          role: 'user',
          content: 'Stream this',
          status: 'complete',
          created_at_ms: 5_000,
        },
        {
          id: 'm-assistant-streaming',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 5_200,
          blocks: [
            { type: 'thinking', content: 'Checking the workspace.' },
            { type: 'markdown', content: 'Streaming partial answer' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-streaming"] button')));
    (runtime.querySelector('[data-thread-id="thread-streaming"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-streaming-cursor')));

    expect(runtime.querySelector('.flower-transcript-stack')).toBeTruthy();
    expect(runtime.querySelector('.flower-message-bubble-streaming')?.textContent).toContain('Streaming partial answer');
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-block-stack-assistant')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-plain')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-role="user"] .flower-message-bubble-framed')).toBeTruthy();
    expect(runtime.querySelector('.flower-streaming-cursor')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-streaming-cursor')).toBeNull();
    expect(runtime.querySelector('.flower-message-streaming-tail')?.textContent).toContain('Thinking...');
    expect(runtime.textContent).toContain('Streaming partial answer');
  });

  it('keeps bottom thinking text visible after completed tool activity while the thread is still running', async () => {
    const toolGapThread = thread({
      thread_id: 'thread-tool-gap-thinking',
      title: 'Tool gap thinking',
      created_at_ms: 5_400,
      updated_at_ms: 5_500,
      status: 'running',
      messages: [
        {
          id: 'm-tool-gap',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 5_500,
          blocks: [
            activityTimeline({
              run_id: 'run-tool-gap',
              turn_id: 'm-tool-gap',
              status: 'success',
              severity: 'quiet',
              items: [activityItem({
                item_id: 'tool-gap-done',
                tool_id: 'tool-gap-done',
                tool_name: 'terminal.exec',
                status: 'success',
                severity: 'quiet',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test', exit_code: 0 },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolGapThread]),
      loadThread: vi.fn(async () => liveBootstrap(toolGapThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-tool-gap-thinking"] button')));
    (runtime.querySelector('[data-thread-id="thread-tool-gap-thinking"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-gap-done"]')));

    expect(runtime.querySelector('[data-flower-activity-item-id="tool-gap-done"]')?.getAttribute('data-flower-activity-status')).toBe('success');
    expect(runtime.querySelectorAll('.flower-streaming-cursor')).toHaveLength(1);
    expect(runtime.querySelector('.flower-message-streaming-tail')?.textContent).toContain('Thinking...');
  });

  it.each(['success', 'failed', 'canceled', 'waiting_approval', 'waiting_user'] as const)(
    'does not show the bottom thinking text for %s threads',
    async (status) => {
      const idleThread = thread({
        thread_id: `thread-no-thinking-${status}`,
        title: `No thinking ${status}`,
        status,
        messages: [
          {
            id: `m-no-thinking-${status}`,
            role: 'assistant',
            content: 'Visible answer.',
            status: status === 'canceled' ? 'canceled' : status === 'failed' ? 'error' : 'complete',
            created_at_ms: 5_700,
            blocks: [{ type: 'markdown', content: 'Visible answer.' }],
          },
        ],
        ...(status === 'waiting_user' ? { input_request: inputRequest() } : {}),
      });
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [idleThread]),
        loadThread: vi.fn(async () => liveBootstrap(idleThread)),
      });

      await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="thread-no-thinking-${status}"] button`)));
      (runtime.querySelector(`[data-thread-id="thread-no-thinking-${status}"] button`) as HTMLButtonElement).click();
      await waitFor(() => runtime.textContent?.includes('Visible answer.') ?? false);

      expect(runtime.querySelector('.flower-streaming-cursor')).toBeNull();
    },
  );

  it('shows completed Flower activity inline between assistant text blocks', async () => {
    const tool_names = [
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'write_todos',
      'task_complete',
    ] as const;
    const toolsThread = thread({
      thread_id: 'thread-tools',
      title: 'Tool activity',
      created_at_ms: 6_000,
      updated_at_ms: 6_500,
      status: 'success',
      messages: [
        {
          id: 'm-tools',
          role: 'assistant',
          content: 'I will check the workspace.\n\nI finished the answer after the audit trail.',
          status: 'complete',
          created_at_ms: 6_500,
          blocks: [
            { type: 'markdown', content: 'I will check the workspace.' },
            activityTimeline({
              run_id: 'run-tools',
              turn_id: 'm-tools',
              items: tool_names.map((tool_name, index) => activityItem({
                item_id: `item-${index}`,
                tool_id: `tool-${index}`,
                tool_name,
                kind: tool_name === 'task_complete' ? 'control' : 'tool',
                status: 'success',
                severity: 'quiet',
                ...(tool_name === 'terminal.exec'
                  ? {
                      label: `npm run check:${index}`,
                      renderer: 'terminal',
                      payload: { command: `npm run check:${index}`, exit_code: 0 },
                    }
                  : tool_name === 'write_todos'
                    ? {
                        label: 'Update todos',
                        renderer: 'todos',
                        payload: { todos: [{ content: 'Verify inline activity', status: 'completed' }] },
                      }
                    : {
                        label: 'task_complete',
                        renderer: 'completion',
                        payload: { result: 'done' },
                      }),
              })),
            }),
            { type: 'markdown', content: 'I finished the answer after the audit trail.' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolsThread]),
      loadThread: vi.fn(async () => liveBootstrap(toolsThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-tools"] button')));
    (runtime.querySelector('[data-thread-id="thread-tools"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-activity-inline')));

    const transcriptText = runtime.textContent ?? '';
    expect(transcriptText.indexOf('I will check the workspace.')).toBeLessThan(transcriptText.indexOf('npm run check:0'));
    expect(transcriptText.indexOf('npm run check:0')).toBeLessThan(transcriptText.indexOf('I finished the answer after the audit trail.'));
    expect(runtime.querySelector('.flower-tool-activity')).toBeNull();
    expect(runtime.querySelector('.flower-todo-snapshot')).toBeNull();
    expect(runtime.textContent).not.toContain('3 / 3 completed');
    expect(runtime.textContent).not.toContain('Draft final answer');
    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(tool_names.length);
    expect(runtime.textContent).not.toContain('terminal.execterminal.exec');
    expect(runtime.textContent).toContain('Update todos');
    expect(runtime.textContent).toContain('completed 1');
    expect(runtime.textContent).toContain('task_complete');
    const firstTerminalRow = runtime.querySelector('[data-flower-activity-item-id="item-0"]');
    expect(firstTerminalRow).toBeTruthy();
    expect(firstTerminalRow?.textContent).toContain('npm run check:0');
  });

  it('renders approval controls inside the matching tool activity row', async () => {
    const approveThread = thread({
      thread_id: 'thread-inline-approval',
      title: 'Inline approval',
      created_at_ms: 6_800,
      updated_at_ms: 6_900,
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-terminal',
        run_id: 'run-inline-approval',
        tool_id: 'tool-needs-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 6_850,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'terminal.exec',
          description: 'Review this command before it runs.',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-inline-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 6_900,
          blocks: [
            activityTimeline({
              run_id: 'run-inline-approval',
              turn_id: 'm-inline-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'approval-item',
                tool_id: 'tool-needs-approval',
                tool_name: 'terminal.exec',
                kind: 'approval',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'pwd; sleep 15; date',
                renderer: 'terminal',
                payload: { command: 'pwd; sleep 15; date' },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approveThread]),
      loadThread: vi.fn(async () => ({
        ...liveBootstrap({
          ...approveThread,
          approval_actions: [],
        }, 12),
        live_state: {
          ...liveBootstrap(approveThread, 12).live_state,
          approval_actions: {
            'appr-terminal': approveThread.approval_actions![0]!,
          },
        },
      })),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-inline-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-inline-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="approval-item"] .flower-approval-card')));

    const row = runtime.querySelector('[data-flower-activity-item-id="approval-item"]') as HTMLElement | null;
    expect(row?.textContent).toContain('pwd; sleep 15; date');
    expect(row?.querySelector('[data-flower-approval-action-id="appr-terminal"]')).toBeTruthy();
    expect(row?.textContent).toContain('Approve');
    expect(runtime.querySelector('.flower-transcript-stack > .flower-approval-stack')).toBeNull();
  });

  it('refreshes canonical thread state when an approval decision is stale', async () => {
    const pendingThread = thread({
      thread_id: 'thread-stale-approval',
      title: 'Stale approval',
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-stale',
        run_id: 'run-stale-approval',
        tool_id: 'tool-stale-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 7_100,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'terminal.exec',
          description: 'Review this command before it runs.',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-stale-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 7_100,
          blocks: [
            activityTimeline({
              run_id: 'run-stale-approval',
              turn_id: 'm-stale-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'stale-approval-item',
                tool_id: 'tool-stale-approval',
                tool_name: 'terminal.exec',
                kind: 'approval',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test' },
              })],
            }),
          ],
        },
      ],
    });
    const resolvedThread = {
      ...pendingThread,
      status: 'running' as const,
      approval_actions: [],
      messages: pendingThread.messages.map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => block.type === 'activity-timeline'
          ? {
              ...block,
              summary: {
                ...block.summary,
                status: 'running' as const,
                needs_attention: false,
                attention_reasons: [],
                counts: { running: 1, approval: 1 },
              },
              items: block.items.map((item) => ({
                ...item,
                status: 'running' as const,
                needs_attention: false,
                approval_state: 'approved' as const,
              })),
            }
          : block),
      })),
    };
    const loadThread = vi.fn(async () => {
      if (loadThread.mock.calls.length <= 1) {
        return {
          ...liveBootstrap({
            ...pendingThread,
            approval_actions: [],
          }, 13),
          live_state: {
            ...liveBootstrap(pendingThread, 13).live_state,
            approval_actions: {
              'appr-stale': pendingThread.approval_actions![0]!,
            },
          },
        };
      }
      return liveBootstrap({
        ...resolvedThread,
        approval_actions: [],
      }, 13);
    });
    const submitApproval = vi.fn(async () => {
      throw new Error('approval no longer pending');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [pendingThread]),
      loadThread,
      submitApproval,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-stale"]')));
    const approve = Array.from(runtime.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Approve');
    expect(approve).toBeTruthy();
    approve?.click();

    await waitFor(() => submitApproval.mock.calls.length === 1);
    await waitFor(() => loadThread.mock.calls.length >= 2);
    expect(runtime.textContent).toContain('approval no longer pending');
    await waitFor(() => runtime.querySelector('[data-flower-approval-action-id="appr-stale"]') === null);
  });

  it('hides approval-only terminal noise while keeping command and output details visible', async () => {
    const terminalThread = thread({
      thread_id: 'thread-terminal-output',
      title: 'Terminal output',
      created_at_ms: 6_600,
      updated_at_ms: 6_700,
      status: 'success',
      messages: [
        {
          id: 'm-terminal-output',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_700,
          blocks: [
            activityTimeline({
              run_id: 'run-terminal-output',
              turn_id: 'm-terminal-output',
              items: [
                activityItem({
                  item_id: 'approval-only',
                  tool_id: 'approval-only',
                  tool_name: 'terminal.exec',
                  kind: 'approval',
                  requires_approval: true,
                  approval_state: 'approved',
                }),
                activityItem({
                  item_id: 'terminal-real',
                  tool_id: 'terminal-real',
                  tool_name: 'terminal.exec',
                  label: 'terminal.exec',
                  renderer: 'terminal',
                  payload: {
                    command: 'curl -s https://example.com',
                    exit_code: 0,
                    stdout: 'example response',
                    stderr: '',
                  },
                }),
              ],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-terminal-output"] button')));
    (runtime.querySelector('[data-thread-id="thread-terminal-output"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelector('[data-flower-activity-item-id="approval-only"]')).toBeNull();
    expect(runtime.querySelector('[data-flower-activity-item-id="terminal-real"]')).toBeTruthy();
    expect(runtime.textContent).toContain('curl -s https://example.com');
    (runtime.querySelector('[data-flower-activity-item-id="terminal-real"] .flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('example response') ?? false);
    expect(runtime.textContent).toContain('example response');
    expect(runtime.textContent).not.toContain('approvalapproved');
  });

  it('refreshes inline activity when message block fields change in place', async () => {
    const runningActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'running',
      severity: 'normal',
      needs_attention: true,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'running',
        severity: 'normal',
        needs_attention: true,
        started_at_unix_ms: 6_000,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test' },
      })],
    });
    const completeActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        started_at_unix_ms: 6_000,
        ended_at_unix_ms: 7_250,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test', exit_code: 0 },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-refresh-block',
      title: 'Refresh block',
      created_at_ms: 6_000,
      updated_at_ms: 6_100,
      status: 'idle',
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant',
          content: 'Running tests.',
          status: 'complete',
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown', content: 'Running tests.' },
            runningActivity,
          ],
        },
      ],
    });
    const completeThread = {
      ...runningThread,
      updated_at_ms: 6_200,
      status: 'success' as const,
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant' as const,
          content: 'Running tests.\n\nTests passed.',
          status: 'complete' as const,
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown' as const, content: 'Running tests.' },
            completeActivity,
            { type: 'markdown' as const, content: 'Tests passed.' },
          ],
        },
      ],
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? runningThread : completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-refresh-block"] button')));
    (runtime.querySelector('[data-thread-id="thread-refresh-block"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'running');

    listSnapshot = [completeThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'success');
    expect(runtime.textContent).toContain('Done');
    expect(runtime.textContent).toContain('1s');
    expect(runtime.textContent).toContain('Tests passed.');
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps waiting activity visible even if a timeline summary is marked digest', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-activity',
      title: 'Waiting activity',
      created_at_ms: 6_700,
      updated_at_ms: 6_900,
      status: 'waiting_user',
      messages: [
        {
          id: 'm-waiting',
          role: 'assistant',
          content: 'I need one choice.',
          status: 'complete',
          created_at_ms: 6_900,
          blocks: [
            { type: 'markdown', content: 'I need one choice.' },
            activityTimeline({
              run_id: 'run-waiting',
              turn_id: 'm-waiting',
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-ask',
                tool_id: 'tool-ask',
                tool_name: 'ask_user',
                kind: 'control',
                label: 'Requested input',
                description: 'Choose a target before continuing.',
                renderer: 'question',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                attention_reasons: ['waiting'],
                payload: {
                  reason_code: 'needs_user_choice',
                  required_from_user: ['target'],
                  questions: [{
                    id: 'target',
                    header: 'Target',
                    question: 'Choose a target before continuing.',
                  }],
                  contains_secret: false,
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-activity"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Requested input') ?? false);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    {
      name: 'running',
      status: 'running' as FlowerActivityStatus,
      severity: 'normal' as const,
    },
    {
      name: 'error',
      status: 'error' as FlowerActivityStatus,
      severity: 'error' as const,
      description: 'stderr includes a failing test.',
    },
    {
      name: 'approval',
      status: 'pending' as FlowerActivityStatus,
      severity: 'blocking' as const,
      requires_approval: true,
      approval_state: 'requested' as const,
    },
  ])('keeps $name activity visible even if a timeline summary is marked digest', async (scenario) => {
    const attentionThread = thread({
      thread_id: `thread-${scenario.name}-activity`,
      title: `${scenario.name} activity`,
      created_at_ms: 6_910,
      updated_at_ms: 6_950,
      status: scenario.status === 'running' ? 'running' : scenario.status === 'error' ? 'failed' : 'waiting_user',
      messages: [
        {
          id: `m-${scenario.name}`,
          role: 'assistant',
          content: `Working on ${scenario.name}.`,
          status: scenario.status === 'error' ? 'error' : 'complete',
          created_at_ms: 6_950,
          blocks: [
            { type: 'markdown', content: `Working on ${scenario.name}.` },
            activityTimeline({
              run_id: `run-${scenario.name}`,
              turn_id: `m-${scenario.name}`,
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: `item-${scenario.name}`,
                tool_id: `tool-${scenario.name}`,
                tool_name: scenario.requires_approval ? 'terminal.exec' : 'shell.exec',
                kind: 'tool',
                label: `npm run check:${scenario.name}`,
                renderer: 'terminal',
                status: scenario.status,
                severity: scenario.severity,
                needs_attention: true,
                requires_approval: scenario.requires_approval ?? false,
                approval_state: scenario.approval_state,
                description: scenario.description,
                payload: {
                  command: `npm run check:${scenario.name}`,
                  ...(scenario.description ? { stderr: scenario.description } : {}),
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [attentionThread]),
      loadThread: vi.fn(async () => liveBootstrap(attentionThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`)));
    (runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });
});
