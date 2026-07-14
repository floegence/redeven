import { For, Show } from 'solid-js';
import type { GitWorkspaceChange } from '../protocol/redeven_v1';
import { changeSecondaryPath, gitDiffEntryIdentity } from '../utils/gitWorkbench';
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
  GitTableFrame,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from './gitWorkbenchScrollRegion';
import { useI18n } from '../i18n';

function itemPath(item: GitWorkspaceChange, i18n: ReturnType<typeof useI18n>): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || i18n.t('filePreview.unknownPath');
}

function itemSectionLabel(item: GitWorkspaceChange, i18n: ReturnType<typeof useI18n>): string {
  const section = String(item.section ?? '').trim();
  switch (section) {
    case 'staged': return i18n.t('git.common.staged');
    case 'unstaged': return i18n.t('git.common.unstaged');
    case 'untracked': return i18n.t('git.common.untracked');
    case 'conflicted': return i18n.t('git.common.conflicted');
    default:
      return section || i18n.t('uiCopy.git.unknown');
  }
}

export interface GitWorkspaceStatusTableProps {
  items: GitWorkspaceChange[];
  selectedKey?: string;
  emptyMessage?: string;
  onOpenDiff?: (item: GitWorkspaceChange) => void;
}

export function GitWorkspaceStatusTable(props: GitWorkspaceStatusTableProps) {
  const i18n = useI18n();
  return (
    <GitTableFrame class="flex min-h-0 flex-1 flex-col">
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="px-4 py-8">
            <GitSubtleNote>{props.emptyMessage ?? i18n.t('git.changes.noFilesInSection')}</GitSubtleNote>
          </div>
        )}
      >
        <div {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="min-h-0 flex-1 overflow-auto">
          <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[52rem] md:min-w-0`}>
            <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
              <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.path')}</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('uiCopy.git.section')}</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.status')}</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.changes')}</th>
                <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>{i18n.t('git.common.action')}</th>
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
                            {itemPath(item, i18n)}
                          </button>
                          <Show when={changeSecondaryPath(item) !== itemPath(item, i18n)}>
                            <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          </Show>
                        </div>
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <div class="text-[11px] text-muted-foreground">{itemSectionLabel(item, i18n)}</div>
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <GitChangeStatusPill change={item.changeType} />
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      <td class={gitChangedFilesStickyCellClass(active())}>
                        <GitChangedFilesActionButton onClick={() => props.onOpenDiff?.(item)}>{i18n.t('files.menuViewDiff')}</GitChangedFilesActionButton>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </GitTableFrame>
  );
}
