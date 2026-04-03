import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'solid-js/web';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Search: (props: { class?: string }) => <span data-icon="search" class={props.class} />,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
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
      commandPlaceholder="Search desktop commands..."
      commandKeybind="Ctrl+K"
      onOpenCommandPalette={() => {}}
      trailingActions={<button type="button">Theme</button>}
      bottomBarLeading={<span>Connect Environment</span>}
      bottomBarTrailing={<span>Disconnected</span>}
    >
      <main id="redeven-desktop-main">Content</main>
    </DesktopLauncherShell>
  ));
}

describe('DesktopLauncherShell', () => {
  it('renders a dedicated titlebar surface with a centered command trigger', async () => {
    const html = await renderShell();

    expect(html).toContain('data-redeven-desktop-titlebar-surface="true"');
    expect(html).toContain('data-redeven-desktop-titlebar-drag-region="true"');
    expect(html).toContain('data-redeven-desktop-titlebar-region="center"');
    expect(html).toContain('data-redeven-desktop-command-trigger');
    expect(html).toContain('Search desktop commands...');
    expect(html).toContain('Ctrl+K');
  });

  it('keeps skip-link and no-drag affordances in the desktop launcher shell', async () => {
    const html = await renderShell();

    expect(html).toContain('href="#redeven-desktop-main"');
    expect(html).toContain('data-redeven-desktop-titlebar-no-drag="true"');
    expect(html).toContain('data-floe-shell-slot="bottom-bar"');
  });
});
