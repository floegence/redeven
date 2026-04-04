import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import { decorateMessageBlocks } from './aiBlockPresentation';

describe('aiBlockPresentation terminal.exec decoration', () => {
  it('preserves effective default timeout metadata from tool results', () => {
    const message: Message = {
      id: 'msg_1',
      role: 'assistant',
      status: 'complete',
      timestamp: 1,
      blocks: [
        {
          type: 'tool-call',
          toolName: 'terminal.exec',
          toolId: 'tool_1',
          args: { command: 'go test ./...' },
          result: {
            output_ref: { run_id: 'run_1', tool_id: 'tool_1' },
            timeout_ms: 120000,
            timeout_source: 'default',
          },
          status: 'running',
        },
      ],
    };

    const next = decorateMessageBlocks(message);
    expect(next.blocks[0]).toMatchObject({
      type: 'shell',
      command: 'go test ./...',
      timeoutMs: 120000,
      timeoutSource: 'default',
      status: 'running',
      outputRef: { runId: 'run_1', toolId: 'tool_1' },
    });
  });

  it('preserves capped timeout metadata and requested timeout when present', () => {
    const message: Message = {
      id: 'msg_2',
      role: 'assistant',
      status: 'complete',
      timestamp: 2,
      blocks: [
        {
          type: 'tool-call',
          toolName: 'terminal.exec',
          toolId: 'tool_2',
          args: { command: 'npm test', timeout_ms: 1800000 },
          result: {
            output_ref: { run_id: 'run_2', tool_id: 'tool_2' },
            timeout_ms: 600000,
            requested_timeout_ms: 1800000,
            timeout_source: 'capped',
            timed_out: true,
          },
          status: 'error',
          error: 'Tool execution timed out after 600000 ms',
        },
      ],
    };

    const next = decorateMessageBlocks(message);
    expect(next.blocks[0]).toMatchObject({
      type: 'shell',
      command: 'npm test',
      timeoutMs: 600000,
      requestedTimeoutMs: 1800000,
      timeoutSource: 'capped',
      timedOut: true,
      status: 'error',
    });
  });
});
