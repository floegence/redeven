import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarItem, SidebarItemList } from '@floegence/floe-webapp-core/layout';
import { Button } from '@floegence/floe-webapp-core/ui';
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { gitChangeDotClass } from '../utils/gitPatch';
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

  return (
    <div class={cn('space-y-3', props.class)}>
      <Show when={!props.repoInfoLoading} fallback={<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Checking repository...</span></div>}>
        <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs break-words text-error">{props.repoInfoError}</div>}>
          <Show when={props.repoAvailable} fallback={<div class="py-3 text-xs text-muted-foreground">Current path is not inside a Git repository.</div>}>
            <div class="space-y-3">
              <div class="flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                <span>{selectorLabel(props.subview)}</span>
                <span>{props.subview === 'changes' ? workspaceCount() : props.subview === 'branches' ? branchCount() : props.subview === 'history' ? (props.commits?.length ?? 0) : 'Ready'}</span>
              </div>

              <Show when={props.subview === 'overview'}>
                <div class="space-y-3">
                  <div class="rounded-lg border border-border/70 bg-muted/15 p-3">
                    <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Workspace</div>
                    <div class="mt-2 text-2xl font-semibold tracking-tight text-foreground">{workspaceCount()}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">{workspaceCount() > 0 ? 'Open Changes to review the working tree.' : 'Working tree is clean.'}</div>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-[11px]">
                    <div class="rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5">
                      <div class="text-muted-foreground">Branches</div>
                      <div class="mt-1 text-base font-semibold text-foreground">{branchCount()}</div>
                    </div>
                    <div class="rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5">
                      <div class="text-muted-foreground">Loaded commits</div>
                      <div class="mt-1 text-base font-semibold text-foreground">{props.commits?.length ?? 0}</div>
                    </div>
                  </div>

                  <div class="rounded-lg border border-dashed border-border/70 bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">
                    Use the view navigation above to move between overview, workspace changes, branches, and commit history while keeping the navigator fixed in one place.
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
                          return (
                            <section class="space-y-1.5">
                              <div class="flex items-center justify-between px-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                                <span>{workspaceSectionLabel(section)}</span>
                                <span>{workspaceSectionCount(props.workspace?.summary, section)}</span>
                              </div>
                              <Show when={items().length > 0} fallback={<div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">No files.</div>}>
                                <SidebarItemList>
                                  <For each={items()}>
                                    {(item) => (
                                      <SidebarItem
                                        active={props.selectedWorkspaceKey === workspaceEntryKey(item)}
                                        class="py-0.5"
                                        icon={<span class={`inline-block size-2 rounded-full ${gitChangeDotClass(item.changeType)}`} />}
                                        onClick={() => {
                                          props.onSelectWorkspaceItem?.(item);
                                          closeAfterPick();
                                        }}
                                      >
                                        <div class="flex min-w-0 items-center gap-2 text-left">
                                          <span class="min-w-0 flex-1 truncate text-[11px] leading-4 text-current" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</span>
                                          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">{changeMetricsText(item)}</span>
                                        </div>
                                      </SidebarItem>
                                    )}
                                  </For>
                                </SidebarItemList>
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
                      <section class="space-y-1.5">
                        <div class="flex items-center justify-between px-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                          <span>Local</span>
                          <span>{props.branches?.local?.length ?? 0}</span>
                        </div>
                        <Show when={(props.branches?.local?.length ?? 0) > 0} fallback={<div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">No local branches.</div>}>
                          <SidebarItemList>
                            <For each={props.branches?.local ?? []}>
                              {(branch) => (
                                <SidebarItem
                                  active={props.selectedBranchKey === branchIdentity(branch)}
                                  class="py-1"
                                  onClick={() => {
                                    props.onSelectBranch?.(branch);
                                    closeAfterPick();
                                  }}
                                >
                                  <div class="min-w-0 flex-1 text-left">
                                    <div class="flex items-center gap-2">
                                      <span class="min-w-0 flex-1 truncate text-[11px] leading-4 text-current">{branchDisplayName(branch)}</span>
                                      <Show when={branch.current}>
                                        <span class="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">Current</span>
                                      </Show>
                                    </div>
                                    <div class="mt-0.5 truncate text-[10px] text-muted-foreground/80">{branchStatusSummary(branch)}</div>
                                  </div>
                                </SidebarItem>
                              )}
                            </For>
                          </SidebarItemList>
                        </Show>
                      </section>

                      <section class="space-y-1.5">
                        <div class="flex items-center justify-between px-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                          <span>Remote</span>
                          <span>{props.branches?.remote?.length ?? 0}</span>
                        </div>
                        <Show when={(props.branches?.remote?.length ?? 0) > 0} fallback={<div class="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">No remote branches.</div>}>
                          <SidebarItemList>
                            <For each={props.branches?.remote ?? []}>
                              {(branch) => (
                                <SidebarItem
                                  active={props.selectedBranchKey === branchIdentity(branch)}
                                  class="py-1"
                                  onClick={() => {
                                    props.onSelectBranch?.(branch);
                                    closeAfterPick();
                                  }}
                                >
                                  <div class="min-w-0 flex-1 text-left">
                                    <div class="truncate text-[11px] leading-4 text-current">{branchDisplayName(branch)}</div>
                                    <div class="mt-0.5 truncate text-[10px] text-muted-foreground/80">{branch.subject || branchStatusSummary(branch)}</div>
                                  </div>
                                </SidebarItem>
                              )}
                            </For>
                          </SidebarItemList>
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
                        <SidebarItemList>
                          <For each={props.commits ?? []}>
                            {(commit) => (
                              <SidebarItem
                                active={props.selectedCommitHash === commit.hash}
                                class="items-start py-1.5"
                                icon={<span class="mt-1 inline-block size-2 rounded-full bg-current" />}
                                onClick={() => {
                                  props.onSelectCommit?.(commit.hash);
                                  closeAfterPick();
                                }}
                              >
                                <div class="min-w-0 flex-1">
                                  <div class="flex items-start justify-between gap-2">
                                    <span class="min-w-0 flex-1 truncate text-[12px] leading-4.5 text-current">{commit.subject || '(no subject)'}</span>
                                    <span class="shrink-0 text-[10px] text-muted-foreground/80">{formatRelativeTime(commit.authorTimeMs)}</span>
                                  </div>
                                  <div class="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                                    <span class="shrink-0 font-mono">{commit.shortHash}</span>
                                    <span class="min-w-0 flex-1 truncate">{commit.authorName || '-'}</span>
                                  </div>
                                </div>
                              </SidebarItem>
                            )}
                          </For>
                        </SidebarItemList>
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
