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

  it('renders Switch Environment as two open routes with detached endpoint anchors', () => {
    const icon = renderIcon(ActivityBarSwitchIcon);
    const routes = icon.querySelectorAll('[data-activity-bar-icon-part="switch-route"]');
    const anchors = icon.querySelectorAll('[data-activity-bar-icon-part="switch-anchor"]');

    expect(icon.getAttribute('data-activity-bar-icon')).toBe('switch-environment');
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('class')).toBe('activity-icon');
    expect(icon.querySelectorAll('rect, polygon, line')).toHaveLength(0);
    expect(routes).toHaveLength(2);
    expect(anchors).toHaveLength(2);
    expect(Array.from(routes, (route) => route.getAttribute('d'))).toEqual([
      'M7.1 7.5h10.3m0 0-2.8-2.8m2.8 2.8-2.8 2.8',
      'M16.9 16.5H6.6m0 0 2.8-2.8m-2.8 2.8 2.8 2.8',
    ]);
    expect(Array.from(routes, (route) => route.getAttribute('stroke'))).toEqual(['currentColor', 'currentColor']);
    expect(Array.from(routes, (route) => route.getAttribute('stroke-width'))).toEqual(['1.7', '1.7']);
    expect(Array.from(routes, (route) => route.getAttribute('stroke-linecap'))).toEqual(['round', 'round']);
    expect(Array.from(routes, (route) => route.getAttribute('stroke-linejoin'))).toEqual(['round', 'round']);
    expect(Array.from(anchors, (anchor) => [
      anchor.getAttribute('cx'),
      anchor.getAttribute('cy'),
      anchor.getAttribute('r'),
      anchor.getAttribute('fill'),
    ])).toEqual([
      ['4.5', '7.5', '1', 'currentColor'],
      ['19.5', '16.5', '1', 'currentColor'],
    ]);
  });

  it('renders Runtime Settings as three staggered controls without a surrounding frame', () => {
    const icon = renderIcon(ActivityBarSettingsIcon);
    const rails = icon.querySelector('[data-activity-bar-icon-part="settings-rails"]');
    const controls = icon.querySelectorAll('[data-activity-bar-icon-part="settings-control"]');

    expect(icon.getAttribute('data-activity-bar-icon')).toBe('runtime-settings');
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('class')).toBe('activity-icon');
    expect(icon.querySelectorAll('polygon, circle')).toHaveLength(0);
    expect(rails?.getAttribute('d')).toBe('M7 4.5v3.6m0 3.9v7.5M12 4.5v7.8m0 3.9v3.3M17 4.5v2.2m0 3.9v8.9');
    expect(rails?.getAttribute('stroke')).toBe('currentColor');
    expect(rails?.getAttribute('stroke-width')).toBe('1.55');
    expect(rails?.getAttribute('stroke-linecap')).toBe('round');
    expect(controls).toHaveLength(3);
    expect(Array.from(controls, (control) => [
      control.getAttribute('x'),
      control.getAttribute('y'),
      control.getAttribute('width'),
      control.getAttribute('height'),
      control.getAttribute('rx'),
      control.getAttribute('fill'),
    ])).toEqual([
      ['5.35', '8.1', '3.3', '3.9', '1.4', 'currentColor'],
      ['10.35', '12.3', '3.3', '3.9', '1.4', 'currentColor'],
      ['15.35', '6.7', '3.3', '3.9', '1.4', 'currentColor'],
    ]);
  });
});
