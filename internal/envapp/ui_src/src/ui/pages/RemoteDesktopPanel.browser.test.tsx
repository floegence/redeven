import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { loadEnvAppDictionary } from '../i18n/locales';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { RemoteDesktopLauncher } from './RemoteDesktopPanel';

const state = vi.hoisted(() => ({ status: vi.fn(), deployment: vi.fn(), create: vi.fn(), open: vi.fn(), progress: vi.fn() }));
const setupNeeded = {
  capabilities: { backend: 'linux-drm-kms', state: 'setup_required', screen: false, input: false, audio: false, clipboard: false, unattended: true, displays: [] },
  login_service: { state: 'not_installed', backend: 'linux-drm-kms' },
  unattended: false, control_in_use: false, last_display_id: '',
};

vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: 'Qualification host', permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'desktop-layout', localRuntime: () => ({}),
}) }));
vi.mock('../services/desktopSessionContext', async original => ({ ...await original<object>(), readDesktopSessionContextSnapshot: () => ({ label: 'Qualification host', target_kind: 'ssh_environment' }) }));
vi.mock('../services/desktopShellBridge', async original => ({ ...await original<object>(),
  desktopShellWebServiceWindowOpenAvailable: () => true,
  remoteDesktopDeploymentInDesktopShell: state.deployment,
  onRemoteDesktopDeploymentProgress: state.progress,
}));
vi.mock('../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create }));
vi.mock('../services/webServiceWindows', async original => ({ ...await original<object>(), resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));

let dispose: (() => void) | undefined;

async function settleDialog(dialog: HTMLElement) {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await expect.poll(() => dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).map(animation => ({
    target: ((animation.effect as KeyframeEffect)?.target as HTMLElement)?.className,
    name: (animation as CSSAnimation).animationName,
    property: (animation as CSSTransition).transitionProperty,
    time: animation.currentTime,
    timing: animation.effect?.getComputedTiming(),
  }))).toEqual([]);
}

function expectCompactFooter(flow: HTMLElement) {
  const content = flow.querySelector<HTMLElement>('.remote-desktop-flow-content')!;
  const footer = flow.querySelector<HTMLElement>('.remote-desktop-flow-footer')!;
  const lastContent = content.lastElementChild!.getBoundingClientRect();
  const remainingScroll = content.scrollHeight - content.clientHeight - content.scrollTop;
  const gap = footer.getBoundingClientRect().top - lastContent.bottom + remainingScroll;
  expect(gap).toBeGreaterThanOrEqual(16);
  expect(gap).toBeLessThanOrEqual(24);
}

function expectFlowWithinViewport(dialog: HTMLElement, width: number, height: number) {
  const body = dialog.querySelector<HTMLElement>('[data-floe-dialog-body]')!;
  const content = dialog.querySelector<HTMLElement>('.remote-desktop-flow-content')!;
  const footer = dialog.querySelector<HTMLElement>('.remote-desktop-flow-footer')!;
  expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
  expect(content.clientHeight).toBeGreaterThan(80);
  for (const button of footer.querySelectorAll('button')) {
    const bounds = button.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
  }
}

beforeEach(() => {
  vi.resetAllMocks(); state.status.mockResolvedValue(setupNeeded);
  state.progress.mockReturnValue(() => {});state.deployment.mockResolvedValue({ ok: true, available: true }); state.open.mockResolvedValue(undefined);
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); writeStoredLanguagePreference('system'); });

it.each(SUPPORTED_LOCALES)('centers the primary label and keeps SSH authorization usable in narrow %s windows', async locale => {
  await page.viewport(320, 780);
  await loadEnvAppDictionary(locale);
  writeStoredLanguagePreference(locale);
  let finishDeployment!: (value: object) => void;
  state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : request.action === 'respond' ? Promise.resolve({ok:true}) : new Promise(resolve => { finishDeployment = resolve; queueMicrotask(()=>state.progress.mock.calls[0][0]({operation_id:request.operationId,stage:'authorization_required',challenge_id:'password',host:'host.example',ssh_user:'tang'})); }));
  const host = document.createElement('main'); document.body.append(host);
  dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
  await expect.poll(() => document.documentElement.lang).toBe(locale);
  await userEvent.click(host.querySelector('button')!);
  const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
  const primary = dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!;
  await expect.poll(() => primary?.disabled).toBe(false);
  const button = primary.getBoundingClientRect();
  const label = primary.querySelector('span > span')!.getBoundingClientRect();
  const labelFontSize = Number.parseFloat(getComputedStyle(primary).fontSize);
  expect(label.height).toBeLessThan(labelFontSize * 1.7);
  expect(Math.abs(label.x + label.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
  expect(button.right).toBeLessThanOrEqual(320);
  expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth + 1);
  await userEvent.click(primary);
  await expect.poll(() => document.querySelector('.remote-desktop-deployment-flow')).not.toBeNull();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  await settleDialog(dialog);
  expectCompactFooter(flow);
  expectFlowWithinViewport(dialog, 320, 780);
  const permissionDetails = flow.querySelector<HTMLElement>('.remote-desktop-permission-details');
  expect(permissionDetails).not.toBeNull();
  expect(permissionDetails!.dataset.open).toBe('false');
  const authorizationSummary = flow.querySelector<HTMLElement>('.remote-desktop-flow-copy > p')!;
  expect(authorizationSummary.getBoundingClientRect().height).toBeLessThanOrEqual(Number.parseFloat(getComputedStyle(authorizationSummary).lineHeight) * 3 + 1);
  expect(permissionDetails!.querySelector('p')).toBeNull();
  permissionDetails!.querySelector('button')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(permissionDetails!.dataset.open).toBe('true');
  await expect.element(page.elementLocator(permissionDetails!.querySelector('p')!)).toBeVisible();
  await settleDialog(dialog);
  expectCompactFooter(flow);
  expectFlowWithinViewport(dialog, 320, 780);
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-permissions-expanded-narrow-zh-CN.png' });
  await userEvent.keyboard('{Enter}');
  expect(permissionDetails!.dataset.open).toBe('false');
  await settleDialog(dialog);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
  for (const control of flow.querySelectorAll<HTMLElement>('input, button')) {
    const rect = control.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(320);
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
    if (control.tagName === 'BUTTON') expect(getComputedStyle(control).whiteSpace).toBe('nowrap');
  }
  await userEvent.click(flow.querySelector<HTMLButtonElement>('.remote-desktop-flow-footer > button:last-child')!);
  await expect.poll(()=>flow.querySelector('input[type=password]')).not.toBeNull();
  await settleDialog(dialog);
  expectCompactFooter(flow);
  expectFlowWithinViewport(dialog, 320, 780);
  await page.elementLocator(flow.querySelector<HTMLInputElement>('input[type=password]')!).fill('ephemeral-fixture');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => flow.querySelector('[data-phase=applying]')).not.toBeNull();
  await Promise.allSettled(flow.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
  for (const control of flow.querySelectorAll<HTMLElement>('input, button')) expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-narrow-zh-CN.png' });
  finishDeployment({ ok: false, code: 'canceled', rollback: 'complete' });
  await expect.poll(() => flow.querySelector('[data-phase=authorizing]')).not.toBeNull();
});

it.each([
  { width: 1000, height: 850, locale: 'zh-CN', theme: 'porcelain-light' },
  { width: 1000, height: 520, locale: 'en-US', theme: 'porcelain-dark' },
  { width: 320, height: 780, locale: 'de-DE', theme: 'porcelain-dark' },
  { width: 320, height: 600, locale: 'en-US', theme: 'porcelain-light' },
  { width: 320, height: 480, locale: 'zh-CN', theme: 'porcelain-dark' },
] as const)('sizes authorization, credentials and failure to content in $locale at $width × $height', async ({ width, height, locale, theme }) => {
  const previousTheme = document.documentElement.dataset.floeShellTheme;
  const previousDark = document.documentElement.classList.contains('dark');
  document.documentElement.dataset.floeShellTheme = theme;
  document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
  try {
    await page.viewport(width, height);
    await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
    let finishDeployment!: (value: object) => void;
    state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : request.action === 'respond' ? Promise.resolve({ ok: true }) : new Promise(resolve => {
      finishDeployment = resolve;
      queueMicrotask(() => state.progress.mock.calls[0][0]({ operation_id: request.operationId, stage: 'authorization_required', challenge_id: 'password', host: 'host.example', ssh_user: 'tang' }));
    }));
    const host = document.createElement('main'); document.body.append(host);
    dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
    await expect.poll(() => document.documentElement.lang).toBe(locale);
    await userEvent.click(host.querySelector('button')!);
    const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
    await expect.poll(() => dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(false);
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!);
    const flow = dialog.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
    const content = flow.querySelector<HTMLElement>('.remote-desktop-flow-content')!;
    await settleDialog(dialog);
    expectCompactFooter(flow);
    expectFlowWithinViewport(dialog, width, height);
    if (height >= 600) {
      const method = content.querySelector<HTMLSelectElement>('select')!;
      expect(method.getBoundingClientRect().top).toBeGreaterThanOrEqual(content.getBoundingClientRect().top);
      expect(method.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom);
    }
    await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-compact-authorization-${width}-${height}-${locale}.png` });

    await userEvent.click(flow.querySelector<HTMLButtonElement>('.remote-desktop-flow-footer > button:last-child')!);
    await expect.poll(() => content.dataset.phase).toBe('password');
    await settleDialog(dialog);
    expectCompactFooter(flow);
    expectFlowWithinViewport(dialog, width, height);
    const password = flow.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(password.getBoundingClientRect().top).toBeGreaterThanOrEqual(content.getBoundingClientRect().top);
    expect(password.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom);
    await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-compact-password-${width}-${height}-${locale}.png` });
    await page.elementLocator(password).fill('ephemeral-fixture');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => content.dataset.phase).toBe('preparing');
    finishDeployment({ ok: false, code: 'authorization_failed', rollback: 'complete' });
    await expect.poll(() => content.dataset.phase).toBe('failed');
    await settleDialog(dialog);
    expect(flow.querySelector('input[type=password]')).toBeNull();
    expect(content.querySelector('[role=alert]')?.textContent).toContain('authorization_failed');
    expectCompactFooter(flow);
    expectFlowWithinViewport(dialog, width, height);
    await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-compact-failure-${width}-${height}-${locale}.png` });
  } finally {
    if (previousTheme === undefined) delete document.documentElement.dataset.floeShellTheme;
    else document.documentElement.dataset.floeShellTheme = previousTheme;
    document.documentElement.classList.toggle('dark', previousDark);
  }
});

it.each([
  { width: 1000, locale: 'en-US', theme: 'light', forcedColors: 'none' },
  { width: 1000, locale: 'zh-CN', theme: 'dark', forcedColors: 'none' },
  { width: 320, locale: 'zh-CN', theme: 'dark', forcedColors: 'none' },
  { width: 320, locale: 'en-US', theme: 'light', forcedColors: 'active' },
] as const)('insets the authorization arrow at $width px in $locale with $theme/$forcedColors colors', async ({ width, locale, theme, forcedColors }) => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void> };
  const previousTheme = document.documentElement.getAttribute('data-theme');
  const previousDark = document.documentElement.classList.contains('dark');
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  await media.emulateMediaPreferences({ forcedColors });
  try {
    await page.viewport(width, 850);
    await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
    const host = document.createElement('main'); document.body.append(host);
    dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
    await expect.poll(() => document.documentElement.lang).toBe(locale);
    await expect.poll(() => host.querySelector('button')).not.toBeNull();
    await userEvent.click(host.querySelector('button')!);
    const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
    await expect.poll(() => dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(false);
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!);
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    const select = dialog.querySelector<HTMLSelectElement>('.remote-desktop-credential select')!;
    expect(select.labels?.[0]?.textContent).toContain(locale === 'zh-CN' ? '管理员授权方式' : 'Administrator authorization');
    expectCompactFooter(dialog.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!);
    const authorizationFooter = dialog.querySelector<HTMLElement>('.remote-desktop-flow-footer')!;
    const permissionDetails = dialog.querySelector<HTMLElement>('.remote-desktop-permission-details')!;
    expect(permissionDetails.getBoundingClientRect().top).toBeGreaterThanOrEqual(select.getBoundingClientRect().bottom);
    expect(authorizationFooter.getBoundingClientRect().top - permissionDetails.getBoundingClientRect().bottom).toBeLessThanOrEqual(24);
    await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-authorization-' + width + '-' + locale + '-' + theme + '-' + forcedColors + '.png' });
    const arrow = select.parentElement!.querySelector('svg');
    expect(arrow, 'The dropdown arrow needs its own inset inside the field').not.toBeNull();
    const field = select.getBoundingClientRect(), icon = arrow!.getBoundingClientRect();
    const style = getComputedStyle(select);
    expect(style.appearance).toBe('none');
    expect(field.right - icon.right).toBeGreaterThanOrEqual(10);
    expect(field.right - icon.right).toBeLessThanOrEqual(14);
    expect(Math.abs(icon.y + icon.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
    expect(field.right - Number.parseFloat(style.paddingInlineEnd)).toBeLessThanOrEqual(icon.left - 6);
    expect(arrow!.closest('[aria-hidden=true]')).not.toBeNull();
    expect(getComputedStyle(arrow!).pointerEvents).toBe('none');
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(field.left).toBeGreaterThanOrEqual(0);
    expect(field.right).toBeLessThanOrEqual(width);
    select.focus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(permissionDetails.querySelector('button'));
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(dialog.querySelector('.remote-desktop-flow-footer > button:first-child'));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(permissionDetails.querySelector('button'));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(select);
    await userEvent.selectOptions(select, 'root');
    expect(select.value).toBe('root');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-flow-footer > button:last-child')!);
    await expect.poll(() => state.deployment.mock.calls.find(([request]) => request.action === 'manage')?.[0].administratorMethod).toBe('root');
  } finally {
    if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', previousTheme);
    document.documentElement.classList.toggle('dark', previousDark);
    await media.emulateMediaPreferences({ forcedColors: 'none' });
  }
});

it.each([320, 1000])('keeps long display choices inset and connects the selected display at %s px', async width => {
  await page.viewport(width, 850);
  await loadEnvAppDictionary('en-US'); writeStoredLanguagePreference('en-US');
  state.status.mockResolvedValue({ ...setupNeeded,
    capabilities: { ...setupNeeded.capabilities, state: 'ready', screen: true, input: true, displays: [
      { id: 'one', name: 'Primary display', width: 1920, height: 1080, scale: 1, primary: true },
      { id: 'two', name: 'External ultrawide presentation display with a long name', width: 3840, height: 2160, scale: 1 },
    ] }, login_service: { ...setupNeeded.login_service, state: 'active' },
  });
  let finishConnection!: (value: object) => void;
  state.create.mockImplementation(() => new Promise(resolve => { finishConnection = resolve; }));
  const host = document.createElement('main'); document.body.append(host);
  dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
  await expect.poll(() => document.documentElement.lang).toBe('en-US');
  await userEvent.click(host.querySelector('button')!);
  const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
  await expect.poll(() => dialog.querySelector('.remote-desktop-display select')).not.toBeNull();
  await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  const select = dialog.querySelector<HTMLSelectElement>('.remote-desktop-display select')!;
  const arrow = select.parentElement!.querySelector<HTMLElement>('.remote-desktop-select-icon')!;
  await userEvent.selectOptions(select, 'two');
  expect(select.getBoundingClientRect().right - arrow.getBoundingClientRect().right).toBeCloseTo(12);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!);
  await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-flow-footer > button:last-child')!);
  await expect.poll(() => state.create.mock.calls[0]?.[0].display_id).toBe('two');
  finishConnection({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeNull();
});

it.each(['no-preference', 'reduce'] as const)('advances one dialog with visible credentials and accessible %s motion', async reducedMotion => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion });
  try {
    await page.viewport(1000, 850);
    await loadEnvAppDictionary('en-US'); writeStoredLanguagePreference('en-US');
    let finishDeployment!: (value: object) => void, finishConnection!: (value: object) => void;
    state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : request.action === 'respond' ? Promise.resolve({ok:true}) : new Promise(resolve => { finishDeployment = resolve; queueMicrotask(()=>state.progress.mock.calls[0][0]({operation_id:request.operationId,stage:'authorization_required',challenge_id:'password',host:'host.example',ssh_user:'tang'})); }));
    state.create.mockImplementation(() => new Promise(resolve => { finishConnection = resolve; }));
    const host = document.createElement('main'); document.body.append(host);
    dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
    await userEvent.click(host.querySelector('button')!);
    const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
    await expect.poll(() => dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(false);
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!);
    const flow = dialog.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
    const duration = Number.parseFloat(getComputedStyle(flow).animationDuration);
    expect(duration).toBeLessThanOrEqual(.3);
    expect(getComputedStyle(flow).animationName).toBe(reducedMotion === 'reduce' ? 'none' : 'remote-desktop-flow-enter');
    await settleDialog(dialog);
    await expect.poll(() => dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).map(animation => ({
    target: ((animation.effect as KeyframeEffect)?.target as HTMLElement)?.className,
    name: (animation as CSSAnimation).animationName,
    property: (animation as CSSTransition).transitionProperty,
    time: animation.currentTime,
    timing: animation.effect?.getComputedTiming(),
  }))).toEqual([]);
    const initialHeight = dialog.getBoundingClientRect().height;
    const content = flow.querySelector<HTMLElement>('.remote-desktop-flow-content')!;
    const initialContentHeight = content.getBoundingClientRect().height;
    const actionWidth = flow.querySelector('.remote-desktop-flow-footer > button:last-child')!.getBoundingClientRect().width;
    await userEvent.click(flow.querySelector<HTMLButtonElement>('.remote-desktop-flow-footer > button:last-child')!);
    await expect.poll(()=>flow.querySelector('input[type=password]')).not.toBeNull();
    const password = flow.querySelector<HTMLInputElement>('input[type=password]')!;
    await page.elementLocator(password).fill('ephemeral-fixture');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => flow.querySelector('[data-phase="applying"]')).not.toBeNull();
    expect(flow.querySelector('input[type=password]')).toBeNull();
    expect(flow.querySelector('[aria-current=step]')?.textContent).toContain('Prepare host');
    expect(flow.querySelector('.remote-desktop-flow-activity')).toBeNull();
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    const action = flow.querySelector('.remote-desktop-flow-footer > button:last-child')!;
    expect(Math.abs(action.getBoundingClientRect().width - actionWidth)).toBeLessThan(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(getComputedStyle(flow.querySelector('.remote-desktop-step-title')!).boxShadow).toBe('none');
    await settleDialog(dialog);
    expect(content.getBoundingClientRect().height).toBe(280);
    await expect.poll(() => Math.abs(dialog.getBoundingClientRect().height - (initialHeight - initialContentHeight + 280))).toBeLessThan(1);
    expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight + 1);
    expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(flow.querySelector<HTMLElement>('.remote-desktop-flow-footer')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(850);
    if (reducedMotion === 'no-preference') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-applying.png' });
    state.status.mockResolvedValue({ ...setupNeeded, capabilities: { ...setupNeeded.capabilities, state: 'ready', screen: true, input: true }, login_service: { ...setupNeeded.login_service, state: 'active' } });
    finishDeployment({ ok: true });
    await expect.poll(() => state.create.mock.calls.length).toBe(1);
    expect(dialog.querySelector('.remote-desktop-deployment-flow')).toBe(flow);
    expect(flow.querySelector('input[type=password]')).toBeNull();
    expect(flow.querySelector('[aria-current=step]')?.textContent).toContain('Connect');
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    await settleDialog(dialog);
    expect(dialog.getBoundingClientRect().height).toBeLessThan(initialHeight);
    expectCompactFooter(flow);
    if (reducedMotion === 'no-preference') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-connecting.png' });
    finishConnection({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
    await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeNull();
    expect(state.open).toHaveBeenCalledOnce();
  } finally { await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); }
});
