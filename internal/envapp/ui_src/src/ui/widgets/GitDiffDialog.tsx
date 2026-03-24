import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { useRedevenRpc, type GitGetFullContextDiffRequest } from '../protocol/redeven_v1';
import { GitPatchViewer, type GitPatchRenderable } from './GitPatchViewer';
import { GitStatePane } from './GitWorkbenchPrimitives';

export type GitDiffDialogSource =
  | {
    kind: 'workspace';
    repoRootPath: string;
    workspaceSection: string;
  }
  | {
    kind: 'commit';
    repoRootPath: string;
    commit: string;
  }
  | {
    kind: 'compare';
    repoRootPath: string;
    baseRef: string;
    targetRef: string;
  };

type GitDiffDialogMode = 'patch' | 'full-context';

const gitDiffModeButtonClass =
  'cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50';

export interface GitDiffDialogProps<T extends GitPatchRenderable> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: T | null | undefined;
  source?: GitDiffDialogSource | null;
  title?: string;
  description?: string;
  emptyMessage: string;
  unavailableMessage?: string | ((item: T) => string | undefined);
  class?: string;
}

function buildFullContextDiffRequest(source: GitDiffDialogSource | null | undefined, item: GitPatchRenderable | null | undefined): GitGetFullContextDiffRequest | null {
  const repoRootPath = String(source?.repoRootPath ?? '').trim();
  if (!repoRootPath || !source || !item) return null;
  const file = {
    changeType: typeof item.changeType === 'string' ? item.changeType : undefined,
    path: typeof item.path === 'string' ? item.path : undefined,
    oldPath: typeof item.oldPath === 'string' ? item.oldPath : undefined,
    newPath: typeof item.newPath === 'string' ? item.newPath : undefined,
  };
  switch (source.kind) {
    case 'workspace':
      return {
        repoRootPath,
        sourceKind: 'workspace',
        workspaceSection: String(source.workspaceSection ?? '').trim(),
        file,
      };
    case 'commit':
      return {
        repoRootPath,
        sourceKind: 'commit',
        commit: String(source.commit ?? '').trim(),
        file,
      };
    case 'compare':
      return {
        repoRootPath,
        sourceKind: 'compare',
        baseRef: String(source.baseRef ?? '').trim(),
        targetRef: String(source.targetRef ?? '').trim(),
        file,
      };
    default:
      return null;
  }
}

function fullContextRequestKey(req: GitGetFullContextDiffRequest | null): string {
  if (!req) return '';
  return JSON.stringify(req);
}

export function GitDiffDialog<T extends GitPatchRenderable>(props: GitDiffDialogProps<T>) {
  const layout = useLayout();
  const rpc = useRedevenRpc();
  const [mode, setMode] = createSignal<GitDiffDialogMode>('patch');
  const [fullContextItem, setFullContextItem] = createSignal<GitPatchRenderable | null>(null);
  const [fullContextLoading, setFullContextLoading] = createSignal(false);
  const [fullContextError, setFullContextError] = createSignal('');
  const [loadedRequestKey, setLoadedRequestKey] = createSignal('');

  let fullContextReqSeq = 0;

  const request = createMemo(() => buildFullContextDiffRequest(props.source, props.item));
  const requestKey = createMemo(() => fullContextRequestKey(request()));
  const canLoadFullContext = createMemo(() => requestKey() !== '');
  const keepPatchVisibleWhileLoading = createMemo(() => mode() === 'patch' || (mode() === 'full-context' && fullContextLoading()));

  createEffect(on(() => [props.open, requestKey()] as const, () => {
    fullContextReqSeq += 1;
    setMode('patch');
    setFullContextItem(null);
    setFullContextLoading(false);
    setFullContextError('');
    setLoadedRequestKey('');
  }, { defer: true }));

  createEffect(on(() => [props.open, mode(), request(), requestKey()] as const, ([open, nextMode, nextRequest, nextRequestKey]) => {
    if (!open || nextMode !== 'full-context' || !nextRequest || !nextRequestKey) return;
    if (loadedRequestKey() === nextRequestKey || fullContextLoading()) return;

    const seq = ++fullContextReqSeq;
    setFullContextLoading(true);
    setFullContextError('');

    void rpc.git.getFullContextDiff(nextRequest).then((resp) => {
      if (seq !== fullContextReqSeq || requestKey() !== nextRequestKey) return;
      setFullContextItem(resp.file ?? null);
      setLoadedRequestKey(nextRequestKey);
    }).catch((err) => {
      if (seq !== fullContextReqSeq || requestKey() !== nextRequestKey) return;
      setFullContextItem(null);
      setFullContextError(err instanceof Error ? err.message : String(err ?? 'Failed to load full-context diff.'));
    }).finally(() => {
      if (seq === fullContextReqSeq) setFullContextLoading(false);
    });
  }, { defer: true }));

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
        <div class="flex shrink-0 items-center justify-between gap-3 pb-2">
          <div class="inline-flex items-center gap-1 rounded-md border border-border/55 bg-muted/[0.16] p-1">
            <button
              type="button"
              class={cn(
                gitDiffModeButtonClass,
                mode() === 'patch' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={mode() === 'patch'}
              onClick={() => setMode('patch')}
            >
              Patch
            </button>
            <button
              type="button"
              class={cn(
                gitDiffModeButtonClass,
                mode() === 'full-context' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={mode() === 'full-context'}
              disabled={!canLoadFullContext()}
              onClick={() => setMode('full-context')}
            >
              Full Context
            </button>
          </div>

          <div class="text-[11px] text-muted-foreground">
            <Switch>
              <Match when={mode() === 'full-context' && fullContextLoading()}>Loading full context...</Match>
              <Match when={mode() === 'full-context' && !fullContextLoading()}>Includes unchanged lines for broader review context.</Match>
              <Match when={true}>Compact patch preview from the current Git payload.</Match>
            </Switch>
          </div>
        </div>

        <div class="relative min-h-0 flex-1">
          <Switch>
            <Match when={keepPatchVisibleWhileLoading()}>
              <GitPatchViewer
                class="min-h-0 flex-1"
                item={props.item}
                emptyMessage={props.emptyMessage}
                unavailableMessage={props.unavailableMessage}
              />
            </Match>

            <Match when={Boolean(fullContextError())}>
              <GitStatePane tone="error" message={fullContextError()} surface class="min-h-0 flex-1" />
            </Match>

            <Match when={fullContextItem()}>
              <GitPatchViewer
                class="min-h-0 flex-1"
                item={fullContextItem()}
                emptyMessage="Full-context diff is unavailable for this file."
                unavailableMessage={props.unavailableMessage as string | ((item: GitPatchRenderable) => string | undefined) | undefined}
              />
            </Match>

            <Match when={true}>
              <GitStatePane message="Full-context diff is unavailable for this file." surface class="min-h-0 flex-1" />
            </Match>
          </Switch>

          <Show when={mode() === 'full-context' && fullContextLoading()}>
            <GitStatePane
              loading
              message="Loading full-context diff..."
              class="absolute inset-0 z-10 h-full rounded-md bg-background/44 backdrop-blur-[1px]"
              contentClass="rounded-md border border-border/45 bg-background/90 px-4 py-3 shadow-sm"
            />
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
