import { Show } from 'solid-js';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import type { GitListWorkspaceChangesResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { GitPatchViewer } from './GitPatchViewer';
import { readWorkspaceGitPatchTextOnce } from '../utils/gitPatchStreamReader';
import { changeMetricsText, changeSecondaryPath, summarizeWorkspaceCount, workspaceSectionLabel } from '../utils/gitWorkbench';
import { gitChangeTone, gitToneBadgeClass, gitToneInsetClass, workspaceSectionTone } from './GitChrome';

export interface GitChangesPanelProps {
  repoRootPath?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  selectedItem?: GitWorkspaceChange | null;
  loading?: boolean;
  error?: string;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const protocol = useProtocol();
  const totalChanges = () => summarizeWorkspaceCount(props.workspace?.summary);

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="shrink-0 border-b border-border/70 px-4 py-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground">Workspace Detail</div>
            <div class="mt-1 text-xs text-muted-foreground">
              <Show when={!props.loading && !props.error} fallback={<span>Loading workspace state...</span>}>
                <span>{totalChanges() > 0 ? `${totalChanges()} file${totalChanges() === 1 ? '' : 's'} currently need attention.` : 'Working tree is clean.'}</span>
              </Show>
            </div>
          </div>

          <Show when={props.selectedItem}>
            {(itemAccessor) => {
              const item = itemAccessor();
              return (
                <div class={gitToneInsetClass(workspaceSectionTone(item.section)) + ' min-w-0 max-w-full rounded-xl border px-3 py-2 text-right'}>
                  <div class="truncate text-[11px] font-medium text-foreground" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                  <div class="mt-1 flex flex-wrap justify-end gap-1.5 text-[10px] text-muted-foreground">
                    <span class={gitToneBadgeClass(workspaceSectionTone(item.section)) + ' rounded-full border px-2 py-0.5 font-medium'}>{workspaceSectionLabel((item.section || 'unstaged') as 'staged' | 'unstaged' | 'untracked' | 'conflicted')}</span>
                    <span class={gitToneBadgeClass(gitChangeTone(item.changeType)) + ' rounded-full border px-2 py-0.5 font-medium'}>{item.changeType || 'modified'}</span>
                    <span class={gitToneBadgeClass('neutral') + ' rounded-full border px-2 py-0.5 font-medium'}>{changeMetricsText(item)}</span>
                  </div>
                </div>
              );
            }}
          </Show>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto px-4 py-3">
        <Show when={!props.loading} fallback={<div class="chat-tool-apply-patch-detail-empty">Loading workspace changes...</div>}>
          <Show when={!props.error} fallback={<div class="chat-tool-apply-patch-detail-empty text-error">{props.error}</div>}>
            <GitPatchViewer
              item={props.selectedItem}
              emptyMessage={totalChanges() > 0 ? 'Select a workspace file from the Git sidebar to inspect its patch.' : 'Workspace is clean.'}
              unavailableMessage={(item) => item.section === 'untracked' ? 'Untracked files do not have a Git patch yet.' : undefined}
              loadPatch={async (item, signal) => {
                const client = protocol.client();
                const repoRootPath = String(props.repoRootPath ?? '').trim();
                const filePath = String(item.patchPath || item.path || item.newPath || item.oldPath || '').trim();
                if (!client || !repoRootPath || !item.section || !filePath) {
                  return { text: '', truncated: false };
                }
                const resp = await readWorkspaceGitPatchTextOnce({
                  client,
                  repoRootPath,
                  section: item.section,
                  filePath,
                  maxBytes: 2 * 1024 * 1024,
                  signal,
                });
                return { text: resp.text, truncated: resp.meta.truncated };
              }}
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
