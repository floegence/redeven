// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

import type { FlowerTurnLauncherIntent } from './contracts/flowerSurfaceContracts';
import {
  FlowerTurnLauncherPanel,
  type FlowerTurnLauncherSubmitInput,
} from './FlowerTurnLauncherWindow';
import { flowerTurnAdmissionError } from './flowerTurnAdmission';

const intent: FlowerTurnLauncherIntent = {
  id: 'launcher-panel-test',
  source_surface: 'file_preview',
  initial_prompt: 'Inspect this file',
  suggested_working_dir: '/workspace/redeven',
  context_items: [
    {
      kind: 'file_path',
      path: '/workspace/redeven/main.go',
      is_directory: false,
    },
  ],
  notes: ['The file is linked as live context.'],
};

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let animationFrameCallbacks: FrameRequestCallback[];

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  animationFrameCallbacks = [];
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001'),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

function renderPanel(overrides: Partial<Parameters<typeof FlowerTurnLauncherPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => undefined);
  const onContextAction = vi.fn();

  dispose = render(() => (
    <FlowerTurnLauncherPanel
      open
      intent={intent}
      onClose={onClose}
      onSubmit={onSubmit}
      onContextAction={onContextAction}
      {...overrides}
    />
  ), host);

  return { onClose, onSubmit, onContextAction };
}

describe('FlowerTurnLauncherPanel', () => {
  it('renders the shared prompt, context projection, notes, and footer without FloatingWindow chrome', () => {
    const { onClose, onContextAction } = renderPanel();

    expect(host.textContent).toContain('What should we focus on?');
    expect(host.textContent).toContain('main.go');
    expect(host.textContent).toContain('/workspace/redeven/main.go');
    expect(host.textContent).toContain('The file is linked as live context.');
    expect(host.textContent).toContain('/workspace/redeven');
    expect(host.querySelector('[data-floe-geometry-surface="floating-window"]')).toBeNull();

    const contextButton = host.querySelector('button[title*="/workspace/redeven/main.go"]') as HTMLButtonElement;
    contextButton.click();
    expect(onContextAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open_live_file_preview', path: '/workspace/redeven/main.go' }),
      expect.objectContaining({ label: 'main.go', tone: 'file' }),
    );

    const closeButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Close') as HTMLButtonElement;
    closeButton.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits a trimmed prompt and keeps launcher actions disabled until submission settles', async () => {
    let finishSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      finishSubmit = resolve;
    }));
    renderPanel({ onSubmit });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '  explain the failure  ';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    sendButton.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledWith({
      client_request_id: 'client_00000000-0000-4000-8000-000000000001',
      prompt: 'explain the failure',
      intent,
    });
    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(host.textContent).toContain('Sending');

    finishSubmit?.();
    await flushAsync();
    expect(textarea.disabled).toBe(false);
  });

  it('preserves a shell-owned draft instead of replacing it with the intent prompt', () => {
    const onDraftChange = vi.fn();
    renderPanel({
      draft: 'Keep this Activity draft',
      onDraftChange,
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Keep this Activity draft');

    textarea.value = 'Updated Activity draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith('Updated Activity draft');
  });

  it('projects submission errors and honors disabled initial autofocus', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('runtime unavailable');
    });
    renderPanel({ onSubmit, autoFocus: false });

    for (const callback of animationFrameCallbacks.splice(0)) callback(0);
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(textarea);

    (host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement).click();
    await flushAsync();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('runtime unavailable');
  });

  it('reuses one client request identity when an unresolved submission is retried', async () => {
    let attempts = 0;
    const onSubmit = vi.fn(async (_input: FlowerTurnLauncherSubmitInput) => {
      attempts += 1;
      if (attempts === 1) throw flowerTurnAdmissionError('unknown', new Error('response lost'));
    });
    renderPanel({ onSubmit });

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    sendButton.click();
    await flushAsync();
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    sendButton.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]?.[0].client_request_id).toBe(
      onSubmit.mock.calls[1]?.[0].client_request_id,
    );
  });
});
