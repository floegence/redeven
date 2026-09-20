import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

const disposers: Array<() => void> = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const flower = () => document.querySelector<HTMLElement>('[data-flower-engaged]');
const click = (selector: string) => {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  button!.click();
};

async function mount(surface: DesktopWelcomeSnapshot['surface'] = 'connect_environment') {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  let snapshot = { ...buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), surface }), navigation_revision: 1 };
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  // Both IPC and runtime preparation stay pending throughout navigation.
  const performAction = vi.fn(() => new Promise<never>(() => {}));
  const getSnapshot = vi.fn(() => new Promise<never>(() => {}));
  const requestRuntimeFlower = vi.fn(() => new Promise<never>(() => {}));
  const settings = { load: vi.fn(), save: vi.fn(), cancel: vi.fn(), requestRuntimeFlower } as unknown as DesktopWelcomeRuntime['settings'];
  const host = document.createElement('div');
  document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
    getSnapshot, performAction, subscribeSnapshot: listener => { receive = listener; return () => {}; },
  } }} />, host));
  await settle();
  return { performAction, getSnapshot, requestRuntimeFlower, snapshot, publish(patch: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...patch, snapshot_revision: (snapshot.snapshot_revision ?? 0) + 1 };
    receive?.(snapshot);
  } };
}

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens Flower on the click while IPC and runtime preparation are pending', async () => {
  const h = await mount();
  expect(h.requestRuntimeFlower).not.toHaveBeenCalled();
  click('.redeven-flower-topbar-button');
  expect(flower()).not.toBeNull();
  expect(document.querySelector('.redeven-flower-back-button')).not.toBeNull();
  expect(h.performAction).not.toHaveBeenCalled();
  expect(h.getSnapshot).not.toHaveBeenCalled();
});

it.each(['.redeven-flower-back-button', '.flower-sidebar-leading-action'])('returns immediately through %s and retains the pending Flower instance', async selector => {
  const h = await mount('flower');
  const mounted = flower();
  expect(mounted).not.toBeNull();
  const calls = h.requestRuntimeFlower.mock.calls.length;
  click(selector);
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  expect(mounted?.closest<HTMLElement>('[aria-hidden="true"]')?.inert).toBe(true);
  click('.redeven-flower-topbar-button');
  expect(flower()).toBe(mounted);
  expect(mounted?.dataset.flowerEngaged).toBe('true');
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(calls);
  expect(h.performAction).not.toHaveBeenCalled();
});

it('keeps local navigation across background snapshots and honors repeated explicit host requests', async () => {
  const h = await mount();
  const card = document.querySelector('[data-environment-group]');
  click('.redeven-flower-topbar-button');
  h.publish({ surface: 'connect_environment' });
  expect(flower()?.dataset.flowerEngaged).toBe('true');
  h.publish({ surface: 'connect_environment', navigation_revision: 2 });
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  expect(document.querySelector('[data-environment-group]')).toBe(card);
  click('.redeven-flower-topbar-button');
  h.publish({ surface: 'connect_environment', navigation_revision: 3 });
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  h.publish({ surface: 'flower', navigation_revision: 4 });
  expect(flower()?.dataset.flowerEngaged).toBe('true');
});

it('releases the previous Flower when the selected runtime identity changes', async () => {
  const h = await mount();
  const card = document.querySelector('[data-environment-group]');
  click('.redeven-flower-topbar-button');
  const previous = flower();
  click('.redeven-flower-back-button');
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, id: `${entry.id}-replacement` })) });
  click('.redeven-flower-topbar-button');
  expect(flower()).not.toBeNull();
  expect(flower()).not.toBe(previous);
  expect(previous?.isConnected).toBe(false);
  expect(card?.isConnected).toBe(false);
});
