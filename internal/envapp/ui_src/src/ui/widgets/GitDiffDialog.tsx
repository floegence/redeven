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
        'flex max-w-none flex-col overflow-hidden rounded-md p-0',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:overflow-hidden [&>div:last-child]:pt-2',
        layout.isMobile()
          ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none'
          : 'max-h-[88vh] w-[min(1100px,94vw)]',
        props.class,
      )}
    >
      <div class="flex h-full min-h-0 flex-col">
        <GitPatchViewer
          class="h-full"
          item={props.item}
          emptyMessage={props.emptyMessage}
          unavailableMessage={props.unavailableMessage}
        />
      </div>
    </Dialog>
  );
}
