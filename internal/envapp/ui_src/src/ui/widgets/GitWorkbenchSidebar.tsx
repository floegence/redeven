import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
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
  summarizeWorkspaceCount,
  workspaceHealthLabel,
  workspaceViewSectionCount,
  workspaceViewSectionLabel,
  type GitWorkspaceViewSection,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import {
  gitBranchTone,
  gitToneActionButtonClass,
  gitToneBadgeClass,
  gitToneSelectableCardClass,
  workspaceSectionTone,
} from './GitChrome';
import { GitCommitGraph } from './GitCommitGraph';
import { GitMetaPill, GitSection, GitSubtleNote } from './GitWorkbenchPrimitives';

export interface GitWorkbenchSidebarProps {
  subview: GitWorkbenchSubview;
  onClose?: () => void;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
  repoAvailable?: boolean;
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
  const workspaceCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const localBranchCount = () => props.branches?.local.length ?? 0;
  const remoteBranchCount = () => props.branches?.remote.length ?? 0;

  return (
    <div class={cn('space-y-1.5 sm:space-y-2', props.class)}>
      <Show
        when={!props.repoInfoLoading}
        fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Checking repository...</span></div>}
      >
        <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs break-words text-error">{props.repoInfoError}</div>}>
          <Show when={props.repoAvailable} fallback={<div class="py-3 text-xs text-muted-foreground">Current path is not inside a Git repository.</div>}>
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
                  fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading workspace changes...</span></div>}
                >
                  <Show when={!props.workspaceError} fallback={<div class="py-3 text-xs break-words text-error">{props.workspaceError}</div>}>
                    <div class="rounded-md border border-border/65 bg-card p-2.5">
                      <div class="flex items-start justify-between gap-2 px-0.5">
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-medium text-foreground">{props.repoSummary?.headRef || 'HEAD'}</div>
                          <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            {workspaceHealthLabel(props.workspace?.summary ?? props.repoSummary?.workspaceSummary)}
                          </div>
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
                                    <div class={cn('mt-0.5 text-[10px] leading-relaxed', active() ? 'text-sidebar-accent-foreground/75' : 'text-muted-foreground')}>
                                      {count() === 0 ? 'No files in this section.' : `${count()} file${count() === 1 ? '' : 's'} available.`}
                                    </div>
                                  </div>
                                  <span
                                    class={cn(
                                      'inline-flex min-w-[1.75rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                      active() ? 'bg-background/15 text-sidebar-accent-foreground' : gitToneBadgeClass(tone())
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
                  fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading branches...</span></div>}
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
                                  type="button"
                                  class={cn('w-full rounded-lg px-3 py-2.5 text-left', gitToneSelectableCardClass(tone(), active()))}
                                  onClick={() => {
                                    props.onSelectBranch?.(branch);
                                    closeAfterPick();
                                  }}
                                >
                                  <div class="grid min-h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                    <span class="min-w-0 flex-1 truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</span>
                                    <Show when={branch.current}>
                                      <span class="rounded bg-primary/[0.12] px-1.5 py-0.5 text-[10px] font-medium text-primary">Current</span>
                                    </Show>
                                  </div>
                                  <div class="mt-0.5 min-h-4 truncate text-[10px] text-muted-foreground" title={branchStatusSummary(branch)}>{branchContextSummary(branch)}</div>
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
                                  type="button"
                                  class={cn('w-full rounded-lg px-3 py-2.5 text-left', gitToneSelectableCardClass('violet', active()))}
                                  onClick={() => {
                                    props.onSelectBranch?.(branch);
                                    closeAfterPick();
                                  }}
                                >
                                  <div class="truncate text-[11.5px] font-medium text-current">{branchDisplayName(branch)}</div>
                                  <div class="mt-0.5 truncate text-[10px] text-muted-foreground">{branch.subject || branchStatusSummary(branch)}</div>
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
                  fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading commits...</span></div>}
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
  );
}
