import { expectSingleLineButtonLabels } from '../test/buttonLayoutAssertions';
import '../index.css';
import './flower-feature.css';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { resolveWorkbenchWheelRouting } from './workbench/surface/workbenchInputRouting';
import { ContainersHeader } from './pages/ContainersPresentation';
import { WebServicesHeader } from './pages/WebServicesPresentation';
import { HostApplicationsHeader } from './pages/HostApplicationsPresentation';
import { createLocalizedFlowerSurfaceCopy, type FlowerSurfaceTranslator } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { EnvAppTranslationKey } from './i18n/locales';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it.each(['zh-CN', 'en-US', 'de-DE'] as const)('wraps the complete %s permission description inside the compact menu', async locale => {
  await page.viewport(1280, 800);
  const i18n = createTestI18nHelpers(locale);
  const translator: FlowerSurfaceTranslator = { locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) };
  const selected = thread({ messages: [], permission_type: 'approval_required' });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected), setThreadPermissionType: async () => liveBootstrap(selected) },
    { copy: createLocalizedFlowerSurfaceCopy(translator), focusThreadRequest: { request_id: 'permission-wrap', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: '1200px', height: '700px' });
  await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger:not(:disabled)')));
  const trigger = runtime.querySelector<HTMLButtonElement>('.flower-permission-trigger')!;
  await userEvent.click(trigger);
  await document.fonts.ready;
  const menu = runtime.querySelector<HTMLElement>('.flower-permission-menu')!;
  await page.screenshot({ element: menu, path: `__screenshots__/resource-permission-${locale}.png` });
  console.info('Permission geometry', JSON.stringify({ locale, width: menu.clientWidth, scrollWidth: menu.scrollWidth, whiteSpace: getComputedStyle(menu.querySelector('.flower-permission-menu-description')!).whiteSpace }));
  expectSingleLineButtonLabels(menu);
  expect(menu.querySelector('button .flower-permission-menu-description')).toBeNull();
  expect.soft(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  for (const description of menu.querySelectorAll<HTMLElement>('.flower-permission-menu-description')) {
    expect.soft(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth);
    expect.soft(getComputedStyle(description).whiteSpace).toBe('normal');
    expect.soft(getComputedStyle(description).fontSize).toBe('11px');
  }
  runtime.setAttribute('data-redeven-workbench-widget-root', 'true');
  runtime.setAttribute('data-redeven-workbench-widget-id', 'permission-widget');
  expect(resolveWorkbenchWheelRouting({ target: menu, disablePanZoom: false, selectedWidgetId: 'permission-widget' }).kind).toBe('local_surface');
  expect(resolveWorkbenchWheelRouting({ target: menu, disablePanZoom: false, selectedWidgetId: null }).kind).toBe('canvas_zoom');
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
});

it.each([320, 544, 1280])('aligns the container title band with resource headers at %ipx', async width => {
  await page.viewport(1440, 900);
  const media = commands as unknown as { emulateTouchInput: (value: boolean) => Promise<void> };
  await media.emulateTouchInput(false);
  const host = document.createElement('main'); host.style.width = `${width}px`; document.body.append(host);
  const dispose = render(() => <FloeConfigProvider>
    <div class="redeven-containers"><ContainersHeader tabs={<div data-test-tabs style={{ height: '32px' }} />} /></div>
    <div class="web-services"><WebServicesHeader /></div>
    <div class="host-apps"><HostApplicationsHeader /></div>
  </FloeConfigProvider>, host);
  onTestFinished(async () => { dispose(); host.remove(); await media.emulateTouchInput(false); });
  await document.fonts.ready;
  await page.screenshot({ element: host, path: `__screenshots__/resource-headers-${width}.png` });
  const band = host.querySelector<HTMLElement>('.container-header-main')!;
  console.info('Container header geometry', JSON.stringify({ width, height: band.getBoundingClientRect().height, font: getComputedStyle(band.querySelector('h1')!).fontSize }));
  expect.soft(band.getBoundingClientRect().height).toBe(40);
  for (const header of host.querySelectorAll('.web-services header, .host-apps header')) expect.soft(band.getBoundingClientRect().height).toBe(header.getBoundingClientRect().height);
  expect.soft(getComputedStyle(band.querySelector('h1')!).fontSize).toBe('14px');
  expect.soft(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  await media.emulateTouchInput(true);
  expect.soft(band.getBoundingClientRect().height).toBe(56);
  for (const button of band.querySelectorAll('button')) expect.soft(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

it.each([{ width: 320, viewport: 320 }, { width: 544, viewport: 544 }, { width: 320, viewport: 1280 }, { width: 544, viewport: 1280 }])('keeps long permission guidance scrollable in a $width px host within a $viewport px viewport', async ({ width, viewport }) => {
  await page.viewport(viewport, 800);
  const i18n = createTestI18nHelpers('de-DE');
  const baseCopy = createLocalizedFlowerSurfaceCopy({ locale: 'de-DE', t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const longDescription = 'Full permission guidance with a_long_unbroken_resource_identifier_'.repeat(14);
  const types = baseCopy.settings.permissionTypes;
  const copy = { ...baseCopy, settings: { ...baseCopy.settings, permissionTypes: {
    readonly: { ...types.readonly, description: longDescription },
    approval_required: { ...types.approval_required, description: longDescription },
    full_access: { ...types.full_access, description: longDescription },
  } } };
  const selected = thread({ messages: [], permission_type: 'approval_required' });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected), setThreadPermissionType: async () => liveBootstrap(selected) },
    { copy, presentation: 'companion', companionOpen: true, focusThreadRequest: { request_id: 'permission-scroll', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: `${width}px`, height: '320px' });
  runtime.setAttribute('data-redeven-workbench-widget-root', 'true');
  runtime.setAttribute('data-redeven-workbench-widget-id', 'permission-widget');
  await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger:not(:disabled), .flower-composer-more-button')));
  if (!runtime.querySelector('button.flower-permission-trigger')) await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!);
  await waitFor(() => Boolean(document.querySelector('button.flower-permission-trigger:not(:disabled)')));
  const trigger = document.querySelector<HTMLButtonElement>('button.flower-permission-trigger')!;
  await userEvent.click(trigger);
  await document.fonts.ready;
  const menu = document.querySelector<HTMLElement>('.flower-permission-menu')!;
  await expect.poll(() => menu.style.getPropertyValue('--flower-permission-menu-available-height')).not.toBe('');
  for (const height of [320, 260, 440]) {
    runtime.style.height = `${height}px`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bounds = runtime.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    expect.soft(rect.top).toBeGreaterThanOrEqual(bounds.top);
    expect.soft(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect.soft(rect.left).toBeGreaterThanOrEqual(bounds.left);
    expect.soft(rect.right).toBeLessThanOrEqual(bounds.right);
    expect.soft(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
    expect.soft(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
    expect.soft(document.querySelector('.flower-permission-menu')).toBe(menu);
  }
  expect(menu.textContent).toContain(longDescription);
  expect(resolveWorkbenchWheelRouting({ target: menu, disablePanZoom: false, selectedWidgetId: 'permission-widget' }).kind).toBe('local_surface');
  await userEvent.keyboard('{End}');
  await expect.poll(() => document.activeElement).toBe(menu.querySelector('.flower-permission-menu-entry:last-child button'));
  expect(menu.scrollTop).toBeGreaterThan(0);
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
});
