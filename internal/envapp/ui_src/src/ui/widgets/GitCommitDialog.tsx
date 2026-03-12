import { For, createMemo } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitWorkspaceChange } from '../protocol/redeven_v1';
import { gitChangePathClass } from './GitChrome';
import { GitChangeMetrics, GitStatStrip } from './GitWorkbenchPrimitives';

export interface GitCommitDialogProps {
  open: boolean;
  stagedItems: GitWorkspaceChange[];
  message: string;
  loading?: boolean;
  canCommit?: boolean;
  onMessageChange?: (value: string) => void;
  onConfirm?: () => void;
  onClose: () => void;
}

function itemPath(item: GitWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

export function GitCommitDialog(props: GitCommitDialogProps) {
  const fileCount = createMemo(() => props.stagedItems.length);
  const additions = createMemo(() => props.stagedItems.reduce((sum, item) => sum + Number(item.additions ?? 0), 0));
  const deletions = createMemo(() => props.stagedItems.reduce((sum, item) => sum + Number(item.deletions ?? 0), 0));

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Commit staged changes"
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.onClose} disabled={props.loading}>
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

        <div class="overflow-hidden rounded-md border border-border/65 bg-card">
          <div class="max-h-[16rem] overflow-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-muted/30 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr class="border-b border-border/60">
                  <th class="px-3 py-2.5 font-medium">Path</th>
                  <th class="px-3 py-2.5 font-medium">Type</th>
                  <th class="px-3 py-2.5 font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.stagedItems}>
                  {(item) => (
                    <tr class="border-b border-border/45 last:border-b-0">
                      <td class="px-3 py-2.5">
                        <div class={`truncate text-xs font-medium ${gitChangePathClass(item.changeType)}`} title={itemPath(item)}>{itemPath(item)}</div>
                      </td>
                      <td class="px-3 py-2.5 capitalize text-muted-foreground">{item.changeType || 'modified'}</td>
                      <td class="px-3 py-2.5"><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-foreground">Message</label>
          <textarea
            rows={4}
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-5 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70"
            value={props.message}
            placeholder="Write the commit message"
            onInput={(event) => props.onMessageChange?.(event.currentTarget.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
