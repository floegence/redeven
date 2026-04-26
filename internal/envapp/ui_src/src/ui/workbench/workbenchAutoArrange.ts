import type { WorkbenchWidgetItem, WorkbenchWidgetType } from '@floegence/floe-webapp-core/workbench';

type PackInput = Readonly<{
  id: string;
  type: WorkbenchWidgetType;
  width: number;
  height: number;
  originalIndex: number;
  typeRank: number;
}>;

type SortableRect = Readonly<{
  width: number;
  height: number;
  originalIndex: number;
  typeRank?: number;
}>;

type PackedItem = PackInput & {
  x: number;
  y: number;
};

type PackedLayout = Readonly<{
  items: PackedItem[];
  width: number;
  height: number;
  sourceArea: number;
  score: number;
}>;

type RectBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type PackHeuristic = 'bestShortSide' | 'bestArea' | 'bottomLeft' | 'contact';

type CompactDirection = 'left' | 'right' | 'up' | 'down';

export type WorkbenchAutoArrangeOptions = Readonly<{
  widgets: readonly WorkbenchWidgetItem[];
  typeOrder: readonly WorkbenchWidgetType[];
  centerX: number;
  centerY: number;
  innerGap?: number;
  groupGap?: number;
}>;

const DEFAULT_INNER_GAP = 12;
const DEFAULT_GROUP_GAP = 18;
const TARGET_WIDTH_FACTORS = [0.88, 1, 1.12, 1.24, 1.38, 1.52, 1.68, 1.88, 2.12, 2.42] as const;
const MAX_TARGET_COLUMN_SAMPLES = 10;
const MAX_ORDER_CANDIDATES = 8;
const MAX_LARGE_LAYOUT_ORDER_CANDIDATES = 6;
const LARGE_LAYOUT_ITEM_COUNT = 18;
const VERY_LARGE_LAYOUT_ITEM_COUNT = 28;
const COMPACTION_PASSES = 3;
const PACK_HEURISTICS: readonly PackHeuristic[] = ['bestShortSide', 'bestArea', 'contact'] as const;
const AREA_SCORE = 6;
const EMPTY_AREA_SCORE = 130;
const AXIS_ADHESION_SCORE = 180;
const TYPE_CLUSTER_EMPTY_SCORE = 18;
const TYPE_CLUSTER_DISTANCE_SCORE = 3.2;
const EMPTY_BAND_SCORE = 3_600;
const EDGE_CONTACT_SCORE = 48;
const EDGE_ALIGNMENT_SCORE = 220;
const LANDSCAPE_SHORTFALL_SCORE = 5_200;
const EXTREME_ASPECT_SCORE = 4_500;
const DENSITY_FLOOR = 0.72;
const EXTREME_ASPECT_FLOOR = 1.92;

function finitePositive(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value))))
    .sort((left, right) => left - right);
}

function compareNumberTuples(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (Math.abs(delta) > 0.001) {
      return delta;
    }
  }
  return 0;
}

function rectsIntersect(left: RectBounds, right: RectBounds): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function rectContains(outer: RectBounds, inner: RectBounds): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function intervalOverlapLength(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function compareByOriginalIndex(left: SortableRect, right: SortableRect): number {
  return left.originalIndex - right.originalIndex;
}

function compareByArea(left: SortableRect, right: SortableRect): number {
  const areaDelta = (right.width * right.height) - (left.width * left.height);
  if (areaDelta !== 0) return areaDelta;
  return compareByOriginalIndex(left, right);
}

function compareByHeight(left: SortableRect, right: SortableRect): number {
  const heightDelta = right.height - left.height;
  if (heightDelta !== 0) return heightDelta;
  return compareByArea(left, right);
}

function compareByWidth(left: SortableRect, right: SortableRect): number {
  const widthDelta = right.width - left.width;
  if (widthDelta !== 0) return widthDelta;
  return compareByArea(left, right);
}

function compareByLongSide(left: SortableRect, right: SortableRect): number {
  const sideDelta = Math.max(right.width, right.height) - Math.max(left.width, left.height);
  if (sideDelta !== 0) return sideDelta;
  return compareByArea(left, right);
}

function compareByTypeThen(compare: (left: SortableRect, right: SortableRect) => number) {
  return (left: PackInput, right: PackInput): number => {
    const leftRank = left.typeRank;
    const rightRank = right.typeRank;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compare(left, right);
  };
}

function rectsOverlap(
  left: Pick<PackedItem, 'x' | 'y' | 'width' | 'height'>,
  right: Pick<PackedItem, 'x' | 'y' | 'width' | 'height'>,
  gap: number,
): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

function boundsOf(items: readonly Pick<PackedItem, 'x' | 'y' | 'width' | 'height'>[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (items.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function normalizePackedItems(items: readonly PackedItem[]): PackedItem[] {
  const bounds = boundsOf(items);
  return items.map((item) => ({
    ...item,
    x: item.x - bounds.minX,
    y: item.y - bounds.minY,
  }));
}

function contentArea(items: readonly Pick<PackInput, 'width' | 'height'>[]): number {
  return items.reduce((value, item) => value + item.width * item.height, 0);
}

function aspectRatioForSize(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(width / height, height / width);
}

function landscapeRatioForSize(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return width / height;
}

function targetLandscapeRatioForCount(count: number): number {
  if (count <= 1) {
    return 1;
  }
  if (count < 8) {
    return 1.18;
  }
  if (count < LARGE_LAYOUT_ITEM_COUNT) {
    return 1.34;
  }
  return 1.54;
}

function axisClearancePenalty(
  rects: readonly Readonly<{ x: number; y: number; width: number; height: number }>[],
  width: number,
  height: number,
): number {
  if (rects.length === 0 || width <= 0 || height <= 0) {
    return 0;
  }

  const axisX = width / 2;
  const axisY = height / 2;
  let xClearance = Number.POSITIVE_INFINITY;
  let yClearance = Number.POSITIVE_INFINITY;
  let centerClearance = Number.POSITIVE_INFINITY;

  for (const rect of rects) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    const dx = axisX >= left && axisX <= right
      ? 0
      : Math.min(Math.abs(axisX - left), Math.abs(axisX - right));
    const dy = axisY >= top && axisY <= bottom
      ? 0
      : Math.min(Math.abs(axisY - top), Math.abs(axisY - bottom));
    xClearance = Math.min(xClearance, dx);
    yClearance = Math.min(yClearance, dy);
    centerClearance = Math.min(centerClearance, Math.hypot(dx, dy));
  }

  return ((xClearance ** 2) + (yClearance ** 2) + ((centerClearance ** 2) * 0.35)) * AXIS_ADHESION_SCORE;
}

function maxEmptyAxisBand(
  items: readonly Pick<PackedItem, 'x' | 'y' | 'width' | 'height'>[],
  axis: 'x' | 'y',
): number {
  const bounds = boundsOf(items);
  const edges = axis === 'x'
    ? [bounds.minX, bounds.maxX, ...items.flatMap((item) => [item.x, item.x + item.width])]
    : [bounds.minY, bounds.maxY, ...items.flatMap((item) => [item.y, item.y + item.height])];
  const sortedEdges = uniqueSorted(edges);
  let maxBand = 0;

  for (let index = 0; index < sortedEdges.length - 1; index += 1) {
    const start = sortedEdges[index]!;
    const end = sortedEdges[index + 1]!;
    const midpoint = (start + end) / 2;
    const covered = axis === 'x'
      ? items.some((item) => midpoint >= item.x && midpoint <= item.x + item.width)
      : items.some((item) => midpoint >= item.y && midpoint <= item.y + item.height);
    if (!covered) {
      maxBand = Math.max(maxBand, end - start);
    }
  }

  return maxBand;
}

function toPackInputs(
  widgets: readonly WorkbenchWidgetItem[],
  typeOrder: readonly WorkbenchWidgetType[],
): PackInput[] {
  const typeRank = new Map(typeOrder.map((type, index) => [type, index]));
  return widgets.map((widget, originalIndex) => ({
    id: widget.id,
    type: widget.type,
    width: finitePositive(widget.width, 1),
    height: finitePositive(widget.height, 1),
    originalIndex,
    typeRank: typeRank.get(widget.type) ?? Number.MAX_SAFE_INTEGER,
  }));
}

function orderKey(items: readonly Pick<PackInput, 'id'>[]): string {
  return items.map((item) => item.id).join('\n');
}

function createOrderCandidates(inputs: readonly PackInput[]): PackInput[][] {
  const typeSorted = inputs.slice().sort((left, right) => {
    if (left.typeRank !== right.typeRank) return left.typeRank - right.typeRank;
    return left.originalIndex - right.originalIndex;
  });
  const comparators = [
    compareByTypeThen(compareByOriginalIndex),
    compareByTypeThen(compareByArea),
    compareByTypeThen(compareByHeight),
    compareByTypeThen(compareByWidth),
    compareByTypeThen(compareByLongSide),
    compareByArea,
    compareByHeight,
    compareByWidth,
    compareByLongSide,
    compareByOriginalIndex,
  ] as const;

  const candidates: PackInput[][] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: PackInput[]) => {
    const key = orderKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  for (const compare of comparators) {
    addCandidate(inputs.slice().sort(compare));
  }

  const groups = new Map<WorkbenchWidgetType, PackInput[]>();
  for (const item of typeSorted) {
    const group = groups.get(item.type) ?? [];
    group.push(item);
    groups.set(item.type, group);
  }
  const groupQueues = Array.from(groups.values()).map((group) => group.slice().sort(compareByArea));
  const roundRobin: PackInput[] = [];
  while (groupQueues.some((group) => group.length > 0)) {
    groupQueues
      .sort((left, right) => right.length - left.length)
      .forEach((group) => {
        const item = group.shift();
        if (item) {
          roundRobin.push(item);
        }
      });
  }
  addCandidate(roundRobin);

  return candidates.slice(
    0,
    inputs.length >= LARGE_LAYOUT_ITEM_COUNT ? MAX_LARGE_LAYOUT_ORDER_CANDIDATES : MAX_ORDER_CANDIDATES,
  );
}

function targetWidthsForItems(items: readonly PackInput[], gap: number): number[] {
  const sourceArea = contentArea(items);
  const maxWidth = items.reduce((value, item) => Math.max(value, item.width), 0);
  const totalWidth = items.reduce((value, item, index) => value + item.width + (index > 0 ? gap : 0), 0);
  const squareWidth = Math.sqrt(sourceArea);
  const widthsDescending = items.map((item) => item.width).sort((left, right) => right - left);
  const maxColumnSamples = items.length >= VERY_LARGE_LAYOUT_ITEM_COUNT
    ? Math.max(6, MAX_TARGET_COLUMN_SAMPLES - 3)
    : MAX_TARGET_COLUMN_SAMPLES;
  const columnSampleCount = Math.min(
    items.length,
    Math.max(1, Math.ceil(Math.sqrt(items.length) * 2.8)),
    maxColumnSamples,
  );
  const columnTargets = Array.from({ length: columnSampleCount }, (_, index) => {
    const columns = index + 1;
    const width = widthsDescending
      .slice(0, columns)
      .reduce((value, itemWidth) => value + itemWidth, 0);
    return width + Math.max(0, columns - 1) * gap;
  });
  return uniqueSorted([
    maxWidth,
    Math.min(totalWidth, maxWidth * 1.35),
    totalWidth,
    ...columnTargets,
    ...TARGET_WIDTH_FACTORS.map((factor) => squareWidth * factor),
  ]).map((value) => Math.max(maxWidth, Math.min(totalWidth, value)));
}

function candidateCoordinates(
  placed: readonly PackedItem[],
  item: PackInput,
  gap: number,
): Array<Readonly<{ x: number; y: number }>> {
  const xValues = uniqueSorted([
    0,
    ...placed.flatMap((rect) => [
      rect.x,
      rect.x + rect.width + gap,
      rect.x + rect.width - item.width,
    ]),
  ]).filter((value) => value >= 0);
  const yValues = uniqueSorted([
    0,
    ...placed.flatMap((rect) => [
      rect.y,
      rect.y + rect.height + gap,
      rect.y + rect.height - item.height,
    ]),
  ]).filter((value) => value >= 0);

  return xValues.flatMap((x) => yValues.map((y) => ({ x, y })));
}

function sameTypeTouchScore(item: PackedItem, placed: readonly PackedItem[], gap: number): number {
  return placed.reduce((score, other) => {
    const horizontalTouch = Math.abs(item.x - (other.x + other.width + gap)) <= 0.1
      || Math.abs(other.x - (item.x + item.width + gap)) <= 0.1;
    const verticalOverlap = item.y < other.y + other.height && item.y + item.height > other.y;
    const verticalTouch = Math.abs(item.y - (other.y + other.height + gap)) <= 0.1
      || Math.abs(other.y - (item.y + item.height + gap)) <= 0.1;
    const horizontalOverlap = item.x < other.x + other.width && item.x + item.width > other.x;
    const touches = (horizontalTouch && verticalOverlap) || (verticalTouch && horizontalOverlap);
    if (!touches) {
      return score;
    }
    return score + (item.type === other.type ? -18_000 : 2_500);
  }, 0);
}

function edgeContactLength(item: PackedItem, placed: readonly PackedItem[], gap: number): number {
  return placed.reduce((value, other) => {
    const itemRight = item.x + item.width;
    const otherRight = other.x + other.width;
    const itemBottom = item.y + item.height;
    const otherBottom = other.y + other.height;
    const horizontalContact = Math.abs(item.x - (otherRight + gap)) <= 0.1
      || Math.abs(other.x - (itemRight + gap)) <= 0.1
      ? intervalOverlapLength(item.y, itemBottom, other.y, otherBottom)
      : 0;
    const verticalContact = Math.abs(item.y - (otherBottom + gap)) <= 0.1
      || Math.abs(other.y - (itemBottom + gap)) <= 0.1
      ? intervalOverlapLength(item.x, itemRight, other.x, otherRight)
      : 0;
    const typeWeight = item.type === other.type ? 1.35 : 0.72;
    return value + (horizontalContact + verticalContact) * typeWeight;
  }, 0);
}

function expandedPackRect(item: Pick<PackedItem, 'x' | 'y' | 'width' | 'height'>, gap: number): RectBounds {
  return {
    x: item.x,
    y: item.y,
    width: item.width + gap,
    height: item.height + gap,
  };
}

function splitFreeRect(freeRect: RectBounds, usedRect: RectBounds): RectBounds[] {
  if (!rectsIntersect(freeRect, usedRect)) {
    return [freeRect];
  }

  const next: RectBounds[] = [];
  const freeRight = freeRect.x + freeRect.width;
  const freeBottom = freeRect.y + freeRect.height;
  const usedRight = usedRect.x + usedRect.width;
  const usedBottom = usedRect.y + usedRect.height;

  if (usedRect.x > freeRect.x) {
    next.push({
      x: freeRect.x,
      y: freeRect.y,
      width: usedRect.x - freeRect.x,
      height: freeRect.height,
    });
  }
  if (usedRight < freeRight) {
    next.push({
      x: usedRight,
      y: freeRect.y,
      width: freeRight - usedRight,
      height: freeRect.height,
    });
  }
  if (usedRect.y > freeRect.y) {
    next.push({
      x: freeRect.x,
      y: freeRect.y,
      width: freeRect.width,
      height: usedRect.y - freeRect.y,
    });
  }
  if (usedBottom < freeBottom) {
    next.push({
      x: freeRect.x,
      y: usedBottom,
      width: freeRect.width,
      height: freeBottom - usedBottom,
    });
  }

  return next.filter((rect) => rect.width > 0 && rect.height > 0);
}

function pruneFreeRects(freeRects: readonly RectBounds[]): RectBounds[] {
  const result: RectBounds[] = [];

  freeRects.forEach((rect, index) => {
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const contained = freeRects.some((other, otherIndex) => (
      otherIndex !== index
      && other.width > 0
      && other.height > 0
      && rectContains(other, rect)
    ));
    if (!contained && !result.some((other) => rectContains(other, rect) && rectContains(rect, other))) {
      result.push(rect);
    }
  });

  return result;
}

function maxRectsPlacementScore(
  item: PackInput,
  freeRect: RectBounds,
  candidate: PackedItem,
  placed: readonly PackedItem[],
  gap: number,
  heuristic: PackHeuristic,
): number[] {
  const packWidth = item.width + gap;
  const packHeight = item.height + gap;
  const leftoverX = Math.max(0, freeRect.width - packWidth);
  const leftoverY = Math.max(0, freeRect.height - packHeight);
  const shortSideFit = Math.min(leftoverX, leftoverY);
  const longSideFit = Math.max(leftoverX, leftoverY);
  const areaFit = Math.max(0, (freeRect.width * freeRect.height) - (packWidth * packHeight));
  const bottom = candidate.y + item.height;
  const contact = edgeContactLength(candidate, placed, gap);
  const typeTouch = sameTypeTouchScore(candidate, placed, gap);

  if (heuristic === 'bestArea') {
    return [areaFit, shortSideFit, longSideFit, bottom, candidate.x, typeTouch - contact];
  }
  if (heuristic === 'bottomLeft') {
    return [bottom, candidate.x, shortSideFit, areaFit, typeTouch - contact];
  }
  if (heuristic === 'contact') {
    return [-contact, shortSideFit, areaFit, bottom, candidate.x, typeTouch];
  }
  return [shortSideFit, longSideFit, areaFit, bottom, candidate.x, typeTouch - contact];
}

function chooseMaxRectsPlacement(
  item: PackInput,
  placed: readonly PackedItem[],
  freeRects: readonly RectBounds[],
  targetWidth: number,
  gap: number,
  heuristic: PackHeuristic,
): PackedItem | null {
  const packWidth = item.width + gap;
  const packHeight = item.height + gap;
  let best: Readonly<{ item: PackedItem; score: number[] }> | null = null;

  for (const freeRect of freeRects) {
    if (packWidth > freeRect.width || packHeight > freeRect.height) {
      continue;
    }
    const candidate: PackedItem = {
      ...item,
      x: freeRect.x,
      y: freeRect.y,
    };
    if (candidate.x + item.width > targetWidth) {
      continue;
    }
    if (placed.some((rect) => rectsOverlap(candidate, rect, gap))) {
      continue;
    }
    const score = maxRectsPlacementScore(item, freeRect, candidate, placed, gap, heuristic);
    if (!best || compareNumberTuples(score, best.score) < 0) {
      best = { item: candidate, score };
    }
  }

  return best?.item ?? null;
}

function packWithMaxRects(
  items: readonly PackInput[],
  targetWidth: number,
  gap: number,
  heuristic: PackHeuristic,
): PackedItem[] | null {
  const maxHeight = items.reduce((value, item) => value + item.height + gap, gap);
  let freeRects: RectBounds[] = [{
    x: 0,
    y: 0,
    width: targetWidth + gap,
    height: maxHeight,
  }];
  const placed: PackedItem[] = [];

  for (const item of items) {
    const placement = chooseMaxRectsPlacement(item, placed, freeRects, targetWidth, gap, heuristic);
    if (!placement) {
      return null;
    }
    placed.push(placement);
    const usedRect = expandedPackRect(placement, gap);
    freeRects = pruneFreeRects(freeRects.flatMap((freeRect) => splitFreeRect(freeRect, usedRect)));
  }

  return normalizePackedItems(placed);
}

function choosePlacementForItem(
  item: PackInput,
  placed: readonly PackedItem[],
  targetWidth: number,
  gap: number,
): PackedItem | null {
  return candidateCoordinates(placed, item, gap).reduce<PackedItem | null>((best, position) => {
    if (position.x + item.width > targetWidth) {
      return best;
    }

    const candidate: PackedItem = {
      ...item,
      x: position.x,
      y: position.y,
    };
    if (placed.some((rect) => rectsOverlap(candidate, rect, gap))) {
      return best;
    }

    const nextBounds = boundsOf([...placed, candidate]);
    const bottom = position.y + item.height;
    const centerDrift = Math.abs((position.x + (item.width / 2)) - (targetWidth / 2));
    const placementScore = (bottom * 1_000_000)
      + (nextBounds.height * 24_000)
      + (nextBounds.width * 2_400)
      + (nextBounds.width * nextBounds.height * 0.9)
      + (centerDrift * 12)
      + sameTypeTouchScore(candidate, placed, gap)
      + position.x;

    if (!best) {
      return candidate;
    }
    const bestBounds = boundsOf([...placed, best]);
    const bestBottom = best.y + best.height;
    const bestCenterDrift = Math.abs((best.x + (best.width / 2)) - (targetWidth / 2));
    const bestScore = (bestBottom * 1_000_000)
      + (bestBounds.height * 24_000)
      + (bestBounds.width * 2_400)
      + (bestBounds.width * bestBounds.height * 0.9)
      + (bestCenterDrift * 12)
      + sameTypeTouchScore(best, placed, gap)
      + best.x;
    return placementScore < bestScore ? candidate : best;
  }, null);
}

function packWithEdgeCandidates(
  items: readonly PackInput[],
  targetWidth: number,
  gap: number,
): PackedItem[] | null {
  const placed: PackedItem[] = [];
  for (const item of items) {
    const placement = choosePlacementForItem(item, placed, targetWidth, gap);
    if (!placement) {
      return null;
    }
    placed.push(placement);
  }
  return normalizePackedItems(placed);
}

function packedItemsKey(items: readonly PackedItem[]): string {
  return items
    .map((item) => `${item.id}:${Math.round(item.x)}:${Math.round(item.y)}`)
    .sort()
    .join('|');
}

function packInWidth(
  items: readonly PackInput[],
  targetWidth: number,
  gap: number,
): PackedItem[][] {
  const layouts: PackedItem[][] = [];
  const seen = new Set<string>();
  const addLayout = (layout: PackedItem[] | null) => {
    if (!layout) {
      return;
    }
    const key = packedItemsKey(layout);
    if (!seen.has(key)) {
      seen.add(key);
      layouts.push(layout);
    }
  };

  for (const heuristic of PACK_HEURISTICS) {
    addLayout(packWithMaxRects(items, targetWidth, gap, heuristic));
  }
  if (items.length < LARGE_LAYOUT_ITEM_COUNT) {
    addLayout(packWithEdgeCandidates(items, targetWidth, gap));
  }

  return layouts;
}

function compactDirection(
  items: readonly PackedItem[],
  gap: number,
  direction: CompactDirection,
): PackedItem[] {
  const next = items.map((item) => ({ ...item }));
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const coordinate = axis;
  const size = axis === 'x' ? 'width' : 'height';
  const movingPositive = direction === 'right' || direction === 'down';
  const bounds = boundsOf(next);
  const extent = axis === 'x' ? bounds.width : bounds.height;

  next
    .slice()
    .sort((left, right) => (
      movingPositive
        ? (right[coordinate] + right[size]) - (left[coordinate] + left[size])
        : left[coordinate] - right[coordinate]
    ))
    .forEach((item) => {
      const index = next.findIndex((candidate) => candidate.id === item.id);
      const current = next[index]!;
      const others = next.filter((_, otherIndex) => otherIndex !== index);
      const limit = extent - current[size];
      const candidates = movingPositive
        ? uniqueSorted([
          Math.max(0, limit),
          ...others.map((other) => other[coordinate] - current[size] - gap),
        ])
          .filter((value) => value >= current[coordinate] && value <= limit)
          .sort((left, right) => right - left)
        : uniqueSorted([
          0,
          ...others.map((other) => other[coordinate] + other[size] + gap),
        ])
          .filter((value) => value >= 0 && value <= current[coordinate]);

      for (const value of candidates) {
        const candidate = {
          ...current,
          [coordinate]: value,
        };
        if (!others.some((other) => rectsOverlap(candidate, other, gap))) {
          next[index] = candidate;
          break;
        }
      }
    });

  return normalizePackedItems(next);
}

function compactWithDirections(
  items: readonly PackedItem[],
  gap: number,
  directions: readonly CompactDirection[],
): PackedItem[] {
  let next = normalizePackedItems(items);
  for (let pass = 0; pass < COMPACTION_PASSES; pass += 1) {
    for (const direction of directions) {
      next = compactDirection(next, gap, direction);
    }
  }
  return normalizePackedItems(next);
}

function compactLayoutVariants(items: readonly PackedItem[], gap: number): PackedItem[][] {
  const compactSequences: readonly (readonly CompactDirection[])[] = [
    ['left', 'up'],
    ['right', 'up'],
    ['left', 'down'],
    ['right', 'down'],
    ['left', 'up', 'right', 'down'],
  ];
  const sequences = items.length >= VERY_LARGE_LAYOUT_ITEM_COUNT
    ? compactSequences.filter((_, index) => index === 0 || index === 3 || index === 4)
    : compactSequences;
  const layouts: PackedItem[][] = [];
  const seen = new Set<string>();
  const addLayout = (layout: PackedItem[]) => {
    const key = packedItemsKey(layout);
    if (!seen.has(key)) {
      seen.add(key);
      layouts.push(layout);
    }
  };

  addLayout(normalizePackedItems(items));
  for (const sequence of sequences) {
    addLayout(compactWithDirections(items, gap, sequence));
  }

  return layouts;
}

function totalEdgeContactLength(items: readonly PackedItem[], gap: number): number {
  let contact = 0;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      contact += edgeContactLength(items[leftIndex]!, [items[rightIndex]!], gap);
    }
  }
  return contact;
}

function edgeAlignmentPenalty(items: readonly PackedItem[]): number {
  if (items.length <= 1) {
    return 0;
  }
  const xEdges = new Set<number>();
  const yEdges = new Set<number>();
  items.forEach((item) => {
    xEdges.add(Math.round(item.x));
    xEdges.add(Math.round(item.x + item.width));
    yEdges.add(Math.round(item.y));
    yEdges.add(Math.round(item.y + item.height));
  });
  const idealLaneCount = Math.ceil(Math.sqrt(items.length)) * 4;
  return Math.max(0, (xEdges.size + yEdges.size) - idealLaneCount);
}

function typeClusterPenalty(items: readonly PackedItem[]): number {
  const groups = new Map<WorkbenchWidgetType, PackedItem[]>();
  for (const item of items) {
    const group = groups.get(item.type) ?? [];
    group.push(item);
    groups.set(item.type, group);
  }

  let penalty = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    const bounds = boundsOf(group);
    const groupArea = contentArea(group);
    const centerX = group.reduce((value, item) => value + item.x + (item.width / 2), 0) / group.length;
    const centerY = group.reduce((value, item) => value + item.y + (item.height / 2), 0) / group.length;
    const distance = group.reduce((value, item) => (
      value + Math.hypot((item.x + (item.width / 2)) - centerX, (item.y + (item.height / 2)) - centerY)
    ), 0);
    penalty += Math.max(0, (bounds.width * bounds.height) - groupArea) * TYPE_CLUSTER_EMPTY_SCORE;
    penalty += distance * TYPE_CLUSTER_DISTANCE_SCORE;
  }
  return penalty;
}

function densityPenalty(totalArea: number, sourceArea: number): number {
  if (totalArea <= 0 || sourceArea <= 0) {
    return 0;
  }
  const density = sourceArea / totalArea;
  const deficit = Math.max(0, DENSITY_FLOOR - density);
  return (deficit ** 2) * sourceArea * EMPTY_AREA_SCORE;
}

function landscapePenalty(width: number, height: number, itemCount: number, sourceArea: number): number {
  const landscapeRatio = landscapeRatioForSize(width, height);
  const targetRatio = targetLandscapeRatioForCount(itemCount);
  const shortfall = Math.max(0, targetRatio - landscapeRatio);
  return (shortfall ** 2) * sourceArea * LANDSCAPE_SHORTFALL_SCORE;
}

function scoreLayout(items: readonly PackedItem[], sourceArea: number, gap: number): PackedLayout {
  const bounds = boundsOf(items);
  const totalArea = bounds.width * bounds.height;
  const emptyArea = Math.max(0, totalArea - sourceArea);
  const aspectRatio = aspectRatioForSize(bounds.width, bounds.height);
  const extremeAspect = Math.max(0, aspectRatio - EXTREME_ASPECT_FLOOR);
  const score = (totalArea * AREA_SCORE)
    + (emptyArea * EMPTY_AREA_SCORE)
    + densityPenalty(totalArea, sourceArea)
    + (maxEmptyAxisBand(items, 'x') + maxEmptyAxisBand(items, 'y')) * EMPTY_BAND_SCORE
    + axisClearancePenalty(items, bounds.width, bounds.height)
    + typeClusterPenalty(items)
    + (edgeAlignmentPenalty(items) * EDGE_ALIGNMENT_SCORE)
    + landscapePenalty(bounds.width, bounds.height, items.length, sourceArea)
    - (totalEdgeContactLength(items, gap) * EDGE_CONTACT_SCORE)
    + ((extremeAspect ** 2) * sourceArea * EXTREME_ASPECT_SCORE);

  return {
    items: items.slice(),
    width: bounds.width,
    height: bounds.height,
    sourceArea,
    score,
  };
}

function packBestLayout(
  inputs: readonly PackInput[],
  gap: number,
): PackedLayout | null {
  const sourceArea = contentArea(inputs);
  let best: PackedLayout | null = null;

  for (const order of createOrderCandidates(inputs)) {
    for (const targetWidth of targetWidthsForItems(order, gap)) {
      for (const packedItems of packInWidth(order, targetWidth, gap)) {
        for (const compacted of compactLayoutVariants(packedItems, gap)) {
          const candidate = scoreLayout(compacted, sourceArea, gap);
          if (!best || candidate.score < best.score) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
}

function resolveCurrentSceneCenter(widgets: readonly WorkbenchWidgetItem[]): { x: number; y: number } {
  if (widgets.length === 0) {
    return { x: 0, y: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const widget of widgets) {
    minX = Math.min(minX, finiteNumber(widget.x, 0));
    minY = Math.min(minY, finiteNumber(widget.y, 0));
    maxX = Math.max(maxX, finiteNumber(widget.x, 0) + finitePositive(widget.width, 1));
    maxY = Math.max(maxY, finiteNumber(widget.y, 0) + finitePositive(widget.height, 1));
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function roundCanvasPoint(value: number): number {
  return Math.round(value);
}

export function arrangeWorkbenchWidgetsByType(
  options: WorkbenchAutoArrangeOptions,
): WorkbenchWidgetItem[] {
  const widgets = options.widgets.map((widget) => ({ ...widget }));
  if (widgets.length === 0) {
    return [];
  }

  const innerGap = finitePositive(options.innerGap, DEFAULT_INNER_GAP);
  const groupGap = finitePositive(options.groupGap, DEFAULT_GROUP_GAP);
  const layoutGap = Math.min(innerGap, groupGap);
  const packed = packBestLayout(toPackInputs(widgets, options.typeOrder), layoutGap);

  if (!packed) {
    return widgets;
  }

  const nextPositionByWidgetId = new Map(packed.items.map((item) => [item.id, { x: item.x, y: item.y }]));
  const fallbackCenter = resolveCurrentSceneCenter(widgets);
  const targetCenterX = finiteNumber(options.centerX, fallbackCenter.x);
  const targetCenterY = finiteNumber(options.centerY, fallbackCenter.y);
  const shiftX = targetCenterX - packed.width / 2;
  const shiftY = targetCenterY - packed.height / 2;

  return widgets.map((widget) => {
    const position = nextPositionByWidgetId.get(widget.id);
    if (!position) {
      return widget;
    }
    return {
      ...widget,
      x: roundCanvasPoint(position.x + shiftX),
      y: roundCanvasPoint(position.y + shiftY),
    };
  });
}
