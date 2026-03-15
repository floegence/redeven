import { For, Show } from 'solid-js';
import type { GitWorkspaceChange, GitWorkspaceSection } from '../protocol/redeven_v1';
import { changeSecondaryPath, gitDiffEntryIdentity, workspaceSectionLabel } from '../utils/gitWorkbench';
import { gitChangePathClass } from './GitChrome';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';

function itemPath(item: GitWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function itemSectionLabel(item: GitWorkspaceChange): string {
  const section = String(item.section ?? '').trim();
  switch (section) {
    case 'staged':
    case 'unstaged':
    case 'untracked':
    case 'conflicted':
      return workspaceSectionLabel(section as GitWorkspaceSection);
    default:
      return section || 'Unknown';
  }
}

export interface GitWorkspaceStatusTableProps {
  items: GitWorkspaceChange[];
  selectedKey?: string;
  emptyMessage?: string;
  onOpenDiff?: (item: GitWorkspaceChange) => void;
}

export function GitWorkspaceStatusTable(props: GitWorkspaceStatusTableProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="px-4 py-8">
            <GitSubtleNote>{props.emptyMessage ?? 'No files are available in this section.'}</GitSubtleNote>
          </div>
        )}
      >
        <div class="min-h-0 flex-1 overflow-auto">
          <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[52rem] md:min-w-0`}>
            <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
              <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Section</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(item) => {
                  const active = () => props.selectedKey === gitDiffEntryIdentity(item);
                  return (
                    <tr aria-selected={active()} class={gitChangedFilesRowClass(active())}>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <div class="min-w-0">
                          <button
                            type="button"
                            class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                            title={changeSecondaryPath(item)}
                            onClick={() => props.onOpenDiff?.(item)}
                          >
                            {itemPath(item)}
                          </button>
                          <Show when={changeSecondaryPath(item) !== itemPath(item)}>
                            <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          </Show>
                        </div>
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <div class="text-[11px] text-muted-foreground">{itemSectionLabel(item)}</div>
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <GitChangeStatusPill change={item.changeType} />
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      <td class={gitChangedFilesStickyCellClass(active())}>
                        <GitChangedFilesActionButton onClick={() => props.onOpenDiff?.(item)}>View Diff</GitChangedFilesActionButton>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
