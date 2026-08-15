import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import {
  adapter,
  approvalCommandResult,
  deferred,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  renderSurfaceWithDraftCoordinator,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower bottom decision surface', () => {
  const approval = (id: string, overrides: Record<string, unknown> = {}) => ({
    action_id: id,
    origin: 'main_tool' as const,
    run_id: 'run-decision-surface',
    tool_id: `tool-${id}`,
    tool_name: 'terminal.exec',
    state: 'requested' as const,
    status: 'pending' as const,
    requested_at_ms: 20_000,
    can_approve: true,
    surface_role: 'primary_action' as const,
    summary: { label: id, command: `printf ${id}` },
    ...overrides,
  });

  it('keeps non-actionable approvals visible and disables every decision', async () => {
    for (const configuration of [
      { label: 'capability', action: approval('approval-no-capability', { can_approve: false, read_only_reason: 'Approval is unavailable in this adapter.' }), adapter: adapter(true) },
      { label: 'adapter', action: approval('approval-read-only-adapter'), adapter: { ...adapter(true), canMutate: false } },
    ]) {
      const waitingThread = thread({
        thread_id: `thread-${configuration.label}-approval`,
        status: 'waiting_approval',
        approval_actions: [configuration.action],
      });
      const runtime = renderSurfaceWithAdapter({
        ...configuration.adapter,
        listThreads: vi.fn(async () => [waitingThread]),
        loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
      });
      await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${waitingThread.thread_id}"] button`)));
      (runtime.querySelector(`[data-thread-id="${waitingThread.thread_id}"] button`) as HTMLButtonElement).click();
      await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));
      const surface = runtime.querySelector('[data-flower-bottom-mode="approval"]') as HTMLElement;
      expect(surface.querySelector('textarea')).toBeNull();
      expect(surface.querySelector('.flower-composer-footer')).toBeNull();
      const decisions = Array.from(surface.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'));
      expect(decisions.length).toBeGreaterThanOrEqual(2);
      expect(decisions.every((button) => button.disabled)).toBe(true);
      expect(surface.textContent?.toLowerCase()).toMatch(/unavailable|read-only|readonly/);
    }
  });

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

  it('prioritizes input over approval, then advances to approval before chat', async () => {
    const request = inputRequest({ prompt_id: 'prompt-input-before-approval' });
    const action = approval('approval-after-input');
    const waitingThread = thread({
      thread_id: 'thread-input-before-approval',
      status: 'waiting_user',
      input_request: request,
      approval_actions: [action],
    });
    const submitInput = vi.fn(async () => ({
      thread_id: waitingThread.thread_id,
      consumed_prompt_id: request.prompt_id,
      current: {
        thread_id: waitingThread.thread_id,
        view_version: 21,
        activity: 'active' as const,
        interactions: [
          { id: request.prompt_id, kind: 'input' as const, resolved: true },
          {
            id: action.action_id,
            kind: 'approval' as const,
            tool_call_id: action.tool_id,
            resolved: false,
            approval: { label: action.summary.label, command: action.summary.command, tool_name: action.tool_name, tool_call_id: action.tool_id },
          },
        ],
      },
    }));
    const submitApproval = vi.fn(async () => ({
      ok: true as const,
      current: {
        thread_id: waitingThread.thread_id,
        view_version: 22,
        activity: 'active' as const,
        interactions: [
          { id: request.prompt_id, kind: 'input' as const, resolved: true },
          { id: action.action_id, kind: 'approval' as const, tool_call_id: action.tool_id, resolved: true, approved: true },
        ],
      },
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
      submitInput,
      submitApproval,
    });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${waitingThread.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${waitingThread.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));
    expect(runtime.querySelectorAll('[data-flower-bottom-mode]')).toHaveLength(1);
    expect(runtime.querySelector('[data-flower-bottom-mode="input_request"] textarea')).toBeNull();
    const choice = runtime.querySelector('[data-flower-input-answer-kind="choice"]') as HTMLButtonElement;
    choice.click();
    const continueButton = runtime.querySelector('.flower-composer-continue') as HTMLButtonElement;
    continueButton.focus();
    continueButton.click();
    await waitFor(() => submitInput.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));
    expect(runtime.querySelectorAll('[data-flower-bottom-mode]')).toHaveLength(1);
    expect(runtime.querySelector('[data-flower-bottom-mode="approval"] textarea')).toBeNull();
    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"] .flower-composer-approval-decision:not([disabled])') === document.activeElement);
    (runtime.querySelector('.flower-composer-approval-decision:not([disabled])') as HTMLButtonElement).click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    expect(runtime.querySelectorAll('[data-flower-bottom-mode]')).toHaveLength(1);
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

  it('renders two pending approvals as one compact surface without mounting the chat composer', async () => {
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
      batch_size: 2,
      summary: {
        label: 'printf flower-decision-surface',
        command: 'printf flower-decision-surface',
        effects: ['shell', 'network'],
        flags: ['open_world'],
      },
    };
    const secondAction = {
      ...action,
      action_id: 'approval-decision-surface-2',
      tool_id: 'tool-decision-surface-2',
      queue_order: 2,
      batch_index: 1,
      summary: {
        ...action.summary,
        label: 'printf flower-decision-surface-2',
        command: 'printf flower-decision-surface-2',
      },
    };
    const approvalThread = thread({
      thread_id: 'thread-approval-decision-surface',
      status: 'waiting_approval',
      approval_actions: [action, secondAction],
    });
    const submitApproval = vi.fn(async (input) => ({
      ok: true as const,
      current: {
        thread_id: input.thread_id,
        view_version: 22 + submitApproval.mock.calls.length,
        activity: 'active' as const,
        turn_id: action.run_id,
        interactions: input.interaction_id === action.action_id
          ? [
              { id: action.action_id, kind: 'approval' as const, tool_call_id: action.tool_id, resolved: true, approved: input.approved },
              {
                id: secondAction.action_id,
                kind: 'approval' as const,
                tool_call_id: secondAction.tool_id,
                resolved: false,
                approval: {
                  label: secondAction.summary.label,
                  command: secondAction.summary.command,
                  tool_name: secondAction.tool_name,
                  tool_call_id: secondAction.tool_id,
                },
              },
            ]
          : [
              { id: action.action_id, kind: 'approval' as const, tool_call_id: action.tool_id, resolved: true, approved: true },
              { id: secondAction.action_id, kind: 'approval' as const, tool_call_id: secondAction.tool_id, resolved: true, approved: input.approved },
            ],
      },
    }));
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
    expect(surface.querySelectorAll('[data-flower-composer-approval="true"]')).toHaveLength(1);
    expect(surface.querySelector('.flower-approval-queue-progress')?.textContent?.trim()).toBe('1 / 2');
    expect(surface.querySelector('textarea')).toBeNull();
    expect(surface.querySelector('input[type="password"]')).toBeNull();
    expect(surface.querySelector('input[type="file"]')).toBeNull();
    expect(surface.querySelector('.flower-composer-reference-lane')).toBeNull();
    expect(surface.querySelector('.flower-attachment-lane')).toBeNull();
    expect(surface.querySelector('.flower-composer-footer')).toBeNull();
    expect(surface.querySelector('.flower-composer-controls-viewport')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="working_dir"]')).toBeNull();
    expect(surface.querySelector('.flower-permission-selector')).toBeNull();
    expect(surface.querySelector('[data-flower-composer-control="model_reasoning"]')).toBeNull();
    expect(surface.querySelector('.flower-composer-context-indicator')).toBeNull();
    const stop = surface.querySelector<HTMLButtonElement>('.flower-composer-stop-thread');
    expect(stop).not.toBeNull();
    expect(stop?.disabled).toBe(false);
    expect(surface.querySelector('.flower-composer-attachment-button')).toBeNull();
    expect(surface.textContent).not.toContain('Review before this runs');
    expect(surface.textContent).toContain('Allow this tool to run?');
    expect(surface.querySelector('.flower-approval-intro')).toBeNull();
    expect(surface.textContent).not.toContain('terminal.exec');
    expect(surface.textContent?.match(/printf flower-decision-surface/g)).toHaveLength(1);
    expect(surface.textContent).toContain('1 / 2');

    expect(decisions.map((button) => button.textContent?.trim())).toEqual(['Reject all in this batch', 'Reject', 'Allow once']);
    const observedModes: string[] = [];
    const observer = new MutationObserver(() => {
      const mode = runtime.querySelector<HTMLElement>('[data-flower-bottom-mode]')?.dataset.flowerBottomMode;
      if (mode) observedModes.push(mode);
    });
    observer.observe(runtime, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-flower-bottom-mode'] });
    decisions[2].click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    expect(submitApproval).toHaveBeenCalledWith({
      thread_id: approvalThread.thread_id,
      interaction_id: action.action_id,
      approved: true,
    });
    await waitFor(() => runtime.querySelector('.flower-approval-queue-progress')?.textContent?.trim() === '1 / 1');
    const nextSurface = runtime.querySelector('[data-flower-bottom-mode="approval"]') as HTMLElement;
    expect(nextSurface.querySelector('textarea')).toBeNull();
    expect(nextSurface.querySelector('.flower-composer-footer')).toBeNull();
    expect(nextSurface.textContent).toContain('printf flower-decision-surface-2');
    const nextDecision = Array.from(nextSurface.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Allow once')!;
    await waitFor(() => nextSurface.querySelector('.flower-composer-approval-decision:not([disabled])') === document.activeElement);
    expect(nextSurface.querySelectorAll('[data-flower-composer-approval="true"]')).toHaveLength(1);
    nextDecision.click();
    await waitFor(() => submitApproval.mock.calls.length === 2);
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    observer.disconnect();
    expect(observedModes.slice(0, -1)).not.toContain('chat');
    await waitFor(() => document.activeElement === runtime.querySelector('[data-flower-bottom-mode="chat"] textarea'));
  });

  it('preserves the complete draft and thread navigation until approval resolves back to chat', async () => {
    const approvalAction = {
      action_id: 'approval-preserved-draft',
      origin: 'main_tool' as const,
      run_id: 'run-preserved-draft',
      tool_id: 'tool-preserved-draft',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      requested_at_ms: 20_000,
      can_approve: true,
      surface_role: 'primary_action' as const,
      summary: { label: 'pnpm test', command: 'pnpm test' },
    };
    const secondApprovalAction = {
      ...approvalAction,
      action_id: 'approval-preserved-draft-2',
      tool_id: 'tool-preserved-draft-2',
      summary: { label: 'pnpm lint', command: 'pnpm lint' },
    };
    const approvalThread = thread({
      thread_id: 'thread-preserved-draft',
      title: 'Preserved draft',
      status: 'waiting_approval',
      approval_actions: [approvalAction, secondApprovalAction],
    });
    const otherThread = thread({
      thread_id: 'thread-navigation-remains-live',
      title: 'Other thread',
      status: 'idle',
      approval_actions: [],
    });
    const coordinator = createFlowerComposerDraftCoordinator();
    const draftAttachment = {
      local_id: 'draft-attachment',
      source: 'file' as const,
      name: 'approval-notes.txt',
      mime_type: 'text/plain',
      size_bytes: 32,
      upload_request_id: 'upload-draft-attachment',
      attempt_state: 'staged_ready',
      staged: {
        attachment_id: 'attachment-preserved-draft',
        name: 'approval-notes.txt',
        mime_type: 'text/plain',
        size_bytes: 32,
        digest_sha256: 'a'.repeat(64),
        locator: 'attachment://v1/attachment-preserved-draft/approval-notes.txt',
        source: 'file' as const,
        capability_revision: 'draft-capability',
      },
    };
    const draftReference = {
      local_id: 'draft-reference',
      kind: 'file' as const,
      path: '/workspace/redeven/AGENTS.md',
      label: 'AGENTS.md',
    };
    coordinator.open(approvalThread.thread_id).mutate((draft) => ({
      ...draft,
      text: 'Keep this draft while approval is pending',
      attachments: [draftAttachment],
      references: [draftReference],
    }));
    let approvalResolved = false;
    const submitApproval = vi.fn(async (input) => {
      if (input.interaction_id === approvalAction.action_id) {
        return {
          ok: true as const,
          current: {
            thread_id: input.thread_id,
            view_version: 22,
            activity: 'active' as const,
            interactions: [
              { id: approvalAction.action_id, kind: 'approval' as const, tool_call_id: approvalAction.tool_id, resolved: true, approved: input.approved },
              {
                id: secondApprovalAction.action_id,
                kind: 'approval' as const,
                tool_call_id: secondApprovalAction.tool_id,
                resolved: false,
                approval: {
                  label: secondApprovalAction.summary.label,
                  command: secondApprovalAction.summary.command,
                  tool_name: secondApprovalAction.tool_name,
                  tool_call_id: secondApprovalAction.tool_id,
                },
              },
            ],
          },
        };
      }
      approvalResolved = true;
      return approvalCommandResult(input.thread_id, input.interaction_id, input.approved, 23);
    });
    const runtime = renderSurfaceWithDraftCoordinator({
      ...adapter(true),
      loadAttachmentCapability: vi.fn(async () => ({
        model_id: 'openai/gpt-5.2',
        revision: 'draft-capability',
        enabled: true,
        supports_long_text: true,
        max_attachments: 4,
        max_file_size_bytes: 1_000_000,
        max_total_size_bytes: 2_000_000,
        routes: { 'text/plain': 'tool_read' as const },
      })),
      uploadAttachment: vi.fn(async () => draftAttachment.staged),
      listThreads: vi.fn(async () => [approvalThread, otherThread]),
      loadThread: vi.fn(async (threadID) => {
        if (threadID === otherThread.thread_id) return liveBootstrap(otherThread, 5);
        return liveBootstrap(approvalResolved
          ? { ...approvalThread, status: 'running', approval_actions: [] }
          : approvalThread, approvalResolved ? 22 : 21);
      }),
      submitApproval,
    }, coordinator);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-preserved-draft"] button')));
    (runtime.querySelector('[data-thread-id="thread-preserved-draft"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));
    expect(runtime.querySelector('[data-flower-bottom-mode="approval"] textarea')).toBeNull();
    expect(runtime.querySelector('.flower-attachment-lane')).toBeNull();
    expect(runtime.querySelector('.flower-composer-reference-lane')).toBeNull();
    await waitFor(() => coordinator.read(approvalThread.thread_id).value.attachments[0]?.attempt_state === 'staged_ready');
    expect(coordinator.read(approvalThread.thread_id).value).toMatchObject({
      text: 'Keep this draft while approval is pending',
      attachments: [draftAttachment],
      references: [draftReference],
    });

    const otherThreadButton = runtime.querySelector('[data-thread-id="thread-navigation-remains-live"] button') as HTMLButtonElement;
    expect(otherThreadButton.disabled).toBe(false);
    otherThreadButton.click();
    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="chat"]') !== null);
    (runtime.querySelector('[data-thread-id="thread-preserved-draft"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"]') !== null);

    const approve = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Allow once');
    expect(approve).toBeTruthy();
    approve?.click();
    await waitFor(() => runtime.querySelector('.flower-approval-queue-progress')?.textContent?.trim() === '1 / 1');
    expect(runtime.querySelector('[data-flower-bottom-mode="approval"] textarea')).toBeNull();
    expect(coordinator.read(approvalThread.thread_id).value).toMatchObject({
      text: 'Keep this draft while approval is pending',
      attachments: [draftAttachment],
      references: [draftReference],
    });
    const secondApprove = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Allow once');
    secondApprove?.click();
    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="chat"]') !== null);
    const restoredComposer = runtime.querySelector('[data-flower-bottom-mode="chat"]') as HTMLElement;
    expect((restoredComposer.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Keep this draft while approval is pending');
    expect(restoredComposer.querySelector('.flower-composer-reference-chip')?.textContent).toContain('AGENTS.md');
    expect(restoredComposer.querySelector('.flower-attachment-item')?.textContent).toContain('approval-notes.txt');
    expect(coordinator.read(approvalThread.thread_id).value).toMatchObject({
      text: 'Keep this draft while approval is pending',
      attachments: [draftAttachment],
      references: [draftReference],
    });
    await waitFor(() => document.activeElement === restoredComposer.querySelector('textarea'));
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

  it('stops from the approval surface without submitting a decision and restores chat focus', async () => {
    const action = approval('approval-stop');
    const approvalThread = thread({
      thread_id: 'thread-approval-stop',
      status: 'waiting_approval',
      approval_actions: [action],
    });
    const stopThread = vi.fn(async () => liveBootstrap({
      ...approvalThread,
      status: 'canceled',
      approval_actions: [],
    }, 22));
    const submitApproval = vi.fn(async (input) => approvalCommandResult(input.thread_id, input.interaction_id, input.approved, 22));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 21)),
      stopThread,
      submitApproval,
    });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));
    const stop = runtime.querySelector('.flower-composer-stop-thread') as HTMLButtonElement;
    stop.focus();
    stop.click();
    await waitFor(() => stopThread.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    expect(stopThread).toHaveBeenCalledTimes(1);
    expect(submitApproval).not.toHaveBeenCalled();
    await waitFor(() => document.activeElement === runtime.querySelector('[data-flower-bottom-mode="chat"] textarea'));
  });

  it('does not steal focus when the user leaves the approval surface during submission', async () => {
    const action = approval('approval-external-focus');
    const approvalThread = thread({
      thread_id: 'thread-approval-external-focus',
      status: 'waiting_approval',
      approval_actions: [action],
    });
    const pending = deferred<ReturnType<typeof approvalCommandResult>>();
    const submitApproval = vi.fn(() => pending.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 21)),
      submitApproval,
    });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${approvalThread.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));
    const allow = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Allow once')!;
    allow.focus();
    allow.click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    const external = document.createElement('button');
    external.textContent = 'External control';
    document.body.appendChild(external);
    external.focus();
    pending.resolve(approvalCommandResult(approvalThread.thread_id, action.action_id, true, 22));
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    expect(document.activeElement).toBe(external);
  });

  it('closes transient chat menus when approval mounts and does not reopen them afterward', async () => {
    const action = approval('approval-after-open-menu');
    const chatThread = thread({
      thread_id: 'thread-menu-to-approval',
      status: 'idle',
      approval_actions: [],
    });
    const approvalThread = { ...chatThread, status: 'waiting_approval' as const, approval_actions: [action] };
    let approvalVisible = false;
    let eventDelivered = false;
    const submitApproval = vi.fn(async (input) => {
      approvalVisible = false;
      return approvalCommandResult(input.thread_id, input.interaction_id, input.approved, 23);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalVisible ? approvalThread : chatThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalVisible ? approvalThread : chatThread, approvalVisible ? 22 : 21)),
      setThreadPermissionType: vi.fn(async () => liveBootstrap(chatThread, 21)),
      listThreadLiveEvents: vi.fn(async () => {
        if (!approvalVisible || eventDelivered) return { stream_generation: 1, events: [], next_cursor: 0, retained_from_seq: 1 };
        eventDelivered = true;
        return { stream_generation: 1, events: [{ seq: 1 }], next_cursor: 1, retained_from_seq: 1 };
      }),
      submitApproval,
    });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${chatThread.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${chatThread.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    const permissionTrigger = runtime.querySelector('.flower-permission-trigger') as HTMLButtonElement;
    permissionTrigger.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    approvalVisible = true;
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')), 2000);
    expect(runtime.querySelector('.flower-permission-menu')).toBeNull();
    const allow = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Allow once')!;
    allow.click();
    await waitFor(() => submitApproval.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="chat"]')));
    expect(runtime.querySelector('.flower-permission-menu')).toBeNull();
    expect(runtime.querySelector('.flower-model-menu')).toBeNull();
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeNull();
    expect(runtime.querySelector('[data-directory-picker="true"]')).toBeNull();
    expect(runtime.querySelector('.flower-composer-reference-menu')).toBeNull();
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

  it('uses the compact approval-only surface in companion presentation', async () => {
    const first = approval('approval-companion-surface', {
      run_id: 'run-companion-surface',
      batch_index: 0,
      batch_size: 2,
      queue_order: 1,
      summary: { label: 'pwd', command: 'pwd' },
    });
    const second = approval('approval-companion-surface-2', {
      run_id: 'run-companion-surface',
      batch_index: 1,
      batch_size: 2,
      queue_order: 2,
      summary: { label: 'git status', command: 'git status' },
    });
    const approvalThread = thread({
      thread_id: 'thread-companion-approval-surface',
      status: 'waiting_approval',
      approval_actions: [first, second],
    });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 20)),
    }, {
      presentation: 'companion',
      companionOpen: true,
      engaged: true,
      transcriptVisible: true,
    });
    runtime.style.width = '320px';

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-companion-approval-surface"] button')));
    (runtime.querySelector('[data-thread-id="thread-companion-approval-surface"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="approval"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="approval"]') as HTMLElement;
    expect(runtime.querySelector('[data-flower-presentation="companion"]')).not.toBeNull();
    expect(surface.querySelector('[data-flower-composer-approval="true"]')).not.toBeNull();
    expect(surface.querySelector('.flower-composer-stop-thread')).not.toBeNull();
    expect(surface.querySelector('textarea')).toBeNull();
    expect(surface.querySelector('.flower-composer-footer')).toBeNull();
    expect(surface.querySelector('.flower-composer-controls-viewport')).toBeNull();
    const approvalSurface = surface.querySelector('[data-flower-composer-approval="true"]') as HTMLElement;
    const surfaceRect = approvalSurface.getBoundingClientRect();
    expect(approvalSurface.clientWidth).toBeGreaterThan(0);
    expect(approvalSurface.scrollWidth).toBeLessThanOrEqual(approvalSurface.clientWidth);
    for (const button of Array.from(approvalSurface.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-actions button'))) {
      const rect = button.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(surfaceRect.left - 0.5);
      expect(rect.right).toBeLessThanOrEqual(surfaceRect.right + 0.5);
    }
  });
});
