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
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import {
  WORKSPACE_SECTIONS,
  branchDisplayName,
  branchIdentity,
  branchStatusSummary,
  changeMetricsText,
  changeSecondaryPath,
  summarizeWorkspaceCount,
  workspaceEntryKey,
  workspaceSectionCount,
  workspaceSectionItems,
  workspaceSectionLabel,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import {
  gitBranchTone,
  gitChangeTone,
  gitSubviewTone,
  gitToneBadgeClass,
  gitToneInsetClass,
  gitToneSelectableCardClass,
  gitToneSurfaceClass,
  workspaceSectionTone,
} from './GitChrome';

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
  selectedWorkspaceKey?: string;
  onSelectWorkspaceItem?: (item: GitWorkspaceChange) => void;
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

function selectorLabel(view: GitWorkbenchSubview): string {
  switch (view) {
    case 'changes':
      return 'Workspace Files';
    case 'branches':
      return 'Branches';
    case 'history':
      return 'Commits';
    default:
      return 'Overview';
  }
}

export function GitWorkbenchSidebar(props: GitWorkbenchSidebarProps) {
  const closeAfterPick = () => {
    props.onClose?.();
  };

  const workspaceCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const branchCount = () => (props.branches?.local.length ?? 0) + (props.branches?.remote.length ?? 0);
  const sidebarTone = () => gitSubviewTone(props.subview);

  return (
    <div class={cn('space-y-3', props.class)}>
      <Show when={!props.repoInfoLoading} fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Checking repository...</span></div>}>
        <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs break-words text-error">{props.repoInfoError}</div>}>
          <Show when={props.repoAvailable} fallback={<div class="py-3 text-xs text-muted-foreground">Current path is not inside a Git repository.</div>}>
            <div class="space-y-3">
              <div class={cn('rounded-xl border px-3 py-2.5', gitToneSurfaceClass(sidebarTone()))}>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">{selectorLabel(props.subview)}</span>
                  <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(sidebarTone()))}>
                    {props.subview === 'changes' ? workspaceCount() : props.subview === 'branches' ? branchCount() : props.subview === 'history' ? (props.commits?.length ?? 0) : 'Ready'}
                  </span>
                </div>
                <div class="mt-1 text-[11px] text-muted-foreground">
                  {props.subview === 'overview'
                    ? 'Pinned navigation keeps mode and scope stable while details change on the right.'
                    : props.subview === 'changes'
                      ? 'Workspace groups and changed files stay compact here so patch reading remains in the main surface.'
                      : props.subview === 'branches'
                        ? 'Pick a branch to compare it without losing your place in the navigator.'
                        : 'Use commits as the primary selector and read the patch in the main detail area.'}
                </div>
              </div>

              <Show when={props.subview === 'overview'}>
                <div class="space-y-3">
                  <div class={cn('rounded-xl border p-3 shadow-sm', gitToneSurfaceClass(workspaceCount() > 0 ? 'warning' : 'success'))}>
                    <div class="flex items-center justify-between gap-2">
                      <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(workspaceCount() > 0 ? 'warning' : 'success'))}>Workspace</span>
                      <span class="text-xl font-semibold tracking-tight text-foreground">{workspaceCount()}</span>
                    </div>
                    <div class="mt-2 text-[11px] text-muted-foreground">{workspaceCount() > 0 ? 'Open Changes to review the working tree.' : 'Working tree is clean.'}</div>
                  </div>

                  <div class="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                    <div class={cn('rounded-xl border px-3 py-2.5', gitToneInsetClass('violet'))}>
                      <div class="text-muted-foreground">Branches</div>
                      <div class="mt-1 text-base font-semibold text-foreground">{branchCount()}</div>
                    </div>
                    <div class={cn('rounded-xl border px-3 py-2.5', gitToneInsetClass('brand'))}>
                      <div class="text-muted-foreground">Loaded commits</div>
                      <div class="mt-1 text-base font-semibold text-foreground">{props.commits?.length ?? 0}</div>
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={props.subview === 'changes'}>
                <Show when={!props.workspaceLoading} fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading workspace changes...</span></div>}>
                  <Show when={!props.workspaceError} fallback={<div class="py-3 text-xs break-words text-error">{props.workspaceError}</div>}>
                    <div class="space-y-3">
                      <For each={WORKSPACE_SECTIONS}>
                        {(section) => {
                          const items = () => workspaceSectionItems(props.workspace, section);
                          const tone = () => workspaceSectionTone(section);
                          return (
                            <section class="space-y-2">
                              <div class="flex items-center justify-between gap-2 px-1">
                                <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(tone()))}>{workspaceSectionLabel(section)}</span>
                                <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('neutral'))}>{workspaceSectionCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary, section)}</span>
                              </div>
                              <Show when={items().length > 0} fallback={<div class={cn('rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground', gitToneInsetClass(tone()))}>No files in this group.</div>}>
                                <div class="space-y-2">
                                  <For each={items()}>
                                    {(item) => {
                                      const active = () => props.selectedWorkspaceKey === workspaceEntryKey(item);
                                      return (
                                        <button
                                          type="button"
                                          class={cn(
                                            'w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
                                            gitToneSelectableCardClass(tone(), active())
                                          )}
                                          onClick={() => {
                                            props.onSelectWorkspaceItem?.(item);
                                            closeAfterPick();
                                          }}
                                        >
                                          <div class="min-w-0">
                                            <div class="truncate text-[12px] font-medium text-current" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                                            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(gitChangeTone(item.changeType)))}>{item.changeType || 'modified'}</span>
                                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{changeMetricsText(item)}</span>
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    }}
                                  </For>
                                </div>
                              </Show>
                            </section>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>

              <Show when={props.subview === 'branches'}>
                <Show when={!props.branchesLoading} fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading branches...</span></div>}>
                  <Show when={!props.branchesError} fallback={<div class="py-3 text-xs break-words text-error">{props.branchesError}</div>}>
                    <div class="space-y-3">
                      <section class="space-y-2">
                        <div class="flex items-center justify-between gap-2 px-1">
                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('brand'))}>Local</span>
                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('neutral'))}>{props.branches?.local?.length ?? 0}</span>
                        </div>
                        <Show when={(props.branches?.local?.length ?? 0) > 0} fallback={<div class={cn('rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground', gitToneInsetClass('neutral'))}>No local branches.</div>}>
                          <div class="space-y-2">
                            <For each={props.branches?.local ?? []}>
                              {(branch) => {
                                const tone = () => gitBranchTone(branch);
                                const active = () => props.selectedBranchKey === branchIdentity(branch);
                                return (
                                  <button
                                    type="button"
                                    class={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-150', gitToneSelectableCardClass(tone(), active()))}
                                    onClick={() => {
                                      props.onSelectBranch?.(branch);
                                      closeAfterPick();
                                    }}
                                  >
                                    <div class="min-w-0">
                                      <div class="flex items-center gap-2">
                                        <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-current">{branchDisplayName(branch)}</span>
                                        <Show when={branch.current}>
                                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('brand'))}>Current</span>
                                        </Show>
                                      </div>
                                      <div class="mt-1 truncate text-[10px] text-muted-foreground">{branchStatusSummary(branch)}</div>
                                    </div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </section>

                      <section class="space-y-2">
                        <div class="flex items-center justify-between gap-2 px-1">
                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('violet'))}>Remote</span>
                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('neutral'))}>{props.branches?.remote?.length ?? 0}</span>
                        </div>
                        <Show when={(props.branches?.remote?.length ?? 0) > 0} fallback={<div class={cn('rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground', gitToneInsetClass('violet'))}>No remote branches.</div>}>
                          <div class="space-y-2">
                            <For each={props.branches?.remote ?? []}>
                              {(branch) => {
                                const active = () => props.selectedBranchKey === branchIdentity(branch);
                                return (
                                  <button
                                    type="button"
                                    class={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-150', gitToneSelectableCardClass('violet', active()))}
                                    onClick={() => {
                                      props.onSelectBranch?.(branch);
                                      closeAfterPick();
                                    }}
                                  >
                                    <div class="truncate text-[12px] font-medium text-current">{branchDisplayName(branch)}</div>
                                    <div class="mt-1 truncate text-[10px] text-muted-foreground">{branch.subject || branchStatusSummary(branch)}</div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </section>
                    </div>
                  </Show>
                </Show>
              </Show>

              <Show when={props.subview === 'history'}>
                <div class="space-y-3">
                  <Show when={!props.listLoading} fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading commits...</span></div>}>
                    <Show when={!props.listError} fallback={<div class="py-3 text-xs break-words text-error">{props.listError}</div>}>
                      <Show when={(props.commits?.length ?? 0) > 0} fallback={<div class="py-3 text-xs text-muted-foreground">This repository has no commits yet.</div>}>
                        <div class="space-y-2">
                          <For each={props.commits ?? []}>
                            {(commit) => {
                              const active = () => props.selectedCommitHash === commit.hash;
                              return (
                                <button
                                  type="button"
                                  class={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-150', gitToneSelectableCardClass('brand', active()))}
                                  onClick={() => {
                                    props.onSelectCommit?.(commit.hash);
                                    closeAfterPick();
                                  }}
                                >
                                  <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0 flex-1">
                                      <div class="truncate text-[12px] font-medium text-current">{commit.subject || '(no subject)'}</div>
                                      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                        <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('brand'))}>{commit.shortHash}</span>
                                        <span>{commit.authorName || '-'}</span>
                                      </div>
                                    </div>
                                    <span class="shrink-0 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{formatRelativeTime(commit.authorTimeMs)}</span>
                                  </div>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </Show>

                  <Show when={props.hasMore}>
                    <div class="border-t border-border/60 pt-2">
                      <Button size="sm" variant="outline" class="w-full" onClick={props.onLoadMore} loading={props.listLoadingMore} disabled={props.listLoadingMore}>
                        Load More
                      </Button>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
