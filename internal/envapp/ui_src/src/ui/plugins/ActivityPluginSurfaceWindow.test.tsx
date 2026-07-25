// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'solid-js/web';
import { Show, createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityPluginSurfaceWindow } from './ActivityPluginSurfaceWindow';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

const harness = vi.hoisted(() => ({
  closeBody: vi.fn<() => Promise<boolean>>(),
  mobile: true,
  onInteraction: undefined as ((event: { kind: string }) => void) | undefined,
  registerClose: undefined as ((close: (() => Promise<boolean>) | null) => void) | undefined,
  registerCloseImmediately: true,
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useLayout: () => ({ isMobile: () => harness.mobile }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: () => <span aria-hidden="true" />,
  Refresh: () => <span aria-hidden="true" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: {
    children?: JSX.Element;
    disabled?: boolean;
    loading?: boolean;
    class?: string;
    onClick?: () => void;
    ref?: (element: HTMLButtonElement) => void;
    variant?: string;
    'data-plugin-surface-retry'?: boolean;
    'data-plugin-surface-end-session'?: boolean;
  }) => (
    <button
      ref={(element) => props.ref?.(element)}
      type="button"
      disabled={props.disabled}
      class={props.class}
      data-loading={String(Boolean(props.loading))}
      data-variant={props.variant}
      data-plugin-surface-retry={props['data-plugin-surface-retry'] ? '' : undefined}
      data-plugin-surface-end-session={props['data-plugin-surface-end-session'] ? '' : undefined}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  ),
  Dialog: (props: { open: boolean; footer?: JSX.Element }) => (
    <Show when={props.open}><div data-session-dialog>{props.footer}</div></Show>
  ),
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) => (
      key === 'uiCopy.plugin.activityWindowTitle'
        ? `${values?.plugin} - ${values?.surface}`
        : key === 'uiCopy.plugin.containersDashboardSurface' ? 'Dashboard' : key
    ),
  }),
}));

vi.mock('../widgets/PersistentFloatingWindow', () => ({
  PersistentFloatingWindow: (props: {
    title: string;
    surfaceRef?: (element: HTMLElement | null) => void;
    onOpenChange: (open: boolean) => void;
    children: JSX.Element;
    zIndex: number;
    class?: string;
  }) => (
    <section
      ref={(element) => props.surfaceRef?.(element)}
      data-floating-window
      data-floe-geometry-surface="floating-window"
      data-z-index={props.zIndex}
    >
      <div class={props.class} data-floating-interaction-surface>
        <button type="button" data-window-close onClick={() => props.onOpenChange(false)}>
          {props.title}
        </button>
        {props.children}
      </div>
    </section>
  ),
}));

vi.mock('./PluginSurfaceFrame', () => ({
  PluginSurfaceBody: (props: {
    registerClose?: (close: (() => Promise<boolean>) | null) => void;
    visible: boolean;
    onInteraction?: (event: { kind: string }) => void;
  }) => {
    harness.registerClose = props.registerClose;
    if (harness.registerCloseImmediately) props.registerClose?.(harness.closeBody);
    harness.onInteraction = props.onInteraction;
    return <div data-plugin-surface-stage data-body-visible={String(props.visible)}><iframe title="Plugin content" /></div>;
  },
}));

const target: PluginSurfaceLaunchTarget = {
  pluginID: 'com.redeven.official.containers',
  pluginInstanceID: 'plugini_redeven_official_containers',
  surfaceID: 'containers.dashboard',
  displayName: 'Containers',
  surfaceDisplayNameKey: 'uiCopy.plugin.containersDashboardSurface',
  expectedManagementRevision: 7,
  preferredPlacement: 'activity',
};

let dispose: (() => void) | undefined;

beforeEach(() => {
  harness.closeBody.mockReset();
  harness.closeBody.mockResolvedValue(true);
  harness.mobile = true;
  harness.onInteraction = undefined;
  harness.registerClose = undefined;
  harness.registerCloseImmediately = true;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function mountWindow(overrides: Partial<Parameters<typeof ActivityPluginSurfaceWindow>[0]> = {}) {
  const mount = document.createElement('div');
  document.body.append(mount);
  const props = {
    instanceID: 'activity_plugin_surface_1',
    target,
    coordinator: {} as Parameters<typeof ActivityPluginSurfaceWindow>[0]['coordinator'],
    confirmationQueue: {} as Parameters<typeof ActivityPluginSurfaceWindow>[0]['confirmationQueue'],
    visible: true,
    active: true,
    zIndex: 159,
    focusRequest: 1,
    onActivate: vi.fn(),
    onClosed: vi.fn(),
    onEndPluginSession: vi.fn(async () => true),
    onRetirementError: vi.fn(),
    ...overrides,
  };
  dispose = render(() => <ActivityPluginSurfaceWindow {...props} />, mount);
  return { mount, props };
}

describe('ActivityPluginSurfaceWindow', () => {
  it('binds modal semantics and moves initial focus into the plugin iframe', async () => {
    const shell = document.createElement('main');
    const preExistingInert = document.createElement('aside');
    preExistingInert.inert = true;
    document.body.append(shell, preExistingInert);
    const { mount } = mountWindow();
    await Promise.resolve();

    const surface = mount.querySelector('[data-floating-window]') as HTMLElement;
    const iframe = mount.querySelector('iframe');
    expect(surface.getAttribute('role')).toBe('dialog');
    expect(surface.getAttribute('aria-modal')).toBe('true');
    expect(surface.getAttribute('aria-label')).toBe('Containers - Dashboard');
    expect(surface.getAttribute('data-redeven-plugin-activity-window')).toBe('true');
    expect(surface.classList.contains('redeven-plugin-activity-window')).toBe(false);
    expect(mount.querySelector('[data-floating-interaction-surface]')?.classList)
      .toContain('redeven-plugin-activity-window');
    expect(document.activeElement).toBe(iframe);
    expect(shell.inert).toBe(true);
    expect(preExistingInert.inert).toBe(true);

    dispose?.();
    dispose = undefined;
    expect(Boolean(shell.inert)).toBe(false);
    expect(preExistingInert.inert).toBe(true);
  });

  it('targets the marked geometry root for the mobile full-screen contract', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/redeven.css'), 'utf8');

    expect(styles).toContain(
      '[data-floe-geometry-surface="floating-window"][data-redeven-plugin-activity-window="true"]',
    );
    expect(styles).toContain('height: calc(100dvh - 0.5rem) !important;');
  });

  it('waits for an opening slot to retire before closing the window', async () => {
    let resolveClose!: (closed: boolean) => void;
    harness.closeBody.mockImplementation(() => new Promise((resolve) => { resolveClose = resolve; }));
    const { mount, props } = mountWindow();

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(harness.closeBody).toHaveBeenCalledOnce();
    expect(props.onClosed).not.toHaveBeenCalled();

    resolveClose(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(props.onClosed).toHaveBeenCalledWith('activity_plugin_surface_1');
  });

  it('queues close visibly until the opening surface registers its exact close handler', async () => {
    harness.registerCloseImmediately = false;
    const serializeClose = vi.fn(async (close: () => Promise<void>) => close());
    const { mount, props } = mountWindow({ serializeClose });

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(serializeClose).toHaveBeenCalledOnce();
    expect(harness.closeBody).not.toHaveBeenCalled();
    expect(props.onClosed).not.toHaveBeenCalled();
    expect(mount.querySelector('[data-plugin-surface-close-queued]')?.getAttribute('role')).toBe('status');
    const serializedClose = serializeClose.mock.results[0]?.value;
    let closeSettled = false;
    void serializedClose.then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    harness.registerClose?.(harness.closeBody);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.closeBody).toHaveBeenCalledOnce();
    expect(props.onClosed).toHaveBeenCalledWith('activity_plugin_surface_1');
    expect(mount.querySelector('[data-plugin-surface-close-queued]')).toBeNull();
    expect(closeSettled).toBe(true);
  });

  it('routes user close through the Shell placement serializer', async () => {
    const serializeClose = vi.fn(async (close: () => Promise<void>) => close());
    const { mount, props } = mountWindow({ serializeClose });

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(serializeClose).toHaveBeenCalledOnce();
    expect(harness.closeBody).toHaveBeenCalledOnce();
    expect(props.onClosed).toHaveBeenCalledWith('activity_plugin_surface_1');
  });

  it('registers an awaitable close handoff for placement changes', async () => {
    const registerRequestClose = vi.fn();
    const { props } = mountWindow({ registerRequestClose });
    const close = registerRequestClose.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;
    expect(close).toEqual(expect.any(Function));

    await close?.();
    expect(harness.closeBody).toHaveBeenCalledOnce();
    expect(props.onClosed).toHaveBeenCalledWith('activity_plugin_surface_1');

    dispose?.();
    dispose = undefined;
    expect(registerRequestClose).toHaveBeenLastCalledWith('activity_plugin_surface_1', null);
  });

  it('uses focus guards without intercepting Tab events targeted at the cross-origin iframe boundary', () => {
    const { mount } = mountWindow();
    const iframe = mount.querySelector('iframe') as HTMLIFrameElement;
    const closeButton = mount.querySelector('[data-window-close]') as HTMLButtonElement;
    const guards = mount.querySelectorAll<HTMLElement>('[data-plugin-focus-guard]');

    guards[1].focus();
    expect(document.activeElement).toBe(closeButton);
    guards[0].focus();
    expect(document.activeElement).toBe(iframe);

    iframe.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    iframe.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps an inactive mobile window mounted, inert, hidden, and lifecycle-hidden', () => {
    const { mount } = mountWindow({ active: false });
    const surface = mount.querySelector('[data-floating-window]') as HTMLElement;

    expect(surface.getAttribute('aria-hidden')).toBe('true');
    expect(surface.inert).toBe(true);
    expect(surface.style.display).toBe('none');
    expect(mount.querySelector('[data-plugin-surface-stage]')?.getAttribute('data-body-visible')).toBe('false');
    expect(mount.querySelector('iframe')).not.toBeNull();
  });

  it('does not steal focus when pointer activation only changes stack order', async () => {
    const external = document.createElement('button');
    document.body.append(external);
    const [active, setActive] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    const props = mountWindow({ active: true }).props;
    dispose?.();
    dispose = render(() => <ActivityPluginSurfaceWindow {...props} active={active()} />, mount);
    await Promise.resolve();

    setActive(false);
    external.focus();
    setActive(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(external);
  });

  it('raises the window for iframe activation, focus, and action interactions', () => {
    const { props } = mountWindow();

    harness.onInteraction?.({ kind: 'activation' });
    harness.onInteraction?.({ kind: 'focus' });
    harness.onInteraction?.({ kind: 'action' });
    harness.onInteraction?.({ kind: 'selection' });

    expect(props.onActivate).toHaveBeenCalledTimes(3);
    expect(props.onActivate).toHaveBeenNthCalledWith(1, 'activity_plugin_surface_1');
  });

  it('retries the same exact surface after close failure and closes only after retry succeeds', async () => {
    harness.closeBody.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { mount, props } = mountWindow();

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(props.onClosed).not.toHaveBeenCalled();
    const recovery = mount.querySelector('[data-plugin-surface-recovery]') as HTMLElement;
    expect(recovery.getAttribute('role')).toBe('alertdialog');
    expect(recovery.getAttribute('aria-modal')).toBe('true');
    expect(recovery.getAttribute('aria-labelledby')).toBe('plugin-surface-recovery-title-activity_plugin_surface_1');
    expect(mount.querySelector('[data-plugin-surface-stage]')?.getAttribute('data-body-visible')).toBe('false');

    const recoveryButton = mount.querySelector('[data-plugin-surface-retry]') as HTMLButtonElement;
    await Promise.resolve();
    expect(document.activeElement).toBe(recoveryButton);
    recoveryButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.closeBody).toHaveBeenCalledTimes(2);
    expect(props.onClosed).toHaveBeenCalledOnce();
    expect(props.onEndPluginSession).not.toHaveBeenCalled();
  });

  it.each([true, false])('traps recovery focus and isolates non-dialog content when mobile is %s', async (mobile) => {
    harness.mobile = mobile;
    harness.closeBody.mockResolvedValue(false);
    const external = document.createElement('button');
    document.body.append(external);
    const { mount } = mountWindow();

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const recovery = mount.querySelector('[data-plugin-surface-recovery]') as HTMLElement;
    const retry = mount.querySelector('[data-plugin-surface-retry]') as HTMLButtonElement;
    const endSession = mount.querySelector('[data-plugin-surface-end-session]') as HTMLButtonElement;
    expect((mount.querySelector('[data-plugin-surface-stage]') as HTMLElement).inert).toBe(true);
    expect((mount.querySelector('[data-window-close]') as HTMLElement).inert).toBe(true);
    expect(external.inert).toBe(true);
    expect(recovery.inert).toBe(false);

    retry.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    retry.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(endSession);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    endSession.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(retry);
  });

  it('does not let a hidden Activity recovery layer block the visible Shell after placement changes', async () => {
    harness.closeBody.mockResolvedValue(false);
    const external = document.createElement('button');
    document.body.append(external);
    const { mount } = mountWindow({ visible: false, active: false });

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const surface = mount.querySelector('[data-floating-window]') as HTMLElement;
    const recovery = mount.querySelector('[data-plugin-surface-recovery]') as HTMLElement;
    expect(surface.inert).toBe(true);
    expect(surface.style.display).toBe('none');
    expect(recovery.getAttribute('aria-modal')).toBeNull();
    expect(recovery.getAttribute('aria-hidden')).toBe('true');
    expect(Boolean(external.inert)).toBe(false);
  });

  it('keeps session teardown secondary and requires explicit destructive confirmation', async () => {
    harness.closeBody.mockResolvedValue(false);
    const { mount, props } = mountWindow();

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const retryButton = mount.querySelector('[data-plugin-surface-retry]') as HTMLButtonElement;
    const endSessionButton = mount.querySelector('[data-plugin-surface-end-session]') as HTMLButtonElement;
    expect(retryButton.getAttribute('data-variant')).toBe('default');
    expect(endSessionButton.getAttribute('data-variant')).toBe('ghost-destructive');
    expect(retryButton.className).toContain('min-h-[46px]');
    expect(endSessionButton.className).toContain('min-h-[46px]');
    expect(props.onEndPluginSession).not.toHaveBeenCalled();

    endSessionButton.click();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-session-dialog]')).not.toBeNull();
    const confirmationButtons = document.querySelectorAll<HTMLButtonElement>('[data-session-dialog] button');
    expect([...confirmationButtons].every((button) => button.className.includes('min-h-[46px]'))).toBe(true);
    confirmationButtons[confirmationButtons.length - 1].click();
    await Promise.resolve();
    expect(props.onEndPluginSession).toHaveBeenCalledOnce();
  });

  it('restores focus to the creating control after unmount', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    mountWindow();
    await Promise.resolve();

    dispose?.();
    dispose = undefined;
    expect(document.activeElement).toBe(trigger);
  });
});
