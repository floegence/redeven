// @vitest-environment jsdom

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ActivityBarCodespacesIcon,
  ActivityBarContainersIcon,
  ActivityBarFolderIcon,
  ActivityBarHostApplicationsIcon,
  ActivityBarMonitorIcon,
  ActivityBarPortsIcon,
  ActivityBarSettingsIcon,
  ActivityBarSwitchIcon,
  ActivityBarTerminalIcon,
} from './ActivityBarDockIcons';

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
  ] as const)('renders %s in the shared rail language', (_label, Icon, identity) => {
    const icon = renderIcon(Icon);

    expect(icon.getAttribute('data-activity-bar-icon')).toBe(identity);
    expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('class')).toBe('activity-icon');
    // Size comes from the rail's own class, not an inline style that would
    // outrank it; the attributes only keep a standalone render proportionate.
    expect(icon.getAttribute('width')).toBe('24');
    expect(icon.getAttribute('height')).toBe('24');
    expect(icon.style.width).toBe('');
    expect(icon.style.height).toBe('');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    expect(icon.getAttribute('stroke-width')).toBe('1.5');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');
    expect(icon.querySelector('[fill], [fill-opacity], [stroke-opacity]')).toBeNull();
    expect(icon.querySelector('title, [tabindex]')).toBeNull();
  });

  it('draws every rail glyph in one frame, at one ink weight', () => {
    const icons = [
      ActivityBarTerminalIcon,
      ActivityBarFolderIcon,
      ActivityBarMonitorIcon,
      ActivityBarCodespacesIcon,
      ActivityBarPortsIcon,
      ActivityBarHostApplicationsIcon,
      ActivityBarContainersIcon,
      ActivityBarSwitchIcon,
      ActivityBarSettingsIcon,
    ];

    for (const Icon of icons) {
      const icon = renderIcon(Icon);
      expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(icon.getAttribute('stroke-width')).toBe('1.5');
      expect(icon.getAttribute('stroke')).toBe('currentColor');
      // Filled glyphs opt out of the inherited stroke per shape; the frame
      // itself always strokes, so a missing stroke would be a regression.
      for (const shape of icon.querySelectorAll<SVGElement>('path, circle, rect, line')) {
        expect(['', 'none', 'currentColor']).toContain(shape.getAttribute('stroke') ?? '');
      }
      // Fills are allowed for solid silhouettes, but never a second colour and
      // never an opacity trick on stroke.
      for (const filled of icon.querySelectorAll('[fill]')) {
        expect(filled.getAttribute('fill')).toBe('currentColor');
      }
      expect(icon.querySelector('[stroke-opacity]')).toBeNull();
    }
  });

  it('keeps the globe glyph for Web Services', () => {
    const icon = renderIcon(ActivityBarPortsIcon);

    expect(icon.getAttribute('data-activity-bar-icon')).toBe('web-services');
    expect(icon.querySelector('circle')).not.toBeNull();
    expect(icon.querySelector('line')).not.toBeNull();
    expect(icon.querySelector('rect')).toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
