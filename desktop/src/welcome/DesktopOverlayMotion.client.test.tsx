import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';
import { DesktopAnchoredListbox } from './DesktopAnchoredListbox';
import { FlowerContextCompactionDivider } from '../../../internal/flower_ui/src/chat/FlowerContextCompactionDivider';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../internal/flower_ui/src/copy';
import { FlowerWorkingDirPickerDialog } from '../../../internal/flower_ui/src/filePicker/FlowerWorkingDirPickerDialog';
import { FlowerTurnLauncherWindow } from '../../../internal/flower_ui/src/FlowerTurnLauncherWindow';
import type { FlowerTurnLauncherIntent } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['panel', 'listbox'] as const)('%s retains its positioned DOM through exit and reverses without losing content', async kind => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  const [open, setOpen] = createSignal(true);
  const anchor = document.createElement('button'); document.body.append(anchor);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ x: 150, y: 400, top: 400, bottom: 430, left: 150, right: 350, width: 200, height: 30, toJSON() {} });
  dispose = render(() => kind === 'panel'
    ? <DesktopAnchoredOverlaySurface open={open()} anchorRef={anchor} interactive={open()} role="dialog"><input aria-label="Draft" /></DesktopAnchoredOverlaySurface>
    : <DesktopAnchoredListbox open={open()} anchorRef={anchor}><input aria-label="Draft" /></DesktopAnchoredListbox>, document.body);
  await new Promise(resolve => setTimeout(resolve, 60));
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'retained';
  const surface = input.closest<HTMLElement>('[data-floating-presence]')!;
  const positioner = surface.parentElement!;
  const top = positioner.style.top;
  setOpen(false);
  expect(surface.dataset.floatingPresence).toBe('exiting');
  expect(surface.inert).toBe(true);
  expect(surface.getAttribute('aria-hidden')).toBe('true');
  expect(positioner.style.visibility).toBe('visible');
  expect(positioner.style.top).toBe(top);
  setOpen(true);
  expect(document.querySelector('input')).toBe(input);
  expect(input.value).toBe('retained');
  expect(surface.dataset.floatingPresence).toBe('open');
  setOpen(false);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(document.querySelector('input')).toBeNull();
});

it('retains compaction details through exit and reverses on the same surface', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'fixture', kind: 'context_compaction', ordinal: 1, anchor: { target_kind: 'message', message_id: 'fixture', edge: 'after' },
    compaction: { operation_id: 'fixture', turn_id: 'fixture', canonical_ordinal: 1, phase: 'complete', status: 'compacted', updated_at_ms: 1, tokens_before: 60000, tokens_after_estimate: 488 },
  }} />, document.body);
  const trigger = document.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  trigger.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const surface = document.querySelector<HTMLElement>('[role=tooltip]')!;
  expect(surface.textContent).toContain('60k');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(surface.dataset.floatingPresence).toBe('exiting');
  expect(surface.inert).toBe(true);
  trigger.click();
  expect(document.querySelector('[role=tooltip]')).toBe(surface);
  expect(surface.dataset.floatingPresence).toBe('open');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(document.querySelector('[role=tooltip]')).toBeNull();
});

it.each(['directory', 'launcher'] as const)('%s lets the shared dialog own exit before removing its content', async kind => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const [open, setOpen] = createSignal(true);
  const [intent, setIntent] = createSignal<FlowerTurnLauncherIntent | null>({ id: 'motion-fixture', source_surface: 'file_preview', initial_prompt: 'Retained question', context_items: [], notes: [] });
  dispose = render(() => kind === 'directory'
    ? <FlowerWorkingDirPickerDialog open={open()} onOpenChange={setOpen} onSelect={() => {}} />
    : <FlowerTurnLauncherWindow open={open()} intent={intent()} onClose={() => setOpen(false)} onSubmit={async () => {}} />, document.body);
  await new Promise(resolve => setTimeout(resolve, 80));
  const surface = document.querySelector<HTMLElement>(kind === 'directory' ? '[data-floe-dialog-panel]' : '[data-floe-geometry-surface="floating-window"]')!;
  expect(surface).not.toBeNull();
  const text = surface.textContent;
  setOpen(false);
  setIntent(null);
  expect(surface.isConnected).toBe(true);
  expect(surface.dataset.floatingPresence).toBe('exiting');
  expect(surface.closest('[aria-hidden="true"]')).not.toBeNull();
  if (kind === 'launcher') expect(surface.inert).toBe(true);
  expect(surface.textContent).toBe(text);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(surface.isConnected).toBe(false);
});

it('dismisses compaction details before their containing window', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const close = vi.fn();
  dispose = render(() => <FloatingWindow open onOpenChange={close}><FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'fixture', kind: 'context_compaction', ordinal: 1, anchor: { target_kind: 'message', message_id: 'fixture', edge: 'after' },
    compaction: { operation_id: 'fixture', turn_id: 'fixture', canonical_ordinal: 1, phase: 'complete', status: 'compacted', updated_at_ms: 1, tokens_before: 60000, tokens_after_estimate: 488 },
  }} /></FloatingWindow>, document.body);
  const trigger = document.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  trigger.focus();
  await new Promise(resolve => setTimeout(resolve, 40));
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>('[role=tooltip]')!.dataset.floatingPresence).toBe('exiting');
});
