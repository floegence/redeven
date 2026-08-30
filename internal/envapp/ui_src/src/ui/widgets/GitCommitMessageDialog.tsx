import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Calendar, Copy, Hash, User } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import type { GitCommitDetail } from '../protocol/redeven_v1';
import { Dialog } from '../primitives/EnvAppModal';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export interface GitCommitMessageDialogProps {
  open: boolean;
  commit: GitCommitDetail | null | undefined;
  onOpenChange: (open: boolean) => void;
  onCopyText?: (value: string) => void;
}

export function normalizedGitCommitBody(
  commit: Pick<GitCommitDetail, 'subject' | 'body'> | null | undefined,
): string {
  const body = String(commit?.body ?? '').trim();
  if (!body) return '';
  const subject = String(commit?.subject ?? '').trim();
  if (!subject) return body;
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== subject) return body;
  return lines.slice(1).join('\n').trim();
}

function formatCommitTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleString();
}

export function GitCommitMessageDialog(props: GitCommitMessageDialogProps) {
  const i18n = useI18n();
  const subject = () => String(props.commit?.subject ?? '').trim() || i18n.t('uiCopy.git.noSubject');
  const body = () => normalizedGitCommitBody(props.commit);
  const author = () => String(props.commit?.authorName ?? '').trim() || i18n.t('uiCopy.git.unknownAuthor');
  const authorEmail = () => String(props.commit?.authorEmail ?? '').trim();
  const hash = () => String(props.commit?.hash ?? '').trim();

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={i18n.t('uiCopy.git.fullCommitMessage')}
      description={i18n.t('uiCopy.git.fullCommitMessageDescription')}
      class="w-[min(44rem,92vw)] border border-border/60 shadow-xl"
      footer={(
        <div class="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            class={redevenSurfaceRoleClass('control')}
            onClick={() => props.onOpenChange(false)}
          >
            {i18n.t('common.actions.close')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-4" data-git-commit-message-dialog>
        <section class={cn('rounded-md border p-4', redevenSurfaceRoleClass('panel'))}>
          <div class="text-[15px] font-semibold leading-6 text-foreground break-words">
            {subject()}
          </div>
          <Show
            when={body()}
            fallback={(
              <div class="mt-3 text-xs italic text-muted-foreground">
                {i18n.t('uiCopy.git.noCommitBody')}
              </div>
            )}
          >
            {(message) => (
              <div class="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90">
                {message()}
              </div>
            )}
          </Show>
        </section>

        <dl class="grid gap-2 sm:grid-cols-2">
          <div class={cn('rounded-md px-3 py-2.5', redevenSurfaceRoleClass('inset'))}>
            <dt class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <User class="h-3 w-3" />
              {i18n.t('uiCopy.git.author')}
            </dt>
            <dd class="mt-1 min-w-0 text-xs text-foreground">
              <div class="truncate font-medium" title={author()}>{author()}</div>
              <Show when={authorEmail()}>
                <div class="mt-0.5 truncate text-[11px] text-muted-foreground" title={authorEmail()}>{authorEmail()}</div>
              </Show>
            </dd>
          </div>
          <div class={cn('rounded-md px-3 py-2.5', redevenSurfaceRoleClass('inset'))}>
            <dt class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <Calendar class="h-3 w-3" />
              {i18n.t('debugConsole.fields.when')}
            </dt>
            <dd class="mt-1 text-xs font-medium text-foreground">
              {formatCommitTime(props.commit?.authorTimeMs)}
            </dd>
          </div>
          <div class={cn('rounded-md px-3 py-2.5 sm:col-span-2', redevenSurfaceRoleClass('inset'))}>
            <dt class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <Hash class="h-3 w-3" />
              {i18n.t('git.common.commit')}
            </dt>
            <dd class="mt-1 flex min-w-0 items-center justify-between gap-2">
              <code class="min-w-0 break-all text-[11px] text-foreground">{hash()}</code>
              <Show when={props.onCopyText && hash()}>
                <Button
                  size="xs"
                  variant="ghost"
                  class="shrink-0"
                  aria-label={i18n.t('git.contextMenu.copyCommitHash')}
                  title={i18n.t('git.contextMenu.copyCommitHash')}
                  onClick={() => props.onCopyText?.(hash())}
                >
                  <Copy class="h-3.5 w-3.5" />
                </Button>
              </Show>
            </dd>
          </div>
        </dl>
      </div>
    </Dialog>
  );
}
