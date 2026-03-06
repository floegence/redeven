import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarItem, SidebarItemList, SidebarPane } from '@floegence/floe-webapp-core/layout';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitCommitSummary, GitResolveRepoResponse } from '../protocol/redeven_v1';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';

export type GitHistorySidebarMode = GitHistoryMode;

const DEFAULT_PAGE_SIDEBAR_WIDTH = 240;

export interface GitHistoryPageSidebarProps {
  mode: GitHistorySidebarMode;
  onModeChange: (mode: GitHistorySidebarMode) => void;
  currentPath: string;
  width?: number;
  open?: boolean;
  resizable?: boolean;
  onResize?: (delta: number) => void;
  onClose?: () => void;
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
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

export function GitHistoryPageSidebar(props: GitHistoryPageSidebarProps) {
  const repoAvailable = () => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath);
  const commitItems = () => props.commits ?? [];
  const canEnterGitHistory = () => repoAvailable() && !props.repoInfoLoading;

  return (
    <SidebarPane
      title="Explorer"
      headerActions={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={!canEnterGitHistory()} />}
      width={props.width ?? DEFAULT_PAGE_SIDEBAR_WIDTH}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      class={cn('h-full', props.class)}
      bodyClass="py-2"
    >
      <div class="flex h-full min-h-0 flex-col px-2.5">
        <div class="shrink-0">
          <Show
            when={!props.repoInfoLoading}
            fallback={
              <div class="py-3 text-xs text-muted-foreground flex items-center gap-2">
                <SnakeLoader size="sm" />
                <span>Checking repository...</span>
              </div>
            }
          >
            <Show when={!props.repoInfoError} fallback={<div class="py-3 text-xs text-error break-words">{props.repoInfoError}</div>}>
              <Show when={repoAvailable()} fallback={<div class="py-3 text-xs text-muted-foreground">Current path is not inside a Git repository.</div>}>
                <div class="mb-2 rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 p-2.5">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Repository</div>
                      <div class="mt-1 text-xs text-sidebar-foreground break-all">{props.repoInfo?.repoRootPath}</div>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={Refresh}
                      class="h-6 w-6 px-0"
                      onClick={props.onRefresh}
                      disabled={props.repoInfoLoading}
                      aria-label="Refresh repository history"
                      title="Refresh repository history"
                    />
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Show when={props.repoInfo?.headRef}>
                      <span class="rounded-full border border-sidebar-border/70 px-2 py-0.5">{props.repoInfo?.headRef}</span>
                    </Show>
                    <Show when={props.repoInfo?.headCommit}>
                      <span class="rounded-full border border-sidebar-border/70 px-2 py-0.5 font-mono">{String(props.repoInfo?.headCommit ?? '').slice(0, 7)}</span>
                    </Show>
                    <Show when={props.repoInfo?.dirty}>
                      <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">Dirty</span>
                    </Show>
                  </div>
                  <div class="mt-2 truncate text-[10px] text-muted-foreground" title={props.currentPath || '/'}>
                    Path: {props.currentPath || '/'}
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        <div class="min-h-0 flex-1">
          <Show
            when={!props.listLoading}
            fallback={
              <div class="py-3 text-xs text-muted-foreground flex items-center gap-2">
                <SnakeLoader size="sm" />
                <span>Loading commits...</span>
              </div>
            }
          >
            <Show when={!props.listError} fallback={<div class="py-3 text-xs text-error break-words">{props.listError}</div>}>
              <Show when={commitItems().length > 0} fallback={<div class="py-3 text-xs text-muted-foreground">This repository has no commits yet.</div>}>
                <div class="h-full min-h-0 overflow-auto">
                  <SidebarItemList>
                    <For each={commitItems()}>
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
        </div>

        <Show when={props.hasMore}>
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
