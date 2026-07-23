import '../index.css';
import './flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, describe, expect, it } from 'vitest';

function mountCompanion(phase: 'expanding' | 'expanded' | 'collapsing' | 'collapsed'): {
  companion: HTMLDivElement;
  composer: HTMLDivElement;
} {
  const companion = document.createElement('div');
  companion.className = 'flower-activity-companion floe-bottom-bar-companion';
  companion.dataset.companionPhase = phase;
  companion.innerHTML = `
    <div class="flower-surface-companion${phase === 'collapsed' ? ' flower-surface-companion-collapsed' : ''}">
      <section class="flower-chat-shell">
        <header class="flower-chat-header">Flower</header>
        <main class="flower-chat-main">
          <div class="flower-empty-state">
            <span class="redeven-flower-soft-aura redeven-flower-soft-aura-lg redeven-flower-icon-breathe">
              <span class="redeven-flower-soft-aura-glow"></span>
            </span>
            <span class="companion-muted-copy">Secondary Flower status</span>
          </div>
        </main>
        <footer class="flower-chat-bottom-dock">
          <div class="flower-composer" tabindex="0">Ask Flower</div>
        </footer>
      </section>
    </div>
  `;
  document.body.appendChild(companion);
  const composer = companion.querySelector('.flower-composer');
  if (!(composer instanceof HTMLDivElement)) throw new Error('Flower composer fixture did not mount.');
  return { companion, composer };
}

function applyTheme(name: string, mode: 'light' | 'dark'): void {
  const preset = builtInShellThemePresets.find((candidate) => candidate.name === name);
  if (!preset) throw new Error(`Missing Floe shell theme preset: ${name}`);
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.dataset.floeShellTheme = name;
  for (const [token, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) document.documentElement.style.setProperty(token, value);
  }
}

function colorChannels(value: string): readonly [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas color context is unavailable.');
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

function relativeLuminance(value: string): number {
  const channels = colorChannels(value).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('style');
});

describe('Flower bottom companion computed visual contract', () => {
  it('keeps the collapsed composer transparent and shadowless', () => {
    const { companion, composer } = mountCompanion('collapsed');
    const frameStyle = getComputedStyle(companion);
    const composerStyle = getComputedStyle(composer);

    expect(frameStyle.boxShadow).toBe('none');
    expect(composerStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(composerStyle.borderTopWidth).toBe('0px');
    expect(composerStyle.boxShadow).toBe('none');
    expect(composerStyle.backdropFilter).toBe('none');
  });

  it('keeps the calm frame treatment continuous across drawer transition phases', () => {
    const styles = (['expanding', 'expanded', 'collapsing'] as const).map((phase) => {
      const { companion, composer } = mountCompanion(phase);
      const frameStyle = getComputedStyle(companion);
      const composerStyle = getComputedStyle(composer);
      return {
        background: frameStyle.backgroundColor,
        border: frameStyle.borderColor,
        shadow: frameStyle.boxShadow,
        composerBackground: composerStyle.backgroundColor,
        composerShadow: composerStyle.boxShadow,
      };
    });

    expect(styles[0]).toEqual(styles[1]);
    expect(styles[1]).toEqual(styles[2]);
    expect(styles[0]?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles[0]?.shadow).not.toBe('none');
    expect(styles[0]?.composerBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles[0]?.composerShadow).not.toBe('none');
  });

  it('does not leak companion surfaces into the full-page Flower shell', () => {
    const fullPageShell = document.createElement('section');
    fullPageShell.className = 'flower-chat-shell';
    const mainSurfaceProbe = document.createElement('div');
    mainSurfaceProbe.style.background = 'var(--redeven-surface-main)';
    document.body.appendChild(fullPageShell);
    document.body.appendChild(mainSurfaceProbe);
    const { companion } = mountCompanion('expanded');

    const fullPageBackground = getComputedStyle(fullPageShell).backgroundColor;
    expect(fullPageBackground).toBe(getComputedStyle(mainSurfaceProbe).backgroundColor);
    expect(fullPageBackground).not.toBe(getComputedStyle(companion).backgroundColor);
  });

  it.each(['classic-dark', 'abyss', 'nord'])('creates a clearly deeper calm surface in %s', (theme) => {
    applyTheme(theme, 'dark');
    const { companion, composer } = mountCompanion('expanded');
    const mainSurfaceProbe = document.createElement('div');
    mainSurfaceProbe.style.background = 'var(--redeven-surface-main)';
    document.body.appendChild(mainSurfaceProbe);
    const aura = companion.querySelector('.redeven-flower-soft-aura-glow');
    const breathe = companion.querySelector('.redeven-flower-icon-breathe');
    if (!(aura instanceof HTMLElement) || !(breathe instanceof HTMLElement)) {
      throw new Error('Flower aura fixture did not mount.');
    }

    const drawerStyle = getComputedStyle(companion);
    const composerStyle = getComputedStyle(composer);
    const mainSurface = getComputedStyle(mainSurfaceProbe).backgroundColor;
    const drawerLuminance = relativeLuminance(drawerStyle.backgroundColor);
    const mainLuminance = relativeLuminance(mainSurface);

    expect(drawerLuminance).toBeLessThan(mainLuminance * 0.82);
    expect(relativeLuminance(composerStyle.backgroundColor)).toBeGreaterThan(drawerLuminance);
    expect(getComputedStyle(aura).opacity).toBe('0.28');
    expect(getComputedStyle(aura).filter).toContain('blur(7px)');
    expect(getComputedStyle(aura).animationName).toBe('none');
    expect(getComputedStyle(breathe).animationName).toBe('none');
  });

  it('keeps the classic light surface restrained', () => {
    applyTheme('classic-light', 'light');
    const { companion } = mountCompanion('expanded');
    const mainSurfaceProbe = document.createElement('div');
    mainSurfaceProbe.style.background = 'var(--redeven-surface-main)';
    document.body.appendChild(mainSurfaceProbe);

    const drawerLuminance = relativeLuminance(getComputedStyle(companion).backgroundColor);
    const mainLuminance = relativeLuminance(getComputedStyle(mainSurfaceProbe).backgroundColor);
    expect(drawerLuminance).toBeGreaterThan(mainLuminance * 0.85);
  });
});
