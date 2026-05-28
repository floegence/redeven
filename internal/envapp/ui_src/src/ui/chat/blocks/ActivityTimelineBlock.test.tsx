// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityTimelineBlock } from './ActivityTimelineBlock';
import type { ActivityTimelineBlock as ActivityTimelineBlockType } from '../types';

const approveToolCallMock = vi.hoisted(() => vi.fn());
const fetchGatewayJSONMock = vi.hoisted(() => vi.fn());
const writeTextToClipboardMock = vi.hoisted(() => vi.fn());
const aiContextMock = vi.hoisted(() => ({
  activeThreadId: vi.fn(() => 'thread_1'),
  activeThreadWaitingPrompt: vi.fn(() => null),
  getStructuredPromptDrafts: vi.fn(() => ({})),
  setStructuredPromptDraft: vi.fn(),
  submitStructuredPromptResponse: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    approveToolCall: approveToolCallMock,
  }),
}));

vi.mock('../../pages/AIChatContext', () => ({
  useAIChatContext: () => aiContextMock,
}));

vi.mock('../../services/gatewayApi', () => ({
  fetchGatewayJSON: (...args: unknown[]) => fetchGatewayJSONMock(...args),
}));

vi.mock('../../utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboardMock(...args),
}));

const renderDisposers: Array<() => void> = [];

function baseBlock(overrides: Partial<ActivityTimelineBlockType> = {}): ActivityTimelineBlockType {
  return {
    type: 'activity-timeline',
    schemaVersion: 1,
    runId: 'run_1',
    messageId: 'msg_1',
    summary: {
      status: 'success',
      totalItems: 1,
      visibleItems: 1,
      label: '1 command',
    },
    groups: [
      {
        groupId: 'command',
        kind: 'command',
        renderer: 'command',
        status: 'success',
        title: 'Ran command',
        defaultOpen: false,
        items: [
          {
            itemId: 'tool_1',
            toolId: 'tool_1',
            toolName: 'terminal.exec',
            kind: 'command',
            renderer: 'command',
            status: 'success',
            severity: 'quiet',
            label: 'Ran command',
            description: 'go test ./...',
            detailRefs: [{
              refId: 'terminal_output:tool_1',
              kind: 'terminal_output',
              toolId: 'tool_1',
              fetchMode: 'endpoint',
              endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_1/output',
              title: 'Command output',
            }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderActivity(block: ActivityTimelineBlockType = baseBlock()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <ActivityTimelineBlock block={block} messageId="msg_1" blockIndex={0} />, host);
  renderDisposers.push(dispose);
  return host;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  while (renderDisposers.length > 0) {
    renderDisposers.pop()?.();
  }
  approveToolCallMock.mockReset();
  fetchGatewayJSONMock.mockReset();
  writeTextToClipboardMock.mockReset();
  aiContextMock.activeThreadId.mockReturnValue('thread_1');
  aiContextMock.activeThreadWaitingPrompt.mockReturnValue(null);
  aiContextMock.getStructuredPromptDrafts.mockReturnValue({});
  aiContextMock.setStructuredPromptDraft.mockReset();
  aiContextMock.submitStructuredPromptResponse.mockReset();
  document.body.innerHTML = '';
});

describe('ActivityTimelineBlock', () => {
  it('keeps groups compact and opens terminal details from the item row', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      status: 'success',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 8,
      cwd: '/tmp',
    });
    writeTextToClipboardMock.mockResolvedValue(undefined);
    const host = renderActivity();

    expect(host.textContent).toContain('1 command');
    expect(host.textContent).toContain('Ran command');
    expect(host.textContent).not.toContain('go test ./...');

    const header = host.querySelector('.chat-activity-group-head') as HTMLButtonElement | null;
    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('go test ./...');

    expect(host.textContent).not.toContain('Details');

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).toHaveBeenCalledWith('/_redeven_proxy/api/ai/runs/run_1/tools/tool_1/output', { method: 'GET' });
    expect(host.textContent).toContain('Command output');
    expect(host.textContent).toContain('Working directory');
    expect(host.textContent).toContain('/tmp');
    expect(host.textContent).toContain('stdout');
    expect(host.textContent).toContain('ok');

    const copyButton = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Copy stdout') as HTMLButtonElement | undefined;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith('ok\n');
    expect(copyButton?.textContent).toBe('Copied');
  });

  it('supports keyboard expansion and keeps rows without details non-interactive', async () => {
    fetchGatewayJSONMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const host = renderActivity();

    const header = host.querySelector('.chat-activity-group-head') as HTMLButtonElement | null;
    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('true');
    expect(fetchGatewayJSONMock).toHaveBeenCalledTimes(1);

    row?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('false');

    const noDetailHost = renderActivity(baseBlock({
      groups: [{
        groupId: 'command',
        kind: 'command',
        renderer: 'command',
        status: 'success',
        title: 'Ran command',
        defaultOpen: true,
        items: [{
          itemId: 'tool_no_detail',
          toolId: 'tool_no_detail',
          toolName: 'terminal.exec',
          kind: 'command',
          renderer: 'command',
          status: 'success',
          label: 'Ran command',
          description: 'pwd',
        }],
      }],
    }));
    const noDetailRow = noDetailHost.querySelector('.chat-activity-item') as HTMLDivElement | null;
    noDetailRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(noDetailRow?.getAttribute('role')).toBeNull();
    expect(noDetailHost.querySelector('.chat-activity-detail-panel')).toBeNull();
  });

  it('uses inline detail payloads without making an endpoint request', async () => {
    const host = renderActivity(baseBlock({
      groups: [{
        groupId: 'command',
        kind: 'command',
        renderer: 'command',
        status: 'success',
        title: 'Ran command',
        defaultOpen: true,
        items: [{
          itemId: 'tool_inline',
          toolId: 'tool_inline',
          toolName: 'terminal.exec',
          kind: 'command',
          renderer: 'command',
          status: 'success',
          label: 'Ran command',
          description: 'pwd',
          detailRefs: [{
            refId: 'terminal_output:tool_inline',
            kind: 'terminal_output',
            toolId: 'tool_inline',
            fetchMode: 'inline',
            title: 'Command output',
            payload: { stdout: '/workspace\n', exit_code: 0 },
          }],
        }],
      }],
    }));

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('/workspace');
    expect(host.textContent).toContain('Exit');
  });

  it('does not expand a detail row while text is selected', async () => {
    const originalGetSelection = window.getSelection;
    Object.defineProperty(window, 'getSelection', {
      configurable: true,
      value: () => ({ toString: () => 'selected output text' }),
    });
    try {
      const host = renderActivity(baseBlock({
        groups: [{
          groupId: 'command',
          kind: 'command',
          renderer: 'command',
          status: 'success',
          title: 'Ran command',
          defaultOpen: true,
          items: baseBlock().groups[0].items,
        }],
      }));

      const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();

      expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('.chat-activity-detail-panel')).toBeNull();
    } finally {
      Object.defineProperty(window, 'getSelection', {
        configurable: true,
        value: originalGetSelection,
      });
    }
  });

  it('routes approval actions through the chat context', () => {
    const block = baseBlock({
      summary: { status: 'waiting', totalItems: 1, visibleItems: 1, label: '1 approval' },
      groups: [{
        groupId: 'mutation',
        kind: 'mutation',
        renderer: 'file_change',
        status: 'waiting',
        severity: 'blocking',
        title: 'Changed file',
        defaultOpen: true,
        items: [{
          itemId: 'tool_patch',
          toolId: 'tool_patch',
          toolName: 'apply_patch',
          kind: 'mutation',
          renderer: 'file_change',
          status: 'waiting',
          severity: 'blocking',
          label: 'Applied patch',
          requiresApproval: true,
          approvalState: 'required',
          detailRefs: [{
            refId: 'tool_detail:tool_patch',
            kind: 'tool_detail',
            toolId: 'tool_patch',
            fetchMode: 'endpoint',
            endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_patch/detail',
            title: 'Tool detail',
          }],
        }],
      }],
    });
    const host = renderActivity(block);

    const allow = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Allow') as HTMLButtonElement | undefined;
    allow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(approveToolCallMock).toHaveBeenCalledWith('msg_1', 'tool_patch', true);
    expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
    expect(host.querySelector('.chat-activity-detail-panel')).toBeNull();
  });

  it('renders todo details as structured status rows', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      tool_name: 'write_todos',
      status: 'success',
      result: {
        todos: [
          { id: 't1', content: 'Inspect current implementation', status: 'completed' },
          { id: 't2', content: 'Draft renderer contract', status: 'in_progress' },
        ],
      },
    });
    const host = renderActivity(baseBlock({
      summary: { status: 'success', totalItems: 1, visibleItems: 1, label: '1 todo update' },
      groups: [{
        groupId: 'todos',
        kind: 'todo',
        renderer: 'todos',
        status: 'success',
        title: 'Updated todos',
        defaultOpen: true,
        items: [{
          itemId: 'tool_todos',
          toolId: 'tool_todos',
          toolName: 'write_todos',
          kind: 'todo',
          renderer: 'todos',
          status: 'success',
          label: 'Updated todos',
          detailRefs: [{
            refId: 'tool_detail:tool_todos',
            kind: 'tool_detail',
            toolId: 'tool_todos',
            fetchMode: 'endpoint',
            endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_todos/detail',
            title: 'Tool detail',
          }],
        }],
      }],
    }));

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Todo changes');
    expect(host.textContent).toContain('Inspect current implementation');
    expect(host.textContent).toContain('In progress');
    expect(host.textContent).not.toContain('"todos"');
  });

  it('copies localized fallback text for untitled todo summaries', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      tool_name: 'write_todos',
      status: 'success',
      result: {
        todos: [
          { id: 't1', status: 'pending' },
        ],
      },
    });
    const host = renderActivity(baseBlock({
      summary: { status: 'success', totalItems: 1, visibleItems: 1, label: '1 todo update' },
      groups: [{
        groupId: 'todos',
        kind: 'todo',
        renderer: 'todos',
        status: 'success',
        title: 'Updated todos',
        defaultOpen: true,
        items: [{
          itemId: 'tool_todos',
          toolId: 'tool_todos',
          toolName: 'write_todos',
          kind: 'todo',
          renderer: 'todos',
          status: 'success',
          label: 'Updated todos',
          detailRefs: [{
            refId: 'tool_detail:tool_todos',
            kind: 'tool_detail',
            toolId: 'tool_todos',
            fetchMode: 'endpoint',
            endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_todos/detail',
            title: 'Tool detail',
          }],
        }],
      }],
    }));

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const copyButton = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Copy summary') as HTMLButtonElement | undefined;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Untitled todo');
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('pending: Untitled todo');
  });

  it('renders file, web, and generic tool details without exposing raw JSON', async () => {
    const block = baseBlock({
      summary: { status: 'success', totalItems: 3, visibleItems: 3, label: '3 actions' },
      groups: [{
        groupId: 'mixed',
        kind: 'mixed',
        renderer: 'mixed',
        status: 'success',
        title: 'Activity',
        defaultOpen: true,
        items: [
          {
            itemId: 'tool_patch',
            toolId: 'tool_patch',
            toolName: 'apply_patch',
            kind: 'mutation',
            renderer: 'file_change',
            status: 'success',
            label: 'Applied patch',
            detailRefs: [{
              refId: 'tool_detail:tool_patch',
              kind: 'tool_detail',
              toolId: 'tool_patch',
              fetchMode: 'endpoint',
              endpoint: '/patch',
              title: 'Tool detail',
            }],
          },
          {
            itemId: 'tool_web',
            toolId: 'tool_web',
            toolName: 'web.search',
            kind: 'research',
            renderer: 'sources',
            status: 'success',
            label: 'Searched the web',
            detailRefs: [{
              refId: 'tool_detail:tool_web',
              kind: 'tool_detail',
              toolId: 'tool_web',
              fetchMode: 'endpoint',
              endpoint: '/web',
              title: 'Tool detail',
            }],
          },
          {
            itemId: 'tool_skill',
            toolId: 'tool_skill',
            toolName: 'use_skill',
            kind: 'skill',
            renderer: 'skill',
            status: 'success',
            label: 'Loaded skill',
            detailRefs: [{
              refId: 'tool_detail:tool_skill',
              kind: 'tool_detail',
              toolId: 'tool_skill',
              fetchMode: 'endpoint',
              endpoint: '/skill',
              title: 'Tool detail',
            }],
          },
        ],
      }],
    });
    fetchGatewayJSONMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/patch') {
        return Promise.resolve({
          tool_name: 'apply_patch',
          status: 'success',
          args: { patch: '*** Begin Patch\n*** Update File: src/ui/chat/activity/ActivityDetailPanel.tsx\n@@\n+panel\n*** End Patch' },
        });
      }
      if (endpoint === '/web') {
        return Promise.resolve({
          tool_name: 'web.search',
          status: 'success',
          args: { query: 'active agent UI tool details' },
          result: { sources: [{ title: 'Agent UI', url: 'https://example.com/agent-ui', snippet: 'Expandable tool calls.' }] },
        });
      }
      return Promise.resolve({
        tool_name: 'use_skill',
        status: 'success',
        args: { name: 'frontend-design', api_key: 'sk-secret', value: 'inline-secret', contains_secret: true },
        result: { loaded: true, metadata: { origin: 'local' } },
      });
    });
    const host = renderActivity(block);
    const rows = [...host.querySelectorAll('.chat-activity-item-clickable')] as HTMLDivElement[];

    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('ActivityDetailPanel.tsx');
    expect(host.textContent).toContain('active agent UI tool details');
    expect(host.textContent).toContain('Agent UI');
    expect(host.textContent).toContain('Name');
    expect(host.textContent).toContain('frontend-design');
    expect(host.textContent).toContain('Api Key');
    expect(host.textContent).toContain('********');
    expect(host.textContent).not.toContain('sk-secret');
    expect(host.textContent).not.toContain('inline-secret');
    expect(host.textContent).not.toContain('Contains Secret');
    expect(host.textContent).not.toContain('"api_key"');
  });

  it('shows a product error state and retry action when detail loading fails', async () => {
    fetchGatewayJSONMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ stdout: 'ok\n' });
    const host = renderActivity(baseBlock({
      groups: [{
        groupId: 'command',
        kind: 'command',
        renderer: 'command',
        status: 'error',
        title: 'Ran command',
        defaultOpen: true,
        items: [{
          itemId: 'tool_1',
          toolId: 'tool_1',
          toolName: 'terminal.exec',
          kind: 'command',
          renderer: 'command',
          status: 'error',
          label: 'Ran command',
          description: 'go test ./...',
          detailRefs: [{
            refId: 'terminal_output:tool_1',
            kind: 'terminal_output',
            toolId: 'tool_1',
            fetchMode: 'endpoint',
            endpoint: '/output',
            title: 'Command output',
          }],
        }],
      }],
    }));

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Detail unavailable');
    expect(host.textContent).toContain('network down');

    const retry = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('stdout');
    expect(host.textContent).toContain('ok');
  });

  it('does not call a still-waiting ask_user prompt resolved when active prompt data is missing', () => {
    const block = baseBlock({
      summary: { status: 'waiting', totalItems: 1, visibleItems: 1, label: '1 input request' },
      groups: [{
        groupId: 'interaction',
        kind: 'interaction',
        renderer: 'blocking_prompt',
        status: 'waiting',
        severity: 'blocking',
        title: 'Needs input',
        defaultOpen: true,
        items: [{
          itemId: 'tool_ask',
          toolId: 'tool_ask',
          toolName: 'ask_user',
          kind: 'interaction',
          renderer: 'blocking_prompt',
          status: 'waiting',
          severity: 'blocking',
          label: 'Input requested',
          payload: {
            questions: [{
              id: 'q1',
              header: 'Need input',
              question: 'Choose next step',
              response_mode: 'write',
            }],
          },
        }],
      }],
    });
    const host = renderActivity(block);

    expect(host.textContent).toContain('Choose next step');
    expect(host.textContent).toContain('Input unavailable');
    expect(host.textContent).not.toContain('Input resolved');
  });
});
