// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { RedevenLoadingCurtain } from './RedevenLoadingCurtain';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RedevenLoadingCurtain', () => {
  it('renders an accessible component-scoped status curtain', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <RedevenLoadingCurtain
        visible
        eyebrow="Files"
        message="Loading files..."
        dataStage="files"
      />
    ), host);

    try {
      const curtain = host.querySelector('.redeven-loading-curtain') as HTMLElement | null;
      expect(curtain).toBeTruthy();
      expect(curtain?.getAttribute('role')).toBe('status');
      expect(curtain?.getAttribute('aria-busy')).toBe('true');
      expect(curtain?.getAttribute('data-redeven-loading-curtain-surface')).toBe('component');
      expect(curtain?.getAttribute('data-redeven-loading-curtain-stage')).toBe('files');
      expect(curtain?.textContent).toContain('Files');
      expect(curtain?.textContent).toContain('Loading files...');
      expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Loading files...');
    } finally {
      dispose();
    }
  });

  it('can render as a passive fullscreen curtain without mounting when hidden', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <>
        <RedevenLoadingCurtain visible={false} message="Hidden" />
        <RedevenLoadingCurtain visible surface="fullscreen" blocking={false} message="Connecting..." />
      </>
    ), host);

    try {
      expect(host.textContent).not.toContain('Hidden');
      const curtain = host.querySelector('.redeven-loading-curtain') as HTMLElement | null;
      expect(curtain?.className).toContain('redeven-loading-curtain--fullscreen');
      expect(curtain?.className).toContain('redeven-loading-curtain--passive');
      expect(curtain?.textContent).toContain('Connecting...');
    } finally {
      dispose();
    }
  });
});
