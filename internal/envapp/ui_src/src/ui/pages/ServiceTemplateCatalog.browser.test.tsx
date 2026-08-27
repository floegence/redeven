import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Dialog } from '@floegence/floe-webapp-core/ui';

import {
  ServiceTemplateCatalog,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{ reducedMotion?: null | 'reduce' | 'no-preference' }>) => Promise<void>;
}>;

const template: ServiceTemplatePresentation = {
  id: 'deepseek-harness-host',
  name: 'DeepSeek Harness',
  description: 'Run DeepSeek Harness directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  brandIcon: 'deepseek-harness',
  deploymentLabel: 'Host',
  version: '0.1.1-rc.2',
  developerPreview: true,
  available: true,
  installed: false,
  duplicateable: true,
  editable: false,
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('ServiceTemplateCatalog browser presentation', () => {
  let dispose: (() => void) | undefined;

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    document.documentElement.classList.remove('light', 'dark');
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    await page.viewport(1280, 720);
  });

  function mount(): void {
    const host = document.createElement('div');
    host.className = 'mx-auto w-[900px] max-w-full bg-card p-4';
    document.body.appendChild(host);
    dispose = render(() => (
      <ServiceTemplateCatalog
        category="host"
        query=""
        hostCount={1}
        containerCount={0}
        templates={[template]}
        loading={false}
        canManage
        onCategoryChange={() => undefined}
        onQueryChange={() => undefined}
        onCreate={() => undefined}
        onDeploy={() => undefined}
        onDuplicate={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    ), host);
  }

  it('uses a gallery and adjacent detail pane with a clear keyboard selection path', async () => {
    await page.viewport(1280, 720);
    mount();

    const catalog = document.querySelector<HTMLElement>('[data-testid="service-template-catalog"]')!;
    const card = document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    expect(card.getBoundingClientRect().width / catalog.getBoundingClientRect().width).toBeLessThan(0.5);
    expect(details.getBoundingClientRect().left).toBeGreaterThan(card.getBoundingClientRect().right);
    expect(card.getAttribute('aria-selected')).toBe('true');

    await userEvent.tab();
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect((document.activeElement as HTMLElement).className).toContain('focus-visible');
  });

  it('resolves the card surface through both light and dark theme tokens', () => {
    document.documentElement.classList.add('light');
    mount();
    const catalogSurface = document.querySelector<HTMLElement>('.service-template-catalog__canvas')!;
    const card = document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const lightBackground = getComputedStyle(card).backgroundColor;
    const lightCatalogBackground = getComputedStyle(catalogSurface).backgroundColor;
    const lightDetailsBackground = getComputedStyle(details).backgroundColor;

    document.documentElement.classList.replace('light', 'dark');
    const darkBackground = getComputedStyle(card).backgroundColor;

    expect(lightBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(lightBackground).not.toBe(lightCatalogBackground);
    expect(lightDetailsBackground).not.toBe(lightCatalogBackground);
    expect(darkBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBackground).not.toBe(lightBackground);
  });

  it('stacks the selected template detail pane with touchable actions on narrow screens', async () => {
    await page.viewport(390, 760);
    mount();

    const layout = document.querySelector<HTMLElement>('.service-template-catalog__layout')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const deploy = document.querySelector<HTMLElement>('[data-testid="service-template-primary"]')!;
    const more = document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!;
    expect(getComputedStyle(layout).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(details.getBoundingClientRect().top).toBeGreaterThan(document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!.getBoundingClientRect().bottom);
    expect(deploy.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('removes decorative card and icon motion when reduced motion is requested', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    mount();

    const card = document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!;
    const icon = document.querySelector<HTMLElement>('.service-template-identity__icon')!;
    expect(getComputedStyle(card).transitionDuration).toBe('0s');
    expect(getComputedStyle(icon).transitionDuration).toBe('0s');
  });

  it('keeps catalog menus above the drawer and closes from the outside backdrop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [open, setOpen] = createSignal(true);
    const [action, setAction] = createSignal('');
    dispose = render(() => (
      <>
        <EnvAppDrawer
          open={open()}
          onOpenChange={setOpen}
          title="Service templates"
          description="Deploy a service in the current Environment."
        >
          <ServiceTemplateCatalog
            category="host"
            query=""
            hostCount={1}
            containerCount={0}
            templates={[template]}
            loading={false}
            canManage
            onCategoryChange={() => undefined}
            onQueryChange={() => undefined}
            onCreate={(kind) => setAction(`create:${kind}`)}
            onDeploy={() => undefined}
            onDuplicate={() => setAction('duplicate')}
            onEdit={() => undefined}
            onDelete={() => undefined}
          />
        </EnvAppDrawer>
        <Dialog
          open={action() === 'duplicate'}
          onOpenChange={(nextOpen) => { if (!nextOpen) setAction(''); }}
          title="Duplicate service template"
        >
          <p>Choose a name for the copy.</p>
        </Dialog>
      </>
    ), host);
    await settle();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!);
    await settle();
    const duplicate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Duplicate'))!;
    const duplicateRect = duplicate.getBoundingClientRect();
    const duplicateTopLayer = document.elementFromPoint(
      duplicateRect.left + duplicateRect.width / 2,
      duplicateRect.top + duplicateRect.height / 2,
    );
    expect(duplicate.contains(duplicateTopLayer) || duplicate === duplicateTopLayer).toBe(true);
    await userEvent.click(duplicate);
    await settle();
    expect(action()).toBe('duplicate');
    const nestedDialog = Array.from(document.querySelectorAll<HTMLElement>('[data-floe-dialog-panel]'))
      .find((dialog) => dialog.textContent?.includes('Duplicate service template'))!;
    const nestedRect = nestedDialog.getBoundingClientRect();
    const nestedTopLayer = document.elementFromPoint(
      nestedRect.left + nestedRect.width / 2,
      nestedRect.top + nestedRect.height / 2,
    );
    expect(nestedDialog.contains(nestedTopLayer) || nestedDialog === nestedTopLayer).toBe(true);
    setAction('');
    await settle();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="service-template-create-menu"]')!);
    await settle();
    const createHost = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('New host template'))!;
    const createRect = createHost.getBoundingClientRect();
    const createTopLayer = document.elementFromPoint(
      createRect.left + createRect.width / 2,
      createRect.top + createRect.height / 2,
    );
    expect(createHost.contains(createTopLayer) || createHost === createTopLayer).toBe(true);
    await userEvent.click(createHost);
    await settle();
    expect(action()).toBe('create:host');

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const panelRect = panel.getBoundingClientRect();
    const outsideTarget = document.elementFromPoint(Math.max(1, panelRect.left / 2), window.innerHeight / 2) as HTMLElement | null;
    expect(outsideTarget?.hasAttribute('data-floe-dialog-backdrop')).toBe(true);
    outsideTarget!.click();
    await settle();
    expect(open()).toBe(false);
  });
});
