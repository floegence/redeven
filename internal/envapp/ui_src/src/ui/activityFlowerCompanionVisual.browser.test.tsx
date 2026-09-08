import '../index.css';
import './flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';

const mediaCommands = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};

function mountCompanion(phase: 'expanding' | 'expanded' | 'collapsing' | 'collapsed'): {
  companion: HTMLDivElement;
  composer: HTMLDivElement;
} {
  const companion = document.createElement('div');
  companion.className = 'flower-activity-companion floe-bottom-bar-companion';
  companion.dataset.companionPhase = phase;
  companion.innerHTML = `
    <div class="flower-component-shell flower-surface flower-surface-companion${phase === 'collapsed' || phase === 'collapsing' ? ' flower-surface-companion-collapsed' : ''}">
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
          <div class="flower-composer p-3"><textarea aria-label="Ask Flower"></textarea></div>
        </footer>
      </section>
    </div>
  `;
  document.body.appendChild(companion);
  const composer = companion.querySelector('.flower-composer');
  if (!(composer instanceof HTMLDivElement)) throw new Error('Flower composer fixture did not mount.');
  return { companion, composer };
}

function expectUnframedComposer(composer: HTMLElement): void {
  const style = getComputedStyle(composer);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect(style.getPropertyValue(`border-${side}-width`)).toBe('0px');
  }
  expect(style.borderRadius).toBe('0px');
  expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(style.boxShadow).toBe('none');
  expect(style.backdropFilter).toBe('none');
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

afterEach(async () => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('style');
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

describe('Flower bottom companion computed visual contract', () => {
  it('keeps the collapsed composer transparent and shadowless', () => {
    const { companion, composer } = mountCompanion('collapsed');
    const frameStyle = getComputedStyle(companion);
    expect(frameStyle.boxShadow).toBe('none');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(frameStyle.getPropertyValue(`border-${side}-width`)).toBe('1px');
    }
    expect(frameStyle.borderRadius).toBe('5px');
    expectUnframedComposer(composer);
  });

  it('keeps the calm frame treatment continuous across drawer transition phases', () => {
    const styles = (['expanding', 'expanded', 'collapsing'] as const).map((phase) => {
      const { companion, composer } = mountCompanion(phase);
      const frameStyle = getComputedStyle(companion);
      const composerStyle = getComputedStyle(composer);
      if (phase === 'collapsing') {
        expectUnframedComposer(composer);
      } else {
        expect(composerStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(composerStyle.boxShadow).not.toBe('none');
      }
      return {
        background: frameStyle.backgroundColor,
        border: frameStyle.borderColor,
        shadow: frameStyle.boxShadow,
      };
    });

    expect(styles[0]).toEqual(styles[1]);
    expect(styles[1]).toEqual(styles[2]);
    expect(styles[0]?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles[0]?.shadow).not.toBe('none');
  });

  it.each(['classic-light', 'classic-dark', 'abyss', 'nord'])('keeps one outline through collapsed states in %s', async (theme) => {
    applyTheme(theme, theme === 'classic-light' ? 'light' : 'dark');
    for (const width of [1440, 390]) {
      await page.viewport(width, 800);
      for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        await mediaCommands.emulateMediaPreferences({ reducedMotion });
        const { companion, composer } = mountCompanion('collapsed');
        const surface = companion.querySelector<HTMLElement>('.flower-surface')!;
        const textarea = composer.querySelector('textarea')!;
        expectUnframedComposer(composer);
        surface.dataset.flowerWarmup = 'true';
        composer.dataset.flowerAttachmentDrag = 'true';
        composer.classList.add('flower-decision-surface');
        textarea.focus();
        expectUnframedComposer(composer);
        for (const mode of ['approval', 'input_request', 'chat']) {
          composer.dataset.flowerBottomMode = mode;
          expectUnframedComposer(composer);
        }
        companion.dataset.companionPhase = 'collapsing';
        expectUnframedComposer(composer);
        companion.remove();
      }
    }
  });

  it.each(['full-page', 'workbench'])('retains the editor frame outside the companion in %s', (placement) => {
    const { companion, composer } = mountCompanion('expanded');
    const surface = companion.querySelector<HTMLElement>('.flower-surface')!;
    surface.classList.remove('flower-surface-companion');
    surface.dataset.flowerPresentation = 'full';
    const host = document.createElement('div');
    if (placement === 'workbench') host.className = 'workbench-widget';
    document.body.append(host);
    host.append(surface);
    const style = getComputedStyle(composer);
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('14px');
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.boxShadow).not.toBe('none');
    for (const mode of ['approval', 'input_request']) {
      composer.classList.add('flower-decision-surface');
      composer.dataset.flowerBottomMode = mode;
      expect(getComputedStyle(composer).borderRadius).toBe('14px');
    }
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
