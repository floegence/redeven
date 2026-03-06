import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import type { GitBranchSummary, GitCommitFileSummary, GitGetBranchCompareResponse } from '../protocol/redeven_v1';
import { GitPatchViewer } from './GitPatchViewer';
import { readCompareGitPatchTextOnce } from '../utils/gitPatchStreamReader';
import { gitChangeDotClass } from '../utils/gitPatch';
import { branchDisplayName, branchStatusSummary, changeMetricsText, changeSecondaryPath, compareHeadline } from '../utils/gitWorkbench';

const FILES_SIDEBAR_WIDTH = 300;

type BranchDetailTab = 'summary' | 'commits' | 'files';

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  selectedBranch?: GitBranchSummary | null;
  branchesLoading?: boolean;
  branchesError?: string;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
}

function compareFileKey(file: GitCommitFileSummary | null | undefined): string {
  return String(file?.patchPath || file?.path || file?.newPath || file?.oldPath || '').trim();
}

function formatAbsoluteTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const protocol = useProtocol();
  const [activeTab, setActiveTab] = createSignal<BranchDetailTab>('summary');
  const [selectedFileKey, setSelectedFileKey] = createSignal('');

  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return props.compare?.files.find((file) => compareFileKey(file) === key) ?? null;
  });

  createEffect(() => {
    props.selectedBranch?.fullName;
    setActiveTab('summary');
  });

  createEffect(() => {
    const files = props.compare?.files ?? [];
    const current = selectedFileKey();
    if (current && files.some((file) => compareFileKey(file) === current)) {
      return;
    }
    setSelectedFileKey(compareFileKey(files[0] ?? null));
  });

  return (
    <div class="h-full min-h-0 flex flex-col overflow-hidden">
      <Show when={!props.branchesLoading} fallback={<div class="flex-1 px-4 py-5 text-xs text-muted-foreground">Loading branches...</div>}>
        <Show when={!props.branchesError} fallback={<div class="flex-1 px-4 py-5 text-xs text-error break-words">{props.branchesError}</div>}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-4 py-5 text-xs text-muted-foreground">Select a branch from the Git sidebar to inspect compare details.</div>}>
            {(branchAccessor) => {
              const branch = branchAccessor();
              return (
                <>
                  <div class="shrink-0 border-b border-border/70 px-4 py-3 space-y-2.5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="min-w-0 truncate text-sm font-medium text-foreground">{branchDisplayName(branch)}</div>
                          <Show when={branch.current}>
                            <span class="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">Current</span>
                          </Show>
                          <Show when={branch.kind}>
                            <span class="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground capitalize">{branch.kind}</span>
                          </Show>
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground">{branchStatusSummary(branch)}</div>
                        <Show when={branch.subject}>
                          <div class="mt-1.5 text-[11px] text-foreground/90">{branch.subject}</div>
                        </Show>
                      </div>

                      <div class="flex flex-wrap justify-end gap-1.5 text-[10px] text-muted-foreground">
                        <Show when={branch.upstreamRef}>
                          <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">Upstream {branch.upstreamRef}</span>
                        </Show>
                        <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">↑{branch.aheadCount ?? 0} ↓{branch.behindCount ?? 0}</span>
                        <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">Updated {formatAbsoluteTime(branch.authorTimeMs)}</span>
                      </div>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="text-xs text-muted-foreground">{compareHeadline(props.compare)}</div>
                      <SegmentedControl
                        size="sm"
                        value={activeTab()}
                        onChange={(value) => setActiveTab((value as BranchDetailTab) || 'summary')}
                        options={[
                          { value: 'summary', label: 'Summary' },
                          { value: 'commits', label: `Commits${(props.compare?.commits.length ?? 0) > 0 ? ` (${props.compare?.commits.length ?? 0})` : ''}` },
                          { value: 'files', label: `Files${(props.compare?.files.length ?? 0) > 0 ? ` (${props.compare?.files.length ?? 0})` : ''}` },
                        ]}
                      />
                    </div>
                  </div>

                  <div class="flex-1 min-h-0 overflow-hidden">
                    <Show when={activeTab() === 'summary'}>
                      <div class="h-full overflow-auto px-4 py-3">
                        <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                          <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                            <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Branch State</div>
                            <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Reference</div>
                                <div class="mt-1 break-all text-sm font-medium text-foreground">{branch.fullName || branch.name || '—'}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Last Updated</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{formatAbsoluteTime(branch.authorTimeMs)}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Latest Commit</div>
                                <div class="mt-1 break-all text-sm font-medium text-foreground">{branch.headCommit ? branch.headCommit.slice(0, 7) : '—'}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Linked Worktree</div>
                                <div class="mt-1 break-all text-sm font-medium text-foreground">{branch.worktreePath || '—'}</div>
                              </div>
                            </div>
                          </div>

                          <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                            <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Compare Snapshot</div>
                            <Show when={!props.compareLoading} fallback={<div class="mt-3 text-xs text-muted-foreground">Loading branch compare...</div>}>
                              <Show when={!props.compareError} fallback={<div class="mt-3 text-xs text-error break-words">{props.compareError}</div>}>
                                <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Base</div>
                                    <div class="mt-1 text-sm font-medium text-foreground">{props.compare?.baseRef || '—'}</div>
                                  </div>
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Target</div>
                                    <div class="mt-1 text-sm font-medium text-foreground">{props.compare?.targetRef || branch.name || '—'}</div>
                                  </div>
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Ahead / Behind</div>
                                    <div class="mt-1 text-sm font-medium text-foreground">↑{props.compare?.targetAheadCount ?? 0} ↓{props.compare?.targetBehindCount ?? 0}</div>
                                  </div>
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Merge Base</div>
                                    <div class="mt-1 break-all text-sm font-medium text-foreground">{props.compare?.mergeBase ? props.compare.mergeBase.slice(0, 7) : '—'}</div>
                                  </div>
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Compare Commits</div>
                                    <div class="mt-1 text-sm font-medium text-foreground">{props.compare?.commits.length ?? 0}</div>
                                  </div>
                                  <div class="rounded-md border border-border/60 px-3 py-2">
                                    <div class="text-muted-foreground">Changed Files</div>
                                    <div class="mt-1 text-sm font-medium text-foreground">{props.compare?.files.length ?? 0}</div>
                                  </div>
                                </div>
                              </Show>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </Show>

                    <Show when={activeTab() === 'commits'}>
                      <div class="h-full overflow-auto px-4 py-3">
                        <Show when={!props.compareLoading} fallback={<div class="text-xs text-muted-foreground">Loading compare commits...</div>}>
                          <Show when={!props.compareError} fallback={<div class="text-xs text-error break-words">{props.compareError}</div>}>
                            <Show when={(props.compare?.commits.length ?? 0) > 0} fallback={<div class="text-xs text-muted-foreground">No compare commits for this branch.</div>}>
                              <div class="space-y-2">
                                <For each={props.compare?.commits ?? []}>
                                  {(commit) => (
                                    <div class="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
                                      <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                          <div class="truncate text-sm font-medium text-foreground">{commit.subject || '(no subject)'}</div>
                                          <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                            <span class="font-mono">{commit.shortHash}</span>
                                            <span>{commit.authorName || '-'}</span>
                                          </div>
                                        </div>
                                        <div class="shrink-0 text-[11px] text-muted-foreground">{formatAbsoluteTime(commit.authorTimeMs)}</div>
                                      </div>
                                      <Show when={commit.bodyPreview}>
                                        <div class="mt-2 text-[11px] leading-4.5 text-muted-foreground">{commit.bodyPreview}</div>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </Show>
                        </Show>
                      </div>
                    </Show>

                    <Show when={activeTab() === 'files'}>
                      <Show when={!props.compareLoading} fallback={<div class="px-4 py-4 text-xs text-muted-foreground">Loading compare files...</div>}>
                        <Show when={!props.compareError} fallback={<div class="px-4 py-4 text-xs text-error break-words">{props.compareError}</div>}>
                          <div class="h-full min-h-0 flex overflow-hidden">
                            <Sidebar width={FILES_SIDEBAR_WIDTH} class="h-full border-r border-border/70">
                              <SidebarContent class="h-full min-h-0 flex flex-col">
                                <SidebarSection title="Changed Files" actions={<span class="text-[11px] text-muted-foreground/80">{props.compare?.files.length ?? 0}</span>} class="min-h-0 flex-1">
                                  <Show when={(props.compare?.files.length ?? 0) > 0} fallback={<div class="px-2.5 py-3 text-xs text-muted-foreground">No changed files in compare.</div>}>
                                    <div class="h-full min-h-0 overflow-auto">
                                      <SidebarItemList>
                                        <For each={props.compare?.files ?? []}>
                                          {(file) => (
                                            <SidebarItem
                                              active={selectedFileKey() === compareFileKey(file)}
                                              class="py-0.5"
                                              icon={<span class={`inline-block size-2 rounded-full ${gitChangeDotClass(file.changeType)}`} />}
                                              onClick={() => setSelectedFileKey(compareFileKey(file))}
                                            >
                                              <div class="flex min-w-0 items-center gap-2 text-left">
                                                <span class="min-w-0 flex-1 truncate text-[11px] leading-4 text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</span>
                                                <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">{file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}</span>
                                              </div>
                                            </SidebarItem>
                                          )}
                                        </For>
                                      </SidebarItemList>
                                    </div>
                                  </Show>
                                </SidebarSection>
                              </SidebarContent>
                            </Sidebar>

                            <div class="flex-1 min-w-0 min-h-0 overflow-auto px-4 py-3">
                              <GitPatchViewer
                                item={selectedFile()}
                                emptyMessage="Select a compare file to inspect its patch."
                                loadPatch={async (item, signal) => {
                                  const client = protocol.client();
                                  const compare = props.compare;
                                  const repoRootPath = String(props.repoRootPath ?? '').trim();
                                  const filePath = String(item.patchPath || item.path || item.newPath || item.oldPath || '').trim();
                                  if (!client || !compare || !repoRootPath || !filePath) {
                                    return { text: '', truncated: false };
                                  }
                                  const resp = await readCompareGitPatchTextOnce({
                                    client,
                                    repoRootPath,
                                    baseRef: compare.baseRef,
                                    targetRef: compare.targetRef,
                                    filePath,
                                    maxBytes: 2 * 1024 * 1024,
                                    signal,
                                  });
                                  return { text: resp.text, truncated: resp.meta.truncated };
                                }}
                              />
                            </div>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </>
              );
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
