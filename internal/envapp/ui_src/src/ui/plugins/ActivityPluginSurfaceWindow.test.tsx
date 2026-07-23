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
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useLayout: () => ({ isMobile: () => true }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: () => <span aria-hidden="true" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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
  }) => {
    props.registerClose?.(harness.closeBody);
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

  it('retains a cleanup error shell and requires confirmation before ending the plugin session', async () => {
    harness.closeBody.mockResolvedValue(false);
    const { mount, props } = mountWindow();

    (mount.querySelector('[data-window-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(props.onClosed).not.toHaveBeenCalled();
    expect(mount.querySelector('[data-plugin-surface-recovery]')).not.toBeNull();

    const recoveryButton = mount.querySelector('[data-plugin-surface-recovery] button') as HTMLButtonElement;
    recoveryButton.click();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-session-dialog]')).not.toBeNull();
    const confirmationButtons = document.querySelectorAll<HTMLButtonElement>('[data-session-dialog] button');
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
