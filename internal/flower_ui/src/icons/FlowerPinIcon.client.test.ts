// @vitest-environment jsdom

import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { FlowerPinIcon } from './FlowerPinIcon';

describe('FlowerPinIcon', () => {
  it('uses a rounded outline when unpinned and a matching fill when pinned', () => {
    const root = document.createElement('div');
    const dispose = render(() => [
      createComponent(FlowerPinIcon, { class: 'h-3.5 w-3.5' }),
      createComponent(FlowerPinIcon, { pinned: true }),
    ], root);
    const icons = root.querySelectorAll<SVGSVGElement>('[data-flower-pin-icon]');

    expect(icons).toHaveLength(2);
    expect(icons[0].getAttribute('data-pinned')).toBe('false');
    expect(icons[0].querySelector('path')?.getAttribute('fill')).toBe('none');
    expect(icons[1].getAttribute('data-pinned')).toBe('true');
    expect(icons[1].querySelector('path')?.getAttribute('fill')).toBe('currentColor');
    expect(icons[0].querySelector('path')?.getAttribute('d')).toBe(icons[1].querySelector('path')?.getAttribute('d'));
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    dispose();
  });
});
