import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import type { GitBranchSummary, GitGetBranchCompareResponse, GitListBranchesResponse, GitCommitFileSummary } from '../protocol/redeven_v1';
import { GitPatchViewer } from './GitPatchViewer';
import { branchDisplayName, branchStatusSummary, changeMetricsText, changeSecondaryPath, compareHeadline } from '../utils/gitWorkbench';
import { gitChangeDotClass } from '../utils/gitPatch';
import { readCompareGitPatchTextOnce } from '../utils/gitPatchStreamReader';

const BRANCHES_SIDEBAR_WIDTH = 320;
const FILES_SIDEBAR_WIDTH = 300;

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  currentRef?: string;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranchName?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
}

function branchKey(branch: GitBranchSummary | null | undefined): string {
  return String(branch?.fullName || branch?.name || '').trim();
}

function compareFileKey(file: GitCommitFileSummary | null | undefined): string {
  return String(file?.patchPath || file?.path || file?.newPath || file?.oldPath || '').trim();
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const protocol = useProtocol();
  const [selectedFileKey, setSelectedFileKey] = createSignal('');

  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return props.compare?.files.find((file) => compareFileKey(file) === key) ?? null;
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
    <div class="h-full min-h-0 flex overflow-hidden">
      <Sidebar width={BRANCHES_SIDEBAR_WIDTH} class="h-full border-r border-border/70">
        <SidebarContent class="h-full min-h-0 flex flex-col">
          <Show when={!props.branchesLoading} fallback={<div class="px-3 py-3 text-xs text-muted-foreground">Loading branches...</div>}>
            <Show when={!props.branchesError} fallback={<div class="px-3 py-3 text-xs text-error break-words">{props.branchesError}</div>}>
              <div class="h-full min-h-0 overflow-auto px-2.5 py-2.5 space-y-3">
                <SidebarSection title="Local branches" actions={<span class="text-[11px] text-muted-foreground/80">{props.branches?.local?.length ?? 0}</span>}>
                  <Show when={(props.branches?.local?.length ?? 0) > 0} fallback={<div class="px-2 py-2 text-[11px] text-muted-foreground">No local branches.</div>}>
                    <SidebarItemList>
                      <For each={props.branches?.local ?? []}>
                        {(branch) => (
                          <SidebarItem
                            active={props.selectedBranchName === branchKey(branch)}
                            class="py-1"
                            onClick={() => props.onSelectBranch?.(branch)}
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
                </SidebarSection>

                <SidebarSection title="Remote branches" actions={<span class="text-[11px] text-muted-foreground/80">{props.branches?.remote?.length ?? 0}</span>}>
                  <Show when={(props.branches?.remote?.length ?? 0) > 0} fallback={<div class="px-2 py-2 text-[11px] text-muted-foreground">No remote branches.</div>}>
                    <SidebarItemList>
                      <For each={props.branches?.remote ?? []}>
                        {(branch) => (
                          <SidebarItem class="py-1">
                            <div class="min-w-0 flex-1 text-left">
                              <div class="truncate text-[11px] leading-4 text-current">{branchDisplayName(branch)}</div>
                              <div class="mt-0.5 truncate text-[10px] text-muted-foreground/80">{branch.subject || 'No recent subject'}</div>
                            </div>
                          </SidebarItem>
                        )}
                      </For>
                    </SidebarItemList>
                  </Show>
                </SidebarSection>
              </div>
            </Show>
          </Show>
        </SidebarContent>
      </Sidebar>

      <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
        <div class="border-b border-border/70 px-4 py-3 space-y-1.5">
          <div class="text-sm font-medium text-foreground">Branch compare</div>
          <div class="text-xs text-muted-foreground">{compareHeadline(props.compare)}</div>
          <Show when={props.compare}>
            {(compareAccessor) => {
              const compare = compareAccessor();
              return (
                <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span class="rounded-full border border-border/70 px-2 py-0.5">Base {compare.baseRef}</span>
                  <span class="rounded-full border border-border/70 px-2 py-0.5">Target {compare.targetRef}</span>
                  <span class="rounded-full border border-border/70 px-2 py-0.5">↑{compare.targetAheadCount ?? 0}</span>
                  <span class="rounded-full border border-border/70 px-2 py-0.5">↓{compare.targetBehindCount ?? 0}</span>
                  <Show when={compare.mergeBase}>
                    <span class="rounded-full border border-border/70 px-2 py-0.5 font-mono">merge-base {String(compare.mergeBase).slice(0, 7)}</span>
                  </Show>
                </div>
              );
            }}
          </Show>
        </div>

        <Show when={!props.compareLoading} fallback={<div class="px-4 py-4 text-xs text-muted-foreground">Loading branch compare...</div>}>
          <Show when={!props.compareError} fallback={<div class="px-4 py-4 text-xs text-error break-words">{props.compareError}</div>}>
            <div class="h-[calc(100%-73px)] min-h-0 flex overflow-hidden">
              <Sidebar width={FILES_SIDEBAR_WIDTH} class="h-full border-r border-border/70">
                <SidebarContent class="h-full min-h-0 flex flex-col">
                  <SidebarSection title="Changed files" actions={<span class="text-[11px] text-muted-foreground/80">{props.compare?.files.length ?? 0}</span>} class="min-h-0 flex-1">
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
      </div>
    </div>
  );
}
