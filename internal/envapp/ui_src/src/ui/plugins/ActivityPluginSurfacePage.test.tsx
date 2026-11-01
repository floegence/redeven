// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityPluginSurfacePage } from './ActivityPluginSurfacePage';
import type { PluginSurfaceInteractionEvent } from './pluginPlatform';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

const bridge = vi.hoisted(() => ({ interact: undefined as ((event: PluginSurfaceInteractionEvent) => void) | undefined }));
let active = () => true;
vi.mock('@floegence/floe-webapp-core', () => ({ useViewActivation: () => ({ active: () => active() }) }));
vi.mock('./PluginSurfaceContainer', () => ({
  PluginSurfaceContainer: (props: { target: PluginSurfaceLaunchTarget; visible: boolean; onInteraction?: (event: PluginSurfaceInteractionEvent) => void }) => {
    bridge.interact = event => props.onInteraction?.(event);
    return <div data-visible={String(props.visible)} data-revision={props.target.expectedManagementRevision}>
      <iframe title="Plugin surface" /><input aria-label="Unsaved document" />
    </div>;
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

it('retains the page when reopening an equal target and forwards authoritative updates', () => {
  const initial: PluginSurfaceLaunchTarget = { pluginID: 'example.plugin', pluginInstanceID: 'instance', surfaceID: 'main', expectedManagementRevision: 1 };
  const [target, setTarget] = createSignal<PluginSurfaceLaunchTarget | null>(initial);
  const [visible, setVisible] = createSignal(true);
  active = visible;
  const mount = document.createElement('div');
  document.body.append(mount);
  dispose = render(() => <ActivityPluginSurfacePage target={target}
    coordinator={{} as any} confirmationQueue={{} as any} registerClose={vi.fn()} onRetirementError={vi.fn()} />, mount);
  const frame = mount.querySelector('iframe');
  const editor = mount.querySelector('input')!;
  editor.value = 'Unsaved work';

  setVisible(false);
  setTarget({ ...initial });
  expect(mount.querySelector('iframe')).toBe(frame);
  expect(mount.querySelector('input')).toBe(editor);
  expect(editor.value).toBe('Unsaved work');
  expect(mount.querySelector('[data-visible]')?.getAttribute('data-visible')).toBe('false');
  setVisible(true);
  setTarget({ ...initial, expectedManagementRevision: 2 });
  expect(mount.querySelector('iframe')).toBe(frame);
  expect(mount.querySelector('[data-revision]')?.getAttribute('data-revision')).toBe('2');

  setTarget(null);
  expect(mount.querySelector('iframe')).toBeNull();
  setTarget({ ...initial, expectedManagementRevision: 3 });
  expect(mount.querySelector('iframe')).not.toBe(frame);
});
