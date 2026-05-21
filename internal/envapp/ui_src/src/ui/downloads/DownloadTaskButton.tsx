import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Download, Refresh, X } from '@floegence/floe-webapp-core/icons';

import { Tooltip } from '../primitives/Tooltip';
import { useDownloadManager } from './DownloadContext';
import { DownloadTaskPanel } from './DownloadTaskPanel';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function DownloadTaskButton(props: { tooltip?: string | false }) {
  const manager = useDownloadManager();
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const failedCount = createMemo(() => manager.tasks().filter((task) => task.status === 'failed').length);
  const activeCount = () => manager.activeCount();
  const badgeLabel = createMemo(() => activeCount() > 0 ? String(activeCount()) : failedCount() > 0 ? '!' : '');
  const tooltip = () => compact(props.tooltip) || 'Downloads';

  createEffect(() => {
    if (!open()) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootEl?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    });
  });

  const button = () => (
    <button
      type="button"
      class={`relative inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors duration-150 hover:border-border/70 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        open() ? 'border-border/70 bg-accent text-foreground' : ''
      }`}
      aria-label="Downloads"
      aria-expanded={open()}
      aria-haspopup="dialog"
      onClick={() => setOpen((current) => !current)}
    >
      <Show when={activeCount() > 0} fallback={failedCount() > 0 ? <X class="size-4" /> : <Download class="size-4" />}>
        <Refresh class="size-4 animate-spin" />
      </Show>
      <Show when={badgeLabel()}>
        <span class={`absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4 ${
          failedCount() > 0 && activeCount() === 0
            ? 'bg-destructive text-white'
            : 'bg-primary text-primary-foreground'
        }`}>
          {badgeLabel()}
        </span>
      </Show>
    </button>
  );

  return (
    <div ref={(el) => { rootEl = el; }} class="relative">
      <Show when={props.tooltip !== false} fallback={button()}>
        <Tooltip content={tooltip()} placement="bottom" delay={0}>
          {button()}
        </Tooltip>
      </Show>

      <Show when={open()}>
        <div class="absolute right-0 top-[calc(100%+0.5rem)] z-[80] animate-in fade-in zoom-in-95 duration-150 max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:top-12">
          <DownloadTaskPanel manager={manager} />
        </div>
      </Show>
    </div>
  );
}
