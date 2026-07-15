// @vitest-environment jsdom

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { ActivityBarCodespacesIcon } from './ActivityBarDockIcons';
import { CodespacesWorkbenchIcon } from './CodespacesIcon';

function renderIcon(Icon: (props: { class?: string }) => JSX.Element): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <Icon />, host);
  return host;
}

describe('Codespaces icons', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the Activity Bar icon monochrome with fine screen lines and a solid mouse dot', () => {
    const host = renderIcon(ActivityBarCodespacesIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="activity-bar"]');
    const monitor = icon?.querySelector('[data-codespaces-icon-part="monitor"]');
    const screenLines = icon?.querySelector('[data-codespaces-icon-part="screen-lines"]');
    const keyboard = icon?.querySelector('[data-codespaces-icon-part="keyboard"]');
    const mouse = icon?.querySelector('[data-codespaces-icon-part="mouse"]');

    expect(icon).toBeTruthy();
    expect(monitor?.getAttribute('stroke')).toBe('currentColor');
    expect(monitor?.getAttribute('stroke-width')).toBe('1.55');
    expect(screenLines?.getAttribute('stroke')).toBe('currentColor');
    expect(screenLines?.getAttribute('stroke-width')).toBe('1.25');
    expect(keyboard?.getAttribute('stroke')).toBe('currentColor');
    expect(mouse?.tagName.toLowerCase()).toBe('circle');
    expect(mouse?.getAttribute('fill')).toBe('currentColor');
    expect(mouse?.getAttribute('stroke')).toBeNull();
  });

  it('renders the Workbench dock icon with the approved flat component colors and no monitor stand', () => {
    const host = renderIcon(CodespacesWorkbenchIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="workbench"]');
    const monitor = icon?.querySelector('[data-codespaces-icon-part="monitor"]');
    const keyboard = icon?.querySelector('[data-codespaces-icon-part="keyboard"]');
    const mouse = icon?.querySelector('[data-codespaces-icon-part="mouse"]');

    expect(icon).toBeTruthy();
    expect(monitor?.getAttribute('fill')).toBe('#3b82f6');
    expect(keyboard?.getAttribute('fill')).toBe('#8194a9');
    expect(mouse?.getAttribute('fill')).toBe('#35b98b');
    expect(icon?.querySelector('[data-codespaces-icon-part="monitor-stand"]')).toBeNull();
  });
});
