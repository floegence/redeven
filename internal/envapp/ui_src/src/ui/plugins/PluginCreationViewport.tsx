import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

/** Keep one live creation container while Activity and Workbench change geometry. */
export function PluginCreationViewport(props: {
  host: HTMLElement | undefined;
  content: HTMLElement | null;
  blocked: boolean;
  children: JSX.Element;
}) {
  const [bounds, setBounds] = createSignal<{ left: number; top: number; width: number; height: number }>();
  createEffect(() => {
    setBounds(undefined);
    const parent = props.host, content = props.content;
    if (!parent || !content) return;
    const measure = () => {
      const outer = parent.getBoundingClientRect(), inner = content.getBoundingClientRect();
      if (!outer.width || !outer.height || !inner.width || !inner.height) return;
      const scaleX = outer.width / parent.offsetWidth, scaleY = outer.height / parent.offsetHeight;
      setBounds({ left: (inner.left - outer.left) / scaleX, top: (inner.top - outer.top) / scaleY,
        width: inner.width / scaleX, height: inner.height / scaleY });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(parent); observer.observe(content);
    window.addEventListener('resize', measure);
    measure();
    const frame = requestAnimationFrame(measure);
    onCleanup(() => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); });
  });
  return <div class="absolute z-10 overflow-hidden bg-background"
    style={{ left: `${bounds()?.left ?? 0}px`, top: `${bounds()?.top ?? 0}px`,
      width: `${bounds()?.width ?? 0}px`, height: `${bounds()?.height ?? 0}px`,
      visibility: bounds() ? 'visible' : 'hidden' }}
    inert={props.blocked} aria-hidden={props.blocked || undefined} data-redeven-plugin-creation-page>
    {props.children}
  </div>;
}
