// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createRedevenPluginSurfaceContext, pluginSurfaceContextFingerprint } from './pluginSurfaceContext';

afterEach(() => {
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
});

describe('Redeven plugin surface context', () => {
  it('projects semantic theme tokens into the closed protocol palette', () => {
    const root = document.documentElement;
    root.style.setProperty('--background', '#123');
    root.style.setProperty('--foreground', 'rgb(10, 20, 30)');
    root.style.setProperty('--primary', 'rgba(40, 50, 60, 0.5)');

    const context = createRedevenPluginSurfaceContext(7, 'de-DE');

    expect(context).toMatchObject({
      schema_version: 'redevplugin.surface_context.v1',
      revision: 7,
      appearance: {
        color_scheme: 'light',
        colors: {
          canvas: '#112233',
          text: '#0a141e',
          accent: '#28323c80',
        },
      },
      locale: { language_tag: 'de-DE', direction: 'ltr' },
    });
  });

  it('uses the dark fallback palette and current document direction', () => {
    document.documentElement.classList.add('dark');
    document.documentElement.dir = 'rtl';

    const context = createRedevenPluginSurfaceContext(2, 'ar-SA');

    expect(context.appearance.color_scheme).toBe('dark');
    expect(context.appearance.colors.canvas).toBe('#171b22');
    expect(context.locale).toEqual({ language_tag: 'ar-SA', direction: 'rtl' });
  });

  it('excludes the revision from change detection', () => {
    const first = createRedevenPluginSurfaceContext(1, 'en-US');
    const second = createRedevenPluginSurfaceContext(2, 'en-US');

    expect(pluginSurfaceContextFingerprint(first)).toBe(pluginSurfaceContextFingerprint(second));
  });
});
