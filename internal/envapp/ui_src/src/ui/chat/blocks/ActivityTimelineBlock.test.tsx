// @vitest-environment jsdom

import { Show } from 'solid-js';
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

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="dialog">
        <div>{props.title}</div>
        {props.children}
      </div>
    </Show>
  ),
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
  it('keeps groups compact and opens fetched details on demand', async () => {
    fetchGatewayJSONMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    writeTextToClipboardMock.mockResolvedValue(undefined);
    const host = renderActivity();

    expect(host.textContent).toContain('1 command');
    expect(host.textContent).toContain('Ran command');
    expect(host.textContent).not.toContain('go test ./...');

    const header = host.querySelector('.chat-activity-group-head') as HTMLButtonElement | null;
    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('go test ./...');

    const detailButton = host.querySelector('.chat-activity-detail-btn') as HTMLButtonElement | null;
    detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).toHaveBeenCalledWith('/_redeven_proxy/api/ai/runs/run_1/tools/tool_1/output', { method: 'GET' });
    expect(document.body.textContent).toContain('Command output');
    expect(document.body.textContent).toContain('stdout');
    expect(document.body.textContent).toContain('ok');

    const copyButton = document.body.querySelector('.chat-activity-detail-copy') as HTMLButtonElement | null;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith('stdout\nok\n');
    expect(copyButton?.textContent).toBe('Copied');
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
        }],
      }],
    });
    const host = renderActivity(block);

    const allow = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Allow') as HTMLButtonElement | undefined;
    allow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(approveToolCallMock).toHaveBeenCalledWith('msg_1', 'tool_patch', true);
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
