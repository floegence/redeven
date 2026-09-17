import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets, FloeConfigProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { RedevenWorkbenchSurface } from './RedevenWorkbenchSurface';
import { extractRuntimeWorkbenchLayoutFromSurfaceState, normalizeRuntimeWorkbenchLayoutSnapshot } from '../runtimeWorkbenchLayout';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  writeStoredLanguagePreference('system');
  document.documentElement.classList.remove('dark', 'light');
  delete document.documentElement.dataset.floeShellTheme;
  delete document.documentElement.dataset.floeSurfaceStyle;
});

function mountComposition(locale: 'en-US' | 'zh-CN' = 'en-US') {
  writeStoredLanguagePreference(locale);
  const host = document.createElement('div');
  host.style.cssText = 'height:100vh;width:100vw';
  document.body.append(host);
  const definitions: WorkbenchWidgetDefinition[] = [{
    type: 'test.panel', label: 'Workspace', defaultTitle: 'Workspace', icon: () => null,
    defaultSize: { width: 300, height: 240 }, renderMode: 'projected_surface',
    body: () => <div class="redeven-workbench-body-surface h-full">Workspace content</div>,
  }];
  const [state, setState] = createSignal<WorkbenchState>({
    ...createDefaultWorkbenchState(definitions),
    mode: 'background', viewport: { x: 0, y: 0, scale: 1 },
    widgets: [{ id: 'panel', type: 'test.panel', title: 'Workspace', x: 880, y: 180, width: 300, height: 240, z_index: 1, created_at_unix_ms: 1 }],
    stickyNotes: [{ id: 'note', kind: 'sticky_note', title: 'Release', body: 'Edit this note', color: 'sage', material: 'tint', x: 180, y: 260, width: 280, height: 190, z_index: 2, created_at_unix_ms: 1, updated_at_unix_ms: 1 }],
    backgroundLayers: [{ id: 'region', name: '', material: 'solid', fill: '#8fa1aa', opacity: 0.8, x: 80, y: 140, width: 700, height: 390, z_index: 1, created_at_unix_ms: 1, updated_at_unix_ms: 1 }],
    annotations: [],
    selectedObject: { kind: 'background_layer', id: 'region' },
  });
  dispose = render(() => <FloeConfigProvider config={{ storage: { enabled: false } }}><ThemeProvider><I18nProvider><RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} /></I18nProvider></ThemeProvider></FloeConfigProvider>, host);
  return { host, state, setState };
}

it('keeps shared matte surfaces distinct under every product shell theme', async () => {
  await page.viewport(1280, 800);
  const { host } = mountComposition();
  await expect.poll(() => host.querySelector('.workbench-widget')).toBeTruthy();
  for (const surfaceStyle of ['standard', 'soft-neumorphic']) {
    document.documentElement.dataset.floeSurfaceStyle = surfaceStyle;
    for (const preset of builtInShellThemePresets) {
      document.documentElement.dataset.floeShellTheme = preset.name;
      document.documentElement.classList.toggle('dark', preset.mode === 'dark');
      document.documentElement.classList.toggle('light', preset.mode === 'light');
      const canvas = getComputedStyle(host.querySelector('.workbench-canvas')!);
      const widget = getComputedStyle(host.querySelector('.workbench-widget')!);
      expect(widget.backgroundColor, preset.name).not.toBe(canvas.backgroundColor);
      expect(widget.backdropFilter, preset.name).toBe('none');
      expect(widget.backgroundColor, preset.name).not.toBe('rgba(0, 0, 0, 0)');
      const note = host.querySelector<HTMLElement>('.workbench-sticky__surface')!;
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--note-face)';
      note.append(probe);
      expect(getComputedStyle(note).backgroundColor, `${preset.name} note face`).toBe(getComputedStyle(probe).backgroundColor);
      probe.remove();
    }
  }
});

it('saves direct edits and emoji through the localized product surface in the owning mode', async () => {
  await page.viewport(1280, 800);
  document.documentElement.dataset.floeShellTheme = 'classic-light';
  document.documentElement.classList.add('light');
  const { host, state, setState } = mountComposition('zh-CN');
  const viewport = { ...state().viewport };
  await expect.poll(() => host.querySelector('.workbench-sticky__body')).toBeTruthy();
  const workContent = host.querySelector<HTMLElement>('.workbench-sticky__body')!;
  expect(workContent.isContentEditable).toBe(false);
  expect(workContent.closest('[inert]')).toBeTruthy();
  expect(host.querySelector('.workbench-widget')?.closest('[inert]')).toBeTruthy();

  await page.getByRole('button', { name: '添加名称', exact: true }).click();
  const region = page.getByRole('textbox', { name: '区域名称', exact: true });
  await region.fill('计划区域');
  await userEvent.keyboard('{Escape}');
  expect(state().backgroundLayers?.[0].name).toBe('计划区域');
  expect(state().viewport).toEqual(viewport);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '清空名称', exact: true }).click();
  expect(state().backgroundLayers?.[0].name).toBe('');
  expect(host.querySelector('.workbench-treatment-panel')).toBeNull();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '使用区域材质：轮廓', exact: true }).click();
  expect(state().backgroundLayers?.[0].material).toBe('frame');
  await page.getByRole('button', { name: '插入表情', exact: true }).click();
  await page.getByRole('menuitem', { name: '插入表情：🚀', exact: true }).click();
  await userEvent.keyboard('{Escape}');
  expect(state().backgroundLayers?.[0].name).toBe('🚀');

  setState((current) => ({ ...current, mode: 'work', selectedObject: null }));
  const note = page.getByRole('textbox', { name: '便签内容', exact: true });
  await note.click();
  await note.fill('直接编辑便签');
  const title = page.getByRole('textbox', { name: '便签标题', exact: true });
  await title.click();
  expect(state().stickyNotes?.[0].body).toBe('直接编辑便签');
  await title.fill('发布计划');
  await userEvent.keyboard('{Escape}');
  expect(state().stickyNotes?.[0].title).toBe('发布计划');
  expect(state().viewport).toEqual(viewport);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '使用便签材质：横线纸', exact: true }).click();
  expect(host.querySelector('[aria-label="完成"]')).toBeNull();
  const snapshot = normalizeRuntimeWorkbenchLayoutSnapshot(extractRuntimeWorkbenchLayoutFromSurfaceState(state()));
  expect(snapshot.sticky_notes[0]).toMatchObject({ title: '发布计划', body: '直接编辑便签', material: 'ruled' });
  expect(snapshot.background_layers[0]).toMatchObject({ name: '🚀', material: 'frame' });
  const tools = host.querySelector('.workbench-object-tools');
  expect(tools?.closest('.workbench-surface')).toBeTruthy();
  expect(tools?.getAttribute('data-floe-surface-floating-layer')).toBe('true');
  if (import.meta.env.VITE_WORKBENCH_SCREENSHOTS === '1') await page.screenshot();
});
