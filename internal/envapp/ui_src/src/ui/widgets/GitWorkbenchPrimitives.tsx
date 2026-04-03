import { For, Show, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { Button, Tag, type TagProps } from '@floegence/floe-webapp-core/ui';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { gitChangeLabel, gitChangeTone, gitToneBadgeClass, gitToneDotClass, gitToneInsetClass, gitToneSurfaceClass, type GitChromeTone } from './GitChrome';

function gitTagVariant(tone?: GitChromeTone): TagProps['variant'] {
  switch (tone) {
    case 'brand':
      return 'primary';
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'danger':
      return 'error';
    case 'info':
    case 'violet':
      return 'info';
    case 'neutral':
    default:
      return 'neutral';
  }
}

export interface GitSectionProps {
  label: string;
  description?: JSX.Element;
  aside?: JSX.Element;
  tone?: GitChromeTone;
  class?: string;
  bodyClass?: string;
  children?: JSX.Element;
}

export function GitSection(props: GitSectionProps) {
  return (
    <section class={cn('rounded-md border px-3 py-2.5', redevenSurfaceRoleClass('panelStrong'), gitToneSurfaceClass(props.tone), props.class)}>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-3 sm:gap-y-1.5">
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2">
            <span class={cn('h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.04)]', gitToneDotClass(props.tone))} aria-hidden="true" />
            <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">{props.label}</div>
          </div>
          <Show when={props.description}>
            <div class="pl-0 text-xs leading-relaxed text-muted-foreground sm:pl-4">{props.description}</div>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="flex max-w-full flex-wrap items-center gap-1.5 text-[10px] font-medium leading-5 text-muted-foreground sm:min-w-fit sm:justify-end sm:text-right">{props.aside}</div>
        </Show>
      </div>

      <Show when={props.children}>
        <div class={cn('mt-2.5 pl-0 sm:pl-4', props.bodyClass)}>{props.children}</div>
      </Show>
    </section>
  );
}

export interface GitLabelBlockProps {
  label: string;
  tone?: GitChromeTone;
  meta?: JSX.Element;
  class?: string;
  bodyClass?: string;
  children?: JSX.Element;
}

export function GitLabelBlock(props: GitLabelBlockProps) {
  return (
    <div class={cn('space-y-1', props.class)}>
      <div class="flex flex-wrap items-center gap-2">
        <span class={cn('h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.04)]', gitToneDotClass(props.tone))} aria-hidden="true" />
        <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">{props.label}</div>
        <Show when={props.meta}>
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">{props.meta}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class={cn('space-y-1 pl-0 sm:pl-4', props.bodyClass)}>{props.children}</div>
      </Show>
    </div>
  );
}

const GIT_PANEL_FRAME_CLASS = cn(
  'rounded-md border px-3 py-2.5 shadow-sm shadow-black/[0.05] ring-1 ring-black/[0.02]',
  redevenSurfaceRoleClass('panelStrong'),
);

const GIT_TABLE_FRAME_CLASS = cn(
  'overflow-hidden rounded-md border',
  redevenSurfaceRoleClass('panelStrong'),
);

export interface GitPanelFrameProps {
  as?: 'div' | 'section';
  class?: string;
  children?: JSX.Element;
}

export function GitPanelFrame(props: GitPanelFrameProps) {
  return (
    <Dynamic component={props.as ?? 'div'} class={cn(GIT_PANEL_FRAME_CLASS, props.class)}>
      {props.children}
    </Dynamic>
  );
}

export interface GitTableFrameProps {
  class?: string;
  children?: JSX.Element;
}

export function GitTableFrame(props: GitTableFrameProps) {
  return <div class={cn(GIT_TABLE_FRAME_CLASS, props.class)}>{props.children}</div>;
}

export interface GitStatItem {
  label: string;
  value: JSX.Element;
  hint?: JSX.Element;
}

export interface GitStatStripProps {
  items: GitStatItem[];
  columnsClass?: string;
  class?: string;
}

export function GitStatStrip(props: GitStatStripProps) {
  return (
    <div class={cn('grid gap-1 rounded-md bg-muted/[0.12] p-1 text-[11px]', props.columnsClass || 'grid-cols-2 lg:grid-cols-4', props.class)}>
      <For each={props.items}>
        {(item) => (
          <div class={cn('rounded-md border px-2.5 py-2 transition-shadow duration-150 hover:shadow-sm', redevenSurfaceRoleClass('inset'))}>
            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{item.label}</div>
            <div class="mt-1 text-xs font-semibold tracking-tight text-foreground">{item.value}</div>
            <Show when={item.hint}>
              <div class="mt-1 text-[10px] text-muted-foreground">{item.hint}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

export interface GitSubtleNoteProps {
  class?: string;
  children: JSX.Element;
}

export function GitSubtleNote(props: GitSubtleNoteProps) {
  return <div class={cn('rounded-md border px-2.5 py-2 text-xs leading-relaxed text-muted-foreground', redevenSurfaceRoleClass('inset'), props.class)}>{props.children}</div>;
}

export interface GitPagedTableFooterProps {
  summary: JSX.Element;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  buttonLabel?: string;
  loadingLabel?: string;
  loadingStatus?: JSX.Element;
  class?: string;
}

export function GitPagedTableFooter(props: GitPagedTableFooterProps) {
  const loading = () => Boolean(props.loading);
  const buttonLabel = () => (loading() ? (props.loadingLabel ?? 'Loading more...') : (props.buttonLabel ?? 'Load more'));
  const loadingStatus = () => (loading() ? (props.loadingStatus ?? 'Loading next page') : '');

  return (
    <div
      class={cn(
        'grid grid-cols-1 gap-2 border-t px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-2 sm:gap-y-2',
        redevenDividerRoleClass(),
        redevenSurfaceRoleClass('inset'),
        props.class,
      )}
    >
      <div class="min-w-0 justify-self-start">
        <Show when={loadingStatus()}>
          {(status) => (
            <div
              aria-live="polite"
              class={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium leading-none tracking-[0.02em] text-muted-foreground shadow-sm shadow-black/5', redevenSurfaceRoleClass('controlMuted'))}
            >
              <span class="inline-grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden text-primary/80">
                <SnakeLoader size="sm" class="h-4 w-4 shrink-0 origin-center scale-[0.68]" />
              </span>
              <span class="truncate">{status()}</span>
            </div>
          )}
        </Show>
      </div>

      <div class="justify-self-stretch sm:justify-self-center">
        <Button
          size="sm"
          variant="outline"
          class={cn('w-full rounded-full px-3 text-[11px] font-medium shadow-sm shadow-black/5 transition-[box-shadow,background-color,border-color] duration-150 hover:bg-accent/60 hover:shadow-md sm:min-w-[8.75rem] sm:w-auto', redevenSurfaceRoleClass('control'))}
          onClick={() => props.onLoadMore?.()}
          loading={loading()}
          disabled={!props.hasMore || loading()}
        >
          {buttonLabel()}
        </Button>
      </div>

      <div class="min-w-0 justify-self-stretch sm:justify-self-end">
        <GitSubtleNote class={cn('w-full px-2 py-1 text-[10px] leading-4 shadow-sm shadow-black/5 sm:max-w-full', redevenSurfaceRoleClass('controlMuted'))}>
          {props.summary}
        </GitSubtleNote>
      </div>
    </div>
  );
}

export interface GitChecklistItemProps {
  index?: JSX.Element;
  title: JSX.Element;
  detail?: JSX.Element;
  tone?: GitChromeTone;
  complete?: boolean;
  required?: boolean;
  class?: string;
  bodyClass?: string;
  children?: JSX.Element;
}

export function GitChecklistItem(props: GitChecklistItemProps) {
  const statusTone = () => (props.complete ? 'success' : props.tone ?? 'neutral');
  const statusLabel = () => {
    if (props.complete) return 'Ready';
    if (props.required === false) return 'Optional';
    return 'Required';
  };

  return (
    <div class={cn('rounded-md px-3 py-3', gitToneInsetClass(statusTone()), props.class)}>
      <div class="flex items-start gap-3">
        <div class={cn('mt-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold', gitToneBadgeClass(statusTone()))}>
          {props.index ?? '•'}
        </div>

        <div class="min-w-0 flex-1 space-y-2">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-xs font-semibold text-foreground">{props.title}</div>
              <GitMetaPill tone={statusTone()}>{statusLabel()}</GitMetaPill>
            </div>
            <Show when={props.detail}>
              <div class="text-[11px] leading-relaxed text-muted-foreground">{props.detail}</div>
            </Show>
          </div>

          <Show when={props.children}>
            <div class={cn('space-y-2', props.bodyClass)}>{props.children}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export interface GitStatePaneProps {
  message: JSX.Element;
  detail?: JSX.Element;
  loading?: boolean;
  tone?: 'muted' | 'error';
  surface?: boolean;
  class?: string;
  contentClass?: string;
}

export function GitStatePane(props: GitStatePaneProps) {
  const tone = () => props.tone ?? 'muted';
  const surfaceClass = () => {
    if (!props.surface) return '';
    if (tone() === 'error') return 'rounded-md border border-error/20 bg-error/5';
    return cn('rounded-md border', redevenSurfaceRoleClass('inset'));
  };

  return (
    <div
      class={cn(
        'flex w-full min-h-0 flex-1 items-center justify-center px-3 py-4 text-center',
        surfaceClass(),
        props.class,
      )}
    >
      <div class={cn('flex max-w-sm flex-col items-center justify-center gap-2', props.contentClass)}>
        <Show when={props.loading}>
          <SnakeLoader size="sm" class={cn('shrink-0', tone() === 'error' ? 'text-error' : 'text-muted-foreground')} />
        </Show>
        <div class={cn('text-xs leading-relaxed break-words', tone() === 'error' ? 'text-error' : 'text-muted-foreground')}>
          {props.message}
        </div>
        <Show when={props.detail}>
          <div class={cn('text-[11px] leading-relaxed break-words', tone() === 'error' ? 'text-error/90' : 'text-muted-foreground/80')}>
            {props.detail}
          </div>
        </Show>
      </div>
    </div>
  );
}

export const GIT_CHANGED_FILES_TABLE_CLASS = 'w-full text-[11px] leading-4';
export const GIT_CHANGED_FILES_HEAD_CLASS = 'sticky top-0 z-10 bg-muted/30 backdrop-blur';
export const GIT_CHANGED_FILES_HEADER_ROW_CLASS = cn('border-b text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground', redevenDividerRoleClass('strong'));
export const GIT_CHANGED_FILES_HEADER_CELL_CLASS = 'px-2.5 py-1 font-medium';
export const GIT_CHANGED_FILES_CELL_CLASS = 'px-2.5 py-1 align-top';
export const GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS = cn('sticky right-0 z-20 border-l bg-muted/30 px-2.5 py-1 text-right font-medium', redevenDividerRoleClass());
export const GIT_CHANGED_FILES_SECONDARY_PATH_CLASS = 'mt-px truncate text-[10px] leading-3.5 text-muted-foreground';
export const GIT_CHANGED_FILES_ACTION_BUTTON_CLASS = 'inline-flex cursor-pointer items-center whitespace-nowrap text-[11px] font-medium text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-45';

export function gitChangedFilesRowClass(active: boolean): string {
  return active
    ? cn('group border-b bg-muted/40 last:border-b-0', redevenDividerRoleClass())
    : cn('group border-b bg-transparent hover:bg-muted/20 last:border-b-0', redevenDividerRoleClass());
}

export function gitChangedFilesStickyCellClass(active: boolean): string {
  return active
    ? cn('sticky right-0 z-10 border-l bg-muted/40 px-2.5 py-1 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)]', redevenDividerRoleClass())
    : cn('sticky right-0 z-10 border-l px-2.5 py-1 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)] group-hover:bg-muted/20', redevenDividerRoleClass(), redevenSurfaceRoleClass('panel'));
}

export interface GitMetaPillProps {
  tone?: GitChromeTone;
  children: JSX.Element;
  class?: string;
}

export function GitMetaPill(props: GitMetaPillProps) {
  return (
    <Tag variant={gitTagVariant(props.tone)} tone="soft" size="sm" class={cn('max-w-full align-middle', props.class)}>
      {props.children}
    </Tag>
  );
}

export interface GitChangeStatusPillProps {
  change?: string | null;
  class?: string;
}

export function GitChangeStatusPill(props: GitChangeStatusPillProps) {
  return (
    <GitMetaPill tone={gitChangeTone(props.change ?? undefined)} class={cn('whitespace-nowrap', props.class)}>
      {gitChangeLabel(props.change ?? undefined)}
    </GitMetaPill>
  );
}

export interface GitChangedFilesActionButtonProps {
  children: JSX.Element;
  class?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  busy?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

export function GitChangedFilesActionButton(props: GitChangedFilesActionButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      disabled={Boolean(props.disabled || props.busy)}
      aria-busy={props.busy || undefined}
      class={cn(GIT_CHANGED_FILES_ACTION_BUTTON_CLASS, props.class)}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export type GitShortcutOrbTone = 'flower' | 'terminal' | 'files';

export interface GitShortcutOrbButtonProps {
  label: string;
  tone: GitShortcutOrbTone;
  icon: Component<{ class?: string }>;
  class?: string;
  iconClass?: string;
  disabled?: boolean;
  disabledReason?: string;
  type?: 'button' | 'submit' | 'reset';
  size?: 'sm' | 'md';
  title?: string;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

function gitShortcutOrbShellClass(): string {
  return cn(
    'shadow-sm text-slate-900 dark:text-slate-50',
    redevenSurfaceRoleClass('control'),
    'hover:bg-slate-300 dark:hover:bg-slate-600',
  );
}

function gitShortcutOrbIconClass(tone: GitShortcutOrbTone): string {
  switch (tone) {
    case 'flower':
      return 'text-orange-700 dark:text-orange-200';
    case 'terminal':
      return 'text-sky-700 dark:text-sky-200';
    case 'files':
    default:
      return 'text-emerald-700 dark:text-emerald-200';
  }
}

export function GitShortcutOrbButton(props: GitShortcutOrbButtonProps) {
  const Icon = props.icon;
  const size = () => props.size ?? 'sm';
  const disabledReason = () => String(props.disabledReason ?? '').trim();

  const renderButton = () => (
    <button
      type={props.type ?? 'button'}
      data-git-shortcut-orb={props.tone}
      data-git-shortcut-size={size()}
      title={props.title ?? props.label}
      aria-label={props.label}
      disabled={Boolean(props.disabled)}
      class={cn(
        'group relative inline-flex cursor-pointer items-center justify-center rounded-full align-middle transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45',
        size() === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        props.class,
      )}
      onClick={props.onClick}
    >
      <span
        class={cn(
          'relative flex items-center justify-center rounded-full border shadow-sm transition-colors duration-150',
          size() === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          gitShortcutOrbShellClass(),
        )}
      >
        <Icon
          class={cn(
            'relative z-[1]',
            gitShortcutOrbIconClass(props.tone),
            props.tone === 'flower'
              ? (size() === 'sm' ? 'h-4 w-4' : 'h-[1.125rem] w-[1.125rem]')
              : (size() === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'),
            props.iconClass,
          )}
        />
      </span>
    </button>
  );

  return (
    <Show when={Boolean(props.disabled) && disabledReason()} fallback={renderButton()}>
      <Tooltip content={disabledReason()} placement="top" delay={0}>
        <span
          class={cn(
            'inline-flex cursor-not-allowed',
            size() === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          )}
        >
          {renderButton()}
        </span>
      </Tooltip>
    </Show>
  );
}

export interface GitShortcutOrbDockProps {
  class?: string;
  children: JSX.Element;
}

export function GitShortcutOrbDock(props: GitShortcutOrbDockProps) {
  return (
    <div
      data-git-shortcut-dock
      class={cn('inline-flex max-w-full flex-wrap items-center gap-1.5', props.class)}
    >
      {props.children}
    </div>
  );
}

export interface GitPrimaryTitleProps {
  class?: string;
  children: JSX.Element;
}

export function GitPrimaryTitle(props: GitPrimaryTitleProps) {
  return <div class={cn('break-words text-[13px] font-bold leading-5 tracking-tight text-foreground', props.class)}>{props.children}</div>;
}

export interface GitChangeMetricsProps {
  additions?: number | null;
  deletions?: number | null;
  class?: string;
}

export function GitChangeMetrics(props: GitChangeMetricsProps) {
  const additions = Number(props.additions ?? 0);
  const deletions = Number(props.deletions ?? 0);

  return (
    <span class={cn('inline-flex items-center gap-1.5 font-medium tabular-nums', props.class)}>
      <span class="text-success">+{additions}</span>
      <span class="text-muted-foreground/65">/</span>
      <span class="text-error">-{deletions}</span>
    </span>
  );
}
