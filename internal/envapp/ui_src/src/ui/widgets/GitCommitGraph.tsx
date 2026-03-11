import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitCommitSummary } from '../protocol/redeven_v1';

export type CommitGraphLane = {
  hash: string;
  colorIndex: number;
};

export type CommitGraphRow = {
  commit: GitCommitSummary;
  lane: number;
  nodeColorIndex: number;
  beforeLanes: CommitGraphLane[];
  afterLanes: CommitGraphLane[];
  parents: string[];
  columns: number;
};

const LANE_WIDTH = 16;
const GRAPH_PADDING_X = 10;
const NODE_RADIUS = 4.25;
const ROW_HEIGHT = 34;
const MID_Y = ROW_HEIGHT / 2;

const LANE_STROKE_COLORS = [
  'color-mix(in srgb, var(--primary) 78%, transparent)',
  'color-mix(in srgb, rgb(139 92 246) 78%, transparent)',
  'color-mix(in srgb, rgb(14 165 233) 82%, transparent)',
  'color-mix(in srgb, var(--success) 80%, transparent)',
  'color-mix(in srgb, var(--warning) 85%, transparent)',
  'color-mix(in srgb, rgb(217 70 239) 78%, transparent)',
  'color-mix(in srgb, rgb(6 182 212) 82%, transparent)',
  'color-mix(in srgb, rgb(244 63 94) 78%, transparent)',
];

const LANE_FILL_COLORS = [
  'var(--primary)',
  'rgb(139 92 246)',
  'rgb(14 165 233)',
  'var(--success)',
  'var(--warning)',
  'rgb(217 70 239)',
  'rgb(6 182 212)',
  'rgb(244 63 94)',
];

function laneX(index: number): number {
  return GRAPH_PADDING_X + index * LANE_WIDTH + LANE_WIDTH / 2;
}

function rowTop(index: number): number {
  return index * ROW_HEIGHT;
}

function rowMid(index: number): number {
  return rowTop(index) + MID_Y;
}

function rowBottom(index: number): number {
  return rowTop(index) + ROW_HEIGHT;
}

function rowLineTop(index: number): number {
  return index === 0 ? rowTop(index) : rowTop(index) - 0.75;
}

function rowLineBottom(index: number, rowCount: number): number {
  return index === rowCount - 1 ? rowBottom(index) : rowBottom(index) + 0.75;
}

function uniqueParents(parents: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const parent of parents ?? []) {
    const value = String(parent ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function dedupeLanes(lanes: CommitGraphLane[]): CommitGraphLane[] {
  const seen = new Set<string>();
  const result: CommitGraphLane[] = [];
  for (const lane of lanes) {
    if (!lane.hash || seen.has(lane.hash)) continue;
    seen.add(lane.hash);
    result.push(lane);
  }
  return result;
}

function laneStrokeColor(index: number): string {
  return LANE_STROKE_COLORS[index % LANE_STROKE_COLORS.length] ?? LANE_STROKE_COLORS[0]!;
}

function laneFillColor(index: number): string {
  return LANE_FILL_COLORS[index % LANE_FILL_COLORS.length] ?? LANE_FILL_COLORS[0]!;
}

function transitionPath(fromLane: number, toLane: number, fromY: number, toY: number): string {
  const fromX = laneX(fromLane);
  const toX = laneX(toLane);
  if (fromLane === toLane) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const controlY = fromY + (toY - fromY) * 0.5;
  return `M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`;
}

function laneByHash(lanes: CommitGraphLane[], hash: string): CommitGraphLane | undefined {
  return lanes.find((lane) => lane.hash === hash);
}

function graphWidth(columns: number): number {
  return Math.max(columns, 1) * LANE_WIDTH + GRAPH_PADDING_X * 2;
}

export function buildCommitGraphRows(commits: GitCommitSummary[]): CommitGraphRow[] {
  const rows: CommitGraphRow[] = [];
  let frontier: CommitGraphLane[] = [];
  let nextColorIndex = 0;
  const allocateColor = () => {
    const value = nextColorIndex;
    nextColorIndex += 1;
    return value;
  };

  for (const commit of commits) {
    let before = frontier.slice();
    let lane = before.findIndex((entry) => entry.hash === commit.hash);
    if (lane < 0) {
      lane = before.length;
      before = before.slice();
      before.splice(lane, 0, {
        hash: commit.hash,
        colorIndex: before.length === 0 ? 0 : allocateColor(),
      });
    }

    const currentLane = before[lane]!;
    const parents = uniqueParents(commit.parents);
    const after = before.slice();
    after.splice(lane, 1);

    if (parents[0]) {
      const firstParentHash = parents[0]!;
      const existingIndex = after.findIndex((entry) => entry.hash === firstParentHash);
      if (existingIndex >= 0) {
        const existing = after.splice(existingIndex, 1)[0]!;
        after.splice(Math.min(lane, after.length), 0, existing);
      } else {
        after.splice(Math.min(lane, after.length), 0, {
          hash: firstParentHash,
          colorIndex: currentLane.colorIndex,
        });
      }
    }

    let insertLane = lane + 1;
    for (const parent of parents.slice(1)) {
      if (after.some((entry) => entry.hash === parent)) continue;
      after.splice(Math.min(insertLane, after.length), 0, {
        hash: parent,
        colorIndex: allocateColor(),
      });
      insertLane += 1;
    }

    frontier = dedupeLanes(after);

    rows.push({
      commit,
      lane,
      nodeColorIndex: currentLane.colorIndex,
      beforeLanes: before,
      afterLanes: frontier.slice(),
      parents,
      columns: 1,
    });
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.beforeLanes.length, row.afterLanes.length, 1), 1);
  return rows.map((row) => ({ ...row, columns: maxColumns }));
}

export interface GitCommitGraphProps {
  commits: GitCommitSummary[];
  selectedCommitHash?: string;
  onSelect?: (hash: string) => void;
  class?: string;
}

export function GitCommitGraph(props: GitCommitGraphProps) {
  const rows = createMemo(() => buildCommitGraphRows(props.commits ?? []));
  const rowCount = createMemo(() => rows().length);
  const columns = createMemo(() => rows()[0]?.columns ?? 1);
  const width = createMemo(() => graphWidth(columns()));
  const height = createMemo(() => Math.max(rows().length * ROW_HEIGHT, ROW_HEIGHT));

  return (
    <div class={cn('overflow-hidden rounded-md border border-border/55 bg-card', props.class)}>
      <div class="relative">
        <svg
          class="pointer-events-none absolute inset-y-0 left-0 z-0 border-r border-border/40 bg-muted/[0.14]"
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          aria-hidden="true"
        >
          <For each={Array.from({ length: columns() }, (_, index) => index)}>
            {(laneIndex) => (
              <line
                x1={laneX(laneIndex)}
                y1="0"
                x2={laneX(laneIndex)}
                y2={height()}
                stroke="color-mix(in srgb, var(--border) 52%, transparent)"
                stroke-width="1"
                stroke-dasharray="2 4"
              />
            )}
          </For>

          <For each={rows()}>
            {(row, rowIndex) => (
              <>
                <For each={row.beforeLanes}>
                  {(laneState, beforeIndex) => {
                    if (laneState.hash === row.commit.hash) return null;
                    const afterIndex = row.afterLanes.findIndex((entry) => entry.hash === laneState.hash);
                    if (afterIndex >= 0) {
                      return (
                        <path
                          d={transitionPath(beforeIndex(), afterIndex, rowLineTop(rowIndex()), rowLineBottom(rowIndex(), rowCount()))}
                          fill="none"
                          stroke={laneStrokeColor(laneState.colorIndex)}
                          stroke-width="1.65"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      );
                    }
                    return (
                      <path
                        d={`M ${laneX(beforeIndex())} ${rowLineTop(rowIndex())} L ${laneX(beforeIndex())} ${rowMid(rowIndex())}`}
                        fill="none"
                        stroke={laneStrokeColor(laneState.colorIndex)}
                        stroke-width="1.65"
                        stroke-linecap="round"
                      />
                    );
                  }}
                </For>

                <ShowCommitTransitions row={row} rowIndex={rowIndex()} rowCount={rowCount()} />

                <For each={row.afterLanes}>
                  {(laneState, afterIndex) => {
                    const beforeIndex = row.beforeLanes.findIndex((entry) => entry.hash === laneState.hash);
                    if (beforeIndex >= 0) return null;
                    if (row.parents.includes(laneState.hash)) return null;
                    return (
                      <path
                        d={`M ${laneX(afterIndex())} ${rowMid(rowIndex())} L ${laneX(afterIndex())} ${rowLineBottom(rowIndex(), rowCount())}`}
                        fill="none"
                        stroke={laneStrokeColor(laneState.colorIndex)}
                        stroke-width="1.65"
                        stroke-linecap="round"
                      />
                    );
                  }}
                </For>

                <circle
                  cx={laneX(row.lane)}
                  cy={rowMid(rowIndex())}
                  r={NODE_RADIUS + 2.25}
                  fill={props.selectedCommitHash === row.commit.hash ? 'var(--background)' : 'color-mix(in srgb, var(--background) 90%, transparent)'}
                  stroke={props.selectedCommitHash === row.commit.hash ? 'color-mix(in srgb, var(--primary) 35%, transparent)' : 'var(--background)'}
                  stroke-width="1.2"
                />
                <circle
                  cx={laneX(row.lane)}
                  cy={rowMid(rowIndex())}
                  r={NODE_RADIUS}
                  fill={laneFillColor(row.nodeColorIndex)}
                  stroke="var(--background)"
                  stroke-width="1.2"
                />
              </>
            )}
          </For>
        </svg>

        <div class="relative z-10">
          <For each={rows()}>
            {(row, rowIndex) => {
              const selected = () => props.selectedCommitHash === row.commit.hash;
              const mergeLabel = () => (row.parents.length > 1 ? `Merge x${row.parents.length}` : '');
              return (
                <button
                  type="button"
                  data-commit-graph-row={row.commit.hash}
                  data-graph-columns={row.columns}
                  style={{ 'grid-template-columns': `${width()}px minmax(0, 1fr)` }}
                  class={cn(
                    'grid w-full appearance-none items-stretch bg-transparent text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1',
                    selected() ? 'bg-sidebar-accent/18' : 'hover:bg-muted/[0.18]',
                  )}
                  onClick={() => props.onSelect?.(row.commit.hash)}
                >
                  <div style={{ height: `${ROW_HEIGHT}px` }} aria-hidden="true" />
                  <div
                    style={{ height: `${ROW_HEIGHT}px` }}
                    class={cn(
                      'min-w-0 px-3 py-1.5',
                      'flex flex-col justify-center',
                      rowIndex() === rowCount() - 1 ? '' : 'border-b border-border/40',
                    )}
                  >
                    <div class="flex items-center gap-2 leading-tight">
                      <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{row.commit.subject || '(no subject)'}</span>
                      <span class="rounded bg-muted/[0.26] px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{row.commit.shortHash}</span>
                    </div>
                    <div class="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] leading-tight text-muted-foreground">
                      <span class="truncate">{row.commit.authorName || 'Unknown author'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeTime(row.commit.authorTimeMs)}</span>
                      <Show when={Boolean(mergeLabel())}>
                        <>
                          <span aria-hidden="true">·</span>
                          <span class="text-violet-700 dark:text-violet-300">{mergeLabel()}</span>
                        </>
                      </Show>
                      <Show when={selected()}>
                        <>
                          <span aria-hidden="true">·</span>
                          <span class="text-primary">Selected</span>
                        </>
                      </Show>
                    </div>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

function ShowCommitTransitions(props: { row: CommitGraphRow; rowIndex: number; rowCount: number }) {
  const lane = () => props.row.lane;
  const currentX = () => laneX(lane());
  const currentColor = () => laneStrokeColor(props.row.nodeColorIndex);

  return (
    <>
      <path
        d={`M ${currentX()} ${rowLineTop(props.rowIndex)} L ${currentX()} ${rowMid(props.rowIndex)}`}
        fill="none"
        stroke={currentColor()}
        stroke-width="1.85"
        stroke-linecap="round"
      />
      <For each={props.row.parents}>
        {(parent, index) => {
          const parentLane = props.row.afterLanes.findIndex((entry) => entry.hash === parent);
          if (parentLane < 0) return null;
          const laneState = laneByHash(props.row.afterLanes, parent);
          const colorIndex = index() === 0 ? props.row.nodeColorIndex : (laneState?.colorIndex ?? props.row.nodeColorIndex);
          return (
            <path
              d={transitionPath(lane(), parentLane, rowMid(props.rowIndex), rowLineBottom(props.rowIndex, props.rowCount))}
              fill="none"
              stroke={laneStrokeColor(colorIndex)}
              stroke-width={index() === 0 ? '1.95' : '1.65'}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          );
        }}
      </For>
    </>
  );
}

function formatRelativeTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return new Date(ms).toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 5) return `${seconds}s ago`;
  return 'now';
}
