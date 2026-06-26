import { describe, expect, it } from 'vitest';
import {
  fromWireAIEventNotify,
  fromWireAICompactThreadContextResponse,
  toWireAICompactThreadContextRequest,
  toWireAISubmitRequestUserInputResponseRequest,
  toWireAISendUserTurnRequest,
} from './ai';

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
            runtime_hint: 'auto',
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

  it('encodes reasoning selection in turn options', () => {
    const req = toWireAISendUserTurnRequest({
      threadId: 'th_reasoning',
      input: {
        text: 'Think carefully',
        attachments: [],
      },
      options: {
        mode: 'act',
        reasoningSelection: { level: 'high', budget_tokens: 4096 },
      },
    });

    expect(req.options?.reasoning_selection).toEqual({
      level: 'high',
      budget_tokens: 4096,
    });
  });

  it('omits reasoning selection from turn options when no override is provided', () => {
    const req = toWireAISendUserTurnRequest({
      threadId: 'th_reasoning',
      input: {
        text: 'Use the thread default',
        attachments: [],
      },
      options: {
        mode: 'act',
      },
    });

    expect(req.options).not.toHaveProperty('reasoning_selection');
  });

  it('round trips compact thread context payloads', () => {
    expect(toWireAICompactThreadContextRequest({
      threadId: ' th_compact ',
      expectedRunId: ' run_live ',
      source: 'slash_command',
    })).toEqual({
      thread_id: 'th_compact',
      expected_run_id: 'run_live',
      source: 'slash_command',
    });

    expect(fromWireAICompactThreadContextResponse({
      operation_id: ' op_1 ',
      kind: ' accepted ',
      error_code: '',
    })).toEqual({
      operationId: 'op_1',
      kind: 'accepted',
      errorCode: undefined,
    });
  });

  it('encodes reasoning selection in input response options', () => {
    const req = toWireAISubmitRequestUserInputResponseRequest({
      threadId: 'th_reasoning',
      response: {
        promptId: 'prompt_1',
        answers: { next: { choiceId: 'continue' } },
      },
      input: {
        text: '',
        attachments: [],
      },
      options: {
        mode: 'act',
        reasoningSelection: { level: 'high' },
      },
    });

    expect(req.options?.reasoning_selection).toEqual({ level: 'high' });
  });

  it('omits reasoning selection from input response options when no stored selection is provided', () => {
    const req = toWireAISubmitRequestUserInputResponseRequest({
      threadId: 'th_reasoning',
      response: {
        promptId: 'prompt_1',
        answers: { next: { choiceId: 'continue' } },
      },
      input: {
        text: '',
        attachments: [],
      },
      options: {
        mode: 'act',
      },
    });

    expect(req.options).not.toHaveProperty('reasoning_selection');
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
				reasoning_selection: { level: 'high' },
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
			reasoningSelection: { level: 'high' },
		}));
	});

  it('decodes thread run error codes from realtime events', () => {
    const event = fromWireAIEventNotify({
      event_type: 'thread_state',
      endpoint_id: 'env-1',
      thread_id: 'thread-1',
      run_id: 'run-1',
      at_unix_ms: 1000,
      run_status: 'failed',
      run_error_code: 'provider_auth_failed',
      run_error: 'The selected AI provider rejected the saved credentials.',
    });

    expect(event?.runStatus).toBe('failed');
    expect(event?.runErrorCode).toBe('provider_auth_failed');
    expect(event?.runError).toBe('The selected AI provider rejected the saved credentials.');
  });

});
