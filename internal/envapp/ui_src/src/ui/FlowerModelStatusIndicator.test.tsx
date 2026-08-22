// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import type { FlowerModelIOStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerModelStatusIndicator } from '../../../../flower_ui/src/chat/FlowerModelStatusIndicator';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
});

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderIndicator() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [status, setStatus] = createSignal<FlowerModelIOStatus | null>({
    phase: 'waiting_response',
    run_id: 'run-1',
    updated_at_ms: 1,
  });
  const [label, setLabel] = createSignal('Thinking...');
  const [threadID, setThreadID] = createSignal('thread-1');
  const [activeRunID, setActiveRunID] = createSignal('run-1');
  const [running, setRunning] = createSignal(true);
  disposers.push(render(() => (
    <FlowerModelStatusIndicator
      status={status()}
      label={label()}
      threadID={threadID()}
      activeRunID={activeRunID()}
      running={running()}
    />
  ), host));
  return { host, setStatus, setLabel, setThreadID, setActiveRunID, setRunning };
}

describe('FlowerModelStatusIndicator', () => {
  it('keeps the same DOM node while one run changes phase and label', async () => {
    const { host, setStatus, setLabel } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');

    batch(() => {
      setStatus({ phase: 'streaming', run_id: 'run-1', updated_at_ms: 2 });
      setLabel('Replying...');
    });
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.getAttribute('data-model-io-phase')).toBe('streaming');
    expect(indicator?.textContent).toContain('Replying');
    expect(indicator?.querySelector('.flower-model-status-dots')?.textContent).toBe('...');
  });

  it('keeps the current indicator through a transient empty status while the run remains active', async () => {
    const { host, setStatus } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');

    setStatus(null);
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.getAttribute('data-model-status-run-id')).toBe('run-1');
  });

  it('clears on terminal or waiting state and remounts for a new run', async () => {
    const { host, setStatus, setActiveRunID, setRunning } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    setRunning(false);
    await flushEffects();
    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();

    batch(() => {
      setActiveRunID('run-2');
      setStatus({ phase: 'preparing', run_id: 'run-2', updated_at_ms: 3 });
      setRunning(true);
    });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBeNull();
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-model-status-run-id')).toBe('run-2');
  });

  it('clears rather than carrying status across thread selection', async () => {
    const { host, setStatus, setThreadID, setActiveRunID } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    batch(() => {
      setThreadID('thread-2');
      setActiveRunID('run-2');
      setStatus({ phase: 'preparing', run_id: 'run-2', updated_at_ms: 4 });
    });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-model-status-run-id')).toBe('run-2');
  });
});
