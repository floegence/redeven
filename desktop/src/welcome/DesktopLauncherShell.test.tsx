import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'solid-js/web';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  TopBar: (props: { ariaLabel?: string; logo?: JSX.Element; actions?: JSX.Element }) => (
    <header data-floe-shell-slot="top-bar" aria-label={props.ariaLabel}>
      <div>
        <div data-top-bar-logo="true">{props.logo}</div>
        <button type="button">Search desktop commands...</button>
        <div data-top-bar-actions="true">{props.actions}</div>
      </div>
    </header>
  ),
  BottomBar: (props: { class?: string; children?: JSX.Element }) => (
    <footer data-floe-shell-slot="bottom-bar" class={props.class}>
      {props.children}
    </footer>
  ),
}));

async function renderShell(): Promise<string> {
  const { DesktopLauncherShell } = await import('./DesktopLauncherShell');

  return renderToString(() => (
    <DesktopLauncherShell
      mainContentId="redeven-desktop-main"
      skipLinkLabel="Skip to Redeven Desktop content"
      topBarLabel="Redeven Desktop toolbar"
      logo={<button type="button">Logo</button>}
      trailingActions={<button type="button">Theme</button>}
      bottomBarLeading={<span>Connect Environment</span>}
      bottomBarTrailing={<span>Disconnected</span>}
    >
      <main id="redeven-desktop-main">Content</main>
    </DesktopLauncherShell>
  ));
}

describe('DesktopLauncherShell', () => {
  it('renders the shared top bar so the launcher stays aligned with other pages', async () => {
    const html = await renderShell();

    expect(html).toContain('data-floe-shell-slot="top-bar"');
    expect(html).toContain('data-top-bar-logo="true"');
    expect(html).toContain('data-top-bar-actions="true"');
    expect(html).toContain('Search desktop commands...');
    expect(html).not.toContain('data-redeven-desktop-titlebar-region="center"');
  });

  it('keeps skip-link and shared shell affordances in the desktop launcher shell', async () => {
    const html = await renderShell();

    expect(html).toContain('href="#redeven-desktop-main"');
    expect(html).toContain('data-floe-shell-slot="bottom-bar"');
  });

  it('keeps the launcher content slot full-width instead of shrinking to child content width', async () => {
    const html = await renderShell();

    expect(html).toContain('class="relative min-h-0 min-w-0 flex-1 overflow-hidden"');
    expect(html).not.toContain('class="flex-1 min-h-0 flex overflow-hidden relative"');
  });
});
