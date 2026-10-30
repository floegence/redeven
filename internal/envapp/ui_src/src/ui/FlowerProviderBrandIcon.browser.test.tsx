import '../index.css';
import '../../../../flower_ui/src/styles/flower.css';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerProviderBrandIcon } from '../../../../flower_ui/src/settings/FlowerProviderBrandIcon';
import { FLOWER_PROVIDER_ICON_DEFINITIONS } from '../../../../flower_ui/src/settings/providerBrandIcons';
import { FLOWER_PROVIDER_TYPES } from '../../../../flower_ui/src/settings/providerCatalog';
import type { FlowerProviderType } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

it.each([{ dark: false, width: 1000 }, { dark: true, width: 1000 }, { dark: false, width: 390 }, { dark: true, width: 390 }])('renders every upstream brand at model-menu, picker and settings sizes ($width px, dark=$dark)', async ({ dark, width }) => {
  await page.viewport(width, 900);
  document.documentElement.classList.toggle('dark', dark);
  host = document.createElement('div');
  host.style.cssText = 'padding:24px;background:var(--background);color:var(--foreground)';
  document.body.append(host);
  dispose = render(() => <div style={{ display: 'grid', 'grid-template-columns': width < 500 ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: '24px' }}>
    <For each={[12, 16, 20, 24]}>{size => <div>
      <h2>{size}px</h2>
      <For each={FLOWER_PROVIDER_TYPES}>{({ value, label }) => <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', height: '44px' }}>
        <FlowerProviderBrandIcon type={value} class={size === 12 ? 'flower-model-menu-icon' : size === 16 ? 'h-4 w-4' : size === 20 ? 'h-5 w-5' : 'h-6 w-6'} />
        <span title={label} style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{label}</span>
      </div>}</For>
    </div>}</For>
  </div>, host);

  const brands = [...host.querySelectorAll<HTMLElement>('[data-flower-provider-brand]')];
  expect(brands).toHaveLength(FLOWER_PROVIDER_TYPES.length * 4);
  for (const [index, brand] of brands.entries()) {
    const type = brand.dataset.flowerProviderBrand as FlowerProviderType;
    const icon = FLOWER_PROVIDER_ICON_DEFINITIONS[type];
    expect(brand.getAttribute('aria-label')).toBe(icon.title);
    expect(brand.getAttribute('role')).toBe('img');
    const size = [12, 16, 20, 24][Math.floor(index / FLOWER_PROVIDER_TYPES.length)];
    const mark = brand.firstElementChild as HTMLElement;
    expect(brand.getBoundingClientRect().width).toBe(size);
    expect(mark.getBoundingClientRect().width).toBe(size);
    expect(mark.getBoundingClientRect().height).toBe(size);
    const image = new Image(); image.src = icon.src;
    await image.decode();
    expect(image.naturalWidth, type + ' decodes').toBeGreaterThan(0);
    if (icon.monochrome) {
      expect(getComputedStyle(mark).maskImage).not.toBe('none');
      expect(getComputedStyle(mark).backgroundColor).toBe(getComputedStyle(host).color);
    } else {
      expect(mark.tagName).toBe('IMG');
      await (mark as HTMLImageElement).decode();
      expect((mark as HTMLImageElement).src).toBe(icon.src);
    }
    expect(brand.querySelector('svg')).toBeNull();
  }
  await page.screenshot({ element: host, path: '__screenshots__/provider-brands-' + width + '-' + (dark ? 'dark' : 'light') + '.png' });
});

it('updates the mark and accessible name when a connection type changes', async () => {
  host = document.createElement('div'); document.body.append(host);
  const [type, setType] = createSignal<FlowerProviderType>('anthropic');
  dispose = render(() => <FlowerProviderBrandIcon type={type()} class="h-6 w-6" />, host);
  const brand = host.firstElementChild!;
  for (const next of ['anthropic', 'google', 'kimi_code', 'chatglm', 'openai_compatible'] as const) {
    setType(next);
    expect(host.firstElementChild).toBe(brand);
    expect(brand.getAttribute('aria-label')).toBe(FLOWER_PROVIDER_ICON_DEFINITIONS[next].title);
    expect(brand.getAttribute('data-flower-provider-brand')).toBe(next);
    expect(brand.querySelectorAll('img, .flower-provider-brand-mask')).toHaveLength(1);
  }
});
