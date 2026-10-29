import '../../index.css';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import { FlowerProgressIndicator } from '../../../../../flower_ui/src/chat/FlowerProgressIndicator';
import { SubagentDetailWindow, type SubagentDetailWindowProps } from '../../../../../flower_ui/src/SubagentDetailWindow';
import type { FlowerProviderRequestProgress } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

type Theme = 'light' | 'dark';

type DockState = Readonly<{ tokens: number; metric: boolean }>;

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.body.innerHTML = '';
});

function request(tokens: number): FlowerProviderRequestProgress {
  return {
    logical_request_id: 'child-request',
    attempt_id: 'child-attempt',
    attempt_epoch: 1,
    started_at: '2026-10-15T12:00:00Z',
    first_output_at: '2026-10-15T12:00:01Z',
    estimated_output_tokens: tokens,
  };
}

function windowProps(open: boolean, onOpenChange: (open: boolean) => void): SubagentDetailWindowProps {
  return {
    open,
    onOpenChange,
    threadID: 'thread-child-progress',
    title: 'Inspect source evidence',
    status: 'running',
    statusLabel: 'Running',
    statusIndicator: <span aria-hidden="true" />,
    elapsedLabel: '12s',
    description: 'Inspect the latest source evidence and operation progress.',
    loading: false,
    error: '',
    detailAvailable: true,
    entries: [],
    renderTimeline: () => null,
    bindScroll: () => undefined,
    onScroll: () => undefined,
    onWheel: () => undefined,
    onPointerDown: () => undefined,
    onTouchMove: () => undefined,
    showScrollToLatest: false,
    onScrollToLatest: () => undefined,
    onRetryLoad: () => undefined,
    viewportLeftInset: 12,
    zIndex: 160,
    threadLoadingLabel: 'Loading subagent detail',
    scrollToLatestLabel: 'Scroll to latest',
    copy: DEFAULT_FLOWER_SURFACE_COPY.subagents!,
  };
}

async function nextFrame(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function mountDockWindow(theme: Theme, viewport: Readonly<{ width: number; height: number }>) {
  await page.viewport(viewport.width, viewport.height);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';

  const fixture = document.createElement('div');
  fixture.dataset.subagentProgressFixture = theme;
  Object.assign(fixture.style, {
    position: 'fixed',
    inset: '0',
    background: 'var(--redeven-surface-main, var(--background))',
  });
  document.body.append(fixture);

  const [open, setOpen] = createSignal(true);
  const [dock, setDock] = createSignal<DockState>({ tokens: 11, metric: true });
  const dockProgress = () => (dock().metric
    ? { kind: 'streaming', runID: 'run-child', request: request(dock().tokens) }
    : { kind: 'preparing', runID: 'run-child' });
  const dockElement = (
    <Show when={dockProgress()}>
      {(progress) => (
        <div class="flower-subagent-detail-progress">
          <FlowerProgressIndicator progress={progress()} label="Generating" outputCopy={DEFAULT_FLOWER_SURFACE_COPY.chat.outputProgress} />
        </div>
      )}
    </Show>
  );

  disposers.push(render(
    () => (
      <LayoutProvider>
        <SubagentDetailWindow {...windowProps(open(), setOpen)} progressDock={dockElement} />
      </LayoutProvider>
    ),
    fixture,
  ));
  await nextFrame(3);

  const surface = document.querySelector<HTMLElement>('.flower-subagent-detail-window');
  if (!surface) throw new Error('Subagent detail floating window did not mount.');
  return { fixture, surface, setDock };
}

function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

describe('Subagent detail progress dock', () => {
  it('rests on a centered footer rail and keeps its width and insets stable as the run reports progress', async () => {
    const { surface, setDock } = await mountDockWindow('dark', { width: 1200, height: 860 });

    const dock = requireElement(surface, '.flower-subagent-detail-progress-dock');
    const pill = requireElement(surface, '.flower-subagent-detail-progress');
    const region = requireElement(surface, '.flower-subagent-detail-transcript-region');
    const label = requireElement(surface, '.flower-model-status-text');
    const metric = requireElement(surface, '.flower-model-status-metric');

    const surfaceRect = surface.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();

    // The rail is an in-flow sibling of the transcript, so it can never cover a message.
    expect(dockRect.top).toBeGreaterThanOrEqual(regionRect.bottom - 0.5);
    expect(dockRect.bottom).toBeLessThanOrEqual(surfaceRect.bottom + 0.5);
    // Bottom center of the window, not of the text column.
    expect(Math.abs(pillRect.left + pillRect.width / 2 - (surfaceRect.left + surfaceRect.width / 2)))
      .toBeLessThanOrEqual(1);
    expect(pillRect.right).toBeLessThanOrEqual(surfaceRect.right + 0.5);
    expect(metric.textContent).toContain('11 tokens');

    const baseline = {
      width: pillRect.width,
      labelLeft: label.getBoundingClientRect().left,
      metricRight: metric.getBoundingClientRect().right,
    };

    setDock({ tokens: 1234567, metric: true });
    await nextFrame(3);

    const grownMetric = requireElement(surface, '.flower-model-status-metric');
    expect(grownMetric.textContent).toContain('1234567 tokens');
    // A growing token count must not resize the pill nor slide the label.
    expect(Math.abs(pill.getBoundingClientRect().width - baseline.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(label.getBoundingClientRect().left - baseline.labelLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(grownMetric.getBoundingClientRect().right - baseline.metricRight)).toBeLessThanOrEqual(0.5);
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(grownMetric.getBoundingClientRect().left + 0.5);

    setDock({ tokens: 1234567, metric: false });
    await nextFrame(3);

    // Dropping the metric swaps in the reveal dots; neither may change the pill.
    expect(surface.querySelector('.flower-model-status-metric')).toBeNull();
    expect(Math.abs(pill.getBoundingClientRect().width - baseline.width)).toBeLessThanOrEqual(0.5);
    const dots = requireElement(surface, '.flower-model-status-dots');
    expect(getComputedStyle(dots).animationName).toBe('none');
    const dotsWidth = dots.getBoundingClientRect().width;
    await nextFrame(3);
    expect(Math.abs(dots.getBoundingClientRect().width - dotsWidth)).toBeLessThanOrEqual(0.5);
  });

  it('stays inside a narrow window without widening it', async () => {
    const { surface } = await mountDockWindow('light', { width: 560, height: 820 });

    const pill = requireElement(surface, '.flower-subagent-detail-progress');
    const dock = requireElement(surface, '.flower-subagent-detail-progress-dock');
    const surfaceRect = surface.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();

    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(pillRect.left).toBeGreaterThanOrEqual(dockRect.left - 0.5);
    expect(pillRect.right).toBeLessThanOrEqual(dockRect.right + 0.5);
    expect(Math.abs(pillRect.left + pillRect.width / 2 - (surfaceRect.left + surfaceRect.width / 2)))
      .toBeLessThanOrEqual(1);
  });
});
