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
        'max-w-none overflow-hidden rounded-[20px] border-0 bg-card/98 p-0 shadow-[0_28px_90px_rgba(0,0,0,0.24)]',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:first-child>button]:bg-transparent [&>div:first-child>button]:text-muted-foreground',
        '[&>div:first-child>button:hover]:bg-muted/80 [&>div:first-child>button:hover]:text-foreground',
        '[&>div:last-child]:pt-2',
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
