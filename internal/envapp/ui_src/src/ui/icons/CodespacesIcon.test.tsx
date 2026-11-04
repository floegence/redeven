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

  it('uses the shared rounded code window in Activity navigation', () => {
    const host = renderIcon(ActivityBarCodespacesIcon);
    expect(host.querySelector('[data-floe-rail-icon="code"]')).toBeTruthy();
    expect(host.querySelector('[data-floe-rail-part="face"] rect')?.getAttribute('rx')).toBe('2.5');
  });

  it('preserves the open folded Workbench brand mark without an inner frame', () => {
    const host = renderIcon(CodespacesWorkbenchIcon);
    const icon = host.querySelector('[data-codespaces-icon-surface="workbench"]');
    const tile = icon?.querySelector('[data-codespaces-icon-part="tile"]');
    const mark = icon?.querySelector('[data-codespaces-icon-mark]');

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
    expect(mark?.querySelector('[data-codespaces-icon-part="slash-facet"]')?.getAttribute('fill')).toBe('var(--redeven-status-warning)');
    expect(mark?.querySelector('[data-codespaces-icon-part="slash-facet"]')?.getAttribute('fill-opacity')).toBe('1');
    expect(mark?.querySelector('[data-codespaces-icon-part="fold-left"]')?.getAttribute('d')).toBe('M7.6 6.35q.4-.04.67.27l.33.4q.25.3-.03.58L5.5 12l3.07 4.4q.28.29.03.59l-.33.4q-.27.31-.67.26l-3.6-4.88q-.29-.34-.29-.77t.29-.77Z');
    expect(icon?.querySelectorAll('rect')).toHaveLength(1);
  });
});
