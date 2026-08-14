import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
  approvalCommandResult,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower bottom decision surface', () => {
  it('replaces the chat composer with a single-layer input request surface', async () => {
    const request = inputRequest({
      prompt_id: 'prompt-decision-surface',
      questions: [{
        id: 'release-channel',
        header: 'Release channel',
        question: 'Which release channel should Flower use?',
        response_mode: 'select_or_write',
        choices: [
          { choice_id: 'stable', label: 'Stable', kind: 'select' },
          { choice_id: 'beta', label: 'Beta', kind: 'select' },
          { choice_id: 'nightly', label: 'Nightly', kind: 'select' },
        ],
        choices_exhaustive: false,
        write_label: 'Something else',
        write_placeholder: 'Describe another channel',
      }],
    });
    const waitingThread = thread({
      thread_id: 'thread-input-decision-surface',
      status: 'waiting_user',
      input_request: request,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-decision-surface"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-decision-surface"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="input_request"]') as HTMLElement;
    expect(surface.querySelector('[data-flower-input-request-prompt]')).not.toBeNull();
    expect(surface.querySelector('.flower-composer-footer')).toBeNull();
    expect(surface.querySelector('.flower-composer-controls-viewport')).toBeNull();
    expect(surface.querySelector('.flower-composer-attachment-button')).toBeNull();
    expect(surface.querySelector('.flower-composer-draft-presence')).toBeNull();
    expect(surface.classList.contains('flower-decision-surface')).toBe(true);
    expect(surface.querySelector('.flower-decision-surface')).toBeNull();
    const radios = Array.from(surface.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(radios).toHaveLength(4);
    expect(surface.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false']);
    const other = surface.querySelector('[data-flower-input-answer-kind="custom"]') as HTMLButtonElement;
    expect(other.textContent).toContain('Something else');
    expect(other.querySelector('.flower-input-request-choice-custom-icon')).not.toBeNull();
    expect(surface.querySelector('[data-flower-input-custom-answer]')).toBeNull();
    expect(surface.querySelector('.flower-composer-continue')?.textContent?.trim()).toBe('Continue');
  });

  it('keeps fixed and custom answers mutually exclusive while preserving the custom draft', async () => {
    const request = inputRequest({
      prompt_id: 'prompt-mutually-exclusive-answer',
      questions: [{
        id: 'preference',
        header: 'Travel preference',
        question: 'What kind of trip would you prefer?',
        response_mode: 'select_or_write',
        choices_exhaustive: false,
        choices: [
          { choice_id: 'hiking', label: 'Nature and hiking', kind: 'select' },
          { choice_id: 'city', label: 'City and culture', kind: 'select' },
        ],
        write_label: 'None of the above / Other',
        write_placeholder: 'Describe your preference',
      }],
    });
    const waitingThread = thread({
      thread_id: 'thread-mutually-exclusive-answer',
      status: 'waiting_user',
      input_request: request,
    });
    const submitInput = vi.fn(async (input) => ({
      thread_id: input.thread_id,
      consumed_prompt_id: input.prompt_id,
      current: {
        thread_id: input.thread_id,
        view_version: 21,
        activity: 'active' as const,
        interactions: [],
      },
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-mutually-exclusive-answer"] button')));
    (runtime.querySelector('[data-thread-id="thread-mutually-exclusive-answer"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-answer-kind="custom"]')));

    const other = runtime.querySelector('[data-flower-input-answer-kind="custom"]') as HTMLButtonElement;
    other.click();
    await waitFor(() => document.activeElement === runtime.querySelector('[data-flower-input-custom-answer]'));
    const customInput = runtime.querySelector('[data-flower-input-custom-answer]') as HTMLTextAreaElement;
    expect(other.getAttribute('aria-checked')).toBe('true');
    expect((runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled).toBe(true);
    customInput.value = 'A quiet coastal village';
    customInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);

    const hiking = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((radio) => radio.textContent?.includes('Nature and hiking'))!;
    hiking.focus();
    hiking.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await waitFor(() => hiking.getAttribute('aria-checked') === 'true');
    expect(runtime.querySelector('[data-flower-input-custom-answer]')).toBeNull();
    other.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-custom-answer]')));
    expect((runtime.querySelector('[data-flower-input-custom-answer]') as HTMLTextAreaElement).value).toBe('A quiet coastal village');
    hiking.click();
    await waitFor(() => hiking.getAttribute('aria-checked') === 'true');
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length === 1);
    expect(submitInput.mock.calls[0]?.[0].answers).toEqual({ preference: { choice_id: 'hiking' } });
  });

  it('navigates multiple input questions without losing per-question answers', async () => {
    const request = inputRequest({
      prompt_id: 'prompt-multi-decision-surface',
      questions: [
        ...(inputRequest().questions),
        {
          id: 'release-note',
          header: 'Release note',
          question: 'What should Flower mention?',
          response_mode: 'write' as const,
          write_placeholder: 'Add a short note',
        },
      ],
    });
    const waitingThread = thread({
      thread_id: 'thread-multi-decision-surface',
      status: 'waiting_user',
      input_request: request,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-multi-decision-surface"] button')));
    (runtime.querySelector('[data-thread-id="thread-multi-decision-surface"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="input_request"]') as HTMLElement;
    expect(surface.querySelector('.flower-input-request-navigation-count')?.textContent?.trim()).toBe('1 / 2');
    (surface.querySelector('[aria-label="Next question"]') as HTMLButtonElement).click();
    await waitFor(() => surface.querySelector('.flower-input-request-navigation-count')?.textContent?.trim() === '2 / 2');
    const textarea = surface.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.value = 'Mention validation.';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Mention validation.' }));
    (surface.querySelector('[aria-label="Previous question"]') as HTMLButtonElement).click();
    await waitFor(() => surface.querySelector('.flower-input-request-navigation-count')?.textContent?.trim() === '1 / 2');
    expect(Array.from(surface.querySelectorAll('.flower-input-request-choice-selected')).map((node) => node.textContent?.trim())).toEqual([]);
  });

  it('keeps approval identity and Stop available without nested cards', async () => {
    const action = {
      action_id: 'approval-decision-surface',
      origin: 'main_tool' as const,
      run_id: 'run-decision-surface',
      tool_id: 'tool-decision-surface',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 3,
      version: 2,
      surface_epoch: 4,
      surface_role: 'primary_action' as const,
      requested_at_ms: 20_000,
      can_approve: true,
      expected_seq: 21,
      queue_generation: 7,
      queue_order: 1,
      batch_index: 0,
      batch_size: 1,
      summary: {
        label: 'printf flower-decision-surface',
        command: 'printf flower-decision-surface',
        effects: ['shell', 'network'],
        flags: ['open_world'],
      },
    };
    const approvalThread = thread({
      thread_id: 'thread-approval-decision-surface',
      status: 'waiting_approval',
      approval_actions: [action],
    });
    const submitApproval = vi.fn(async (input) => approvalCommandResult(input.thread_id, input.interaction_id, input.approved, 22));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 21)),
      submitApproval,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-approval-decision-surface"] button')));
    (runtime.querySelector('[data-thread-id="thread-approval-decision-surface"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="approval"]') as HTMLElement;
    const decisions = Array.from(surface.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'));
    await waitFor(() => document.activeElement === decisions[0]);
    expect(surface.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).not.toBe(surface);
    expect(surface.classList.contains('flower-decision-surface')).toBe(true);
    expect(surface.querySelector('.flower-decision-surface')).toBeNull();
    expect(surface.querySelector('.flower-approval-card')).toBeNull();
    expect(surface.querySelector('.flower-approval-copy-btn')).toBeNull();
    expect(surface.querySelector('.flower-composer-footer')).not.toBeNull();
    expect(surface.querySelector('.flower-composer-stop-thread')).toBeNull();
    const stop = surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="stop"]');
    expect(stop).not.toBeNull();
    expect(stop?.disabled).toBe(false);
    expect(surface.querySelector('.flower-composer-attachment-button')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="working_dir"]')).not.toBeNull();
    expect(surface.querySelector('.flower-permission-selector')).not.toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="model_reasoning"]')).not.toBeNull();
    expect(surface.textContent).not.toContain('Review before this runs');
    expect(surface.textContent).toContain('Approval required');
    expect(surface.querySelector('.flower-approval-intro')).toBeNull();
    expect(surface.textContent).not.toContain('terminal.exec');
    expect(surface.textContent?.match(/printf flower-decision-surface/g)).toHaveLength(1);
    expect(surface.textContent).not.toContain('1 / 1');

    expect(decisions.map((button) => button.textContent?.trim())).toEqual(['Reject', 'Allow once']);
    decisions[1].click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    expect(submitApproval).toHaveBeenCalledWith({
      thread_id: approvalThread.thread_id,
      interaction_id: action.action_id,
      approved: true,
    });
  });

  it('does not render a command summary above the canonical approval command', async () => {
    const summary = 'curl -s --max-time 20 https://api.open-meteo.com/v1/forecast';
    const command = `${summary}\npython - <<'PY'\nprint('weather')\nPY`;
    const action = {
      action_id: 'approval-duplicate-command',
      origin: 'main_tool' as const,
      run_id: 'run-duplicate-command',
      tool_id: 'tool-duplicate-command',
      tool_name: '',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      requested_at_ms: 20_000,
      can_approve: true,
      summary: { label: summary, command },
    };
    const approvalThread = thread({
      thread_id: 'thread-duplicate-command',
      status: 'waiting_approval',
      approval_actions: [action],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 21)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-duplicate-command"] button')));
    (runtime.querySelector('[data-thread-id="thread-duplicate-command"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="approval"]') as HTMLElement;
    expect(surface.querySelector('.flower-approval-intro')).toBeNull();
    expect(surface.querySelector('.flower-approval-command-text')?.textContent).toBe(command);
  });

  it('uses the same single-layer decision contract in the narrow companion surface', async () => {
    const request = inputRequest({ prompt_id: 'prompt-companion-decision-surface' });
    const waitingThread = thread({
      thread_id: 'thread-companion-decision-surface',
      status: 'waiting_user',
      input_request: request,
    });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
    }, {
      presentation: 'companion',
      companionOpen: true,
      engaged: true,
      transcriptVisible: true,
    });
    runtime.style.width = '320px';

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-companion-decision-surface"] button')));
    (runtime.querySelector('[data-thread-id="thread-companion-decision-surface"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="input_request"]') as HTMLElement;
    expect(runtime.querySelector('[data-flower-presentation="companion"]')).not.toBeNull();
    expect(surface.classList.contains('flower-decision-surface')).toBe(true);
    expect(surface.querySelector('.flower-decision-surface')).toBeNull();
    expect(surface.querySelector('.flower-composer-footer')).toBeNull();
    expect(surface.querySelector('.flower-composer-controls-viewport')).toBeNull();
    expect(surface.querySelector('.flower-input-request-choice')).not.toBeNull();
    expect(surface.querySelector('.flower-composer-continue')?.textContent?.trim()).toBe('Continue');
  });
});
