import { Show, createMemo } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitStashSummary } from '../protocol/redeven_v1';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitSubtleNote } from './GitWorkbenchPrimitives';
import { WindowModal } from './WindowModal';

export interface GitStashDeleteConfirmDialogProps {
  open: boolean;
  stash?: GitStashSummary | null;
  reviewError?: string;
  loading?: boolean;
  host?: HTMLElement | null;
  onClose: () => void;
  onConfirm?: () => void;
}

function formatStashTime(value?: number): string {
  if (!value || !Number.isFinite(value)) return 'Unknown time';
  return new Date(value).toLocaleString();
}

export function GitStashDeleteConfirmDialog(props: GitStashDeleteConfirmDialogProps) {
  const layout = useLayout();
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const stashHeadline = createMemo(() => {
    const stash = props.stash;
    const message = String(stash?.message ?? '').trim();
    if (message) return message;
    const ref = String(stash?.ref ?? '').trim();
    if (ref) return ref;
    return 'Selected stash';
  });
  const stashMeta = createMemo(() => {
    const parts = [
      String(props.stash?.ref ?? '').trim(),
      String(props.stash?.branchName ?? '').trim(),
      formatStashTime(props.stash?.createdAtUnixMs),
    ].filter(Boolean);
    return parts.join(' • ');
  });
  const footer = (
    <div class={cn('border-t px-4 pt-3 pb-4 backdrop-blur', redevenDividerRoleClass('strong'), redevenSurfaceRoleClass('inset'), 'supports-[backdrop-filter]:bg-background/78')}>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button size="sm" variant="outline" class={cn('w-full sm:w-auto', outlineControlClass)} disabled={props.loading} onClick={props.onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" class="w-full sm:w-auto" loading={props.loading} disabled={props.loading} onClick={() => props.onConfirm?.()}>
          Confirm Delete
        </Button>
      </div>
    </div>
  );
  const body = (
    <div class="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-4">
      <GitSubtleNote class="border-error/25 bg-error/10 text-foreground">
        <div class="space-y-1.5">
          <div class="text-xs font-semibold text-foreground">{stashHeadline()}</div>
          <Show when={stashMeta()}>
            <div class="text-[11px] leading-relaxed text-muted-foreground">{stashMeta()}</div>
          </Show>
        </div>
      </GitSubtleNote>

      <GitSubtleNote class="border-warning/25 bg-warning/10 text-foreground">
        Deleting a stash removes it from the shared stack. These changes will not be applied to the current workspace.
      </GitSubtleNote>

      <Show when={props.reviewError}>
        <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.reviewError}</GitSubtleNote>
      </Show>
    </div>
  );

  if (!layout.isMobile()) {
    return (
      <WindowModal
        open={props.open}
        host={props.host ?? null}
        title="Delete Stash"
        description="Remove this stash entry from the shared stack without applying its changes."
        footer={footer}
        class="w-[min(28rem,calc(100%-1rem))]"
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        {body}
      </WindowModal>
    );
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Stash"
      description="Remove this stash entry from the shared stack without applying its changes."
      footer={footer}
      class={cn(
        'flex max-w-none flex-col overflow-hidden rounded-md p-0',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(28rem,calc(100vw-2rem))]',
      )}
    >
      {body}
    </Dialog>
  );
}
