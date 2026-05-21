import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import { createAIThreadRenderController } from './createAIThreadRenderController';

describe('createAIThreadRenderController', () => {
  it('projects transcript messages while carrying forward optimistic local user turns', () => {
    const [previousRenderedMessages] = createSignal<Message[]>([
      {
        id: 'u_local_1',
        role: 'user',
        status: 'complete',
        timestamp: 10,
        blocks: [{ type: 'text', content: 'draft turn' }],
      },
    ]);

    const dispose = createRoot((disposeRoot) => {
      const controller = createAIThreadRenderController({
        previousRenderedMessages,
      });

      controller.replaceTranscriptMessages([{
        id: 'm_ai_1',
        role: 'assistant',
        status: 'complete',
        timestamp: 20,
        blocks: [{ type: 'markdown', content: 'persisted answer' }],
      }]);

      expect(controller.projectedMessages().map((message) => message.id)).toEqual(['m_ai_1', 'u_local_1']);

      return disposeRoot;
    });

    dispose();
  });

  it('derives active subagents from transcript state without projection feedback', () => {
    const [previousRenderedMessages] = createSignal<Message[]>([]);
    const dispose = createRoot((disposeRoot) => {
      const controller = createAIThreadRenderController({
        previousRenderedMessages,
      });

      controller.replaceTranscriptMessages([{
        id: 'm_ai_subagent_1',
        role: 'assistant',
        status: 'complete',
        timestamp: 20,
        blocks: [{
          type: 'subagent',
          subagentId: 'sa_1',
          taskId: 'task_1',
          agentType: 'worker',
          triggerReason: 'delegate',
          status: 'running',
          summary: 'working',
          evidenceRefs: [],
          keyFiles: [],
          openRisks: [],
          nextActions: [],
          history: [],
          stats: { steps: 0, toolCalls: 0, tokens: 0, elapsedMs: 0, outcome: '' },
          updatedAtUnixMs: 200,
        }],
      }]);

      expect(controller.activeThreadSubagents()).toHaveLength(1);
      expect(controller.activeThreadSubagents()[0]).toMatchObject({
        subagentId: 'sa_1',
        status: 'running',
      });

      controller.replaceTranscriptMessages([{
        id: 'm_ai_subagent_reset',
        role: 'assistant',
        status: 'complete',
        timestamp: 30,
        blocks: [{ type: 'markdown', content: 'no subagent blocks remain' }],
      }]);

      expect(controller.activeThreadSubagents()).toHaveLength(0);

      return disposeRoot;
    });

    dispose();
  });

  it('batches live-run events and clears the live tail once transcript catches up', () => {
    const [previousRenderedMessages] = createSignal<Message[]>([]);
    const scheduledCallbacks: FrameRequestCallback[] = [];

    const dispose = createRoot((disposeRoot) => {
      const controller = createAIThreadRenderController({
        previousRenderedMessages,
        scheduleAnimationFrame: (callback) => {
          scheduledCallbacks.push(callback);
          return scheduledCallbacks.length;
        },
        cancelAnimationFrame: () => undefined,
      });

      controller.applyLiveRunStreamEvent({ type: 'message-start', messageId: 'm_live_1' });
      controller.applyLiveRunStreamEvent({ type: 'block-start', messageId: 'm_live_1', blockIndex: 0, blockType: 'markdown' });
      controller.applyLiveRunStreamEvent({ type: 'block-delta', messageId: 'm_live_1', blockIndex: 0, delta: 'Hello Flower' });

      expect(controller.liveAssistantTailMessage()).toBeNull();
      expect(scheduledCallbacks).toHaveLength(1);

      scheduledCallbacks[0]?.(0);

      expect(controller.liveAssistantTailMessage()?.id).toBe('m_live_1');
      expect(controller.hasStreamingAssistantMessage()).toBe(true);

      controller.upsertTranscriptMessage({
        id: 'm_live_1',
        role: 'assistant',
        status: 'complete',
        timestamp: 30,
        blocks: [{ type: 'markdown', content: 'Hello Flower' }],
      });

      expect(controller.liveAssistantTailMessage()).toBeNull();

      return disposeRoot;
    });

    dispose();
  });
});
