import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import {
  useRedevenRpc,
  type GitDiffFileContent,
  type GitGetDiffContentRequest,
} from '../protocol/redeven_v1';
import { seedGitDiffContent, type GitSeededCommitFileSummary, type GitSeededWorkspaceChange } from '../utils/gitWorkbench';
import { GitPatchViewer } from './GitPatchViewer';
import { GitStatePane } from './GitWorkbenchPrimitives';

export type GitDiffDialogItem = GitSeededCommitFileSummary | GitSeededWorkspaceChange | GitDiffFileContent;

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
  }
  | {
    kind: 'stash';
    repoRootPath: string;
    stashId: string;
  };

type GitDiffDialogMode = 'patch' | 'full-context';
type GitDiffContentMode = 'preview' | 'full';

const gitDiffModeButtonClass =
  'cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50';

export interface GitDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: GitDiffDialogItem | null | undefined;
  source?: GitDiffDialogSource | null;
  title?: string;
  description?: string;
  emptyMessage: string;
  unavailableMessage?: string | ((item: GitDiffFileContent) => string | undefined);
  class?: string;
}

function buildDiffContentRequest(
  source: GitDiffDialogSource | null | undefined,
  item: GitDiffDialogItem | null | undefined,
  mode: GitDiffContentMode,
): GitGetDiffContentRequest | null {
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
        mode,
        file,
      };
    case 'commit':
      return {
        repoRootPath,
        sourceKind: 'commit',
        commit: String(source.commit ?? '').trim(),
        mode,
        file,
      };
    case 'compare':
      return {
        repoRootPath,
        sourceKind: 'compare',
        baseRef: String(source.baseRef ?? '').trim(),
        targetRef: String(source.targetRef ?? '').trim(),
        mode,
        file,
      };
    case 'stash':
      return {
        repoRootPath,
        sourceKind: 'stash',
        stashId: String(source.stashId ?? '').trim(),
        mode,
        file,
      };
    default:
      return null;
  }
}

function diffRequestKey(req: GitGetDiffContentRequest | null): string {
  if (!req) return '';
  return JSON.stringify(req);
}

export function GitDiffDialog(props: GitDiffDialogProps) {
  const layout = useLayout();
  const rpc = useRedevenRpc();
  const [mode, setMode] = createSignal<GitDiffDialogMode>('patch');
  const [previewItem, setPreviewItem] = createSignal<GitDiffFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal('');
  const [previewLoadedKey, setPreviewLoadedKey] = createSignal('');
  const [fullItem, setFullItem] = createSignal<GitDiffFileContent | null>(null);
  const [fullLoading, setFullLoading] = createSignal(false);
  const [fullError, setFullError] = createSignal('');
  const [fullLoadedKey, setFullLoadedKey] = createSignal('');

  let previewReqSeq = 0;
  let fullReqSeq = 0;

  const previewRequest = createMemo(() => buildDiffContentRequest(props.source, props.item, 'preview'));
  const fullRequest = createMemo(() => buildDiffContentRequest(props.source, props.item, 'full'));
  const previewRequestKey = createMemo(() => diffRequestKey(previewRequest()));
  const fullRequestKey = createMemo(() => diffRequestKey(fullRequest()));
  const canLoadFullContext = createMemo(() => fullRequestKey() !== '');
  const seededPreviewItem = createMemo(() => seedGitDiffContent(props.item));
  const effectivePreviewItem = createMemo(() => previewItem() ?? seededPreviewItem());
  const activeItem = createMemo(() => (mode() === 'full-context' ? fullItem() : effectivePreviewItem()));

  createEffect(on(() => [props.open, previewRequestKey(), fullRequestKey()] as const, () => {
    previewReqSeq += 1;
    fullReqSeq += 1;
    setMode('patch');
    setPreviewItem(seededPreviewItem());
    setPreviewLoading(false);
    setPreviewError('');
    setPreviewLoadedKey(seededPreviewItem() && previewRequestKey() ? previewRequestKey() : '');
    setFullItem(null);
    setFullLoading(false);
    setFullError('');
    setFullLoadedKey('');
  }, { defer: true }));

  createEffect(on(() => [props.open, previewRequest(), previewRequestKey()] as const, ([open, nextRequest, nextRequestKey]) => {
    if (!open || !nextRequest || !nextRequestKey) return;
    if (seededPreviewItem()) return;
    if (previewLoadedKey() === nextRequestKey || previewLoading()) return;

    const seq = ++previewReqSeq;
    setPreviewLoading(true);
    setPreviewError('');

    void rpc.git.getDiffContent(nextRequest).then((resp) => {
      if (seq !== previewReqSeq || previewRequestKey() !== nextRequestKey) return;
      setPreviewItem(resp.file ?? null);
      setPreviewLoadedKey(nextRequestKey);
    }).catch((err) => {
      if (seq !== previewReqSeq || previewRequestKey() !== nextRequestKey) return;
      setPreviewItem(null);
      setPreviewError(err instanceof Error ? err.message : String(err ?? 'Failed to load patch preview.'));
    }).finally(() => {
      if (seq === previewReqSeq) setPreviewLoading(false);
    });
  }, { defer: true }));

  createEffect(on(() => [props.open, mode(), fullRequest(), fullRequestKey()] as const, ([open, nextMode, nextRequest, nextRequestKey]) => {
    if (!open || nextMode !== 'full-context' || !nextRequest || !nextRequestKey) return;
    if (fullLoadedKey() === nextRequestKey || fullLoading()) return;

    const seq = ++fullReqSeq;
    setFullLoading(true);
    setFullError('');

    void rpc.git.getDiffContent(nextRequest).then((resp) => {
      if (seq !== fullReqSeq || fullRequestKey() !== nextRequestKey) return;
      setFullItem(resp.file ?? null);
      setFullLoadedKey(nextRequestKey);
    }).catch((err) => {
      if (seq !== fullReqSeq || fullRequestKey() !== nextRequestKey) return;
      setFullItem(null);
      setFullError(err instanceof Error ? err.message : String(err ?? 'Failed to load full-context diff.'));
    }).finally(() => {
      if (seq === fullReqSeq) setFullLoading(false);
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
              <Match when={mode() === 'full-context' && fullLoading()}>Loading full context...</Match>
              <Match when={mode() === 'full-context' && !fullLoading()}>Includes unchanged lines for broader review context.</Match>
              <Match when={mode() === 'patch' && previewLoading()}>Loading patch preview...</Match>
              <Match when={true}>Loads a single-file patch on demand.</Match>
            </Switch>
          </div>
        </div>

        <div class="relative min-h-0 flex-1">
          <Switch>
            <Match when={mode() === 'patch' && previewError()}>
              <GitStatePane tone="error" message={previewError()} surface class="min-h-0 flex-1" />
            </Match>

            <Match when={mode() === 'full-context' && fullError()}>
              <GitStatePane tone="error" message={fullError()} surface class="min-h-0 flex-1" />
            </Match>

            <Match when={activeItem()}>
              <GitPatchViewer
                class="min-h-0 flex-1"
                item={activeItem()}
                emptyMessage={mode() === 'patch' ? props.emptyMessage : 'Full-context diff is unavailable for this file.'}
                unavailableMessage={props.unavailableMessage}
              />
            </Match>

            <Match when={mode() === 'patch' && previewLoading()}>
              <GitStatePane loading message="Loading patch preview..." surface class="min-h-0 flex-1" />
            </Match>

            <Match when={mode() === 'full-context' && effectivePreviewItem()}>
              <GitPatchViewer
                class="min-h-0 flex-1"
                item={effectivePreviewItem()}
                emptyMessage={props.emptyMessage}
                unavailableMessage={props.unavailableMessage}
              />
            </Match>

            <Match when={mode() === 'full-context' && fullLoading()}>
              <GitStatePane loading message="Loading full-context diff..." surface class="min-h-0 flex-1" />
            </Match>

            <Match when={true}>
              <GitStatePane
                message={mode() === 'patch' ? props.emptyMessage : 'Full-context diff is unavailable for this file.'}
                surface
                class="min-h-0 flex-1"
              />
            </Match>
          </Switch>

          <Show when={mode() === 'full-context' && fullLoading() && effectivePreviewItem()}>
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
