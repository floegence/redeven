// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexPendingInputsPanel } from './CodexPendingInputsPanel';

function renderPanel(options?: {
  canGuideQueued?: boolean;
  guideQueuedDisabledReason?: string;
}) {
  const onGuideQueued = vi.fn();
  const onRestoreQueued = vi.fn();
  const onRemoveQueued = vi.fn();
  const onMoveQueued = vi.fn();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <CodexPendingInputsPanel
      dispatchingItems={[{
        id: 'dispatch_1',
        thread_id: 'thread_1',
        text: 'Guide the current run',
        attachments: [],
        mentions: [],
        runtime_config: {
          cwd: '/workspace',
          model: 'gpt-5.4',
          effort: 'medium',
          approval_policy: 'never',
          sandbox_mode: 'danger-full-access',
          approvals_reviewer: '',
        },
        created_at_unix_ms: 10,
        source: 'send_now',
      }]}
      queuedItems={[{
        id: 'followup_1',
        thread_id: 'thread_1',
        text: 'Queue this follow-up',
        attachments: [],
        mentions: [],
        runtime_config: {
          cwd: '/workspace',
          model: 'gpt-5.4',
          effort: 'medium',
          approval_policy: 'never',
          sandbox_mode: 'danger-full-access',
          approvals_reviewer: '',
        },
        created_at_unix_ms: 20,
        source: 'queued',
      }]}
      canGuideQueued={options?.canGuideQueued ?? true}
      guideQueuedDisabledReason={options?.guideQueuedDisabledReason ?? ''}
      onGuideQueued={onGuideQueued}
      onRestoreQueued={onRestoreQueued}
      onRemoveQueued={onRemoveQueued}
      onMoveQueued={onMoveQueued}
    />
  ), host);

  return {
    host,
    dispose,
    onGuideQueued,
    onRestoreQueued,
    onRemoveQueued,
    onMoveQueued,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CodexPendingInputsPanel', () => {
  it('keeps the rail compact while still letting the user restore, guide, and remove queued items', () => {
    const {
      host,
      dispose,
      onGuideQueued,
      onRestoreQueued,
      onRemoveQueued,
    } = renderPanel();

    const restoreButton = host.querySelector('.codex-pending-input-card-queued .codex-pending-input-card-main') as HTMLButtonElement | null;
    const guideButton = host.querySelector('button[title="Guide queued input into the current turn"]') as HTMLButtonElement | null;
    const removeButton = host.querySelector('button[aria-label="Remove queued input"]') as HTMLButtonElement | null;

    if (!restoreButton || !guideButton || !removeButton) {
      throw new Error('queued controls not found');
    }

    restoreButton.click();
    guideButton.click();
    removeButton.click();

    expect(host.querySelector('.codex-pending-inputs-header')).toBeNull();
    expect(host.textContent).not.toContain('Queued prompts');
    expect(host.textContent).not.toContain('Above the composer');
    expect(onRestoreQueued).toHaveBeenCalledWith('followup_1');
    expect(onGuideQueued).toHaveBeenCalledWith('followup_1');
    expect(onRemoveQueued).toHaveBeenCalledWith('followup_1');
    expect(host.textContent).toContain('Guiding');
    dispose();
  });

  it('disables Guide with the provided reason when same-turn guidance is unavailable', () => {
    const { host, dispose, onGuideQueued } = renderPanel({
      canGuideQueued: false,
      guideQueuedDisabledReason: 'This turn cannot accept guided input.',
    });

    const guideButton = host.querySelector('.codex-pending-input-card-action-guide') as HTMLButtonElement | null;
    if (!guideButton) throw new Error('guide button not found');

    expect(guideButton.disabled).toBe(true);
    expect(guideButton.title).toBe('This turn cannot accept guided input.');

    guideButton.click();
    expect(onGuideQueued).not.toHaveBeenCalled();
    dispose();
  });
});
