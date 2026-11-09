// @vitest-environment jsdom
import { createSignal, type Component } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityRailIconProps } from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from './FlowerIcon';
import {
  ActivityBarCodespacesIcon, ActivityBarContainersIcon, ActivityBarFolderIcon,
  ActivityBarHostApplicationsIcon, ActivityBarMonitorIcon, ActivityBarPortsIcon,
  ActivityBarSettingsIcon, ActivityBarSwitchIcon, ActivityBarTerminalIcon,
  ActivityBarFlowerIcon, ActivityBarTessivenIcon, ActivityBarPluginsIcon, ActivityBarAutomationIcon,
} from './ActivityBarDockIcons';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
const cases: Array<[string, Component<ActivityRailIconProps>]> = [
  ['files', ActivityBarFolderIcon], ['terminal', ActivityBarTerminalIcon],
  ['monitor', ActivityBarMonitorIcon], ['code', ActivityBarCodespacesIcon],
  ['globe', ActivityBarPortsIcon], ['applications', ActivityBarHostApplicationsIcon],
  ['containers', ActivityBarContainersIcon], ['switch', ActivityBarSwitchIcon],
  ['settings', ActivityBarSettingsIcon],
  ['connections', ActivityBarTessivenIcon], ['launchpad', ActivityBarPluginsIcon],
  ['automation', ActivityBarAutomationIcon],
];
describe('Activity Bar published Floe adapters', () => {
  it('reuses all five original Flower petals through selection without resizing or remounting', () => {
    const host = document.createElement('div'); document.body.append(host);
    const [active, setActive] = createSignal(false);
    disposers.push(render(() => <>
      <ActivityBarFlowerIcon active={active()} class="activity-icon" size={20} />
      <FlowerIcon />
    </>, host));
    const [svg, brand] = host.querySelectorAll('svg');
    const artwork = (icon: SVGSVGElement) => [...icon.querySelectorAll('path')].map(path => [path.getAttribute('d'), path.getAttribute('transform')]);
    const petals = [...svg.querySelectorAll('path')];
    expect(petals).toHaveLength(5);
    expect(artwork(svg)).toEqual(artwork(brand));
    expect(svg.querySelector('.redeven-flower-icon-center')?.getAttribute('r')).toBe('3');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.classList.contains('activity-icon')).toBe(true);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-flower-variant')).toBe('navigation');
    expect(svg.getAttribute('data-flower-active')).toBe('false');
    setActive(true);
    expect(svg.getAttribute('data-flower-active')).toBe('true');
    expect(svg.getAttribute('data-floe-rail-active')).toBe('true');
    expect([...svg.querySelectorAll('path')]).toEqual(petals);
    expect(artwork(svg)).toEqual(artwork(brand));
    expect(svg.getAttribute('width')).toBe('20');
    setActive(false);
    expect(svg.getAttribute('data-flower-active')).toBe('false');
    expect(brand.hasAttribute('data-flower-variant')).toBe(false);
    expect(brand.hasAttribute('data-flower-active')).toBe(false);
  });
  it.each(cases)('keeps %s selection reactive in the shared rounded frame', (identity, Icon) => {
    const host = document.createElement('div'); document.body.append(host);
    const [active, setActive] = createSignal(false);
    disposers.push(render(() => <Icon active={active()} class="activity-icon" />, host));
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('data-floe-rail-icon')).toBe(identity);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('class')).toBe('activity-icon');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.style.width).toBe('');
    expect(svg.querySelector('[data-floe-rail-part="face"]')?.getAttribute('fill-opacity')).toBe('.13');
    setActive(true);
    expect(host.querySelector('svg')).toBe(svg);
    expect(svg.getAttribute('data-floe-rail-active')).toBe('true');
    expect(svg.querySelector('[data-floe-rail-part="face"]')).toBeNull();
    expect(svg.querySelector('[data-floe-rail-part="solid"]')?.getAttribute('fill-opacity')).toBe(identity === 'monitor' ? '0.2' : '1');
    setActive(false);
    expect(svg.getAttribute('data-floe-rail-active')).toBe('false');
  });
  it.each([
    [ActivityBarPortsIcon, 'web-services'], [ActivityBarSwitchIcon, 'switch-environment'], [ActivityBarSettingsIcon, 'runtime-settings'],
  ] as const)('preserves the product identity %s', (Icon, identity) => {
    const host = document.createElement('div'); document.body.append(host);
    disposers.push(render(() => <Icon />, host));
    expect(host.querySelector('svg')?.getAttribute('data-activity-bar-icon')).toBe(identity);
  });
});
