import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarItem, SidebarItemList, SidebarPane } from '@floegence/floe-webapp-core/layout';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitCommitSummary, GitListBranchesResponse, GitListWorkspaceChangesResponse, GitRepoSummaryResponse } from '../protocol/redeven_v1';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { GitSubviewSwitch } from './GitSubviewSwitch';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';

const DEFAULT_PAGE_SIDEBAR_WIDTH = 280;

export interface GitWorkbenchSidebarProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  subview: GitWorkbenchSubview;
  subviewItems: GitWorkbenchSubviewItem[];
  onSubviewChange: (value: GitWorkbenchSubview) => void;
  currentPath: string;
  width?: number;
  open?: boolean;
  resizable?: boolean;
  onResize?: (delta: number) => void;
  onClose?: () => void;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
  repoAvailable?: boolean;
  repoSummary?: GitRepoSummaryResponse | null;
  repoSummaryLoading?: boolean;
  workspace?: GitListWorkspaceChangesResponse | null;
  branches?: GitListBranchesResponse | null;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  onRefresh?: () => void;
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

export function GitWorkbenchSidebar(props: GitWorkbenchSidebarProps) {
  const canEnterGit = () => Boolean(props.repoAvailable && !props.repoInfoLoading);

  return (
    <SidebarPane
      title="Explorer"
      headerActions={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={!canEnterGit()} />}
      width={props.width ?? DEFAULT_PAGE_SIDEBAR_WIDTH}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      class={cn('h-full', props.class)}
      bodyClass="py-2"
    >
      <div class="flex h-full min-h-0 flex-col px-2.5">
        <div class="shrink-0 space-y-2">
          <Show when={!props.repoInfoLoading} fallback={<div class="py-3 text-xs text-muted-foreground flex items-center gap-2"><SnakeLoader size="sm" /><span>Checking repository...</span></div>}>
            <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs text-error break-words">{props.repoInfoError}</div>}>
              <Show when={props.repoAvailable} fallback={<div class="py-3 text-xs text-muted-foreground">Current path is not inside a Git repository.</div>}>
                <div class="rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 p-2.5">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Repository</div>
                      <div class="mt-1 text-xs text-sidebar-foreground break-all">{props.repoSummary?.repoRootPath || 'Loading...'}</div>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={Refresh}
                      class="h-6 w-6 px-0"
                      onClick={props.onRefresh}
                      disabled={props.repoSummaryLoading}
                      aria-label="Refresh Git workbench"
                      title="Refresh Git workbench"
                    />
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Show when={props.repoSummary?.headRef}>
                      <span class="rounded-full border border-sidebar-border/70 px-2 py-0.5">{props.repoSummary?.headRef}</span>
                    </Show>
                    <Show when={props.repoSummary?.upstreamRef}>
                      <span class="rounded-full border border-sidebar-border/70 px-2 py-0.5">{props.repoSummary?.upstreamRef}</span>
                    </Show>
                    <Show when={typeof props.repoSummary?.aheadCount === 'number' || typeof props.repoSummary?.behindCount === 'number'}>
                      <span class="rounded-full border border-sidebar-border/70 px-2 py-0.5">↑{props.repoSummary?.aheadCount ?? 0} ↓{props.repoSummary?.behindCount ?? 0}</span>
                    </Show>
                  </div>
                  <div class="mt-2 truncate text-[10px] text-muted-foreground" title={props.currentPath || '/'}>
                    Path: {props.currentPath || '/'}
                  </div>
                </div>
              </Show>
            </Show>
          </Show>

          <GitSubviewSwitch value={props.subview} items={props.subviewItems} onChange={props.onSubviewChange} />
        </div>

        <div class="min-h-0 flex-1 pt-2">
          <Show when={props.subview === 'history'} fallback={<div class="space-y-2 text-[11px] text-muted-foreground px-1">
            <div class="rounded-md border border-border/60 bg-muted/15 p-2.5">Workspace changes: {(props.workspace?.summary.stagedCount ?? 0) + (props.workspace?.summary.unstagedCount ?? 0) + (props.workspace?.summary.untrackedCount ?? 0) + (props.workspace?.summary.conflictedCount ?? 0)}</div>
            <div class="rounded-md border border-border/60 bg-muted/15 p-2.5">Local branches: {props.branches?.local.length ?? 0}</div>
            <div class="rounded-md border border-border/60 bg-muted/15 p-2.5">Remote branches: {props.branches?.remote.length ?? 0}</div>
          </div>}>
            <Show when={!props.listLoading} fallback={<div class="py-3 text-xs text-muted-foreground flex items-center gap-2"><SnakeLoader size="sm" /><span>Loading commits...</span></div>}>
              <Show when={!props.listError} fallback={<div class="py-3 text-xs text-error break-words">{props.listError}</div>}>
                <Show when={(props.commits?.length ?? 0) > 0} fallback={<div class="py-3 text-xs text-muted-foreground">This repository has no commits yet.</div>}>
                  <div class="h-full min-h-0 overflow-auto">
                    <SidebarItemList>
                      <For each={props.commits ?? []}>
                        {(commit) => (
                          <SidebarItem
                            active={props.selectedCommitHash === commit.hash}
                            class="items-start py-1.5"
                            icon={<span class="mt-1 inline-block size-2 rounded-full bg-current" />}
                            onClick={() => {
                              props.onSelectCommit?.(commit.hash);
                              props.onClose?.();
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
                  </div>
                </Show>
              </Show>
            </Show>
          </Show>
        </div>

        <Show when={props.subview === 'history' && props.hasMore}>
          <div class="shrink-0 pb-2 pt-2">
            <Button size="sm" variant="outline" class="w-full" onClick={props.onLoadMore} loading={props.listLoadingMore} disabled={props.listLoadingMore}>
              Load More
            </Button>
          </div>
        </Show>
      </div>
    </SidebarPane>
  );
}
