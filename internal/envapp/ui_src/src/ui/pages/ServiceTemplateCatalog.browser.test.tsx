import '../../index.css';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';

import {
  ServiceTemplateCatalog,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{ reducedMotion?: null | 'reduce' | 'no-preference' }>) => Promise<void>;
}>;

const template: ServiceTemplatePresentation = {
  id: 'deepseek-harness-host',
  name: 'DeepSeek Harness',
  description: 'Run DeepSeek Harness directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  deploymentLabel: 'Host',
  version: '0.1.1-rc.2',
  developerPreview: true,
  available: true,
  installed: false,
  duplicateable: true,
  editable: false,
};

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

  it('uses the available content width and exposes a clear keyboard focus path', async () => {
    await page.viewport(1280, 720);
    mount();

    const catalog = document.querySelector<HTMLElement>('[data-testid="service-template-catalog"]')!;
    const card = document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!;
    expect(card.getBoundingClientRect().width / catalog.getBoundingClientRect().width).toBeGreaterThan(0.97);

    await userEvent.tab();
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect((document.activeElement as HTMLElement).className).toContain('focus-visible');
  });

  it('resolves the card surface through both light and dark theme tokens', () => {
    document.documentElement.classList.add('light');
    mount();
    const card = document.querySelector<HTMLElement>('[data-testid="service-template-card"]')!;
    const lightBackground = getComputedStyle(card).backgroundColor;

    document.documentElement.classList.replace('light', 'dark');
    const darkBackground = getComputedStyle(card).backgroundColor;

    expect(lightBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBackground).not.toBe(lightBackground);
  });

  it('keeps card actions touchable and stacked on narrow screens', async () => {
    await page.viewport(390, 760);
    mount();

    const footer = document.querySelector<HTMLElement>('.service-template-card__footer')!;
    const deploy = document.querySelector<HTMLElement>('[data-testid="service-template-primary"]')!;
    const more = document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!;
    expect(getComputedStyle(footer).flexDirection).toBe('column');
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
});
