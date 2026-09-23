// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvAppDrawer } from './EnvAppDrawer';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: any) => props.open ? (
    <section role="dialog" data-floe-dialog-panel="test" data-presentation={props.presentation} class={props.class}>
      <button type="button" aria-label="Close" onClick={() => props.onOpenChange(false)}>Close</button>
      {props.children}
      {props.footer}
    </section>
  ) : null,
}));

describe('EnvAppDrawer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an interactive Desktop-safe panel and closes from its header action', () => {
    const onOpenChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <EnvAppDrawer
        open
        onOpenChange={onOpenChange}
        title="Service templates"
        bodyDescription="Deploy a template"
        footer={<button type="button">Footer action</button>}
      >
        <input aria-label="Template name" />
      </EnvAppDrawer>
    ), host);

    try {
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]');
      expect(panel?.getAttribute('role')).toBe('dialog');
      expect(panel?.className).toContain('env-app-drawer-panel');
      expect(panel?.getAttribute('data-presentation')).toBe('side-drawer');
      expect(panel?.querySelector('[data-redeven-desktop-titlebar-no-drag="true"]')).toBeTruthy();

      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      expect(close?.getAttribute('aria-label')).toBe('Close');
      close?.click();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      dispose();
    }
  });

  it('reserves the Desktop title bar inside the shared drawer boundary', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/redeven.css'), 'utf8');
    const rule = css.match(/\[data-floe-dialog-panel\]\.env-app-drawer-panel\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    expect(rule).toContain('app-region: no-drag');
    expect(rule).toContain('margin-top: var(--redeven-desktop-titlebar-height, 0px)');
    expect(rule).toContain('height: calc(100% - var(--redeven-desktop-titlebar-height, 0px))');
    expect(rule).not.toContain('position: fixed');
  });

  it('keeps the Desktop titlebar drag region outside the drawer overlay no-drag area', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/redeven.css'), 'utf8');
    const overlayRule = css.match(/\[data-floe-dialog-overlay-root\]:has\(\.env-app-drawer-panel\)\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    const interactionRule = css.match(/\[data-floe-dialog-overlay-root\]:has\(\.env-app-drawer-panel\) > :not\(\[data-floe-dialog-backdrop\]\)\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    expect(overlayRule).toBe('');
    expect(interactionRule).toBe('');
  });
});
