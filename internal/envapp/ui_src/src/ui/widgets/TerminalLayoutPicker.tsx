import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { Button, Popover } from '@floegence/floe-webapp-core/ui';
import { Grid } from '@floegence/floe-webapp-core/icons';
import { measureSplitWorkspace, type SplitWorkspaceArrangement, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { useI18n } from '../i18n';
import { TerminalLayoutPreview } from './TerminalLayoutPreview';
import './terminal-workspace.css';

function geometry(layout: SplitWorkspaceLayout) {
  return JSON.stringify([...measureSplitWorkspace(layout).panes.values()]
    .map(rect => [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 1000))).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
}

export function TerminalLayoutPicker(props: {
  layout: SplitWorkspaceLayout | null;
  choices: readonly SplitWorkspaceArrangement[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  label?: string;
  viewId?: string;
  compact?: boolean;
}) {
  const i18n = useI18n();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const choices = createMemo(() => props.choices);
  const disabled = () => props.disabled || !choices().length;
  const selectedGeometry = createMemo(() => props.layout ? geometry(props.layout) : '');
  const label = () => props.label ?? i18n.t('terminalWorkspace.adjustLayout');
  const names = () => ({
    rows: i18n.t('terminalWorkspace.arrangementRows'), columns: i18n.t('terminalWorkspace.arrangementColumns'),
    grid: i18n.t('terminalWorkspace.grid'), 'main-left': i18n.t('terminalWorkspace.mainLeft'),
    'main-right': i18n.t('terminalWorkspace.mainRight'), 'main-top': i18n.t('terminalWorkspace.mainTop'), 'main-bottom': i18n.t('terminalWorkspace.mainBottom'),
  });
  createEffect(() => { if (disabled()) setOpen(false); });
  const close = () => { setOpen(false); trigger?.focus({ preventScroll: true }); };
  const Gallery = () => {
    let grid: HTMLDivElement | undefined;
    onMount(() => queueMicrotask(() => { if (open()) (grid?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? grid?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }); }));
    return <div class="terminal-layout-gallery" data-terminal-layout-gallery={props.viewId ?? 'current'}>
      <div class="terminal-layout-heading">{i18n.t('terminalWorkspace.adjustLayout')}</div>
      <div ref={grid} class="terminal-layout-options" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 4 : event.key === 'ArrowUp' ? -4 : 0;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : offset ? Math.max(0, Math.min(buttons.length - 1, index + offset)) : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
        <For each={choices().map(choice => choice.id)}>{(id, index) => { const choice = () => choices().find(item => item.id === id)!; return <button type="button" class="terminal-layout-option" data-terminal-layout-option={id}
          aria-label={i18n.t('terminalWorkspace.arrangementChoice', { name: names()[choice().kind], index: index() + 1 })}
          aria-pressed={geometry(choice().layout) === selectedGeometry()}
          onClick={() => { if (geometry(choice().layout) !== selectedGeometry()) props.onSelect(id); close(); }}>
          <TerminalLayoutPreview layout={choice().layout} />
        </button>; }}</For>
      </div>
    </div>;
  };
  return <Popover open={open()} onOpenChange={next => { if (!disabled()) setOpen(next); }} placement="bottom-end" ariaLabel={label()} class="terminal-layout-popover"
    trigger={binding => <Button {...binding} ref={trigger} size="sm" variant="ghost" class={props.compact ? 'terminal-view-layout-action' : 'terminal-layout-trigger'}
      data-testid={props.viewId ? undefined : 'terminal-workspace-layout'} data-terminal-view-layout={props.viewId}
      aria-label={label()} title={label()} disabled={disabled()}>
      <Show when={props.layout} fallback={<Grid class="h-3.5 w-3.5" />}>{layout => <TerminalLayoutPreview layout={layout()} />}</Show>
    </Button>}>
    <Show when={open()}><Gallery /></Show>
  </Popover>;
}
