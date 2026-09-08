// @vitest-environment jsdom
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginSurfaceContainer, type PluginSurfaceResolution } from './PluginSurfaceContainer';

const leases = vi.hoisted(() => ({ opened: vi.fn(), released: vi.fn() }));
vi.mock('./PluginSurfaceFrame', () => ({
  PluginSurfaceBody: (props: any) => {
    onMount(() => { leases.opened(props.target); props.registerClose?.(async () => true); });
    onCleanup(() => leases.released(props.target));
    return <div data-test-lease data-revision={props.target.expectedManagementRevision} data-visible={String(props.visible)} />;
  },
}));
const target = { pluginID: 'example.plugin', pluginInstanceID: 'instance-1', surfaceID: 'secondary', expectedManagementRevision: 7 };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });

describe('PluginSurfaceContainer', () => {
  it('retains its container through update, disable, permissions, and reconnect at unchanged revisions', () => {
    const [resolution, setResolution] = createSignal<PluginSurfaceResolution>({ target, generation: 0, status: 'ready' });
    const mount = document.createElement('div'); document.body.append(mount);
    dispose = render(() => <PluginSurfaceContainer target={target} resolveSurface={resolution} visible coordinator={{} as any} confirmationQueue={{} as any} onRetirementError={vi.fn()} />, mount);
    const container = mount.firstElementChild;
    const firstLease = mount.querySelector('[data-test-lease]');
    setResolution({ target, generation: 0, status: 'pending' });
    expect(mount.querySelector('[data-test-lease]')).toBe(firstLease);
    expect(firstLease?.getAttribute('data-visible')).toBe('false');
    for (const status of ['disabled', 'permission', 'loading', 'unknown', 'surfaceMissing'] as const) {
      setResolution({ target: null, generation: 0, status });
      expect(mount.firstElementChild).toBe(container);
      expect(mount.querySelector('[data-test-lease]')).toBeNull();
      expect(mount.querySelector('[data-plugin-surface-status]')?.getAttribute('data-plugin-surface-status')).toBe(status);
    }
    setResolution({ target, generation: 1, status: 'ready' });
    expect(mount.firstElementChild).toBe(container);
    expect(mount.querySelector('[data-test-lease]')).not.toBe(firstLease);
    expect(leases.opened).toHaveBeenCalledTimes(2);
    setResolution({ target: { ...target, expectedManagementRevision: 8 }, generation: 1, status: 'ready' });
    expect(mount.querySelector('[data-test-lease]')?.getAttribute('data-revision')).toBe('8');
    expect(mount.firstElementChild).toBe(container);
  });

  it('offers only the action supplied by current authorization', () => {
    const enable = vi.fn();
    const [resolution, setResolution] = createSignal<PluginSurfaceResolution>({ target: null, generation: 0, status: 'disabled' });
    const mount = document.createElement('div'); document.body.append(mount);
    dispose = render(() => <PluginSurfaceContainer target={target} resolveSurface={resolution} visible coordinator={{} as any} confirmationQueue={{} as any} onRetirementError={vi.fn()} />, mount);
    expect(mount.querySelector('button')).toBeNull();
    setResolution({ ...resolution(), action: { label: 'enable', run: enable } });
    mount.querySelector<HTMLButtonElement>('button')!.click();
    expect(enable).toHaveBeenCalledOnce();
    expect(leases.opened).not.toHaveBeenCalled();
  });
});
