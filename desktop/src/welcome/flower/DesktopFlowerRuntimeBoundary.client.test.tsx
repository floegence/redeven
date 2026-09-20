import { afterEach, expect, it, vi } from 'vitest';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { createDesktopI18n } from '../../shared/i18n';
import { normalizeRuntimeServiceSnapshot, RUNTIME_SERVICE_COMPATIBILITY_EPOCH as epoch, RUNTIME_SERVICE_PROTOCOL_VERSION as protocol } from '../../shared/runtimeService';
import { createFlowerComposerDraftCoordinator } from '../../../../internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { DesktopFlowerRuntimeBoundary } from './DesktopFlowerRuntimeBoundary';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.innerHTML = ''; });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const runtime = (compatibility_epoch: number) => normalizeRuntimeServiceSnapshot({ protocol_version: protocol, compatibility_epoch, compatibility: 'compatible', open_readiness: { state: 'openable' }, ai_readiness: { state: 'ready' }, runtime_version: 'v0.0.0-dev', runtime_commit: '0123456789abcdef' });

it.each(['starting', 'inspecting', 'backing_up', 'optimizing', 'migrating', 'verifying', 'recovering', 'restoring'] as const)(
  'waits for AI after the runtime is openable during %s, then mounts once', async state => {
    const [snapshot, setSnapshot] = createSignal({ ...runtime(epoch), ai_readiness: { state } } as ReturnType<typeof runtime>);
    const load = vi.fn();
    const Child = () => { onMount(load); return <div data-ready-flower />; };
    const back = vi.fn();
    disposers.push(render(() => <DesktopFlowerRuntimeBoundary snapshot={snapshot()} i18n={createDesktopI18n('en-US')} onRecover={vi.fn()} onBack={back}><Child /></DesktopFlowerRuntimeBoundary>, document.body));
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Preparing Flower');
    (document.querySelector('button') as HTMLButtonElement).click();
    expect(back).toHaveBeenCalledOnce();
    setSnapshot(runtime(epoch));
    await settle();
    expect(load).toHaveBeenCalledOnce();
    const child = document.querySelector('[data-ready-flower]');
    setSnapshot({ ...runtime(epoch), ai_readiness: { state: 'degraded' } });
    await settle();
    expect(document.querySelector('[data-ready-flower]')).toBe(child);
    expect(load).toHaveBeenCalledOnce();
  },
);

it.each(['blocked', 'unavailable', undefined] as const)('keeps nonoperational AI explicit and never admits requests: %s', async state => {
  const snapshot = { ...runtime(epoch), ai_readiness: state ? { state } : undefined };
  const load = vi.fn();
  const Child = () => { onMount(load); return <div />; };
  disposers.push(render(() => <DesktopFlowerRuntimeBoundary snapshot={snapshot} i18n={createDesktopI18n('en-US')} onRecover={vi.fn()} onBack={vi.fn()}><Child /></DesktopFlowerRuntimeBoundary>, document.body));
  await settle();
  expect(load).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Flower is unavailable');
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});

it('disposes stale initialization on AI loss and preserves drafts outside the boundary', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  disposers.push(() => coordinator.dispose());
  coordinator.open('').mutate(value => ({ ...value, text: 'Keep my draft' }));
  const [snapshot, setSnapshot] = createSignal(runtime(epoch));
  const release = vi.fn();
  const Child = () => {
    onCleanup(release);
    return <textarea value={coordinator.read('').value.text} />;
  };
  disposers.push(render(() => <DesktopFlowerRuntimeBoundary snapshot={snapshot()} i18n={createDesktopI18n('en-US')} onRecover={vi.fn()} onBack={vi.fn()}><Child /></DesktopFlowerRuntimeBoundary>, document.body));
  const first = document.querySelector('textarea');
  setSnapshot({ ...runtime(epoch), ai_readiness: { state: 'recovering' } });
  await settle();
  expect(release).toHaveBeenCalledOnce();
  expect(first?.isConnected).toBe(false);
  setSnapshot(runtime(epoch));
  await settle();
  expect(document.querySelector('textarea')?.value).toBe('Keep my draft');
  expect(document.querySelector('textarea')).not.toBe(first);
});

it('blocks client mounting before update and keeps the existing draft through failure and recovery', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  disposers.push(() => coordinator.dispose());
  coordinator.open('').mutate(value => ({ ...value, text: 'Use my system browser' }));
  const [snapshot, setSnapshot] = createSignal(runtime(epoch - 1));
  const load = vi.fn();
  let attempts = 0;
  const recover = vi.fn(async () => { if (++attempts === 2) setSnapshot(runtime(epoch)); });
  const back = vi.fn();
  const Composer = () => {
    const draft = coordinator.open('');
    onMount(load);
    return <textarea aria-label="Draft" value={draft.snapshot().value.text} onInput={event => draft.mutate(value => ({ ...value, text: event.currentTarget.value }))} />;
  };
  disposers.push(render(() => <DesktopFlowerRuntimeBoundary snapshot={snapshot()} i18n={createDesktopI18n('en-US')} onRecover={recover} onBack={back}><Composer /></DesktopFlowerRuntimeBoundary>, document.body));
  await settle();
  expect(load).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Update the runtime to use Flower');
  expect(document.body.textContent).toContain('0123456789ab');
  (document.querySelector('button') as HTMLButtonElement).click();
  await settle();
  expect(document.querySelector('[data-flower-runtime-blocker]')).not.toBeNull();
  expect(document.querySelector('button')?.disabled).toBe(false);
  expect(load).not.toHaveBeenCalled();
  (document.querySelector('button') as HTMLButtonElement).click();
  await settle();
  expect(recover).toHaveBeenNthCalledWith(2, 'runtime_update_required');
  expect(document.querySelector('textarea')?.value).toBe('Use my system browser');
  const textarea = document.querySelector('textarea')!;
  textarea.value = 'Keep this unsent draft';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  setSnapshot(runtime(epoch + 1));
  await settle();
  expect(document.body.textContent).toContain('Update Desktop to use Flower');
  expect(document.querySelector('textarea')).toBeNull();
  expect(coordinator.read('').value.text).toBe('Keep this unsent draft');
  (document.querySelectorAll('button')[1] as HTMLButtonElement).click();
  expect(back).toHaveBeenCalledOnce();
  setSnapshot(runtime(epoch));
  await settle();
  expect(document.querySelector('textarea')?.value).toBe('Keep this unsent draft');
});
