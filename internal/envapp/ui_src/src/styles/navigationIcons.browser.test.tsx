import '../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { TessivenIcon } from '../../../../tessiven_ui/src/TessivenIcon';
import { ActivityBarHostApplicationsIcon } from '../ui/icons/ActivityBarDockIcons';
import { RemoteDesktopIcon } from '../ui/icons/RemoteDesktopIcon';
import { HostApplicationsWorkbenchIcon, RemoteDesktopWorkbenchIcon, TessivenWorkbenchIcon } from '../ui/icons/WorkbenchSoftIcons';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;

const media = commands as unknown as {
  emulateMediaPreferences: (value: { forcedColors: 'active' | 'none' }) => Promise<void>;
};

afterEach(async () => {
  dispose?.();
  host?.remove();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  await media.emulateMediaPreferences({ forcedColors: 'none' });
});

it('paints the Tessiven navigation mark before its lazy page has ever opened', () => {
  host = document.createElement('div');
  host.style.cssText = 'background:var(--background);color:var(--muted-foreground)';
  document.body.append(host);
  dispose = render(() => <TessivenIcon kind="tessiven" />, host);

  const icon = host.querySelector('svg')!;
  expect(getComputedStyle(icon.querySelector('.glyph-main')!).fill).not.toBe('none');
  expect(getComputedStyle(icon.querySelector('.glyph-accent')!).fill).not.toBe('none');
  expect(getComputedStyle(icon.querySelector('.glyph-line')!).stroke).not.toBe('none');
  expect(icon.getBoundingClientRect().width).toBe(23);
});

it.each(builtInShellThemePresets)('keeps navigation identities legible at actual sizes in $name', async (preset) => {
  await page.viewport(760, 400);
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => (
    <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: preset.mode === 'dark' ? 'dark' : 'light' } }}>
      <div style={{ width: '680px', padding: '28px', background: 'var(--background)', color: 'var(--foreground)' }}>
        <div style={{ 'font-size': '16px', 'font-weight': '600', 'margin-bottom': '24px' }}>{preset.name}</div>
        <div style={{ display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', gap: '24px' }}>
          <div data-navigation-identity="service-canvas">
            <div style={{ height: '52px', color: 'var(--muted-foreground)' }}><TessivenIcon kind="tessiven" /></div>
            <TessivenWorkbenchIcon />
            <div style={{ 'margin-top': '12px' }}>Tessiven</div>
          </div>
          <div data-navigation-identity="remote-desktop">
            <div style={{ height: '52px', color: 'var(--muted-foreground)' }}><RemoteDesktopIcon /></div>
            <RemoteDesktopWorkbenchIcon />
            <div style={{ 'margin-top': '12px' }}>Remote Desktop</div>
          </div>
          <div data-navigation-identity="host-applications">
            <div style={{ height: '52px', color: 'var(--muted-foreground)' }}><ActivityBarHostApplicationsIcon /></div>
            <HostApplicationsWorkbenchIcon />
            <div style={{ 'margin-top': '12px' }}>Host Applications</div>
          </div>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '20px', 'margin-top': '28px', color: 'var(--muted-foreground)' }}>
          <RemoteDesktopIcon size={16} /><RemoteDesktopIcon size={20} /><RemoteDesktopIcon />
          <RemoteDesktopWorkbenchIcon class="w-5 h-5" />
          <RemoteDesktopWorkbenchIcon class="w-8 h-8" />
        </div>
      </div>
    </FloeProvider>
  ), host);
  const root = document.documentElement;
  root.classList.toggle('dark', preset.mode === 'dark');
  root.dataset.theme = preset.mode;
  for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) root.style.setProperty(key, value);
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  const tessiven = host.querySelector('.tessiven-icon')!;
  const tessivenInk = getComputedStyle(tessiven).color;
  expect(getComputedStyle(tessiven.querySelector('.glyph-main')!).fill).toBe(tessivenInk);
  expect(getComputedStyle(tessiven.querySelector('.glyph-line')!).stroke).toBe(tessivenInk);
  expect(host.querySelector('[data-workbench-icon="remote-desktop"] .remote-desktop-glyph')).not.toBeNull();
  expect(host.querySelector('[data-workbench-icon="host-applications"] .remote-desktop-glyph')).toBeNull();
  for (const glyph of host.querySelectorAll('.remote-desktop-glyph')) {
    const screen = glyph.querySelector('rect')!;
    const pointer = glyph.querySelector('path:last-child')!;
    expect(getComputedStyle(screen).stroke).not.toBe('none');
    expect(getComputedStyle(pointer).fill).not.toBe('none');
    const bounds = glyph.getBoundingClientRect();
    const icon = glyph.closest('svg')!.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(icon.left);
    expect(bounds.right).toBeLessThanOrEqual(icon.right);
    expect(bounds.top).toBeGreaterThanOrEqual(icon.top);
    expect(bounds.bottom).toBeLessThanOrEqual(icon.bottom);
  }
  await page.screenshot({ element: host, path: `../../.vitest-attachments/navigation-icons-${preset.name}.png` });

  await media.emulateMediaPreferences({ forcedColors: 'active' });
  const pointer = host.querySelector('.remote-desktop-glyph path:last-child')!;
  expect(getComputedStyle(pointer).fill).not.toBe(getComputedStyle(pointer).stroke);
  expect(getComputedStyle(tessiven.querySelector('.glyph-main')!).fill).toBe(getComputedStyle(tessiven.querySelector('.glyph-line')!).stroke);
  if (preset.name === 'paper') {
    await page.screenshot({ element: host, path: '../../.vitest-attachments/navigation-icons-high-contrast.png' });
  }
});

it('retains navigation paint when the lazy canvas stylesheet arrives', async () => {
  host = document.createElement('div');
  host.style.color = 'var(--muted-foreground)';
  document.body.append(host);
  dispose = render(() => <TessivenIcon kind="tessiven" />, host);
  const icon = host.querySelector('svg')!;
  const paint = () => ['.glyph-main', '.glyph-accent', '.glyph-line'].map(selector => {
    const style = getComputedStyle(icon.querySelector(selector)!);
    return [style.fill, style.stroke];
  });
  const before = paint();
  await import('../../../../tessiven_ui/src/tessiven.css');
  expect(paint()).toEqual(before);
});
