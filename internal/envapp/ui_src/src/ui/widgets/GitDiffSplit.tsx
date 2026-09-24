import '../../styles/git-review.css';
import { createContext, createEffect, createSignal, on, Show, useContext, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useI18n } from '../i18n';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitContentSkeleton } from './GitWorkbenchPrimitives';

export interface GitDiffNavigation { openDetail: () => void; showFiles: () => void }
const GitDiffNavigationContext = createContext<GitDiffNavigation>();
export const useGitDiffNavigation = () => useContext(GitDiffNavigationContext);

/** Retain both views while narrow surfaces show one navigation step at a time. */
export function GitDiffSplit(props: { children: JSX.Element; detail: JSX.Element; filesHeader?: JSX.Element; loading?: boolean; resetKey?: string; ref?: (navigation: GitDiffNavigation) => void; class?: string }) {
  const i18n = useI18n();
  const [pane, setPane] = createSignal<'files' | 'detail'>('files');
  let root: HTMLDivElement | undefined;
  createEffect(on(() => props.resetKey, () => setPane('files')));
  const navigation = {
    openDetail: () => {
      setPane('detail');
      queueMicrotask(() => {
        const back = root?.querySelector<HTMLButtonElement>('[data-git-diff-back]');
        if (back?.getClientRects().length) back.focus({ preventScroll: true });
      });
    },
    showFiles: () => {
      setPane('files');
      queueMicrotask(() => {
        const row = root?.querySelector<HTMLElement>('[aria-selected="true"]');
        const target = row?.matches('button') ? row : row?.querySelector<HTMLButtonElement>('td:first-child button');
        target?.focus({ preventScroll: true });
      });
    },
  };
  props.ref?.(navigation);
  const navigateFiles: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[aria-selected]');
    if (!row || !event.currentTarget.contains(row)) return;
    const fileButton = row.matches('button') ? row : row.querySelector<HTMLButtonElement>('td:first-child button');
    if (target !== row && target !== fileButton) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[aria-selected]'));
    const index = rows.indexOf(row);
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      if (target !== row || row.matches('button')) return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    const nextRow = rows[next];
    const nextButton = nextRow?.matches('button') ? nextRow : nextRow?.querySelector<HTMLButtonElement>('td:first-child button');
    nextButton?.focus({ preventScroll: true });
    nextButton?.click();
    nextRow?.scrollIntoView?.({ block: 'nearest' });
  };
  return (
    <GitDiffNavigationContext.Provider value={navigation}>
      <div ref={root} data-git-diff-split class={cn('git-diff-split rounded-md border', redevenSurfaceRoleClass('panel'), redevenDividerRoleClass(), props.class)}>
        <div class="git-diff-split__layout" data-mobile-pane={pane()}>
          <div class="git-diff-split__files" onKeyDown={navigateFiles}>
            <div class="git-diff-split__files-header">{props.filesHeader ?? i18n.t('uiCopy.git.changedFiles')}</div>
            <Show when={!props.loading} fallback={<GitContentSkeleton variant="file-rail" rows={8} label={i18n.t('uiCopy.git.loadingChangedFiles')} />}>
              {props.children}
            </Show>
          </div>
          <div class="git-diff-split__detail">{props.detail}</div>
        </div>
      </div>
    </GitDiffNavigationContext.Provider>
  );
}
