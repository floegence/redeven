import '../../index.css';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import { SubagentDetailWindow, type SubagentDetailWindowProps } from '../../../../../flower_ui/src/SubagentDetailWindow';

type Theme = 'light' | 'dark';

type RGBColor = Readonly<{
  red: number;
  green: number;
  blue: number;
  alpha: number;
}>;

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.documentElement.classList.remove('light', 'dark');
  document.body.innerHTML = '';
});

function parseRGBColor(value: string): RGBColor {
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (channels.length < 3) throw new Error(`Unsupported color: ${value}`);
  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!,
    alpha: channels[3] ?? 1,
  };
}

function relativeLuminance(color: RGBColor): number {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(first: RGBColor, second: RGBColor): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function windowProps(open: boolean, onOpenChange: (open: boolean) => void): SubagentDetailWindowProps {
  return {
    open,
    onOpenChange,
    title: 'Inspect source evidence',
    status: 'running',
    statusLabel: 'Running',
    statusIndicator: <span aria-hidden="true" />,
    agentTypeLabel: 'Explore',
    elapsedLabel: '12s',
    description: 'Inspect the latest source evidence and operation progress.',
    loading: false,
    error: '',
    detailAvailable: true,
    entries: [],
    renderEntry: () => null,
    bindScroll: () => undefined,
    onScroll: () => undefined,
    showScrollToLatest: false,
    onScrollToLatest: () => undefined,
    hasMore: false,
    loadingMore: false,
    onLoadMore: () => undefined,
    onRetryLoad: () => undefined,
    modelStatus: null,
    tailLoading: true,
    tailError: '',
    onRetryTail: () => undefined,
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

async function mountWindow(theme: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  const fixture = document.createElement('div');
  fixture.dataset.subagentBoundaryFixture = theme;
  Object.assign(fixture.style, {
    position: 'fixed',
    inset: '0',
    background: 'var(--redeven-surface-main, var(--background))',
  });
  document.body.append(fixture);

  const [open, setOpen] = createSignal(true);
  disposers.push(render(
    () => (
      <LayoutProvider>
        <SubagentDetailWindow {...windowProps(open(), setOpen)} />
      </LayoutProvider>
    ),
    fixture,
  ));
  await nextFrame(3);

  const geometry = document.querySelector<HTMLElement>("[data-floe-geometry-surface='floating-window']");
  const surface = document.querySelector<HTMLElement>('.flower-subagent-detail-window');
  if (!geometry || !surface) throw new Error('Subagent detail floating window did not mount.');
  return { fixture, geometry, surface, open };
}

function assertContinuousBorder(surface: HTMLElement, adjacentBackground: string): void {
  const style = getComputedStyle(surface);
  const adjacent = parseRGBColor(adjacentBackground);
  const borderColors = [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor];
  const borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];

  expect(borderWidths).toEqual(['1px', '1px', '1px', '1px']);
  for (const borderColor of borderColors) {
    const parsed = parseRGBColor(borderColor);
    expect(parsed.alpha).toBe(1);
    expect(contrastRatio(parsed, adjacent)).toBeGreaterThanOrEqual(3);
  }
}

describe('Subagent detail window boundary', () => {
  it('keeps an opaque, elevated boundary in light and dark themes', async () => {
    await page.viewport(1440, 900);

    for (const theme of ['light', 'dark'] as const) {
      const { fixture, geometry, surface } = await mountWindow(theme);
      const fixtureStyle = getComputedStyle(fixture);
      const geometryStyle = getComputedStyle(geometry);
      const surfaceStyle = getComputedStyle(surface);
      const expectedSurface = theme === 'light' ? 'rgb(251, 249, 246)' : 'rgb(52, 56, 64)';

      expect(surfaceStyle.backgroundColor).toBe(expectedSurface);
      expect(surfaceStyle.backgroundColor).not.toBe(fixtureStyle.backgroundColor);
      expect(parseRGBColor(surfaceStyle.backgroundColor).alpha).toBe(1);
      expect(surfaceStyle.borderRadius).toBe('6px');
      expect(geometryStyle.borderRadius).toBe('6px');
      expect(geometryStyle.boxShadow).not.toBe('none');
      expect(surfaceStyle.boxShadow).toContain('inset');
      assertContinuousBorder(surface, fixtureStyle.backgroundColor);

      const titlebar = surface.querySelector<HTMLElement>("[data-floe-floating-window-titlebar='true']");
      const overview = surface.querySelector<HTMLElement>('.flower-subagent-detail-overview');
      const dock = surface.querySelector<HTMLElement>('.flower-subagent-detail-bottom-dock');
      expect(titlebar).not.toBeNull();
      expect(overview).not.toBeNull();
      expect(dock).not.toBeNull();
      expect(getComputedStyle(titlebar!).backgroundImage).toBe('none');
      expect(getComputedStyle(titlebar!).backgroundColor).not.toBe(surfaceStyle.backgroundColor);
      expect(getComputedStyle(overview!).backgroundColor).not.toBe(surfaceStyle.backgroundColor);
      expect(getComputedStyle(dock!).backgroundColor).toBe(getComputedStyle(overview!).backgroundColor);
      expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

      fixture.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 31,
        pointerType: 'mouse',
        button: 0,
      }));
      await nextFrame();
      expect(surface.dataset.floeFloatingWindowState).toBe('inactive');
      assertContinuousBorder(surface, fixtureStyle.backgroundColor);

      disposers.pop()?.();
      fixture.remove();
      await nextFrame();
    }
  });

  it('preserves drag, resize, narrow viewport clamping, and Escape close', async () => {
    await page.viewport(1440, 900);
    const { geometry, surface, open } = await mountWindow('dark');
    const titlebar = surface.querySelector<HTMLElement>("[data-floe-floating-window-titlebar='true']")!;
    const resizeHandle = surface.querySelector<HTMLElement>("[data-floe-floating-window-resize-handle='se']")!;
    const start = geometry.getBoundingClientRect();
    geometry.setPointerCapture = () => undefined;
    geometry.releasePointerCapture = () => undefined;

    titlebar.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 41,
      pointerType: 'mouse',
      button: 0,
      clientX: start.left + 120,
      clientY: start.top + 20,
    }));
    geometry.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 41,
      pointerType: 'mouse',
      clientX: start.left + 160,
      clientY: start.top + 44,
    }));
    geometry.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 41,
      pointerType: 'mouse',
      button: 0,
      clientX: start.left + 160,
      clientY: start.top + 44,
    }));
    await nextFrame();
    const dragged = geometry.getBoundingClientRect();
    expect(dragged.left).toBeGreaterThan(start.left + 30);
    expect(dragged.top).toBeGreaterThan(start.top + 14);

    resizeHandle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'mouse',
      button: 0,
      clientX: dragged.right,
      clientY: dragged.bottom,
    }));
    geometry.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'mouse',
      clientX: dragged.right + 40,
      clientY: dragged.bottom + 30,
    }));
    geometry.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'mouse',
      button: 0,
      clientX: dragged.right + 40,
      clientY: dragged.bottom + 30,
    }));
    await nextFrame();
    const resized = geometry.getBoundingClientRect();
    expect(resized.width).toBeGreaterThan(dragged.width + 30);
    expect(resized.height).toBeGreaterThan(dragged.height + 20);

    await page.viewport(640, 800);
    await nextFrame(3);
    const narrow = geometry.getBoundingClientRect();
    expect(narrow.left).toBeGreaterThanOrEqual(12);
    expect(narrow.top).toBeGreaterThanOrEqual(56);
    expect(narrow.right).toBeLessThanOrEqual(window.innerWidth - 12 + 1);
    expect(narrow.bottom).toBeLessThanOrEqual(window.innerHeight - 12 + 1);
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);

    geometry.focus();
    geometry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextFrame(10);
    expect(open()).toBe(false);
    expect(document.querySelector('.flower-subagent-detail-window')).toBeNull();
  });
});
