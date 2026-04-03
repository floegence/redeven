// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopDetachedWindowFrame } from './DesktopDetachedWindowFrame';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DesktopDetachedWindowFrame', () => {
  it('renders a chrome-safe detached window layout with title, subtitle, banner, actions, and footer slots', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <DesktopDetachedWindowFrame
        title="File Preview"
        subtitle="/workspace/demo.txt"
        banner={<div data-testid="frame-banner">banner</div>}
        headerActions={<button type="button">Action</button>}
        footer={<div data-testid="frame-footer">footer</div>}
      >
        <div data-testid="frame-body">body</div>
      </DesktopDetachedWindowFrame>
    ), host);

    const titlebar = host.querySelector('[data-redeven-desktop-window-titlebar="true"]');
    expect(titlebar).toBeTruthy();
    expect(titlebar?.getAttribute('data-redeven-desktop-titlebar-drag-region')).toBe('true');
    expect(host.querySelector('[data-redeven-desktop-window-titlebar-content="true"]')).toBeTruthy();
    expect(host.textContent).toContain('File Preview');
    expect(host.textContent).toContain('/workspace/demo.txt');
    expect(host.querySelector('[data-testid="frame-banner"]')?.textContent).toBe('banner');
    expect(host.querySelector('[data-testid="frame-body"]')?.textContent).toBe('body');
    expect(host.querySelector('[data-testid="frame-footer"]')?.textContent).toBe('footer');
    expect(host.querySelector('button')?.textContent).toBe('Action');
  });
});
