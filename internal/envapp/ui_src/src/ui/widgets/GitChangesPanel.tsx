import { Show, createEffect, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitListWorkspaceChangesResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { readGitPatchWithFallback, readWorkspaceGitPatchTextOnce } from '../utils/gitPatchStreamReader';
import { changeMetricsText, changeSecondaryPath, summarizeWorkspaceCount, workspaceSectionLabel } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitChangeTone, gitToneBadgeClass, gitToneInsetClass, gitToneSurfaceClass, workspaceSectionTone } from './GitChrome';

export interface GitChangesPanelProps {
  repoRootPath?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  selectedItem?: GitWorkspaceChange | null;
  loading?: boolean;
  error?: string;
  inspectNonce?: number;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const protocol = useProtocol();
  const [diffOpen, setDiffOpen] = createSignal(false);
  const totalChanges = () => summarizeWorkspaceCount(props.workspace?.summary);
  const selectedSectionTone = () => workspaceSectionTone(props.selectedItem?.section);

  createEffect(() => {
    const nonce = Number(props.inspectNonce ?? 0);
    if (nonce <= 0) return;
    if (props.selectedItem) {
      setDiffOpen(true);
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div class="shrink-0 border-b border-border/70 px-3 py-2.5">
        <div class="flex flex-wrap items-start justify-between gap-2.5">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground">Workspace Detail</div>
            <div class="mt-0.5 text-[11px] text-muted-foreground">
              <Show when={!props.loading && !props.error} fallback={<span>Loading workspace state...</span>}>
                <span>{totalChanges() > 0 ? `${totalChanges()} file${totalChanges() === 1 ? '' : 's'} need review.` : 'Working tree is clean.'}</span>
              </Show>
            </div>
          </div>

          <Show when={props.selectedItem}>
            {(itemAccessor) => {
              const item = itemAccessor();
              return (
                <div class={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(selectedSectionTone()))}>
                  <span>{workspaceSectionLabel((item.section || 'unstaged') as 'staged' | 'unstaged' | 'untracked' | 'conflicted')}</span>
                  <span class="opacity-60">·</span>
                  <span class="truncate max-w-[14rem]" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</span>
                </div>
              );
            }}
          </Show>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
        <Show when={!props.loading} fallback={<div class="text-xs text-muted-foreground">Loading workspace changes...</div>}>
          <Show when={!props.error} fallback={<div class="text-xs text-error">{props.error}</div>}>
            <div class="space-y-3">
              <section class={cn('rounded-xl border p-3', gitToneSurfaceClass(totalChanges() > 0 ? 'warning' : 'success'))}>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Workspace Summary</div>
                    <div class="mt-1 text-xs text-muted-foreground">Keep scanning files from the sidebar. Clicking a file opens its diff in a floating panel.</div>
                  </div>
                  <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(totalChanges() > 0 ? 'warning' : 'success'))}>
                    {totalChanges() > 0 ? `${totalChanges()} open` : 'Clean'}
                  </span>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] lg:grid-cols-4">
                  <div class={cn('rounded-lg border px-2.5 py-2', gitToneInsetClass(workspaceSectionTone('staged')))}>
                    <div class="text-muted-foreground">Staged</div>
                    <div class="mt-1 text-sm font-semibold text-foreground">{props.workspace?.summary?.stagedCount ?? 0}</div>
                  </div>
                  <div class={cn('rounded-lg border px-2.5 py-2', gitToneInsetClass(workspaceSectionTone('unstaged')))}>
                    <div class="text-muted-foreground">Unstaged</div>
                    <div class="mt-1 text-sm font-semibold text-foreground">{props.workspace?.summary?.unstagedCount ?? 0}</div>
                  </div>
                  <div class={cn('rounded-lg border px-2.5 py-2', gitToneInsetClass(workspaceSectionTone('untracked')))}>
                    <div class="text-muted-foreground">Untracked</div>
                    <div class="mt-1 text-sm font-semibold text-foreground">{props.workspace?.summary?.untrackedCount ?? 0}</div>
                  </div>
                  <div class={cn('rounded-lg border px-2.5 py-2', gitToneInsetClass(workspaceSectionTone('conflicted')))}>
                    <div class="text-muted-foreground">Conflicted</div>
                    <div class="mt-1 text-sm font-semibold text-foreground">{props.workspace?.summary?.conflictedCount ?? 0}</div>
                  </div>
                </div>
              </section>

              <Show when={props.selectedItem}>
                {(itemAccessor) => {
                  const item = itemAccessor();
                  return (
                    <section class={cn('rounded-xl border p-3', gitToneSurfaceClass(selectedSectionTone()))}>
                      <div class="flex flex-wrap items-start justify-between gap-2.5">
                        <div class="min-w-0 flex-1">
                          <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Focused File</div>
                          <div class="mt-1 truncate text-sm font-medium text-foreground" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(selectedSectionTone()))}>
                              {workspaceSectionLabel((item.section || 'unstaged') as 'staged' | 'unstaged' | 'untracked' | 'conflicted')}
                            </span>
                            <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(gitChangeTone(item.changeType)))}>{item.changeType || 'modified'}</span>
                            <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{changeMetricsText(item)}</span>
                          </div>
                        </div>

                        <Button size="sm" variant="outline" class="cursor-pointer" onClick={() => setDiffOpen(true)}>
                          Open Diff
                        </Button>
                      </div>
                    </section>
                  );
                }}
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <GitDiffDialog
        open={diffOpen()}
        onOpenChange={setDiffOpen}
        item={props.selectedItem}
        title="Workspace Diff"
        emptyMessage={totalChanges() > 0 ? 'Select a workspace file from the Git sidebar to inspect its diff.' : 'Workspace is clean.'}
        unavailableMessage={(item) => item.section === 'untracked' ? 'Untracked files do not have a Git patch yet.' : undefined}
        loadPatch={async (item, signal) => {
          const client = protocol.client();
          const repoRootPath = String(props.repoRootPath ?? '').trim();
          const section = item.section;
          if (!client || !repoRootPath || !section) {
            return { text: '', truncated: false };
          }
          const resp = await readGitPatchWithFallback({
            item,
            readByPath: (filePath) => readWorkspaceGitPatchTextOnce({
              client,
              repoRootPath,
              section,
              filePath,
              maxBytes: 2 * 1024 * 1024,
              signal,
            }),
          });
          return { text: resp.text, truncated: resp.meta.truncated };
        }}
      />
    </div>
  );
}
