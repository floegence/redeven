// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FlowerProgressIndicator,
  type FlowerProgressIndicatorState,
} from '../../../../flower_ui/src/chat/FlowerProgressIndicator';

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
  const [progress, setProgress] = createSignal<FlowerProgressIndicatorState | null>({
    kind: 'waiting',
    runID: 'run-1',
  });
  const [label, setLabel] = createSignal('Thinking...');
  const [threadID, setThreadID] = createSignal('thread-1');
  const [activeRunID, setActiveRunID] = createSignal('run-1');
  const [running, setRunning] = createSignal(true);
  disposers.push(render(() => (
    <FlowerProgressIndicator
      progress={progress()}
      label={label()}
      threadID={threadID()}
      activeRunID={activeRunID()}
      running={running()}
    />
  ), host));
  return { host, setProgress, setLabel, setThreadID, setActiveRunID, setRunning };
}

describe('FlowerProgressIndicator', () => {
  it('keeps the same DOM node while one run changes phase and label', async () => {
    const { host, setProgress, setLabel } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');

    batch(() => {
      setProgress({ kind: 'output', runID: 'run-1' });
      setLabel('Replying...');
    });
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.getAttribute('data-flower-progress-kind')).toBe('output');
    expect(indicator?.textContent).toContain('Replying');
    expect(indicator?.querySelector('.flower-model-status-dots')?.textContent).toBe('...');
  });

  it('keeps the current indicator through a transient empty status while the run remains active', async () => {
    const { host, setProgress } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');

    setProgress(null);
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.getAttribute('data-flower-progress-run-id')).toBe('run-1');
  });

  it('clears on terminal or waiting state and remounts for a new run', async () => {
    const { host, setProgress, setActiveRunID, setRunning } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    setRunning(false);
    await flushEffects();
    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();

    batch(() => {
      setActiveRunID('run-2');
      setProgress({ kind: 'waiting', runID: 'run-2' });
      setRunning(true);
    });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBeNull();
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-flower-progress-run-id')).toBe('run-2');
  });

  it('clears rather than carrying status across thread selection', async () => {
    const { host, setProgress, setThreadID, setActiveRunID } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    batch(() => {
      setThreadID('thread-2');
      setActiveRunID('run-2');
      setProgress({ kind: 'waiting', runID: 'run-2' });
    });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-flower-progress-run-id')).toBe('run-2');
  });
});
