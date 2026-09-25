import '../index.css';
import './flower-feature.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { CodespacesPageFrame } from './pages/CodespacesPresentation';
import { WebServicesHeader, WebServicesPageSkeleton } from './pages/WebServicesPresentation';
import { HostApplicationsHeader, HostApplicationsPageSkeleton } from './pages/HostApplicationsPresentation';
import { FileBrowserWorkspace } from './widgets/FileBrowserWorkspace';
import { adapter, inputRequest, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function prepare(touch = false) {
  await page.viewport(1440, 1000);
  const media = commands as unknown as { emulateTouchInput: (value: boolean) => Promise<void> };
  await media.emulateTouchInput(touch);
  onTestFinished(() => media.emulateTouchInput(false));
}

it.each([320, 544, 1280])('uses the same quiet single-line page header at %ipx without enlarging any title', async width => {
  await prepare();
  const host = document.createElement('main');
  host.style.width = `${width}px`;
  document.body.append(host);
  const dispose = render(() => <FloeConfigProvider>
    <div style={{ height: '100px' }}><CodespacesPageFrame><div /></CodespacesPageFrame></div>
    <div class="web-services"><WebServicesHeader /></div>
    <div class="host-apps"><HostApplicationsHeader /></div>
  </FloeConfigProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await document.fonts.ready;
  const headers = [...host.querySelectorAll('header')];
  await page.screenshot({ element: host, path: `__screenshots__/coordination-headers-${width}.png` });
  console.info('Header geometry', JSON.stringify(headers.map(header => ({ height: header.getBoundingClientRect().height, titleSize: getComputedStyle(header.querySelector('h1')!).fontSize }))));
  for (const header of headers) {
    expect.soft(header.getBoundingClientRect().height).toBe(40);
    const title = header.querySelector('h1')!;
    expect.soft(title).not.toBeNull();
    if (title) expect.soft(getComputedStyle(title).fontSize).toBe('14px');
    expect.soft(header.querySelector('p, .codespaces-description, .host-apps-eyebrow')).toBeNull();
    expect.soft(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
  }
});

it.each([false, true])('separates narrow file toolbar layout from touch sizing, touch=%s', async touch => {
  await prepare(touch);
  const host = document.createElement('main');
  host.style.cssText = 'height:600px;width:720px';
  document.body.append(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider><FileBrowserWorkspace
    mode="files" onModeChange={() => undefined}
    files={[]} currentPath="/workspace" initialPath="/workspace" instanceId="coordination-files" resetKey={0} open={false}
  /></LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await document.fonts.ready;
  await expect.poll(() => host.querySelector('[data-toolbar-layout]')?.getAttribute('data-toolbar-layout')).toBe('stacked');
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Filter files"]')!;
  const boundary = input.closest('label')!;
  console.info('File toolbar geometry', JSON.stringify({ touch, font: getComputedStyle(input).fontSize, height: boundary.getBoundingClientRect().height }));
  await page.screenshot({ element: host, path: `__screenshots__/coordination-files-${touch}.png` });
  expect.soft(getComputedStyle(input).fontSize).toBe(touch ? '16px' : '12px');
  expect.soft(boundary.getBoundingClientRect().height).toBe(touch ? 44 : 32);
  for (const button of host.querySelectorAll<HTMLElement>('[data-toolbar-layout] > div:last-child button')) {
    if (button.getClientRects().length) expect.soft(button.getBoundingClientRect().height).toBe(touch ? 44 : 32);
  }
});

it.each([
  [false, 'approval_required'], [true, 'approval_required'], [false, 'full_access'], [true, 'full_access'],
] as const)('keeps composer selectors and menus small with full labels and accessible touch=%s, permission=%s', async (touch, permissionType) => {
  await prepare(touch);
  const selected = thread({ messages: [], permission_type: permissionType });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected), setThreadModel: async () => liveBootstrap(selected), setThreadPermissionType: async () => liveBootstrap(selected) },
    { focusThreadRequest: { request_id: 'coordination', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: '1200px', height: '800px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
  await document.fonts.ready;
  expect.soft(runtime.querySelector('.flower-thread-list-heading p')).toBeNull();
  for (const selector of ['.flower-permission-trigger', '.flower-model-reasoning-control']) {
    const control = runtime.querySelector<HTMLElement>(selector)!;
    if (touch) expect.soft(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    else expect.soft(control.getBoundingClientRect().height).toBe(24);
    expect.soft(getComputedStyle(control).fontSize).toBe(touch ? '12px' : '11px');
    await expect.poll(() => getComputedStyle(control).backgroundColor).toMatch(/(?:,\s*0|\/\s*0)\)$/);
    expect.soft(getComputedStyle(control).borderTopWidth).toBe('0px');
  }
  const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!;
  const slot = trigger.closest('.flower-composer-control-slot')!;
  expect(getComputedStyle(slot, '::before').width).toBe('1px');
  expect(getComputedStyle(slot, '::before').height).toBe('10px');
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  await page.screenshot({ element: composer, path: `__screenshots__/composer-minimal-${permissionType}-${touch ? 'touch' : 'desktop'}.png` });
  const name = trigger.getAttribute('aria-label');
  await userEvent.click(trigger);
  const menu = runtime.querySelector<HTMLElement>('.flower-model-menu')!;
  expect.soft(menu.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  expect.soft(getComputedStyle(menu.querySelector('.flower-model-menu-name')!).fontSize).toBe(touch ? '12px' : '11px');
  await page.screenshot({ element: runtime, path: `__screenshots__/coordination-composer${touch ? '-touch' : ''}.png` });
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-label')).toBe(name);
  const permission = runtime.querySelector<HTMLButtonElement>('.flower-permission-trigger')!;
  await userEvent.click(permission);
  const permissionMenu = runtime.querySelector<HTMLElement>('.flower-permission-menu')!;
  expect(permissionMenu.getBoundingClientRect().width).toBeLessThanOrEqual(256);
  expect(getComputedStyle(permissionMenu.querySelector('.flower-permission-menu-label')!).fontSize).toBe(touch ? '12px' : '11px');
  for (const item of permissionMenu.querySelectorAll('button')) {
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(touch ? 44 : 28);
  }
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(permission);
});

it.each([false, true])('fits four choices into a compact reply surface and preserves selection, touch=%s', async touch => {
  await prepare(touch);
  const prompt = inputRequest({ public_summary: '', questions: [{ id: 'focus', header: 'Focus area', question: 'Which project should I go deeper on next?', response_mode: 'select_or_write', write_label: 'Something else',
    choices: ['chrome-text-to-image', 'autoinput', 'cline-test', 'Nothing deeper'].map(label => ({ choice_id: label, value: label, label, description: 'Read the implementation and explain its behavior without changing files.', kind: 'select' })) }] });
  const selected = thread({ status: 'waiting_user', input_request: prompt });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread: vi.fn(async () => liveBootstrap(selected)) },
    { focusThreadRequest: { request_id: 'question', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: '1200px', height: '800px' });
  await waitFor(() => runtime.querySelectorAll('.flower-input-request-choice').length === 4);
  await document.fonts.ready;
  const surface = runtime.querySelector<HTMLElement>('.flower-decision-surface')!;
  console.info('Question geometry', JSON.stringify({ height: surface.getBoundingClientRect().height, title: getComputedStyle(surface.querySelector('.flower-input-request-question-header')!).fontSize }));
  const initialTheme = document.documentElement.className;
  onTestFinished(() => { document.documentElement.className = initialTheme; });
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark);
    await page.screenshot({ element: surface, path: `__screenshots__/coordination-question${touch ? '-touch' : ''}${dark ? '-dark' : ''}.png` });
    expect.soft(surface.getBoundingClientRect().height).toBeLessThanOrEqual(touch ? 360 : 320);
  }
  expect.soft(getComputedStyle(surface.querySelector('.flower-input-request-question-header')!).fontSize).toBe(touch ? '14px' : '12px');
  for (const choice of surface.querySelectorAll('.flower-input-request-choice, .flower-input-request-choice-custom')) {
    expect(choice.getBoundingClientRect().height).toBeGreaterThanOrEqual(touch ? 44 : 28);
  }
  await userEvent.click(surface.querySelector('.flower-input-request-choice')!);
  expect(surface.querySelector('[role="radio"][aria-checked="true"]')).not.toBeNull();
  expect(surface.querySelector<HTMLButtonElement>('.flower-composer-continue')!.disabled).toBe(false);
  const firstChoice = surface.querySelector('.flower-input-request-choice');
  for (const width of [1200, 544, 320]) {
    Object.assign(runtime.style, { width: `${width}px`, height: '360px' });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const footer = surface.querySelector('.flower-input-request-actions')!.getBoundingClientRect();
    expect.soft(footer.bottom).toBeLessThanOrEqual(runtime.getBoundingClientRect().bottom);
    expect.soft(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
    const scroll = surface.querySelector<HTMLElement>('.flower-input-request-questions')!;
    scroll.scrollTop = scroll.scrollHeight;
    expect.soft(scroll.scrollTop).toBeGreaterThan(0);
    expect(surface.querySelector('.flower-input-request-choice')).toBe(firstChoice);
  }
});

it.each([false, true])('keeps resource filters compact on a narrow desktop and accessible on touch, touch=%s', async touch => {
  await prepare(touch);
  const host = document.createElement('main');
  host.style.cssText = 'width:544px;height:900px';
  document.body.append(host);
  const dispose = render(() => <FloeConfigProvider>
    <div style={{ height: '400px' }}><WebServicesPageSkeleton /></div>
    <div style={{ height: '400px' }}><HostApplicationsPageSkeleton /></div>
  </FloeConfigProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await document.fonts.ready;
  for (const input of host.querySelectorAll('input')) {
    expect.soft(getComputedStyle(input).fontSize).toBe(touch ? '16px' : '12px');
    expect.soft(input.getBoundingClientRect().height).toBe(touch ? 44 : 32);
  }
  for (const header of host.querySelectorAll('header')) {
    expect.soft(header.getBoundingClientRect().height).toBe(touch ? 56 : 40);
    for (const button of header.querySelectorAll('button')) {
      expect.soft(button.getBoundingClientRect().height).toBe(touch ? 44 : 28);
    }
  }
});
