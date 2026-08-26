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

  it('renders the Activity Bar icon as three custom filled facets', () => {
    const host = renderIcon(ActivityBarCodespacesIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="activity-bar"]');
    const leftFold = icon?.querySelector('[data-codespaces-icon-part="fold-left"]');
    const rightFold = icon?.querySelector('[data-codespaces-icon-part="fold-right"]');
    const slashFacet = icon?.querySelector('[data-codespaces-icon-part="slash-facet"]');

    expect(icon).toBeTruthy();
    expect(icon?.children).toHaveLength(3);
    expect(icon?.getAttribute('fill')).toBeNull();
    expect(leftFold?.tagName.toLowerCase()).toBe('path');
    expect(rightFold?.tagName.toLowerCase()).toBe('path');
    expect(slashFacet?.tagName.toLowerCase()).toBe('path');
    expect(leftFold?.getAttribute('fill')).toBe('currentColor');
    expect(rightFold?.getAttribute('fill')).toBe('currentColor');
    expect(slashFacet?.getAttribute('fill')).toBe('currentColor');
    expect(leftFold?.getAttribute('fill-opacity')).toBe('.86');
    expect(rightFold?.getAttribute('fill-opacity')).toBe('.86');
    expect(slashFacet?.getAttribute('fill-opacity')).toBe('.78');
    expect(leftFold?.getAttribute('d')).toBe('M7.6 6.35q.4-.04.67.27l.33.4q.25.3-.03.58L5.5 12l3.07 4.4q.28.29.03.59l-.33.4q-.27.31-.67.26l-3.6-4.88q-.29-.34-.29-.77t.29-.77Z');
    expect(slashFacet?.getAttribute('d')).toBe('M13.36 4.2q.12-.45.57-.34l.4.11q.45.12.33.57L10.54 19.8q-.12.45-.57.34l-.4-.11q-.45-.12-.33-.57Z');
    expect(leftFold?.getAttribute('stroke')).toBeNull();
    expect(rightFold?.getAttribute('stroke')).toBeNull();
    expect(slashFacet?.getAttribute('stroke')).toBeNull();
    expect(icon?.querySelector('rect')).toBeNull();
    expect(icon?.querySelector('text')).toBeNull();
  });

  it('reuses the same open folded mark in Workbench without an inner frame', () => {
    const host = renderIcon(CodespacesWorkbenchIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="workbench"]');
    const tile = icon?.querySelector('[data-codespaces-icon-part="tile"]');
    const mark = icon?.querySelector('[data-codespaces-icon-mark]');
    const activityHost = renderIcon(ActivityBarCodespacesIcon);
    const activityMark = activityHost.querySelector('[data-codespaces-icon-surface="activity-bar"]');

    expect(icon).toBeTruthy();
    expect(icon?.querySelector('defs')).toBeNull();
    expect(tile?.getAttribute('fill')).toContain('color-mix');
    expect(mark?.getAttribute('transform')).toBe('translate(2.4 2.4) scale(1.8)');
    expect(mark?.querySelectorAll('path')).toHaveLength(3);
    expect(mark?.querySelectorAll('rect')).toHaveLength(0);
    expect(mark?.querySelectorAll('text')).toHaveLength(0);
    expect(mark?.querySelector('[data-codespaces-icon-part="fold-left"]')?.getAttribute('fill')).toBe('var(--redeven-status-info)');
    expect(mark?.querySelector('[data-codespaces-icon-part="fold-right"]')?.getAttribute('fill')).toBe('var(--redeven-status-info)');
    expect(mark?.querySelector('[data-codespaces-icon-part="fold-left"]')?.getAttribute('fill-opacity')).toBe('.82');
    expect(mark?.querySelector('[data-codespaces-icon-part="fold-right"]')?.getAttribute('fill-opacity')).toBe('.82');
    expect(mark?.querySelector('[data-codespaces-icon-part="slash-facet"]')?.getAttribute('fill')).toBe('color-mix(in oklch, var(--redeven-status-warning) 24%, #ffe14a 76%)');
    expect(mark?.querySelector('[data-codespaces-icon-part="slash-facet"]')?.getAttribute('fill-opacity')).toBe('1');
    expect(Array.from(mark?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')))
      .toEqual(Array.from(activityMark?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')));
    expect(icon?.querySelectorAll('rect')).toHaveLength(1);
  });
});
