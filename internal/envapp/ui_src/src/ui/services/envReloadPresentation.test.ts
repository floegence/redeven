// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnvReloadPresentation } from './envReloadPresentation';

const controller = vi.hoisted(() => ({ active: vi.fn(() => true), restrictTo: vi.fn(), finish: vi.fn(), arm: vi.fn(), clear: vi.fn() }));
vi.mock('@floegence/floe-webapp-core/reload-placeholder', () => ({ getReloadPlaceholder: () => controller }));
const cleanups: (() => void)[] = [];
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"><div data-floe-shell><main data-floe-shell-slot="main"><section data-env-reload-state="pending"></section></main></div></div>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); document.body.replaceChildren(); });
function mount() {
  const [target, setTarget] = createSignal('codespaces');
  const [environment, setEnvironment] = createSignal('host');
  const [authentication, setAuthentication] = createSignal(0);
  const [blocked, setBlocked] = createSignal(false);
  const [activity, setActivity] = createSignal(true);
  createRoot(dispose => { cleanups.push(dispose); createEnvReloadPresentation({ target, environment, authentication, activity, blocked }); });
  return { setTarget, setEnvironment, setAuthentication, setBlocked, setActivity };
}
describe('document presentation ownership', () => {
  it('keeps one placeholder until current content, including an empty result, is renderable', async () => {
    mount(); await settle();
    expect(controller.restrictTo).toHaveBeenCalled();
    expect(controller.finish).not.toHaveBeenCalled();
    expect(controller.clear).not.toHaveBeenCalled();
    document.querySelector('section')!.setAttribute('data-env-reload-state', 'content');
    await settle();
    expect(controller.finish).toHaveBeenCalledOnce();
    expect(controller.arm).toHaveBeenCalledWith(document.querySelector('[data-floe-shell]'), expect.any(String));
  });
  it('reveals an actionable error instead of leaving a frozen placeholder', async () => {
    mount(); await settle();
    document.querySelector('section')!.setAttribute('data-env-reload-state', 'error');
    await settle();
    expect(controller.clear).toHaveBeenCalledOnce();
    expect(controller.arm).not.toHaveBeenCalled();
  });
  it.each(['target', 'environment', 'authentication', 'blocked', 'activity'])('retires old geometry when %s changes', async changed => {
    const state = mount(); await settle();
    if (changed === 'target') state.setTarget('terminal');
    if (changed === 'environment') state.setEnvironment('other');
    if (changed === 'authentication') state.setAuthentication(1);
    if (changed === 'blocked') state.setBlocked(true);
    if (changed === 'activity') state.setActivity(false);
    await settle();
    expect(controller.clear).toHaveBeenCalled();
    expect(controller.arm).not.toHaveBeenCalled();
  });
});
