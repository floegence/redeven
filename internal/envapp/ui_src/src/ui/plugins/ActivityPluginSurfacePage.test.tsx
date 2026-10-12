// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityPluginSurfacePage } from './ActivityPluginSurfacePage';
import type { PluginSurfaceInteractionEvent } from './pluginPlatform';

const bridge = vi.hoisted(() => ({ interact: undefined as ((event: PluginSurfaceInteractionEvent) => void) | undefined }));
let active = () => true;
vi.mock('@floegence/floe-webapp-core', () => ({ useViewActivation: () => ({ active: () => active() }) }));
vi.mock('./PluginSurfaceContainer', () => ({
  PluginSurfaceContainer: (props: { onInteraction?: (event: PluginSurfaceInteractionEvent) => void }) => {
    bridge.interact = event => props.onInteraction?.(event);
    return <iframe title="Plugin surface" />;
  },
}));

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); active = () => true; bridge.interact = undefined; });

it('projects trusted user interactions from the active Activity page without treating selection or hidden pages as activation', () => {
  const [visible, setVisible] = createSignal(true);
  active = visible;
  const onInteraction = vi.fn();
  const mount = document.createElement('div');
  document.body.append(mount);
  dispose = render(() => <ActivityPluginSurfacePage
    target={() => ({ pluginID: 'example.plugin', pluginInstanceID: 'instance', surfaceID: 'main', expectedManagementRevision: 1 })}
    coordinator={{} as any} confirmationQueue={{} as any} registerClose={vi.fn()} onRetirementError={vi.fn()}
    onInteraction={onInteraction}
  />, mount);

  for (const kind of ['activation', 'focus', 'action', 'selection'] as const) bridge.interact?.({ kind } as PluginSurfaceInteractionEvent);
  expect(onInteraction.mock.calls.map(([event]) => event.kind)).toEqual(['activation', 'focus', 'action']);
  setVisible(false);
  bridge.interact?.({ kind: 'activation' } as PluginSurfaceInteractionEvent);
  expect(onInteraction).toHaveBeenCalledTimes(3);
  setVisible(true);
  bridge.interact?.({ kind: 'activation' } as PluginSurfaceInteractionEvent);
  expect(onInteraction).toHaveBeenCalledTimes(4);
});
