import '../index.css';
import './flower-feature.css';

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
        <main class="flower-chat-main"></main>
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

afterEach(() => {
  document.body.replaceChildren();
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
});
