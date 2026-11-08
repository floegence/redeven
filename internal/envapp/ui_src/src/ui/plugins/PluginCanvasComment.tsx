import { Show, createEffect, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { createFloatingPresence } from '@floegence/floe-webapp-core/ui';
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
  const [panel, setPanel] = createSignal<HTMLElement>();
  let input: HTMLTextAreaElement | undefined;
  let restore: HTMLElement | undefined;
  const [position, setPosition] = createSignal<JSX.CSSProperties>();
  const presence = createFloatingPresence({ open: () => props.open, element: panel });
  createEffect(() => {
    if (!presence.mounted()) { setPosition(undefined); return; }
    const element = panel();
    if (!props.open || !element) return;
    const selection = props.selectionKey;
    // A stale selection must not relocate a comment while the user is typing.
    const anchor = untrack(() => props.anchor?.());
    const owner = document.activeElement;
    if (owner instanceof HTMLElement && !element.contains(owner)) restore = owner;
    const place = () => {
      const parent = element.offsetParent;
      if (!(parent instanceof HTMLElement)) return;
      const bounds = parent.getBoundingClientRect();
      const width = element.offsetWidth, height = element.offsetHeight, gap = 14;
      const x = anchor ? anchor.x - bounds.left : bounds.width - width - gap;
      const y = anchor ? anchor.y - bounds.top - 14 : 16;
      const preferred = anchor && x + gap + width > bounds.width - 12 ? x - width - gap : x + (anchor ? gap : 0);
      setPosition({ left: `${Math.max(12, Math.min(preferred, bounds.width - width - 12))}px`,
        top: `${Math.max(12, Math.min(y, bounds.height - height - 12))}px` });
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    // Measure layout dimensions before the shared presence reveals the panel.
    place();
    const focusFrame = requestAnimationFrame(() => {
      if (props.open && props.selectionKey === selection) input?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', schedule);
    onCleanup(() => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); observer.disconnect(); window.removeEventListener('resize', schedule); });
  });
  const close = () => { props.onClose(); if (restore?.isConnected) restore.focus({ preventScroll: true }); };
  const sendable = () => Boolean(props.text.trim()) && !props.stale && !props.busy && !props.sending;
  return <Show when={presence.mounted()}>
    <section ref={setPanel} class="plugin-canvas-comment floe-floating-presence floe-floating-menu"
      data-floating-presence={position() ? presence.state() : 'entering'}
      style={{ ...position(), visibility: position() ? undefined : 'hidden' }}
      inert={!props.open} aria-hidden={!props.open || undefined}
      role="dialog" aria-modal="false" aria-label={i18n.t('uiCopy.plugin.creation.comment')}
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
      <Show when={props.stale}><p role="status">{i18n.t('uiCopy.plugin.creation.commentStale')}</p></Show>
      <div class="plugin-canvas-comment-actions"><span>{i18n.t('aiChrome.flowerTitle')} <kbd>{i18n.t('uiCopy.plugin.creation.commentShortcut')}</kbd></span>
        <button type="button" disabled={!sendable()} onClick={props.onSubmit}
          aria-busy={props.sending} aria-label={i18n.t('uiCopy.plugin.creation.sendComment')}
          title={i18n.t(props.busy ? 'uiCopy.plugin.creation.commentBusy' : 'uiCopy.plugin.creation.sendComment')}>
          <ArrowUp size={15} />
        </button>
      </div>
    </section>
  </Show>;
}
