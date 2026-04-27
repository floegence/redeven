import { For, Show, createEffect, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import {
  WORKSPACE_VIEW_SECTIONS,
  branchContextSummary,
  branchDisplayName,
  branchIdentity,
  branchStatusSummary,
  describeGitHead,
  summarizeWorkspaceCount,
  workspaceHealthLabel,
  workspaceViewSectionCount,
  workspaceViewSectionLabel,
  type GitWorkspaceViewSection,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import {
  gitBranchTone,
  gitSelectedChipClass,
  gitSelectedSecondaryTextClass,
  gitToneActionButtonClass,
  gitToneBadgeClass,
  gitToneSelectableCardClass,
  workspaceSectionTone,
} from './GitChrome';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitCommitGraph } from './GitCommitGraph';
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from './gitWorkbenchScrollRegion';
import { GitMetaPill, GitSection, GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';

export interface GitWorkbenchSidebarProps {
  subview: GitWorkbenchSubview;
  onClose?: () => void;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
  repoAvailable?: boolean;
  repoUnavailableReason?: string;
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspaceLoading?: boolean;
  workspaceError?: string;
  selectedWorkspaceSection?: GitWorkspaceViewSection;
  onSelectWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranchKey?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  class?: string;
}

const SELECTED_BRANCH_REVEAL_PADDING = 8;

type BranchRevealScrollInput = {
  scrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  itemTop: number;
  itemBottom: number;
  padding?: number;
  maxScrollTop?: number;
};

type BranchAnchorScrollInput = {
  scrollTop: number;
  viewportTop: number;
  itemTop: number;
  anchorItemTopOffset: number;
  maxScrollTop?: number;
};

type BranchSelectionScrollAnchor = {
  key: string;
  branchesRef: GitListBranchesResponse | null | undefined;
  branchListSignature: string;
  scrollTop: number;
  itemTopOffset: number;
};

function clampGitSidebarScrollTop(value: number, maxScrollTop?: number): number {
  const minScrollTop = Math.max(0, value);
  if (!Number.isFinite(maxScrollTop)) return minScrollTop;
  return Math.min(minScrollTop, Math.max(0, Number(maxScrollTop)));
}

export function resolveGitSidebarRevealScrollTop(input: BranchRevealScrollInput): number {
  const padding = Math.max(0, input.padding ?? SELECTED_BRANCH_REVEAL_PADDING);
  const topLimit = input.viewportTop + padding;
  const bottomLimit = input.viewportBottom - padding;

  if (input.itemTop < topLimit) {
    return clampGitSidebarScrollTop(
      input.scrollTop - (topLimit - input.itemTop),
      input.maxScrollTop,
    );
  }
  if (input.itemBottom > bottomLimit) {
    return clampGitSidebarScrollTop(
      input.scrollTop + (input.itemBottom - bottomLimit),
      input.maxScrollTop,
    );
  }
  return clampGitSidebarScrollTop(input.scrollTop, input.maxScrollTop);
}

export function resolveGitSidebarAnchorScrollTop(input: BranchAnchorScrollInput): number {
  const itemTopOffset = input.itemTop - input.viewportTop;
  return clampGitSidebarScrollTop(
    input.scrollTop + (itemTopOffset - input.anchorItemTopOffset),
    input.maxScrollTop,
  );
}

function gitSidebarBranchListSignature(branches: GitListBranchesResponse | null | undefined): string {
  return [
    'local',
    ...(branches?.local ?? []).map(branchIdentity),
    'remote',
    ...(branches?.remote ?? []).map(branchIdentity),
  ].join('\u001f');
}

function resolveElementMaxScrollTop(element: HTMLElement): number | undefined {
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  return Number.isFinite(maxScrollTop) && maxScrollTop > 0 ? maxScrollTop : undefined;
}

function normalizeSubview(view: GitWorkbenchSubview): GitWorkbenchSubview {
  return view === 'overview' ? 'changes' : view;
}

function selectorLabel(view: GitWorkbenchSubview): string {
  switch (normalizeSubview(view)) {
    case 'branches':
      return 'Branches';
    case 'history':
      return 'Commit Graph';
    case 'changes':
    default:
      return 'Changes';
  }
}

function selectorDescription(view: GitWorkbenchSubview): string {
  switch (normalizeSubview(view)) {
    case 'branches':
      return 'Pick a branch to inspect its status or history in the main pane.';
    case 'history':
      return 'Pick a commit to inspect it on the right.';
    case 'changes':
    default:
      return 'Use section cards to open the matching file table in the main pane.';
  }
}

export function GitWorkbenchSidebar(props: GitWorkbenchSidebarProps) {
  const closeAfterPick = () => props.onClose?.();
  const activeSubview = () => normalizeSubview(props.subview);
  const headDisplay = () => describeGitHead(props.repoSummary);
  const workspaceCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const localBranchCount = () => props.branches?.local.length ?? 0;
  const remoteBranchCount = () => props.branches?.remote.length ?? 0;
  const branchButtonRefs = new Map<string, HTMLButtonElement>();
  let scrollRegionElement: HTMLDivElement | undefined;
  let scheduledBranchScrollFrame = 0;
  let scheduledBranchScrollTask: (() => void) | null = null;
  let previousBranchesRef: GitListBranchesResponse | null | undefined;
  let pendingSelectionScrollAnchor: BranchSelectionScrollAnchor | null = null;

  const registerBranchButton = (branch: GitBranchSummary, element: HTMLButtonElement) => {
    const key = branchIdentity(branch);
    if (key) branchButtonRefs.set(key, element);
  };

  const cancelScheduledBranchScroll = () => {
    scheduledBranchScrollTask = null;
    if (!scheduledBranchScrollFrame) return;
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scheduledBranchScrollFrame);
    }
    scheduledBranchScrollFrame = 0;
  };

  const scheduleBranchScrollTask = (task: () => void) => {
    cancelScheduledBranchScroll();
    scheduledBranchScrollTask = () => {
      scheduledBranchScrollFrame = 0;
      scheduledBranchScrollTask = null;
      task();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      scheduledBranchScrollFrame = window.requestAnimationFrame(() => {
        scheduledBranchScrollTask?.();
      });
      return;
    }
    scheduledBranchScrollTask();
  };

  const captureSelectionScrollAnchor = (branch: GitBranchSummary, element: HTMLButtonElement) => {
    const key = branchIdentity(branch);
    const scrollRegion = scrollRegionElement;
    if (!key || !scrollRegion || !scrollRegion.contains(element)) {
      pendingSelectionScrollAnchor = null;
      return;
    }

    const viewportRect = scrollRegion.getBoundingClientRect();
    const itemRect = element.getBoundingClientRect();
    pendingSelectionScrollAnchor = {
      key,
      branchesRef: props.branches,
      branchListSignature: gitSidebarBranchListSignature(props.branches),
      scrollTop: scrollRegion.scrollTop,
      itemTopOffset: itemRect.top - viewportRect.top,
    };
  };

  const revealSelectedBranchIfNeeded = () => {
    const key = String(props.selectedBranchKey ?? '').trim();
    const scrollRegion = scrollRegionElement;
    const selectedButton = key ? branchButtonRefs.get(key) : undefined;
    if (!scrollRegion || !selectedButton || !scrollRegion.contains(selectedButton)) return;

    const viewportRect = scrollRegion.getBoundingClientRect();
    const itemRect = selectedButton.getBoundingClientRect();
    const nextScrollTop = resolveGitSidebarRevealScrollTop({
      scrollTop: scrollRegion.scrollTop,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom,
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom,
      padding: 0,
      maxScrollTop: resolveElementMaxScrollTop(scrollRegion),
    });
    if (nextScrollTop !== scrollRegion.scrollTop) {
      scrollRegion.scrollTop = nextScrollTop;
    }
  };

  const scheduleRevealSelectedBranch = () => {
    scheduleBranchScrollTask(revealSelectedBranchIfNeeded);
  };

  const restoreSelectionScrollFromAnchor = (anchor: BranchSelectionScrollAnchor) => {
    const scrollRegion = scrollRegionElement;
    if (!scrollRegion) return;

    const selectedButton = branchButtonRefs.get(anchor.key);
    const nextSignature = gitSidebarBranchListSignature(props.branches);
    const maxScrollTop = resolveElementMaxScrollTop(scrollRegion);
    let nextScrollTop = clampGitSidebarScrollTop(anchor.scrollTop, maxScrollTop);

    if (selectedButton && scrollRegion.contains(selectedButton) && nextSignature !== anchor.branchListSignature) {
      const viewportRect = scrollRegion.getBoundingClientRect();
      const itemRect = selectedButton.getBoundingClientRect();
      const anchoredScrollTop = resolveGitSidebarAnchorScrollTop({
        scrollTop: scrollRegion.scrollTop,
        viewportTop: viewportRect.top,
        itemTop: itemRect.top,
        anchorItemTopOffset: anchor.itemTopOffset,
        maxScrollTop,
      });
      const scrollDelta = anchoredScrollTop - scrollRegion.scrollTop;
      nextScrollTop = resolveGitSidebarRevealScrollTop({
        scrollTop: anchoredScrollTop,
        viewportTop: viewportRect.top,
        viewportBottom: viewportRect.bottom,
        itemTop: itemRect.top - scrollDelta,
        itemBottom: itemRect.bottom - scrollDelta,
        padding: 0,
        maxScrollTop,
      });
    }

    if (nextScrollTop !== scrollRegion.scrollTop) {
      scrollRegion.scrollTop = nextScrollTop;
    }
  };

  createEffect(() => {
    const branches = props.branches;
    const validKeys = new Set([
      ...(branches?.local ?? []).map(branchIdentity),
      ...(branches?.remote ?? []).map(branchIdentity),
    ].filter(Boolean));
    for (const key of Array.from(branchButtonRefs.keys())) {
      if (!validKeys.has(key)) branchButtonRefs.delete(key);
    }
  });

  createEffect(() => {
    const branches = props.branches;
    const selectedBranchKey = String(props.selectedBranchKey ?? '').trim();
    const branchKeys = gitSidebarBranchListSignature(branches);
    const branchesRefChanged = branches !== previousBranchesRef;
    previousBranchesRef = branches;

    if (pendingSelectionScrollAnchor && selectedBranchKey !== pendingSelectionScrollAnchor.key) {
      pendingSelectionScrollAnchor = null;
    }

    if (
      activeSubview() !== 'branches'
      || !selectedBranchKey
      || props.branchesLoading
      || props.branchesError
      || !branches
    ) {
      return;
    }

    const pendingAnchor = pendingSelectionScrollAnchor;
    if (
      pendingAnchor
      && branchesRefChanged
      && branches !== pendingAnchor.branchesRef
    ) {
      pendingSelectionScrollAnchor = null;
      scheduleBranchScrollTask(() => restoreSelectionScrollFromAnchor(pendingAnchor));
      return;
    }

    if (branchesRefChanged && branchKeys) {
      scheduleRevealSelectedBranch();
    }
  });

  onCleanup(cancelScheduledBranchScroll);

  return (
    <div class={cn('flex h-full min-h-0 flex-col', props.class)}>
      <div
        ref={(element) => {
          scrollRegionElement = element;
        }}
        {...GIT_WORKBENCH_SCROLL_REGION_PROPS}
        data-testid="git-sidebar-scroll-region"
        class="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
      >
        <div class="space-y-1.5 sm:space-y-2">
          <Show
              when={!props.repoInfoLoading}
              fallback={<GitStatePane loading message="Checking repository..." class="min-h-[4.5rem] py-3" />}
          >
            <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs break-words text-error">{props.repoInfoError}</div>}>
              <Show
                when={props.repoAvailable}
                fallback={<div class="py-3 text-xs text-muted-foreground">{props.repoUnavailableReason || 'Current path is not inside a Git repository.'}</div>}
              >
                <div class="space-y-1.5 sm:space-y-2">
                  <div class="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
                    {selectorLabel(activeSubview())}
                  </div>
                  <div class="px-1 text-[11px] text-muted-foreground">
                    {selectorDescription(activeSubview())}
                  </div>

                  <Show when={activeSubview() === 'changes'}>
                    <Show
                      when={!props.workspaceLoading}
                      fallback={<GitStatePane loading message="Loading workspace changes..." class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!props.workspaceError} fallback={<div class="py-3 text-xs break-words text-error">{props.workspaceError}</div>}>
                        <div class={cn('rounded-md border p-2.5', redevenSurfaceRoleClass('panelStrong'))}>
                          <div class="flex items-start justify-between gap-2 px-0.5">
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center gap-1.5">
                                <div class="text-xs font-medium text-foreground">{headDisplay().label}</div>
                                <Show when={headDisplay().detail}>
                                  <GitMetaPill tone="neutral">{headDisplay().detail}</GitMetaPill>
                                </Show>
                              </div>
                              <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                {workspaceHealthLabel(props.workspace?.summary ?? props.repoSummary?.workspaceSummary)}
                              </div>
                              <Show when={headDisplay().detached}>
                                <div class="mt-0.5 text-[10px] leading-relaxed text-warning">Detached HEAD keeps history browsing read-only for pull and push.</div>
                              </Show>
                            </div>
                            <GitMetaPill tone={workspaceCount() > 0 ? 'warning' : 'success'}>
                              {workspaceCount() > 0 ? `${workspaceCount()} open` : 'Clean'}
                            </GitMetaPill>
                          </div>

                          <div class="mt-2 grid grid-cols-1 gap-1">
                            <For each={WORKSPACE_VIEW_SECTIONS}>
                              {(section) => {
                                const count = () => workspaceViewSectionCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary, section);
                                const tone = () => workspaceSectionTone(section);
                                const active = () => props.selectedWorkspaceSection === section;
                                return (
                                  <button
                                    type="button"
                                    class={cn('w-full rounded-md px-2.5 py-2 text-left text-xs', gitToneSelectableCardClass(tone(), active()))}
                                    onClick={() => {
                                      props.onSelectWorkspaceSection?.(section);
                                      closeAfterPick();
                                    }}
                                  >
                                    <div class="flex items-start justify-between gap-2">
                                      <div class="min-w-0 flex-1">
                                        <div class="font-medium text-current">{workspaceViewSectionLabel(section)}</div>
                                        <div class={cn('mt-0.5 text-[10px] leading-relaxed', gitSelectedSecondaryTextClass(active()))}>
                                          {count() === 0 ? 'No files in this section.' : `${count()} file${count() === 1 ? '' : 's'} available.`}
                                        </div>
                                      </div>
                                      <span
                                        class={cn(
                                          'inline-flex min-w-[1.75rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                          active() ? gitSelectedChipClass(true) : gitToneBadgeClass(tone())
                                        )}
                                      >
                                        {count()}
                                      </span>
                                    </div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </Show>

                  <Show when={activeSubview() === 'branches'}>
                    <Show
                      when={!props.branchesLoading}
                      fallback={<GitStatePane loading message="Loading branches..." class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!props.branchesError} fallback={<div class="py-3 text-xs break-words text-error">{props.branchesError}</div>}>
                        <GitSection label="Local" description="Branches in this checkout." aside={String(localBranchCount())} tone="brand">
                          <Show when={localBranchCount() > 0} fallback={<GitSubtleNote>No local branches.</GitSubtleNote>}>
                            <div class="space-y-1">
                              <For each={props.branches?.local ?? []}>
                                {(branch) => {
                                  const tone = () => gitBranchTone(branch);
                                  const active = () => props.selectedBranchKey === branchIdentity(branch);
                                  return (
                                    <button
                                      ref={(element) => registerBranchButton(branch, element)}
                                      type="button"
                                      data-git-sidebar-branch-key={branchIdentity(branch)}
                                      class={cn('w-full rounded-lg px-3 py-2.5 text-left', gitToneSelectableCardClass(tone(), active()))}
                                      onClick={(event) => {
                                        captureSelectionScrollAnchor(branch, event.currentTarget);
                                        props.onSelectBranch?.(branch);
                                        closeAfterPick();
                                      }}
                                    >
                                      <div class="grid min-h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                        <span class="min-w-0 flex-1 truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</span>
                                        <Show when={branch.current}>
                                          <span class={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', active() ? gitSelectedChipClass(true) : 'bg-primary/[0.12] text-primary')}>Current</span>
                                        </Show>
                                      </div>
                                      <div class={cn('mt-0.5 min-h-4 truncate text-[10px]', gitSelectedSecondaryTextClass(active()))} title={branchStatusSummary(branch)}>{branchContextSummary(branch)}</div>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </GitSection>

                        <GitSection label="Remote" description="Tracking and shared refs." aside={String(remoteBranchCount())} tone="violet">
                          <Show when={remoteBranchCount() > 0} fallback={<GitSubtleNote>No remote branches.</GitSubtleNote>}>
                            <div class="space-y-1">
                              <For each={props.branches?.remote ?? []}>
                                {(branch) => {
                                  const active = () => props.selectedBranchKey === branchIdentity(branch);
                                  return (
                                    <button
                                      ref={(element) => registerBranchButton(branch, element)}
                                      type="button"
                                      data-git-sidebar-branch-key={branchIdentity(branch)}
                                      class={cn('w-full rounded-lg px-3 py-2.5 text-left', gitToneSelectableCardClass('violet', active()))}
                                      onClick={(event) => {
                                        captureSelectionScrollAnchor(branch, event.currentTarget);
                                        props.onSelectBranch?.(branch);
                                        closeAfterPick();
                                      }}
                                    >
                                      <div class="truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</div>
                                      <div class={cn('mt-0.5 truncate text-[10px]', gitSelectedSecondaryTextClass(active()))}>{branch.subject || branchStatusSummary(branch)}</div>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </GitSection>
                      </Show>
                    </Show>
                  </Show>

                  <Show when={activeSubview() === 'history'}>
                    <Show
                      when={!props.listLoading}
                      fallback={<GitStatePane loading message="Loading commits..." class="min-h-[4.5rem] py-3" />}
                    >
                      <Show when={!props.listError} fallback={<div class="py-3 text-xs break-words text-error">{props.listError}</div>}>
                        <Show when={(props.commits?.length ?? 0) > 0} fallback={<GitSubtleNote>This repository has no commits yet.</GitSubtleNote>}>
                          <GitCommitGraph
                            commits={props.commits ?? []}
                            selectedCommitHash={props.selectedCommitHash}
                            onSelect={(hash) => {
                              props.onSelectCommit?.(hash);
                              closeAfterPick();
                            }}
                          />
                        </Show>
                      </Show>
                    </Show>

                    <Show when={props.hasMore}>
                      <div class="pt-1">
                        <Button size="sm" variant="ghost" class={cn('w-full', gitToneActionButtonClass())} onClick={props.onLoadMore} loading={props.listLoadingMore} disabled={props.listLoadingMore}>
                          Load More
                        </Button>
                      </div>
                    </Show>
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
