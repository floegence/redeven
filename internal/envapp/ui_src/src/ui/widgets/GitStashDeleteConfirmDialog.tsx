import { Show, createMemo } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Dialog } from '../primitives/EnvAppModal';
import type { GitStashSummary } from '../protocol/redeven_v1';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitSubtleNote } from './GitWorkbenchPrimitives';
import { WindowModal } from './WindowModal';
import { useI18n, type I18nHelpers } from '../i18n';

export interface GitStashDeleteConfirmDialogProps {
  open: boolean;
  stash?: GitStashSummary | null;
  reviewError?: string;
  loading?: boolean;
  host?: HTMLElement | null;
  onClose: () => void;
  onConfirm?: () => void;
}

function formatStashTime(i18n: I18nHelpers, value?: number): string {
  if (!value || !Number.isFinite(value)) return i18n.t('git.stashDelete.unknownTime');
  return i18n.formatDateTime(value);
}

export function GitStashDeleteConfirmDialog(props: GitStashDeleteConfirmDialogProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const stashHeadline = createMemo(() => {
    const stash = props.stash;
    const message = String(stash?.message ?? '').trim();
    if (message) return message;
    const ref = String(stash?.ref ?? '').trim();
    if (ref) return ref;
    return i18n.t('git.stashDelete.selectedStash');
  });
  const stashMeta = createMemo(() => {
    const parts = [
      String(props.stash?.ref ?? '').trim(),
      String(props.stash?.branchName ?? '').trim(),
      formatStashTime(i18n, props.stash?.createdAtUnixMs),
    ].filter(Boolean);
    return parts.join(' • ');
  });
  const footer = (
    <>
      <div class="git-dialog-actions">
        <Button size="md" variant="outline" class={cn('w-full sm:w-auto', outlineControlClass)} disabled={props.loading} onClick={props.onClose}>
          {i18n.t('common.actions.cancel')}
        </Button>
        <Button size="md" variant="destructive" class="w-full sm:w-auto" loading={props.loading} disabled={props.loading} onClick={() => props.onConfirm?.()}>
          {i18n.t('git.stashDelete.confirmDelete')}
        </Button>
      </div>
    </>
  );
  const body = (
    <div class="flex min-w-0 flex-col gap-3">
      <GitSubtleNote tone="danger">
        <div class="space-y-1.5">
          <div class="text-xs font-semibold text-foreground">{stashHeadline()}</div>
          <Show when={stashMeta()}>
            <div class="text-[11px] leading-relaxed text-muted-foreground">{stashMeta()}</div>
          </Show>
        </div>
      </GitSubtleNote>

      <GitSubtleNote tone="warning">
        {i18n.t('git.stashDelete.warning')}
      </GitSubtleNote>

      <Show when={props.reviewError}>
        <GitSubtleNote tone="warning">{props.reviewError}</GitSubtleNote>
      </Show>
    </div>
  );

  if (!layout.isMobile()) {
    return (
      <WindowModal
        open={props.open}
        host={props.host ?? null}
        title={i18n.t('git.stashDelete.title')}
        bodyDescription={i18n.t('git.stashDelete.description')}
        footer={<div class="git-window-dialog-footer">{footer}</div>}
        class="git-operation-dialog w-[min(28rem,calc(100%-1rem))]"
        bodyClass="git-window-dialog-body"
        onOpenChange={(open) => {
          if (!open && !props.loading) props.onClose();
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
        if (!open && !props.loading) props.onClose();
      }}
      title={i18n.t('git.stashDelete.title')}
      bodyDescription={i18n.t('git.stashDelete.description')}
      contentClass="git-dialog-body"
      footer={footer}
      class={cn(
        'git-operation-dialog max-w-none',
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(28rem,calc(100vw-2rem))]',
      )}
    >
      {body}
    </Dialog>
  );
}
