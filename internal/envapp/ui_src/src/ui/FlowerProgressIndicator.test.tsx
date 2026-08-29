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
    kind: 'waiting_response',
    runID: 'run-1',
  });
  const [label, setLabel] = createSignal('Waiting for model response...');
  disposers.push(render(() => (
    <FlowerProgressIndicator progress={progress()} label={label()} />
  ), host));
  return { host, setProgress, setLabel };
}

describe('FlowerProgressIndicator', () => {
  it('keeps the indicator, Flower, and dots DOM nodes while one run changes phase', async () => {
    const { host, setProgress, setLabel } = renderIndicator();
    await flushEffects();
    const indicator = host.querySelector('.flower-model-status-indicator');
    const flower = indicator?.querySelector('.flower-model-status-flower');
    const dots = indicator?.querySelector('.flower-model-status-dots');

    batch(() => {
      setProgress({ kind: 'streaming', runID: 'run-1' });
      setLabel('Thinking...');
    });
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(indicator?.querySelector('.flower-model-status-flower')).toBe(flower);
    expect(indicator?.querySelector('.flower-model-status-dots')).toBe(dots);
    expect(indicator?.getAttribute('data-flower-progress-kind')).toBe('streaming');
    expect(indicator?.textContent).toContain('Thinking');
  });

  it('clears when upstream run progress clears', async () => {
    const { host, setProgress } = renderIndicator();
    await flushEffects();

    setProgress(null);
    await flushEffects();

    expect(host.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('remounts only when the real run identity changes', async () => {
    const { host, setProgress } = renderIndicator();
    await flushEffects();
    const firstIndicator = host.querySelector('.flower-model-status-indicator');

    setProgress({ kind: 'preparing', runID: 'run-2' });
    await flushEffects();

    const nextIndicator = host.querySelector('.flower-model-status-indicator');
    expect(nextIndicator).not.toBeNull();
    expect(nextIndicator).not.toBe(firstIndicator);
    expect(nextIndicator?.getAttribute('data-flower-progress-run-id')).toBe('run-2');
  });
});
