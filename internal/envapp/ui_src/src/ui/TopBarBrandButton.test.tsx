// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopBarBrandButton } from './TopBarBrandButton';

vi.mock('./primitives/Tooltip', () => ({
  Tooltip: (props: any) => <div data-testid="tooltip" data-content={String(props.content ?? '')}>{props.children}</div>,
}));

describe('TopBarBrandButton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('keeps a 24px visual box while extending the hit area around it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TopBarBrandButton label="Back to dashboard">
        <img alt="Redeven" src="/logo.svg" />
      </TopBarBrandButton>
    ), host);

    const button = host.querySelector('button[aria-label="Back to dashboard"]');
    expect(button?.className).toContain('h-6');
    expect(button?.className).toContain('w-6');
    expect(button?.className).toContain('overflow-visible');
    expect(button?.className).toContain('before:-inset-1');
    expect(button?.className).toContain('cursor-pointer');
    expect(button?.className).not.toContain('before:pointer-events-none');
    expect(host.querySelector('[data-testid="tooltip"]')?.getAttribute('data-content')).toBe('Back to dashboard');
  });

  it('skips the tooltip wrapper when tooltip is disabled', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TopBarBrandButton label="Back to dashboard" tooltip={false}>
        <img alt="Redeven" src="/logo.svg" />
      </TopBarBrandButton>
    ), host);

    expect(host.querySelector('[data-testid="tooltip"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Back to dashboard"]')).not.toBeNull();
  });
});
