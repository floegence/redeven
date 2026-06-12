import { describe, expect, it } from 'vitest';
import { fromWireAIEventNotify, toWireAISendUserTurnRequest } from './ai';

describe('Redeven v1 AI codec', () => {
  it('passes Ask Flower context actions through sendUserTurn without permission material', () => {
    const req = toWireAISendUserTurnRequest({
      threadId: 'th_1',
      model: 'openai/gpt-5.5',
      input: {
        messageId: 'msg_1',
        text: 'Review this directory',
        attachments: [],
        contextAction: {
          schema_version: 2,
          action_id: 'assistant.ask.flower',
          provider: 'flower',
          target: {
            target_id: 'current',
            locality: 'auto',
          },
          source: {
            surface: 'file_browser',
          },
          execution_context: {
            current_target_id: 'env_a',
            source_env_public_id: 'env_a',
            host_hint: 'auto',
            session_source: 'provider_environment',
          },
          context: [
            {
              kind: 'file_path',
              path: '/workspace/app',
              is_directory: true,
            },
          ],
          presentation: {
            label: 'Ask Flower',
            priority: 100,
          },
        },
      },
      options: {
        maxSteps: 10,
        mode: 'act',
      },
    });

    expect(req.input.context_action).toMatchObject({
      action_id: 'assistant.ask.flower',
      execution_context: {
        source_env_public_id: 'env_a',
      },
    });
    expect(JSON.stringify(req.input.context_action)).not.toContain('can_write');
    expect(JSON.stringify(req.input.context_action)).not.toContain('grant');
  });

  it('preserves request_user_input tool_name in realtime waiting prompts', () => {
    const event = fromWireAIEventNotify({
      event_type: 'thread_state',
      endpoint_id: 'env-1',
      thread_id: 'thread-1',
      run_id: 'run-1',
      at_unix_ms: 1000,
      run_status: 'waiting_user',
      waiting_prompt: {
        prompt_id: 'prompt-1',
        message_id: 'message-1',
        tool_id: 'tool-1',
        tool_name: 'ask_user',
        questions: [{
          id: 'next_step',
          header: 'Need input',
          question: 'Choose the next step.',
          is_secret: false,
          response_mode: 'select',
          choices: [{ choice_id: 'continue', label: 'Continue', kind: 'select' }],
        }],
      },
    });

    expect(event?.waitingPrompt).toEqual(expect.objectContaining({
      promptId: 'prompt-1',
      messageId: 'message-1',
      toolId: 'tool-1',
      toolName: 'ask_user',
    }));
  });
});
