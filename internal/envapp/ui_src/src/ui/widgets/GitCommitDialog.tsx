import { For, Show, createMemo } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitWorkspaceChange } from '../protocol/redeven_v1';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { gitChangePathClass } from './GitChrome';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitPagedTableFooter,
  GitStatStrip,
  GitSubtleNote,
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
      title="Commit staged changes"
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" class={outlineControlClass} onClick={props.onClose} disabled={props.loading}>
            Cancel
          </Button>
          <Button size="sm" variant="default" onClick={() => props.onConfirm?.()} loading={props.loading} disabled={!props.canCommit}>
            Commit
          </Button>
        </div>
      )}
    >
      <div class="space-y-3">
        <div class="text-xs text-muted-foreground">Review the staged files below, then write the commit message for this snapshot.</div>

        <GitStatStrip
          columnsClass="grid-cols-1 gap-1 sm:grid-cols-3"
          items={[
            { label: 'Files Ready', value: `${fileCount()} ${fileCount() === 1 ? 'file' : 'files'}` },
            { label: 'Added Lines', value: <span class="text-success">+{additions()}</span> },
            { label: 'Removed Lines', value: <span class="text-error">-{deletions()}</span> },
          ]}
        />

        <div class={`overflow-hidden rounded-md border ${redevenSurfaceRoleClass('panelStrong')}`}>
          <Show
            when={!props.loadingItems || props.stagedItems.length > 0}
            fallback={(
              <div class="px-4 py-8">
                <GitSubtleNote>Loading staged files...</GitSubtleNote>
              </div>
            )}
          >
            <div class="max-h-[16rem] overflow-auto">
              <table class={GIT_CHANGED_FILES_TABLE_CLASS}>
                <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
                  <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
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
                  ? 'More staged files are available.'
                  : 'Load more staged files if you want to review the full snapshot here.'}
                onLoadMore={props.onLoadMore}
                hasMore={props.hasMore}
                loading={props.loadingItems && props.stagedItems.length > 0}
                loadingStatus="Loading next staged files"
              />
            </Show>
          </Show>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-foreground">Message</label>
          <textarea
            rows={4}
            class={`w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-5 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70 ${outlineControlClass}`}
            value={props.message}
            placeholder="Write the commit message"
            onInput={(event) => props.onMessageChange?.(event.currentTarget.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
