import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitCommitSummary } from '../protocol/redeven_v1';

type CommitGraphRow = {
  commit: GitCommitSummary;
  lane: number;
  beforeLanes: string[];
  afterLanes: string[];
  parents: string[];
  columns: number;
};

const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
const ROW_HEIGHT = 34;
const MID_Y = ROW_HEIGHT / 2;

function laneX(index: number): number {
  return index * LANE_WIDTH + 6;
}

function buildCommitGraphRows(commits: GitCommitSummary[]): CommitGraphRow[] {
  const rows: CommitGraphRow[] = [];
  let frontier: string[] = [];

  for (const commit of commits) {
    let before = frontier.slice();
    let lane = before.indexOf(commit.hash);
    if (lane < 0) {
      lane = before.length;
      before = [...before, commit.hash];
    }

    const parents = Array.isArray(commit.parents) ? commit.parents.filter(Boolean) : [];
    const next = before.slice();
    next.splice(lane, 1);
    if (parents[0]) next.splice(lane, 0, parents[0]!);
    let insertOffset = 1;
    for (const parent of parents.slice(1)) {
      if (next.includes(parent)) continue;
      next.splice(Math.min(lane + insertOffset, next.length), 0, parent);
      insertOffset += 1;
    }
    frontier = next.filter((hash, index, list) => hash && list.indexOf(hash) === index);

    rows.push({
      commit,
      lane,
      beforeLanes: before,
      afterLanes: frontier.slice(),
      parents,
      columns: Math.max(before.length, frontier.length, 1),
    });
  }

  return rows;
}

function transitionPath(fromLane: number, toLane: number, fromY: number, toY: number): string {
  const fromX = laneX(fromLane);
  const toX = laneX(toLane);
  if (fromLane === toLane) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  return `M ${fromX} ${fromY} L ${fromX} ${MID_Y} L ${toX} ${toY}`;
}

export interface GitCommitGraphProps {
  commits: GitCommitSummary[];
  selectedCommitHash?: string;
  onSelect?: (hash: string) => void;
  class?: string;
}

export function GitCommitGraph(props: GitCommitGraphProps) {
  const rows = createMemo(() => buildCommitGraphRows(props.commits ?? []));

  return (
    <div class={cn('overflow-hidden rounded-xl border border-border/45 bg-muted/[0.16]', props.class)}>
      <For each={rows()}>
        {(row) => {
          const otherHashes = Array.from(new Set([...row.beforeLanes, ...row.afterLanes])).filter((hash) => hash && hash !== row.commit.hash);
          const selected = () => props.selectedCommitHash === row.commit.hash;
          return (
            <button
              type="button"
              class={cn(
                'flex w-full items-stretch gap-0 border-b border-border/35 px-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 last:border-b-0',
                selected() ? 'bg-background/88' : 'hover:bg-background/62',
              )}
              onClick={() => props.onSelect?.(row.commit.hash)}
            >
              <svg
                class="shrink-0 overflow-visible border-r border-border/35 bg-background/55 px-2"
                width={Math.max(row.columns * LANE_WIDTH, LANE_WIDTH) + 16}
                height={ROW_HEIGHT}
                viewBox={`0 0 ${Math.max(row.columns * LANE_WIDTH, LANE_WIDTH) + 16} ${ROW_HEIGHT}`}
                aria-hidden="true"
              >
                <For each={otherHashes}>
                  {(hash) => {
                    const beforeLane = row.beforeLanes.indexOf(hash);
                    const afterLane = row.afterLanes.indexOf(hash);
                    if (beforeLane >= 0 && afterLane >= 0) {
                      return <path d={transitionPath(beforeLane, afterLane, 0, ROW_HEIGHT)} fill="none" class="stroke-muted-foreground/35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />;
                    }
                    if (beforeLane >= 0) {
                      const x = laneX(beforeLane);
                      return <path d={`M ${x} 0 L ${x} ${MID_Y}`} fill="none" class="stroke-muted-foreground/35" stroke-width="1.5" stroke-linecap="round" />;
                    }
                    const x = laneX(afterLane);
                    return <path d={`M ${x} ${MID_Y} L ${x} ${ROW_HEIGHT}`} fill="none" class="stroke-muted-foreground/35" stroke-width="1.5" stroke-linecap="round" />;
                  }}
                </For>

                <ShowCommitParents row={row} />

                <circle cx={laneX(row.lane)} cy={MID_Y} r={NODE_RADIUS + 2} class={selected() ? 'fill-primary/15' : 'fill-background/92'} />
                <circle cx={laneX(row.lane)} cy={MID_Y} r={NODE_RADIUS} class={cn(row.parents.length > 1 ? 'fill-violet-500/82' : 'fill-primary/82')} />
              </svg>

              <div class="min-w-0 flex-1 px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{row.commit.subject || '(no subject)'}</span>
                  <span class="rounded bg-muted/[0.22] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{row.commit.shortHash}</span>
                  <For each={row.parents.length > 1 ? [`Merge x${row.parents.length}`] : []}>
                    {(label) => <span class="rounded bg-violet-500/[0.12] px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">{label}</span>}
                  </For>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{row.commit.authorName || 'Unknown author'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTime(row.commit.authorTimeMs)}</span>
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
  );
}

function ShowCommitParents(props: { row: CommitGraphRow }) {
  const currentX = () => laneX(props.row.lane);

  return (
    <>
      <path d={`M ${currentX()} 0 L ${currentX()} ${MID_Y}`} fill="none" class="stroke-primary/28" stroke-width="1.35" stroke-linecap="round" />
      <For each={props.row.parents}>
        {(parent) => {
          const parentLane = props.row.afterLanes.indexOf(parent);
          if (parentLane < 0) return null;
          return (
            <path
              d={transitionPath(props.row.lane, parentLane, MID_Y, ROW_HEIGHT)}
              fill="none"
              class={cn(parent === props.row.parents[0] ? 'stroke-primary/46' : 'stroke-violet-500/52')}
              stroke-width={parent === props.row.parents[0] ? '1.7' : '1.5'}
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
