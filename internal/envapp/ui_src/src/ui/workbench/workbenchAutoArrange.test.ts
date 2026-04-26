import { describe, expect, it } from 'vitest';
import type { WorkbenchWidgetItem } from '@floegence/floe-webapp-core/workbench';

import { arrangeWorkbenchWidgetsByType } from './workbenchAutoArrange';

const TYPE_ORDER = [
  'redeven.files',
  'redeven.terminal',
  'redeven.preview',
  'redeven.monitor',
  'redeven.codespaces',
  'redeven.ports',
  'redeven.ai',
  'redeven.codex',
] as const;

type Bounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}>;

type ScenarioSpec = Readonly<{
  type: WorkbenchWidgetItem['type'];
  count: number;
  sizes: readonly Readonly<{ width: number; height: number }>[];
}>;

function widget(input: Partial<WorkbenchWidgetItem> & Pick<WorkbenchWidgetItem, 'id' | 'type' | 'width' | 'height'>): WorkbenchWidgetItem {
  return {
    title: input.type,
    x: 0,
    y: 0,
    z_index: 1,
    created_at_unix_ms: 1,
    ...input,
  };
}

function boxesOverlap(left: WorkbenchWidgetItem, right: WorkbenchWidgetItem, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

function centerOf(widgets: readonly WorkbenchWidgetItem[]): { x: number; y: number } {
  const bounds = boundsOf(widgets);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function aspectRatioOf(widgets: readonly WorkbenchWidgetItem[]): number {
  const bounds = boundsOf(widgets);
  return Math.max(bounds.width / bounds.height, bounds.height / bounds.width);
}

function landscapeRatioOf(widgets: readonly WorkbenchWidgetItem[]): number {
  const bounds = boundsOf(widgets);
  return bounds.width / bounds.height;
}

function boundsOf(widgets: readonly WorkbenchWidgetItem[]): Bounds {
  const minX = Math.min(...widgets.map((item) => item.x));
  const minY = Math.min(...widgets.map((item) => item.y));
  const maxX = Math.max(...widgets.map((item) => item.x + item.width));
  const maxY = Math.max(...widgets.map((item) => item.y + item.height));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function contentAreaOf(widgets: readonly WorkbenchWidgetItem[]): number {
  return widgets.reduce((value, item) => value + item.width * item.height, 0);
}

function densityOf(widgets: readonly WorkbenchWidgetItem[]): number {
  const bounds = boundsOf(widgets);
  return contentAreaOf(widgets) / (bounds.width * bounds.height);
}

function axisClearanceOf(widgets: readonly WorkbenchWidgetItem[]): { x: number; y: number; center: number } {
  let xClearance = Number.POSITIVE_INFINITY;
  let yClearance = Number.POSITIVE_INFINITY;
  let centerClearance = Number.POSITIVE_INFINITY;
  for (const item of widgets) {
    const dx = 0 >= item.x && 0 <= item.x + item.width
      ? 0
      : Math.min(Math.abs(item.x), Math.abs(item.x + item.width));
    const dy = 0 >= item.y && 0 <= item.y + item.height
      ? 0
      : Math.min(Math.abs(item.y), Math.abs(item.y + item.height));
    xClearance = Math.min(xClearance, dx);
    yClearance = Math.min(yClearance, dy);
    centerClearance = Math.min(centerClearance, Math.hypot(dx, dy));
  }
  return {
    x: xClearance,
    y: yClearance,
    center: centerClearance,
  };
}

function maxEmptyAxisBandOf(
  widgets: readonly WorkbenchWidgetItem[],
  axis: 'x' | 'y',
): number {
  const bounds = boundsOf(widgets);
  const edges = axis === 'x'
    ? [bounds.minX, bounds.maxX, ...widgets.flatMap((item) => [item.x, item.x + item.width])]
    : [bounds.minY, bounds.maxY, ...widgets.flatMap((item) => [item.y, item.y + item.height])];
  const sortedEdges = Array.from(new Set(edges)).sort((left, right) => left - right);
  let maxEmptyBand = 0;
  for (let index = 0; index < sortedEdges.length - 1; index += 1) {
    const start = sortedEdges[index]!;
    const end = sortedEdges[index + 1]!;
    const midpoint = (start + end) / 2;
    const covered = axis === 'x'
      ? widgets.some((item) => midpoint >= item.x && midpoint <= item.x + item.width)
      : widgets.some((item) => midpoint >= item.y && midpoint <= item.y + item.height);
    if (!covered) {
      maxEmptyBand = Math.max(maxEmptyBand, end - start);
    }
  }
  return maxEmptyBand;
}

function assertNoOverlap(widgets: readonly WorkbenchWidgetItem[]): void {
  for (let leftIndex = 0; leftIndex < widgets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < widgets.length; rightIndex += 1) {
      expect(boxesOverlap(widgets[leftIndex]!, widgets[rightIndex]!, 0)).toBe(false);
    }
  }
}

function assertSizesPreserved(
  source: readonly WorkbenchWidgetItem[],
  arranged: readonly WorkbenchWidgetItem[],
): void {
  expect(arranged.map((item) => [item.id, item.width, item.height])).toEqual(
    source.map((item) => [item.id, item.width, item.height]),
  );
}

function buildScenarioWidgets(specs: readonly ScenarioSpec[]): WorkbenchWidgetItem[] {
  let sequence = 0;
  return specs.flatMap((spec) => Array.from({ length: spec.count }, (_, index) => {
    const size = spec.sizes[index % spec.sizes.length]!;
    sequence += 1;
    return widget({
      id: `${spec.type}-${index + 1}`,
      type: spec.type,
      width: size.width,
      height: size.height,
      x: ((sequence % 5) - 2) * 420,
      y: ((sequence % 7) - 3) * -360,
      created_at_unix_ms: sequence,
    });
  }));
}

function arrangedScenario(widgets: readonly WorkbenchWidgetItem[]): WorkbenchWidgetItem[] {
  return arrangeWorkbenchWidgetsByType({
    widgets,
    typeOrder: TYPE_ORDER,
    centerX: 0,
    centerY: 0,
  });
}

function assertScenarioQuality(
  widgets: readonly WorkbenchWidgetItem[],
  options: Readonly<{
    aspectRatioLimit: number;
    minLandscapeRatio?: number;
    minDensity: number;
    axisClearanceLimit: number;
    maxEmptyBandLimit: number;
    typeAspectRatioLimit?: number;
  }>,
): void {
  const arranged = arrangedScenario(widgets);
  assertSizesPreserved(widgets, arranged);
  assertNoOverlap(arranged);
  expect(centerOf(arranged)).toEqual({ x: 0, y: 0 });
  expect(aspectRatioOf(arranged)).toBeLessThanOrEqual(options.aspectRatioLimit);
  if (options.minLandscapeRatio) {
    expect(landscapeRatioOf(arranged)).toBeGreaterThanOrEqual(options.minLandscapeRatio);
  }
  expect(densityOf(arranged)).toBeGreaterThanOrEqual(options.minDensity);
  expect(axisClearanceOf(arranged).x).toBeLessThanOrEqual(options.axisClearanceLimit);
  expect(axisClearanceOf(arranged).y).toBeLessThanOrEqual(options.axisClearanceLimit);
  expect(maxEmptyAxisBandOf(arranged, 'x')).toBeLessThanOrEqual(options.maxEmptyBandLimit);
  expect(maxEmptyAxisBandOf(arranged, 'y')).toBeLessThanOrEqual(options.maxEmptyBandLimit);

  const types = Array.from(new Set(arranged.map((item) => item.type)));
  if (options.typeAspectRatioLimit) {
    for (const type of types) {
      const group = arranged.filter((item) => item.type === type);
      if (group.length >= 4) {
        expect(aspectRatioOf(group)).toBeLessThanOrEqual(options.typeAspectRatioLimit);
      }
    }
  }
}

describe('workbenchAutoArrange', () => {
  it('keeps widget sizes intact while centering the arranged scene', () => {
    const widgets = [
      widget({ id: 'files-1', type: 'redeven.files', width: 760, height: 560, x: -1200, y: 400 }),
      widget({ id: 'terminal-1', type: 'redeven.terminal', width: 980, height: 360, x: 900, y: -700 }),
      widget({ id: 'terminal-2', type: 'redeven.terminal', width: 520, height: 620, x: 20, y: 1200 }),
    ];

    const arranged = arrangeWorkbenchWidgetsByType({
      widgets,
      typeOrder: TYPE_ORDER,
      centerX: 500,
      centerY: 300,
    });

    expect(arranged.map((item) => [item.id, item.width, item.height])).toEqual(
      widgets.map((item) => [item.id, item.width, item.height]),
    );
    expect(centerOf(arranged)).toEqual({ x: 500, y: 300 });
  });

  it('keeps same-type widgets clustered without overlaps for uneven widget sizes', () => {
    const widgets = [
      widget({ id: 'terminal-wide', type: 'redeven.terminal', width: 1320, height: 340, created_at_unix_ms: 1 }),
      widget({ id: 'files-tall', type: 'redeven.files', width: 520, height: 940, created_at_unix_ms: 2 }),
      widget({ id: 'terminal-small', type: 'redeven.terminal', width: 460, height: 380, created_at_unix_ms: 3 }),
      widget({ id: 'files-wide', type: 'redeven.files', width: 980, height: 420, created_at_unix_ms: 4 }),
      widget({ id: 'monitor', type: 'redeven.monitor', width: 760, height: 420, created_at_unix_ms: 5 }),
    ];

    const arranged = arrangeWorkbenchWidgetsByType({
      widgets,
      typeOrder: TYPE_ORDER,
      centerX: 0,
      centerY: 0,
      innerGap: 28,
      groupGap: 56,
    });

    for (let leftIndex = 0; leftIndex < arranged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arranged.length; rightIndex += 1) {
        expect(boxesOverlap(arranged[leftIndex]!, arranged[rightIndex]!, 0)).toBe(false);
      }
    }

    const terminalWidgets = arranged.filter((item) => item.type === 'redeven.terminal');
    const fileWidgets = arranged.filter((item) => item.type === 'redeven.files');
    const terminalSpanX = Math.max(...terminalWidgets.map((item) => item.x + item.width))
      - Math.min(...terminalWidgets.map((item) => item.x));
    const fileSpanX = Math.max(...fileWidgets.map((item) => item.x + item.width))
      - Math.min(...fileWidgets.map((item) => item.x));

    expect(terminalSpanX).toBeLessThanOrEqual(1320 + 460 + 56);
    expect(fileSpanX).toBeLessThanOrEqual(980 + 520 + 56);
    expect(axisClearanceOf(arranged)).toEqual({ x: 0, y: 0, center: 0 });
    expect(maxEmptyAxisBandOf(arranged, 'y')).toBeLessThanOrEqual(56);
  });

  it('centers a single widget without resizing it', () => {
    const arranged = arrangeWorkbenchWidgetsByType({
      widgets: [widget({ id: 'terminal-1', type: 'redeven.terminal', width: 840, height: 500 })],
      typeOrder: TYPE_ORDER,
      centerX: 120,
      centerY: 80,
    });

    expect(arranged[0]).toMatchObject({
      id: 'terminal-1',
      width: 840,
      height: 500,
      x: -300,
      y: -170,
    });
  });

  it('avoids a narrow vertical tower when many widgets are arranged together', () => {
    const widgets = [
      widget({ id: 'files-1', type: 'redeven.files', width: 760, height: 560 }),
      widget({ id: 'files-2', type: 'redeven.files', width: 760, height: 560 }),
      widget({ id: 'files-3', type: 'redeven.files', width: 920, height: 620 }),
      widget({ id: 'terminal-1', type: 'redeven.terminal', width: 840, height: 500 }),
      widget({ id: 'terminal-2', type: 'redeven.terminal', width: 840, height: 500 }),
      widget({ id: 'terminal-3', type: 'redeven.terminal', width: 840, height: 500 }),
      widget({ id: 'terminal-4', type: 'redeven.terminal', width: 1020, height: 360 }),
      widget({ id: 'monitor', type: 'redeven.monitor', width: 760, height: 420 }),
    ];

    const arranged = arrangeWorkbenchWidgetsByType({
      widgets,
      typeOrder: TYPE_ORDER,
      centerX: 0,
      centerY: 0,
    });

    for (let leftIndex = 0; leftIndex < arranged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arranged.length; rightIndex += 1) {
        expect(boxesOverlap(arranged[leftIndex]!, arranged[rightIndex]!, 0)).toBe(false);
      }
    }
    expect(aspectRatioOf(arranged)).toBeLessThanOrEqual(1.58);
    expect(landscapeRatioOf(arranged)).toBeGreaterThanOrEqual(1.18);
  });

  it('keeps large file and terminal sets in a compact landscape footprint', () => {
    const widgets = [
      ...Array.from({ length: 14 }, (_, index) => widget({
        id: `files-${index + 1}`,
        type: 'redeven.files',
        width: index % 4 === 0 ? 940 : 760,
        height: index % 3 === 0 ? 640 : 560,
        created_at_unix_ms: index + 1,
      })),
      ...Array.from({ length: 16 }, (_, index) => widget({
        id: `terminal-${index + 1}`,
        type: 'redeven.terminal',
        width: index % 5 === 0 ? 1020 : 840,
        height: index % 4 === 0 ? 360 : 500,
        created_at_unix_ms: index + 100,
      })),
    ];

    const arranged = arrangeWorkbenchWidgetsByType({
      widgets,
      typeOrder: TYPE_ORDER,
      centerX: 0,
      centerY: 0,
    });

    for (let leftIndex = 0; leftIndex < arranged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arranged.length; rightIndex += 1) {
        expect(boxesOverlap(arranged[leftIndex]!, arranged[rightIndex]!, 0)).toBe(false);
      }
    }
    expect(aspectRatioOf(arranged)).toBeLessThanOrEqual(1.9);
    expect(landscapeRatioOf(arranged)).toBeGreaterThanOrEqual(1.45);
  });

  it('keeps a single large file-browser family compact as a landscape block', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.files',
        count: 24,
        sizes: [
          { width: 760, height: 560 },
          { width: 820, height: 620 },
          { width: 680, height: 600 },
          { width: 940, height: 520 },
        ],
      },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 1.92,
      minLandscapeRatio: 1.35,
      minDensity: 0.81,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 16,
    });
  });

  it('keeps a single large terminal family compact when terminal sizes vary', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.terminal',
        count: 31,
        sizes: [
          { width: 840, height: 500 },
          { width: 1020, height: 360 },
          { width: 760, height: 540 },
          { width: 920, height: 440 },
          { width: 700, height: 620 },
        ],
      },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 1.9,
      minLandscapeRatio: 1.4,
      minDensity: 0.78,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 16,
    });
  });

  it('balances two large same-count families without turning them into a vertical tower', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.files',
        count: 15,
        sizes: [
          { width: 760, height: 560 },
          { width: 900, height: 620 },
          { width: 680, height: 640 },
        ],
      },
      {
        type: 'redeven.terminal',
        count: 15,
        sizes: [
          { width: 840, height: 500 },
          { width: 1040, height: 360 },
          { width: 760, height: 560 },
        ],
      },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 1.9,
      minLandscapeRatio: 1.45,
      minDensity: 0.8,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 24,
    });
  });

  it('handles heavily imbalanced type counts while keeping the full scene dense and axis-adhered', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.terminal',
        count: 22,
        sizes: [
          { width: 840, height: 500 },
          { width: 1020, height: 360 },
          { width: 720, height: 580 },
          { width: 920, height: 460 },
        ],
      },
      {
        type: 'redeven.files',
        count: 3,
        sizes: [
          { width: 760, height: 560 },
          { width: 920, height: 620 },
          { width: 640, height: 700 },
        ],
      },
      {
        type: 'redeven.monitor',
        count: 2,
        sizes: [
          { width: 760, height: 420 },
          { width: 900, height: 460 },
        ],
      },
      {
        type: 'redeven.ports',
        count: 1,
        sizes: [{ width: 760, height: 480 }],
      },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 1.92,
      minLandscapeRatio: 1.35,
      minDensity: 0.7,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 24,
    });
  });

  it('packs many widget types as type blocks instead of one long type-ordered strip', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.files',
        count: 7,
        sizes: [
          { width: 760, height: 560 },
          { width: 880, height: 620 },
          { width: 700, height: 640 },
        ],
      },
      {
        type: 'redeven.terminal',
        count: 9,
        sizes: [
          { width: 840, height: 500 },
          { width: 980, height: 380 },
          { width: 760, height: 560 },
        ],
      },
      {
        type: 'redeven.preview',
        count: 5,
        sizes: [
          { width: 900, height: 620 },
          { width: 780, height: 700 },
        ],
      },
      { type: 'redeven.monitor', count: 1, sizes: [{ width: 760, height: 420 }] },
      { type: 'redeven.codespaces', count: 1, sizes: [{ width: 780, height: 520 }] },
      { type: 'redeven.ports', count: 1, sizes: [{ width: 760, height: 480 }] },
      { type: 'redeven.ai', count: 1, sizes: [{ width: 980, height: 620 }] },
      { type: 'redeven.codex', count: 1, sizes: [{ width: 980, height: 620 }] },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 1.9,
      minLandscapeRatio: 1.35,
      minDensity: 0.75,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 24,
    });
  });

  it('stays compact with extreme wide, tall, and regular widgets mixed together', () => {
    const widgets = buildScenarioWidgets([
      {
        type: 'redeven.terminal',
        count: 8,
        sizes: [
          { width: 1500, height: 320 },
          { width: 1280, height: 360 },
          { width: 760, height: 620 },
          { width: 840, height: 500 },
        ],
      },
      {
        type: 'redeven.files',
        count: 8,
        sizes: [
          { width: 520, height: 960 },
          { width: 620, height: 880 },
          { width: 980, height: 520 },
          { width: 760, height: 560 },
        ],
      },
      {
        type: 'redeven.preview',
        count: 4,
        sizes: [
          { width: 1120, height: 520 },
          { width: 680, height: 760 },
        ],
      },
      { type: 'redeven.ai', count: 1, sizes: [{ width: 980, height: 620 }] },
      { type: 'redeven.codex', count: 1, sizes: [{ width: 980, height: 620 }] },
    ]);

    assertScenarioQuality(widgets, {
      aspectRatioLimit: 2.05,
      minLandscapeRatio: 1.25,
      minDensity: 0.72,
      axisClearanceLimit: 0,
      maxEmptyBandLimit: 24,
    });
  });
});
