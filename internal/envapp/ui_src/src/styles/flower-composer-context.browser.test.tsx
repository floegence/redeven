import '../index.css';
import '../ui/flower-feature.css';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerTurnLauncherWindow } from '../../../../flower_ui/src/FlowerTurnLauncherWindow';
import type { FlowerTurnLauncherIntent } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../ui/workbench/surface/workbenchWheelInteractive';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

const intent: FlowerTurnLauncherIntent = {
  id: 'composer-context', source_surface: 'file_preview',
  context_items: [
    { kind: 'file_selection', path: '/workspace/commerce/src/services/orders/checkout.ts', selection: 'await createOrder(cart)', selection_chars: 23 },
    { kind: 'terminal_selection', working_dir: '/workspace/commerce', selection: 'Connection refused: database:5432', selection_chars: 33 },
    { kind: 'text_snapshot', title: 'Git changes', detail: 'commerce / feature/checkout', content: 'diff --git a/checkout.ts b/checkout.ts' },
    { kind: 'process_snapshot', pid: 1842, name: 'orders-api', username: 'developer', cpu_percent: 12.5, memory_bytes: 83886080 },
    { kind: 'file_path', path: '/workspace/commerce/assets', is_directory: true },
    { kind: 'environment', target_id: 'production-01', label: 'Production', detail: 'Commerce services' },
  ],
};

function mount(value = intent) {
  const host = document.createElement('div');
  document.body.append(host);
  const onContextAction = vi.fn();
  const onSubmit = vi.fn(async () => undefined);
  dispose = render(() => <LayoutProvider>
    <FlowerTurnLauncherWindow open intent={value} anchor={{ x: 80, y: 70 }}
      localScrollProps={REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
      onClose={() => {}} onSubmit={onSubmit} onContextAction={onContextAction} />
  </LayoutProvider>, host);
  return { onContextAction, onSubmit };
}

function applyTheme(preset: typeof builtInShellThemePresets[number]) {
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.toggle('dark', preset.mode === 'dark');
  document.documentElement.classList.toggle('light', preset.mode === 'light');
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {}))
    if (value) document.documentElement.style.setProperty(name, value);
}

it('keeps every source in the input with bounded scrolling, preview actions and exact submission context', async () => {
  await page.viewport(1000, 800);
  const runtime = mount();
  await expect.element(page.getByRole('textbox')).toBeVisible();
  const input = document.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-editor-shell"]')!;
  const list = input.querySelector<HTMLElement>('.flower-composer-context-list')!;
  const rows = [...input.querySelectorAll<HTMLElement>('.flower-composer-context-reference')];
  expect(rows).toHaveLength(6);
  expect(rows[0].textContent).toBe('checkout.ts');
  expect(input.querySelector('.flower-composer-context-heading')).toBeNull();
  expect(document.querySelector('.flower-turn-launcher-message-surface')?.textContent).not.toContain('selected content');
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  expect(list.getAttribute('data-redeven-workbench-wheel-role')).toBe('local-scroll-viewport');
  for (const row of rows) {
    const style = getComputedStyle(row);
    expect(style.borderRadius).toBe('0px');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }
  const preview = rows[0].querySelector('button')!;
  await userEvent.click(preview);
  expect(runtime.onContextAction).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'open_text_context_preview', body: 'await createOrder(cart)' }),
    expect.objectContaining({ tone: 'selection' }),
  );
  await userEvent.click(rows[0].querySelector<HTMLButtonElement>('.flower-composer-context-action')!);
  expect(runtime.onContextAction).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'open_live_file_preview', path: '/workspace/commerce/src/services/orders/checkout.ts' }),
    expect.objectContaining({ tone: 'selection' }),
  );
  await userEvent.click(rows[3].querySelector('button')!);
  expect(runtime.onContextAction).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'open_process_snapshot_preview', pid: 1842 }),
    expect.objectContaining({ tone: 'process' }),
  );
  expect(rows[5].querySelector('button')).toBeNull();
  await page.getByRole('textbox').fill('Explain these references');
  await page.getByRole('button', { name: 'Launch turn', exact: true }).click();
  expect(runtime.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Explain these references', intent }));
});

it('renders restrained reference styling in every theme without changing input focus geometry', async () => {
  await page.viewport(1000, 800);
  mount({ ...intent, context_items: intent.context_items.slice(0, 2) });
  await expect.element(page.getByRole('textbox')).toBeVisible();
  const input = document.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-editor-shell"]')!;
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset);
    await page.getByRole('textbox').fill('Explain the checkout failure');
    const before = input.getBoundingClientRect();
    await userEvent.click(input.querySelector('button')!);
    const style = getComputedStyle(input);
    await page.getByRole('textbox').click();
    expect(input.getBoundingClientRect().width).toBe(before.width);
    expect(input.getBoundingClientRect().height).toBe(before.height);
    expect(getComputedStyle(input).borderWidth).toBe(style.borderWidth);
    expect(getComputedStyle(input).boxShadow).toBe(style.boxShadow);
    await page.screenshot({ element: input, path: `__screenshots__/flower-context-${preset.name}.png` });
  }
});

it('keeps long quotes, secondary actions and the editor reachable in a narrow window', async () => {
  await page.viewport(390, 700);
  mount({ ...intent, context_items: [
    { kind: 'file_selection', path: '/workspace/commerce/checkout/reconciliation/very-long-production-configuration.ts', selection: 'retryPolicy', selection_chars: 11 },
    ...intent.context_items.slice(1),
  ] });
  await expect.element(page.getByRole('textbox')).toBeVisible();
  const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  await expect.poll(() => root.getAttribute('data-floating-presence')).toBe('open');
  await expect.poll(() => root.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  const bounds = root.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  const input = root.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-editor-shell"]')!;
  expect(input.scrollWidth).toBe(input.clientWidth);
  const action = input.querySelector<HTMLElement>('.flower-composer-context-action')!;
  expect(action.getBoundingClientRect().right).toBeLessThan(input.getBoundingClientRect().right);
  await page.getByRole('textbox').fill('Inspect this selection');
  await page.screenshot({ element: root, path: '__screenshots__/flower-context-narrow.png' });
  await page.getByRole('button', { name: 'Launch turn', exact: true }).click();
});
