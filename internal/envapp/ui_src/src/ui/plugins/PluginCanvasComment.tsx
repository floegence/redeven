import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { X, ArrowUp, MessageSquare } from 'lucide-solid';
import { useI18n } from '../i18n';

export function PluginCanvasComment(props: {
  open: boolean;
  text: string;
  target?: string;
  selectionKey?: string;
  anchor?: () => { x: number; y: number } | undefined;
  stale: boolean;
  busy: boolean;
  sending: boolean;
  onText: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}): JSX.Element {
  const i18n = useI18n();
  let panel: HTMLElement | undefined;
  let input: HTMLTextAreaElement | undefined;
  let restore: HTMLElement | undefined;
  const [position, setPosition] = createSignal<JSX.CSSProperties>({});
  createEffect(() => {
    if (!props.open) return;
    const selection = props.selectionKey;
    const owner = document.activeElement;
    restore = owner instanceof HTMLElement ? owner : undefined;
    const frame = requestAnimationFrame(() => { if (props.selectionKey === selection) input?.focus({ preventScroll: true }); });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  createEffect(() => {
    if (!props.open) return;
    const anchor = props.anchor?.();
    const place = () => {
      const parent = panel?.offsetParent;
      if (!(parent instanceof HTMLElement) || !panel) return;
      const bounds = parent.getBoundingClientRect();
      const width = panel.offsetWidth, height = panel.offsetHeight, gap = 14;
      const x = anchor ? anchor.x - bounds.left : bounds.width - width - gap;
      const y = anchor ? anchor.y - bounds.top - 14 : 16;
      const preferred = anchor && x + gap + width > bounds.width - 12 ? x - width - gap : x + (anchor ? gap : 0);
      setPosition({ left: `${Math.max(12, Math.min(preferred, bounds.width - width - 12))}px`,
        top: `${Math.max(12, Math.min(y, bounds.height - height - 12))}px` });
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (panel) observer.observe(panel);
    if (panel?.parentElement) observer.observe(panel.parentElement);
    window.addEventListener('resize', schedule);
    onCleanup(() => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); });
  });
  const close = () => { props.onClose(); if (restore?.isConnected) restore.focus({ preventScroll: true }); };
  const sendable = () => Boolean(props.text.trim()) && !props.stale && !props.busy && !props.sending;
  return <Show when={props.open}>
    <section ref={panel} class="plugin-canvas-comment" style={position()} role="dialog" aria-modal="false" aria-label={i18n.t('uiCopy.plugin.creation.comment')}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); close(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing && sendable()) {
          event.preventDefault(); props.onSubmit();
        }
      }}>
      <div class="plugin-canvas-comment-context"><MessageSquare size={12} />
        <span class="plugin-canvas-comment-target" title={props.target}>{props.target || i18n.t('uiCopy.plugin.creation.commentTarget')}</span>
        <button type="button" aria-label={i18n.t('uiCopy.plugin.creation.commentClose')} onClick={close}><X size={14} /></button>
      </div>
      <textarea ref={input} value={props.text} maxLength={4000} rows={3}
        aria-label={i18n.t('uiCopy.plugin.creation.commentPlaceholder')} placeholder={i18n.t('uiCopy.plugin.creation.commentPlaceholder')}
        onInput={event => props.onText(event.currentTarget.value)} />
      <Show when={props.stale || props.busy}><p role="status">{i18n.t(props.stale ? 'uiCopy.plugin.creation.commentStale' : 'uiCopy.plugin.creation.commentBusy')}</p></Show>
      <div class="plugin-canvas-comment-actions"><span>{i18n.t('aiChrome.flowerTitle')} <kbd>{i18n.t('uiCopy.plugin.creation.commentShortcut')}</kbd></span>
        <button type="button" disabled={!sendable()} onClick={props.onSubmit}
          aria-label={i18n.t('uiCopy.plugin.creation.sendComment')} title={i18n.t('uiCopy.plugin.creation.sendComment')}>
          <ArrowUp size={15} />
        </button>
      </div>
    </section>
  </Show>;
}
