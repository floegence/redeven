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

  it('renders the Activity Bar icon as a monochrome code workspace', () => {
    const host = renderIcon(ActivityBarCodespacesIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="activity-bar"]');
    const workspace = icon?.querySelector('[data-codespaces-icon-part="workspace"]');
    const codeBrackets = icon?.querySelector('[data-codespaces-icon-part="code-brackets"]');

    expect(icon).toBeTruthy();
    expect(icon?.children).toHaveLength(2);
    expect(workspace?.getAttribute('fill')).toBe('none');
    expect(workspace?.getAttribute('stroke')).toBe('currentColor');
    expect(workspace?.getAttribute('stroke-width')).toBe('1.75');
    expect(codeBrackets?.getAttribute('stroke')).toBe('currentColor');
    expect(codeBrackets?.getAttribute('stroke-width')).toBe('1.75');
    expect(codeBrackets?.getAttribute('stroke-linecap')).toBe('round');
    expect(codeBrackets?.getAttribute('stroke-linejoin')).toBe('round');
    expect(icon?.querySelector('[data-codespaces-icon-part="keyboard"]')).toBeNull();
    expect(icon?.querySelector('[data-codespaces-icon-part="mouse"]')).toBeNull();
  });

  it('carries the same restrained code-workspace symbol into Workbench', () => {
    const host = renderIcon(CodespacesWorkbenchIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="workbench"]');
    const tile = icon?.querySelector('[data-codespaces-icon-part="tile"]');
    const workspace = icon?.querySelector('[data-codespaces-icon-part="workspace"]');
    const codeBrackets = icon?.querySelector('[data-codespaces-icon-part="code-brackets"]');

    expect(icon).toBeTruthy();
    expect(icon?.querySelector('defs')).toBeNull();
    expect(tile?.getAttribute('fill')).toContain('color-mix');
    expect(workspace?.getAttribute('fill')).toBe('none');
    expect(workspace?.getAttribute('stroke')).toBe('#4f7fad');
    expect(codeBrackets?.getAttribute('stroke')).toBe('#4f7fad');
    expect(codeBrackets?.getAttribute('stroke-linecap')).toBe('round');
    expect(codeBrackets?.getAttribute('stroke-linejoin')).toBe('round');
    expect(icon?.querySelector('[data-codespaces-icon-part="monitor"]')).toBeNull();
    expect(icon?.querySelector('[data-codespaces-icon-part="keyboard"]')).toBeNull();
    expect(icon?.querySelector('[data-codespaces-icon-part="mouse"]')).toBeNull();
  });
});
