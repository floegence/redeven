import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

/** Keep a retained plugin page inside the current Activity or Workbench viewport. */
export function PluginPageViewport(props: {
  host: HTMLElement | undefined;
  content: HTMLElement | null;
  blocked: boolean;
  page: 'center' | 'creation';
  visible?: boolean;
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
      visibility: props.visible !== false && bounds() ? 'visible' : 'hidden' }}
    inert={props.blocked || props.visible === false} aria-hidden={props.blocked || props.visible === false || undefined}
    data-redeven-plugin-creation-page={props.page === 'creation' ? '' : undefined}
    data-redeven-plugin-center-page={props.page === 'center' ? '' : undefined}
    data-page-visible={props.visible !== false}>
    {props.children}
  </div>;
}
