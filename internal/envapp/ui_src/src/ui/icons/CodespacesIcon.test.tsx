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
    expect(icon?.getAttribute('fill')).toBe('currentColor');
    expect(leftFold?.tagName.toLowerCase()).toBe('path');
    expect(rightFold?.tagName.toLowerCase()).toBe('path');
    expect(slashFacet?.tagName.toLowerCase()).toBe('path');
    expect(leftFold?.getAttribute('fill-opacity')).toBe('.86');
    expect(rightFold?.getAttribute('fill-opacity')).toBe('.86');
    expect(slashFacet?.getAttribute('fill-opacity')).toBe('.7');
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
    expect(mark?.getAttribute('fill')).toBe('#4f7fad');
    expect(mark?.getAttribute('transform')).toBe('translate(2.4 2.4) scale(1.8)');
    expect(mark?.querySelectorAll('path')).toHaveLength(3);
    expect(mark?.querySelectorAll('rect')).toHaveLength(0);
    expect(mark?.querySelectorAll('text')).toHaveLength(0);
    expect(Array.from(mark?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')))
      .toEqual(Array.from(activityMark?.querySelectorAll('path') ?? [], (path) => path.getAttribute('d')));
    expect(icon?.querySelectorAll('rect')).toHaveLength(1);
  });
});
