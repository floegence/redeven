import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { flowerToolGlyphs } from './flowerToolGlyphs';
import { flowerToolMotion, type FlowerToolMotionRecipe } from './flowerToolMotion';

const AnimatedGlyph: Component<{ recipe: FlowerToolMotionRecipe; running: boolean }> = (props) => {
  let host!: HTMLSpanElement;
  const [mounted, setMounted] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  const groups: { node: SVGGElement; track: FlowerToolMotionRecipe['tracks'][number] }[] = [];
  let animations: Animation[] = [];
  const stop = () => {
    animations.forEach(animation => animation.cancel());
    animations = [];
    groups.forEach(({ node, track }) => {
      for (const property of Object.keys(track.base ?? {})) node.style.removeProperty(property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`));
    });
  };
  onMount(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    onCleanup(() => preference.removeEventListener('change', update));
    const svg = host.querySelector('svg');
    if (!svg) return;
    const parts = Array.from(svg.children);
    for (const track of props.recipe.tracks) {
      const indices = track.parts === 'all' ? parts.map((_, index) => index) : track.parts;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.style.transformBox = track.box || 'view-box';
      group.style.transformOrigin = track.origin || '12px 12px';
      svg.insertBefore(group, parts[Math.min(...indices)]);
      for (const index of indices) {
        if (track.normalize) parts[index].setAttribute('pathLength', '1');
        group.append(parts[index]);
      }
      groups.push({ node: group, track });
    }
    setMounted(true);
  });
  createEffect(() => {
    stop();
    if (!mounted() || !props.running || reduced()) return;
    for (const { node, track } of groups) {
      Object.assign(node.style, track.base ?? {});
      const animation = node.animate(track.keyframes, {
        duration: track.duration ?? props.recipe.cycle,
        delay: track.delay ?? 0,
        iterations: Infinity,
        easing: track.easing ?? 'linear',
        fill: 'both',
      });
      void animation.finished.catch(() => undefined);
      animations.push(animation);
    }
  });
  onCleanup(stop);
  return <span ref={host} class="flower-tool-icon" aria-hidden="true">
    <Dynamic component={flowerToolGlyphs[props.recipe.icon]} size={16} strokeWidth={1.7} />
  </span>;
};

const webOperationMotion: Readonly<Record<string, FlowerToolMotionRecipe>> = {
  open_page: {icon:'book-open-text', cycle:2400, tracks:[{parts:'all', keyframes:[{opacity:0.5}, {opacity:1}, {opacity:0.5}]}]},
  find_in_page: {icon:'text-search', cycle:2400, tracks:[{parts:'all', keyframes:[{opacity:0.5}, {opacity:1}, {opacity:0.5}]}]},
};

export const FlowerToolIcon: Component<{ toolName?: string; source?: string; webOperation?: string; running: boolean }> = (props) => {
  const runningCommand = () => props.running && (props.toolName === 'terminal.exec' || props.toolName === 'terminal.read');
  const recipe = createMemo(() => (props.webOperation ? webOperationMotion[props.webOperation] ?? flowerToolMotion.web_search : undefined) ?? flowerToolMotion[props.toolName ?? '']
    ?? flowerToolMotion[props.source === 'mcp' || props.toolName?.startsWith('mcp_') ? 'mcp' : 'unknown']);
  return <Show when={runningCommand()} fallback={
    <Show when={recipe()} keyed>{value => <AnimatedGlyph recipe={value} running={props.running} />}</Show>
  }>
    <span class="flower-activity-inline-loader" aria-hidden="true">
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
      <span class="flower-activity-inline-loader-square" />
    </span>
  </Show>;
};
