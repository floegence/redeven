import { createMemo, Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Dialog } from '../primitives/EnvAppModal';
import { PreviewWindow } from './PreviewWindow';
import { GitDiffPanel, type GitDiffPanelProps } from './GitDiffPanel';
import { useI18n } from '../i18n';

export type { GitDiffDialogItem, GitDiffDialogSource, GitDiffDialogErrorFormatter, GitDiffDialogErrorFormatterContext } from './GitDiffPanel';
export interface GitDiffDialogProps extends GitDiffPanelProps {
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  desktopFloatingWindow?: boolean;
  stackId?: string;
}
const GIT_DIFF_WINDOW_DEFAULT_SIZE = { width: 1100, height: 760 };
const GIT_DIFF_WINDOW_MIN_SIZE = { width: 720, height: 520 };

export function GitDiffDialog(props: GitDiffDialogProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const title = createMemo(() => props.title ?? i18n.t('gitDiff.title'));
  const useDesktopFloatingWindow = () => props.desktopFloatingWindow === true && !layout.isMobile();
  return (
    <Show
      when={useDesktopFloatingWindow()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={title()}
          bodyDescription={props.description}
          contentClass="flex min-h-0 flex-1 flex-col overflow-hidden pt-2"
          class={cn(
            "flex max-w-none flex-col overflow-hidden rounded-md p-0",
            "[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2",
            layout.isMobile()
              ? "h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none"
              : "h-[88vh] max-h-[88vh] w-[min(1100px,94vw)]",
            props.class,
          )}
        >
          <GitDiffPanel {...props} />
        </Dialog>
      }
    >
      <PreviewWindow
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={title()}
        description={props.description}
        stackId={props.stackId ?? "git-diff"}
        persistenceKey="git-diff-dialog"
        defaultSize={GIT_DIFF_WINDOW_DEFAULT_SIZE}
        minSize={GIT_DIFF_WINDOW_MIN_SIZE}
        floatingClass="bg-background"
        mobileClass="bg-background"
      >
        <GitDiffPanel {...props} />
      </PreviewWindow>
    </Show>
  );
}
