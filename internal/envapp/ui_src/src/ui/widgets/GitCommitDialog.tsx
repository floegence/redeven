import { For, Show, createMemo } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitWorkspaceChange } from '../protocol/redeven_v1';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { gitChangePathClass } from './GitChrome';
import { useI18n } from '../i18n';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitInlineLoadingStatus,
  GitPagedTableFooter,
  GitStatStrip,
  GitTableFrame,
  gitChangedFilesRowClass,
} from './GitWorkbenchPrimitives';

export interface GitCommitDialogProps {
  open: boolean;
  stagedItems: GitWorkspaceChange[];
  totalCount?: number;
  hasMore?: boolean;
  loadingItems?: boolean;
  message: string;
  loading?: boolean;
  canCommit?: boolean;
  onMessageChange?: (value: string) => void;
  onConfirm?: () => void;
  onLoadMore?: () => void;
  onClose: () => void;
}

function itemPath(item: GitWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

export function GitCommitDialog(props: GitCommitDialogProps) {
  const i18n = useI18n();
  const loadedCount = createMemo(() => props.stagedItems.length);
  const fileCount = createMemo(() => Math.max(loadedCount(), Number(props.totalCount ?? 0)));
  const partial = createMemo(() => fileCount() > loadedCount());
  const additions = createMemo(() => props.stagedItems.reduce((sum, item) => sum + Number(item.additions ?? 0), 0));
  const deletions = createMemo(() => props.stagedItems.reduce((sum, item) => sum + Number(item.deletions ?? 0), 0));
  const outlineControlClass = redevenSurfaceRoleClass('control');

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={i18n.t('git.commitDialog.title')}
      class="border border-border/60 shadow-xl"
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" class={outlineControlClass} onClick={props.onClose} disabled={props.loading}>
            {i18n.t('common.actions.cancel')}
          </Button>
          <Button size="sm" variant="default" onClick={() => props.onConfirm?.()} loading={props.loading} disabled={!props.canCommit}>
            {i18n.t('git.commitDialog.commit')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-3">
        <div class="text-xs text-muted-foreground">{i18n.t('git.commitDialog.description')}</div>

        <GitStatStrip
          columnsClass="grid-cols-1 gap-1 sm:grid-cols-3"
          items={[
            { label: i18n.t('git.commitDialog.filesReady'), value: i18n.tn('git.common.fileCount', fileCount()) },
            { label: i18n.t('git.commitDialog.addedLines'), value: <span class="text-success">+{additions()}</span> },
            { label: i18n.t('git.commitDialog.removedLines'), value: <span class="text-error">-{deletions()}</span> },
          ]}
        />

        <GitTableFrame>
          <Show
            when={!props.loadingItems || props.stagedItems.length > 0}
            fallback={(
              <div class="px-4 py-8">
                <GitInlineLoadingStatus>{i18n.t('git.commitDialog.loadingStagedFiles')}</GitInlineLoadingStatus>
              </div>
            )}
          >
            <div class="max-h-[16rem] overflow-auto">
              <table class={GIT_CHANGED_FILES_TABLE_CLASS}>
                <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
                  <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.path')}</th>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.status')}</th>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.changes')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.stagedItems}>
                    {(item) => (
                      <tr class={gitChangedFilesRowClass(false)}>
                        <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                          <div class={`truncate text-[11px] font-medium ${gitChangePathClass(item.changeType)}`} title={itemPath(item)}>{itemPath(item)}</div>
                        </td>
                        <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeStatusPill change={item.changeType} /></td>
                        <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={props.hasMore || (props.loadingItems && props.stagedItems.length > 0)}>
              <GitPagedTableFooter
                summary={partial()
                  ? i18n.t('git.commitDialog.moreStagedFilesAvailable')
                  : i18n.t('git.commitDialog.loadMoreStagedFiles')}
                onLoadMore={props.onLoadMore}
                hasMore={props.hasMore}
                loading={props.loadingItems && props.stagedItems.length > 0}
                loadingStatus={i18n.t('git.commitDialog.loadingNextStagedFiles')}
              />
            </Show>
          </Show>
        </GitTableFrame>

        <div>
          <label class="mb-1 block text-xs font-medium text-foreground">{i18n.t('git.commitDialog.messageLabel')}</label>
          <textarea
            rows={4}
            class={`w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring/70 ${outlineControlClass}`}
            value={props.message}
            placeholder={i18n.t('git.commitDialog.messagePlaceholder')}
            onInput={(event) => props.onMessageChange?.(event.currentTarget.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
