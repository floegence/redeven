// @vitest-environment jsdom
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityPluginSurfacePage } from './ActivityPluginSurfacePage';
import type { PluginSurfaceResolution } from './PluginSurfaceContainer';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

const lifecycle = vi.hoisted(() => ({ opened: vi.fn(), closed: vi.fn() }));
vi.mock('@floegence/floe-webapp-core', () => ({ useViewActivation: () => ({ active: () => true }) }));
vi.mock('./PluginSurfaceFrame', () => ({ PluginSurfaceBody: (props: { target: PluginSurfaceLaunchTarget }) => {
  onMount(() => lifecycle.opened(props.target));
  onCleanup(() => lifecycle.closed());
  return <iframe title="Plugin document" />;
} }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });

it('reuses equivalent targets while retiring only authoritative lease changes', () => {
  const initial = { pluginID: 'example.plugin', pluginInstanceID: 'one', surfaceID: 'main', expectedManagementRevision: 1 };
  const [target, setTarget] = createSignal(initial);
  const [generation, setGeneration] = createSignal(0);
  const [allowed, setAllowed] = createSignal(true);
  const resolveSurface = (): PluginSurfaceResolution => ({ target: allowed() ? target() : null,
    generation: generation(), status: allowed() ? 'ready' : 'permission' });
  const stage = document.createElement('div'); document.body.append(stage);
  dispose = render(() => <ActivityPluginSurfacePage target={target} resolveSurface={resolveSurface}
    coordinator={{} as any} confirmationQueue={{} as any} registerClose={vi.fn()} onRetirementError={vi.fn()} />, stage);
  const first = stage.querySelector('iframe');
  for (let i = 0; i < 5; i++) setTarget({ ...initial });
  expect(stage.querySelector('iframe')).toBe(first);
  expect(lifecycle.opened).toHaveBeenCalledOnce();
  expect(lifecycle.closed).not.toHaveBeenCalled();
  setTarget({ ...initial, expectedManagementRevision: 2 });
  expect(stage.querySelector('iframe')).not.toBe(first);
  expect(lifecycle.opened).toHaveBeenCalledTimes(2);
  setGeneration(1);
  expect(lifecycle.opened).toHaveBeenCalledTimes(3);
  setAllowed(false);
  expect(stage.querySelector('iframe')).toBeNull();
  expect(lifecycle.closed).toHaveBeenCalledTimes(3);
  expect(stage.querySelector('[data-plugin-surface-status]')?.getAttribute('data-plugin-surface-status')).toBe('permission');
});
