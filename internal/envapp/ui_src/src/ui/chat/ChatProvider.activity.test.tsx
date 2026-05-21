// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatProvider, useChatContext } from './ChatProvider';
import type { Message } from './types';

const renderDisposers: Array<() => void> = [];

function activityMessage(): Message {
  return {
    id: 'msg_approval',
    role: 'assistant',
    status: 'streaming',
    timestamp: 1,
    blocks: [{
      type: 'activity-timeline',
      schemaVersion: 1,
      runId: 'run_1',
      messageId: 'msg_approval',
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
    }],
  };
}

const Probe = () => {
  const ctx = useChatContext();
  const approve = () => ctx.approveToolCall('msg_approval', 'tool_patch', true);
  const summaryStatus = () => {
    const block = ctx.messages()[0]?.blocks[0];
    return block?.type === 'activity-timeline' ? block.summary.status : '';
  };
  const itemState = () => {
    const block = ctx.messages()[0]?.blocks[0];
    if (block?.type !== 'activity-timeline') return '';
    const item = block.groups[0]?.items[0];
    return `${item?.status ?? ''}:${item?.approvalState ?? ''}`;
  };
  return (
    <div>
      <button type="button" onClick={approve}>Approve</button>
      <span data-testid="summary">{summaryStatus()}</span>
      <span data-testid="item">{itemState()}</span>
    </div>
  );
};

function renderProvider(onToolApproval = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <ChatProvider initialMessages={[activityMessage()]} callbacks={{ onToolApproval }}>
      <Probe />
    </ChatProvider>
  ), host);
  renderDisposers.push(dispose);
  return { host, onToolApproval };
}

afterEach(() => {
  while (renderDisposers.length > 0) {
    renderDisposers.pop()?.();
  }
  document.body.innerHTML = '';
});

describe('ChatProvider activity approvals', () => {
  it('updates item and summary state optimistically', async () => {
    const { host, onToolApproval } = renderProvider();

    expect(host.querySelector('[data-testid="summary"]')?.textContent).toBe('waiting');
    expect(host.querySelector('[data-testid="item"]')?.textContent).toBe('waiting:required');

    const approve = host.querySelector('button') as HTMLButtonElement | null;
    approve?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(host.querySelector('[data-testid="summary"]')?.textContent).toBe('running');
    expect(host.querySelector('[data-testid="item"]')?.textContent).toBe('running:approved');
    expect(onToolApproval).toHaveBeenCalledWith('msg_approval', 'tool_patch', true);
  });
});
