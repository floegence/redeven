import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Copy, FileText, Folder, History, Terminal } from '@floegence/floe-webapp-core/icons';
import type { GitCommitSummary } from '../protocol/redeven_v1';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { GitAskFlowerRequest, GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { useI18n } from '../i18n';
import { GitEntityContextMenu, createGitEntityContextMenuController, type GitContextMenuActionItem } from './GitEntityContextMenu';
import { exactGitPath, type GitDetachedSwitchTarget } from '../utils/gitWorkbench';

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
const NODE_HALO_RADIUS = NODE_RADIUS + 2.25;
const PRIMARY_STROKE_WIDTH = 1.95;
const SECONDARY_STROKE_WIDTH = 1.65;
const RAIL_STROKE_WIDTH = 1;
const NODE_STROKE_WIDTH = 1.2;
const FALLBACK_CONTAINER_WIDTH = 180;
const COMMIT_SUMMARY_MIN_WIDTH = 128;
const GRAPH_MAX_WIDTH_SHARE = 0.45;
const MIN_GRAPH_WIDTH = LANE_WIDTH + GRAPH_PADDING_X * 2;
const MIN_GEOMETRY_DENSITY = 0.3;
const ROW_HEIGHT = 34;
const SUBJECT_ROW_HEIGHT = 14;
const META_ROW_HEIGHT = 10;
const ROW_TOP_PADDING = 3;
const ROW_GAP = 1;
const ROW_BOTTOM_PADDING = ROW_HEIGHT - ROW_TOP_PADDING - SUBJECT_ROW_HEIGHT - ROW_GAP - META_ROW_HEIGHT;
const NODE_CENTER_Y = ROW_TOP_PADDING + SUBJECT_ROW_HEIGHT / 2;
const CONNECTOR_OVERSCAN = 0.75;

const LANE_STROKE_COLORS = [
  'color-mix(in srgb, var(--redeven-categorical-1) 78%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-2) 78%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-3) 82%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-4) 80%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-5) 85%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-6) 78%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-7) 82%, transparent)',
  'color-mix(in srgb, var(--redeven-categorical-8) 78%, transparent)',
];

const LANE_FILL_COLORS = [
  'var(--redeven-categorical-1)',
  'var(--redeven-categorical-2)',
  'var(--redeven-categorical-3)',
  'var(--redeven-categorical-4)',
  'var(--redeven-categorical-5)',
  'var(--redeven-categorical-6)',
  'var(--redeven-categorical-7)',
  'var(--redeven-categorical-8)',
];

export type CommitGraphGeometry = Readonly<{
  width: number;
  laneWidth: number;
  paddingX: number;
  nodeRadius: number;
  nodeHaloRadius: number;
  primaryStrokeWidth: number;
  secondaryStrokeWidth: number;
  railStrokeWidth: number;
  nodeStrokeWidth: number;
}>;

function naturalGraphWidth(columns: number): number {
  return Math.max(columns, 1) * LANE_WIDTH + GRAPH_PADDING_X * 2;
}

export function resolveCommitGraphGeometry(columns: number, containerWidth: number): CommitGraphGeometry {
  const normalizedColumns = Math.max(1, Math.floor(Number.isFinite(columns) ? columns : 1));
  const normalizedContainerWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : FALLBACK_CONTAINER_WIDTH;
  const naturalWidth = naturalGraphWidth(normalizedColumns);
  const graphBudget = Math.max(
    MIN_GRAPH_WIDTH,
    Math.min(
      normalizedContainerWidth * GRAPH_MAX_WIDTH_SHARE,
      Math.max(MIN_GRAPH_WIDTH, normalizedContainerWidth - COMMIT_SUMMARY_MIN_WIDTH),
    ),
  );
  const width = Math.min(naturalWidth, graphBudget);
  const compressionRatio = Math.min(1, width / naturalWidth);
  const paddingX = Math.max(4, GRAPH_PADDING_X * compressionRatio);
  const laneWidth = (width - paddingX * 2) / normalizedColumns;
  const density = Math.max(MIN_GEOMETRY_DENSITY, Math.min(1, laneWidth / LANE_WIDTH));

  return {
    width,
    laneWidth,
    paddingX,
    nodeRadius: NODE_RADIUS * density,
    nodeHaloRadius: NODE_HALO_RADIUS * density,
    primaryStrokeWidth: Math.max(1, PRIMARY_STROKE_WIDTH * density),
    secondaryStrokeWidth: Math.max(0.9, SECONDARY_STROKE_WIDTH * density),
    railStrokeWidth: Math.max(0.75, RAIL_STROKE_WIDTH * density),
    nodeStrokeWidth: Math.max(0.75, NODE_STROKE_WIDTH * density),
  };
}

function laneX(index: number, geometry: CommitGraphGeometry): number {
  return geometry.paddingX + index * geometry.laneWidth + geometry.laneWidth / 2;
}

function graphHeight(rowCount: number): number {
  return Math.max(rowCount * ROW_HEIGHT, ROW_HEIGHT);
}

function rowSegmentTop(rowIndex: number): number {
  return rowIndex === 0 ? 0 : -CONNECTOR_OVERSCAN;
}

function rowSegmentBottom(rowIndex: number, rowCount: number): number {
  return rowIndex === rowCount - 1 ? ROW_HEIGHT : ROW_HEIGHT + CONNECTOR_OVERSCAN;
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

function transitionPath(
  fromLane: number,
  toLane: number,
  fromY: number,
  toY: number,
  geometry: CommitGraphGeometry,
): string {
  const fromX = laneX(fromLane, geometry);
  const toX = laneX(toLane, geometry);
  if (fromLane === toLane) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const controlY = fromY + (toY - fromY) * 0.5;
  return `M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`;
}

function laneByHash(lanes: CommitGraphLane[], hash: string): CommitGraphLane | undefined {
  return lanes.find((lane) => lane.hash === hash);
}

export function buildCommitGraphRows(commits: GitCommitSummary[]): CommitGraphRow[] {
  const rows: CommitGraphRow[] = [];
  let frontier: CommitGraphLane[] = [];
  let nextColorIndex = 1;
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
  repoRootPath?: string;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'commit' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  switchDetachedBusy?: boolean;
  alreadyDetachedCommitHash?: string;
  onCopyText?: (value: string) => void;
  class?: string;
}

export function GitCommitGraph(props: GitCommitGraphProps) {
  const i18n = useI18n();
  let containerElement: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(FALLBACK_CONTAINER_WIDTH);
  type CommitContextTarget = Readonly<{ commit: GitCommitSummary; repoRootPath: string }>;
  const contextMenu = createGitEntityContextMenuController<CommitContextTarget>({
    snapshotTarget: (target) => ({
      repoRootPath: target.repoRootPath,
      commit: { ...target.commit, parents: [...target.commit.parents] },
    }),
  });
  const rows = createMemo(() => buildCommitGraphRows(props.commits ?? []));
  const rowCount = createMemo(() => rows().length);
  const columns = createMemo(() => rows()[0]?.columns ?? 1);
  const geometry = createMemo(() => resolveCommitGraphGeometry(columns(), containerWidth()));
  const width = createMemo(() => geometry().width);
  const height = createMemo(() => graphHeight(rowCount()));
  const railStyle = createMemo(() => ({
    height: `${height()}px`,
  }));
  const rowStyle = createMemo(() => ({
    'grid-template-columns': `${width()}px minmax(0, 1fr)`,
  }));
  const graphCellStyle = {
    height: `${ROW_HEIGHT}px`,
  };
  const rowContentStyle = {
    height: `${ROW_HEIGHT}px`,
    'padding-top': `${ROW_TOP_PADDING}px`,
    'padding-bottom': `${ROW_BOTTOM_PADDING}px`,
    'grid-template-rows': `${SUBJECT_ROW_HEIGHT}px ${META_ROW_HEIGHT}px`,
    gap: `${ROW_GAP}px`,
  };
  const repoRootPath = () => exactGitPath(props.repoRootPath);

  const syncContainerWidth = () => {
    const nextWidth = containerElement?.clientWidth ?? 0;
    if (nextWidth > 0) setContainerWidth(nextWidth);
  };

  onMount(() => {
    syncContainerWidth();
    if (typeof ResizeObserver === 'undefined' || !containerElement) return;
    const observer = new ResizeObserver(syncContainerWidth);
    observer.observe(containerElement);
    onCleanup(() => observer.disconnect());
  });
  const contextMenuItems = (target: CommitContextTarget): GitContextMenuActionItem[] => {
    const { commit } = target;
    const items: GitContextMenuActionItem[] = [];
    if (props.onAskFlower && target.repoRootPath) {
      items.push({
        id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10,
        label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({ kind: 'commit', repoRootPath: target.repoRootPath, location: 'graph', commit, files: [] }),
      });
    }
    if (props.onSelect) {
      items.push({
        id: 'view-commit-details', kind: 'action', group: 'inspect', rank: 10,
        label: i18n.t('git.contextMenu.viewCommitDetails'), icon: FileText,
        onSelect: () => props.onSelect?.(commit.hash),
      });
    }
    if (props.onOpenInTerminal && target.repoRootPath) {
      items.push({
        id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal,
        onSelect: () => props.onOpenInTerminal?.({ path: target.repoRootPath }),
      });
    }
    if (props.onBrowseFiles && target.repoRootPath) {
      items.push({
        id: 'browse-files', kind: 'action', group: 'navigate', rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'), icon: Folder,
        onSelect: () => void props.onBrowseFiles?.({ path: target.repoRootPath }),
      });
    }
    if (props.onSwitchDetached) {
      items.push({
        id: 'switch-detached', kind: 'action', group: 'modify', rank: 10,
        label: i18n.t('git.contextMenu.switchDetached'), icon: History,
        disabled: Boolean(props.switchDetachedBusy) || target.commit.hash === props.alreadyDetachedCommitHash,
        disabledReason: props.switchDetachedBusy
          ? i18n.t('uiCopy.git.switching')
          : target.commit.hash === props.alreadyDetachedCommitHash
            ? i18n.t('uiCopy.git.alreadyDetachedHere')
            : undefined,
        onSelect: () => props.onSwitchDetached?.({ commitHash: commit.hash, shortHash: commit.shortHash, source: 'graph' }),
      });
    }
    if (props.onCopyText) {
      items.push({
        id: 'copy-commit-hash', kind: 'action', group: 'clipboard', rank: 10,
        label: i18n.t('git.contextMenu.copyCommitHash'), icon: Copy,
        onSelect: () => props.onCopyText?.(commit.hash),
      });
    }
    return items;
  };
  const openContextMenu = (event: MouseEvent, commit: GitCommitSummary) => {
    const target = { commit, repoRootPath: repoRootPath() };
    if (contextMenuItems(target).length > 0) contextMenu.openFromContextMenu(event, target);
  };
  const openKeyboardContextMenu = (event: KeyboardEvent, commit: GitCommitSummary) => {
    const target = { commit, repoRootPath: repoRootPath() };
    if (contextMenuItems(target).length > 0) contextMenu.openFromKeyboard(event, target);
  };

  return (
    <div
      ref={containerElement}
      data-commit-graph
      class={cn('min-w-0 overflow-hidden rounded-md border', redevenSurfaceRoleClass('panel'), redevenDividerRoleClass(), props.class)}
    >
      <div class="relative">
        <svg
          data-commit-graph-rails
          class={cn('pointer-events-none absolute top-0 left-0 z-10 border-r', redevenSurfaceRoleClass('inset'), redevenDividerRoleClass())}
          style={railStyle()}
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          aria-hidden="true"
        >
          <For each={Array.from({ length: columns() }, (_, index) => index)}>
            {(laneIndex) => (
              <line
                x1={laneX(laneIndex, geometry())}
                y1="0"
                x2={laneX(laneIndex, geometry())}
                y2={height()}
                stroke="var(--redeven-stroke-divider)"
                stroke-width={geometry().railStrokeWidth}
                stroke-dasharray="2 4"
              />
            )}
          </For>
        </svg>

        <div class="relative z-20">
          <For each={rows()}>
            {(row, rowIndex) => {
              const selected = () => props.selectedCommitHash === row.commit.hash;
              const mergeLabel = () => (row.parents.length > 1 ? `Merge x${row.parents.length}` : '');
              const subject = () => row.commit.subject || i18n.t('uiCopy.git.noSubject');
              const author = () => row.commit.authorName || i18n.t('uiCopy.git.unknownAuthor');
              const relativeTime = () => formatRelativeTime(row.commit.authorTimeMs);
              const metadataTitle = () => [author(), relativeTime(), mergeLabel()].filter(Boolean).join(' · ');
              return (
                <button
                  type="button"
                  data-commit-graph-row={row.commit.hash}
                  data-graph-columns={row.columns}
                  style={rowStyle()}
                  class={cn(
                    'group relative grid w-full cursor-pointer appearance-none items-stretch overflow-hidden bg-transparent text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1',
                    selected() ? 'text-sidebar-accent-foreground' : 'text-foreground',
                  )}
                  onClick={() => props.onSelect?.(row.commit.hash)}
                  onContextMenu={(event) => openContextMenu(event, row.commit)}
                  onKeyDown={(event) => openKeyboardContextMenu(event, row.commit)}
                >
                  <div data-commit-graph-cell style={graphCellStyle} class="relative z-20 min-w-0 overflow-hidden" aria-hidden="true">
                    {/* Keep dynamic graph drawing inside the row box so it cannot drift from row layout. */}
                    <svg
                      data-commit-graph-segment={row.commit.hash}
                      class="pointer-events-none absolute inset-0 overflow-visible"
                      width={width()}
                      height={ROW_HEIGHT}
                      viewBox={`0 0 ${width()} ${ROW_HEIGHT}`}
                      aria-hidden="true"
                    >
                      <CommitRowSegment row={row} rowIndex={rowIndex()} rowCount={rowCount()} selected={selected()} geometry={geometry()} />
                    </svg>
                  </div>

                  <div
                    data-commit-graph-summary
                    style={rowContentStyle}
                    class={cn(
                      'relative z-20 grid min-w-0 px-3 transition-colors duration-150',
                      selected() ? 'bg-sidebar-accent' : 'bg-transparent group-hover:bg-muted/[0.28]',
                      rowIndex() === rowCount() - 1 ? '' : cn('border-b', redevenDividerRoleClass()),
                    )}
                  >
                    <div class="flex min-w-0 items-center gap-2 overflow-hidden leading-none">
                      <span
                        data-commit-graph-subject={row.commit.hash}
                        class={cn('min-w-0 flex-1 truncate text-[11px] font-medium', selected() ? 'text-sidebar-accent-foreground' : 'text-foreground')}
                        title={subject()}
                      >
                        {subject()}
                      </span>
                      <span
                        data-commit-graph-hash
                        class={cn(
                          'shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px]',
                          selected()
                            ? 'bg-background/18 text-sidebar-accent-foreground/82'
                            : 'bg-muted/[0.26] text-muted-foreground',
                        )}
                      >
                        {row.commit.shortHash}
                      </span>
                    </div>
                    <div
                      class={cn(
                        'flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden text-[9px] leading-none',
                        selected() ? 'text-sidebar-accent-foreground/72' : 'text-muted-foreground',
                      )}
                      title={metadataTitle()}
                    >
                      <span data-commit-graph-author class="min-w-0 flex-1 truncate">{author()}</span>
                      <span class="shrink-0" aria-hidden="true">·</span>
                      <span data-commit-graph-time class="shrink-0">{relativeTime()}</span>
                      <Show when={Boolean(mergeLabel())}>
                        <>
                          <span class="shrink-0" aria-hidden="true">·</span>
                          <span class={cn('shrink-0', selected() ? 'text-sidebar-accent-foreground/86' : 'text-[var(--redeven-categorical-6)]')}>{mergeLabel()}</span>
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
      <GitEntityContextMenu controller={contextMenu} items={contextMenuItems} />
    </div>
  );
}

function CommitRowSegment(props: {
  row: CommitGraphRow;
  rowIndex: number;
  rowCount: number;
  selected: boolean;
  geometry: CommitGraphGeometry;
}) {
  const lane = () => props.row.lane;
  const currentX = () => laneX(lane(), props.geometry);
  const currentColor = () => laneStrokeColor(props.row.nodeColorIndex);
  const lineTop = () => rowSegmentTop(props.rowIndex);
  const lineBottom = () => rowSegmentBottom(props.rowIndex, props.rowCount);

  return (
    <>
      <For each={props.row.beforeLanes}>
        {(laneState, beforeIndex) => {
          if (laneState.hash === props.row.commit.hash) return null;
          const afterIndex = props.row.afterLanes.findIndex((entry) => entry.hash === laneState.hash);
          if (afterIndex >= 0) {
            return (
              <path
                d={transitionPath(beforeIndex(), afterIndex, lineTop(), lineBottom(), props.geometry)}
                fill="none"
                stroke={laneStrokeColor(laneState.colorIndex)}
                stroke-width={props.geometry.secondaryStrokeWidth}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            );
          }
          return (
            <path
              d={`M ${laneX(beforeIndex(), props.geometry)} ${lineTop()} L ${laneX(beforeIndex(), props.geometry)} ${NODE_CENTER_Y}`}
              fill="none"
              stroke={laneStrokeColor(laneState.colorIndex)}
              stroke-width={props.geometry.secondaryStrokeWidth}
              stroke-linecap="round"
            />
          );
        }}
      </For>

      <path
        d={`M ${currentX()} ${lineTop()} L ${currentX()} ${NODE_CENTER_Y}`}
        fill="none"
        stroke={currentColor()}
        stroke-width={props.geometry.primaryStrokeWidth}
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
              d={transitionPath(lane(), parentLane, NODE_CENTER_Y, lineBottom(), props.geometry)}
              fill="none"
              stroke={laneStrokeColor(colorIndex)}
              stroke-width={index() === 0 ? props.geometry.primaryStrokeWidth : props.geometry.secondaryStrokeWidth}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          );
        }}
      </For>

      <For each={props.row.afterLanes}>
        {(laneState, afterIndex) => {
          const beforeIndex = props.row.beforeLanes.findIndex((entry) => entry.hash === laneState.hash);
          if (beforeIndex >= 0) return null;
          if (props.row.parents.includes(laneState.hash)) return null;
          return (
            <path
              d={`M ${laneX(afterIndex(), props.geometry)} ${NODE_CENTER_Y} L ${laneX(afterIndex(), props.geometry)} ${lineBottom()}`}
              fill="none"
              stroke={laneStrokeColor(laneState.colorIndex)}
              stroke-width={props.geometry.secondaryStrokeWidth}
              stroke-linecap="round"
            />
          );
        }}
      </For>

      <circle
        data-commit-graph-node={props.row.commit.hash}
        r={props.geometry.nodeHaloRadius}
        cx={currentX()}
        cy={NODE_CENTER_Y}
        fill={props.selected ? 'var(--background)' : 'color-mix(in srgb, var(--background) 90%, transparent)'}
        stroke={props.selected ? 'color-mix(in srgb, var(--primary) 35%, transparent)' : 'var(--background)'}
        stroke-width={props.geometry.nodeStrokeWidth}
      />
      <circle
        r={props.geometry.nodeRadius}
        cx={currentX()}
        cy={NODE_CENTER_Y}
        fill={laneFillColor(props.row.nodeColorIndex)}
        stroke="var(--background)"
        stroke-width={props.geometry.nodeStrokeWidth}
      />
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
