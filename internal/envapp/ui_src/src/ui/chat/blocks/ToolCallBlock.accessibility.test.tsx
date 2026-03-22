// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { ChatProvider } from '../ChatProvider';
import { ToolCallBlock } from './ToolCallBlock';
import type { ToolCallBlock as ToolCallBlockType } from '../types';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ToolCallBlock accessibility', () => {
  it('renders the disclosure through a dedicated button and keeps approval actions separate', () => {
    const block: ToolCallBlockType = {
      type: 'tool-call',
      toolName: 'exec',
      toolId: 'tool-1',
      args: { cmd: 'pwd' },
      status: 'success',
      collapsed: true,
      result: 'ok',
      requiresApproval: true,
      approvalState: 'required',
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <ChatProvider>
        <ToolCallBlock
          block={block}
          messageId="message-1"
          blockIndex={0}
        />
      </ChatProvider>
    ), host);

    const headerButton = host.querySelector('.chat-tool-call-header-button') as HTMLButtonElement | null;
    const approvalActions = host.querySelector('.chat-tool-approval-actions');

    expect(headerButton).toBeTruthy();
    expect(headerButton?.getAttribute('aria-expanded')).toBe('false');
    expect(headerButton?.getAttribute('aria-controls')).toContain('chat-tool-call-body-');
    expect(approvalActions).toBeTruthy();
    expect(headerButton?.querySelector('.chat-tool-approval-actions')).toBeNull();
  });
});
