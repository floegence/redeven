// @vitest-environment jsdom

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { ActivityBarSettingsIcon, ActivityBarSwitchIcon } from './ActivityBarDockIcons';

function renderIcon(Icon: (props: { class?: string }) => JSX.Element): SVGSVGElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <Icon class="activity-icon" />, host);
  return host.querySelector('svg') as SVGSVGElement;
}

describe('Activity Bar bottom icons', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    ['Switch Environment', ActivityBarSwitchIcon, 'switch-environment'],
    ['Runtime Settings', ActivityBarSettingsIcon, 'runtime-settings'],
  ] as const)('renders %s as compact, theme-inheriting decorative line art', (_label, Icon, identity) => {
    const icon = renderIcon(Icon);

    expect(icon.getAttribute('data-activity-bar-icon')).toBe(identity);
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('class')).toBe('activity-icon');
    expect(icon.style.width).toBe('18px');
    expect(icon.style.height).toBe('18px');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    expect(icon.getAttribute('stroke-width')).toBe('1.6');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');
    expect(icon.querySelector('[fill], [fill-opacity], [stroke-opacity]')).toBeNull();
    expect(icon.querySelector('title, [tabindex]')).toBeNull();
  });
});
