import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { GitPatchViewer, type GitPatchRenderable } from './GitPatchViewer';

export interface GitDiffDialogProps<T extends GitPatchRenderable> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: T | null | undefined;
  title?: string;
  description?: string;
  emptyMessage: string;
  unavailableMessage?: string | ((item: T) => string | undefined);
  class?: string;
}

export function GitDiffDialog<T extends GitPatchRenderable>(props: GitDiffDialogProps<T>) {
  const layout = useLayout();

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title ?? 'Diff'}
      description={props.description}
      class={cn(
        'max-w-none overflow-hidden rounded-xl border border-border bg-card p-0',
        layout.isMobile()
          ? 'h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-h-none'
          : 'max-h-[88vh] w-[min(1100px,94vw)]',
        props.class,
      )}
    >
      <div class="min-h-[320px]">
        <GitPatchViewer
          item={props.item}
          emptyMessage={props.emptyMessage}
          unavailableMessage={props.unavailableMessage}
        />
      </div>
    </Dialog>
  );
}
