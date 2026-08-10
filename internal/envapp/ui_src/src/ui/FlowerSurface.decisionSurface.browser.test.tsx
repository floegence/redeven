import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
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
          { choice_id: 'custom', label: 'Custom', kind: 'select' },
        ],
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
    expect(surface.querySelectorAll('.flower-input-request-choice')).toHaveLength(4);
    expect(surface.querySelector('.flower-composer-continue')?.textContent?.trim()).toBe('Continue');
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

  it('keeps approval identity while removing nested cards and unrelated chat controls', async () => {
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
      approval_queue: {
        generation: 7,
        revision: 3,
        current_action_id: action.action_id,
        current_position: 1,
        total: 1,
        unresolved_count: 1,
      },
    });
    const submitApproval = vi.fn(async () => ({ ok: true, current_cursor: 22 }));
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
    expect(surface.querySelector('.flower-composer-footer')).toBeNull();
    expect(surface.querySelector('.flower-composer-stop-thread')).toBeNull();
    expect(surface.querySelector('.flower-composer-attachment-button')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="working_dir"]')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="permission"]')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="model_reasoning"]')).toBeNull();
    expect(surface.textContent).not.toContain('Review before this runs');
    expect(surface.textContent).not.toContain('Approval required');
    expect(surface.querySelector('.flower-approval-intro')).toBeNull();
    expect(surface.textContent).not.toContain('terminal.exec');
    expect(surface.textContent?.match(/printf flower-decision-surface/g)).toHaveLength(1);
    expect(surface.textContent).not.toContain('1 / 1');

    expect(decisions.map((button) => button.textContent?.trim())).toEqual(['Reject', 'Allow once']);
    decisions[1].click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    expect(submitApproval).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: approvalThread.thread_id,
      action_id: action.action_id,
      approved: true,
      expected_seq: action.expected_seq,
      revision: action.revision,
      version: action.version,
      surface_epoch: action.surface_epoch,
      queue_generation: action.queue_generation,
    }));
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
