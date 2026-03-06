import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import type { GitListWorkspaceChangesResponse, GitWorkspaceChange, GitWorkspaceSection } from '../protocol/redeven_v1';
import { GitPatchViewer } from './GitPatchViewer';
import { changeMetricsText, changeSecondaryPath, workspaceSectionCount, workspaceSectionItems } from '../utils/gitWorkbench';
import { gitChangeDotClass } from '../utils/gitPatch';
import { readWorkspaceGitPatchTextOnce } from '../utils/gitPatchStreamReader';

const FILES_SIDEBAR_WIDTH = 320;
const WORKSPACE_SECTIONS: GitWorkspaceSection[] = ['staged', 'unstaged', 'untracked', 'conflicted'];

export interface GitChangesPanelProps {
  repoRootPath?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  loading?: boolean;
  error?: string;
}

function workspaceEntryKey(item: GitWorkspaceChange | null | undefined): string {
  if (!item) return '';
  return `${item.section || ''}:${item.patchPath || item.path || item.newPath || item.oldPath || ''}`;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const protocol = useProtocol();
  const [selectedKey, setSelectedKey] = createSignal('');

  const selectedItem = createMemo<GitWorkspaceChange | null>(() => {
    const key = selectedKey();
    if (!key) return null;
    for (const section of WORKSPACE_SECTIONS) {
      const item = workspaceSectionItems(props.workspace, section).find((entry) => workspaceEntryKey(entry) === key);
      if (item) return item;
    }
    return null;
  });

  createEffect(() => {
    props.repoRootPath;
    props.workspace;
    const allItems = WORKSPACE_SECTIONS.flatMap((section) => workspaceSectionItems(props.workspace, section));
    const current = selectedKey();
    if (current && allItems.some((item) => workspaceEntryKey(item) === current)) {
      return;
    }
    setSelectedKey(workspaceEntryKey(allItems[0] ?? null));
  });

  return (
    <div class="h-full min-h-0 flex overflow-hidden">
      <Sidebar width={FILES_SIDEBAR_WIDTH} class="h-full border-r border-border/70">
        <SidebarContent class="h-full min-h-0 flex flex-col">
          <Show when={!props.loading} fallback={<div class="px-3 py-3 text-xs text-muted-foreground">Loading workspace changes...</div>}>
            <Show when={!props.error} fallback={<div class="px-3 py-3 text-xs text-error break-words">{props.error}</div>}>
              <div class="h-full min-h-0 overflow-auto px-2.5 py-2.5 space-y-3">
                <For each={WORKSPACE_SECTIONS}>
                  {(section) => {
                    const items = createMemo(() => workspaceSectionItems(props.workspace, section));
                    return (
                      <SidebarSection
                        title={section[0]!.toUpperCase() + section.slice(1)}
                        actions={<span class="text-[11px] text-muted-foreground/80">{workspaceSectionCount(props.workspace?.summary, section)}</span>}
                      >
                        <Show when={items().length > 0} fallback={<div class="px-2 py-2 text-[11px] text-muted-foreground">No files.</div>}>
                          <SidebarItemList>
                            <For each={items()}>
                              {(item) => (
                                <SidebarItem
                                  active={selectedKey() === workspaceEntryKey(item)}
                                  class="py-0.5"
                                  icon={<span class={`inline-block size-2 rounded-full ${gitChangeDotClass(item.changeType)}`} />}
                                  onClick={() => setSelectedKey(workspaceEntryKey(item))}
                                >
                                  <div class="flex min-w-0 items-center gap-2 text-left">
                                    <span class="min-w-0 flex-1 truncate text-[11px] leading-4 text-current" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</span>
                                    <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">{item.section === 'untracked' ? 'New file' : changeMetricsText(item)}</span>
                                  </div>
                                </SidebarItem>
                              )}
                            </For>
                          </SidebarItemList>
                        </Show>
                      </SidebarSection>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </SidebarContent>
      </Sidebar>

      <div class="flex-1 min-w-0 min-h-0 overflow-auto px-4 py-3">
        <GitPatchViewer
          item={selectedItem()}
          emptyMessage="Select a workspace file to inspect its patch."
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
      </div>
    </div>
  );
}
