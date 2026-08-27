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
    <section role="dialog" data-floe-dialog-panel="test" class={props.class}>
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
        description="Deploy a template"
        footer={<button type="button">Footer action</button>}
      >
        <input aria-label="Template name" />
      </EnvAppDrawer>
    ), host);

    try {
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]');
      expect(panel?.getAttribute('role')).toBe('dialog');
      expect(panel?.className).toContain('env-app-drawer-panel');
      expect(panel?.querySelector('[data-redeven-desktop-titlebar-no-drag="true"]')).toBeTruthy();

      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      expect(close?.getAttribute('aria-label')).toBe('Close');
      close?.click();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      dispose();
    }
  });

  it('uses horizontal drawer presence without scale and reserves the Desktop title bar', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/redeven.css'), 'utf8');
    const rule = css.match(/\[data-floe-dialog-panel\]\.env-app-drawer-panel\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    expect(rule).toContain('app-region: no-drag');
    expect(rule).toContain('top: var(--redeven-desktop-titlebar-height, 0px)');
    expect(rule).toContain('--floe-floating-enter-x:');
    expect(rule).toContain('--floe-floating-exit-x:');
    expect(rule).toContain('--floe-floating-enter-y: 0');
    expect(rule).toContain('--floe-floating-enter-scale: 1');
    expect(rule).toContain('--floe-floating-exit-scale: 1');
  });

  it('keeps the full drawer overlay outside Desktop drag regions', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/redeven.css'), 'utf8');
    const overlayRule = css.match(/\[data-floe-dialog-overlay-root\]:has\(\.env-app-drawer-panel\)\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    const interactionRule = css.match(/\[data-floe-dialog-overlay-root\]:has\(\.env-app-drawer-panel\) > :not\(\[data-floe-dialog-backdrop\]\)\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    expect(overlayRule).toContain('app-region: no-drag');
    expect(interactionRule).toContain('pointer-events: none');
  });
});
