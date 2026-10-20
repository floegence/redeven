import { render } from 'solid-js/web';
import '../../../../tessiven_ui/src/tessiven.css';
import '../../../../tessiven_ui/native/native.css';
import { afterEach, expect, it, vi } from 'vitest';
import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { SUPPORTED_LOCALES } from '../ui/i18n/localeMeta';
import { sharedHostsVersion } from './tessiven-shared-hosts.fixture';

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
const originalHash = location.hash;
const originalLanguage = document.documentElement.lang;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
  host?.remove();
  history.replaceState(null, '', location.pathname + location.search + originalHash);
  document.documentElement.lang = originalLanguage;
});

it('localizes native canvas controls in every locale without replacing their state', async () => {
  history.replaceState(null, '', '#render_id=localization-test');
  const { NativeCanvas } = await import('../../../../tessiven_ui/src/native/NativeCanvas');
  host = document.createElement('div');
  host.style.cssText = 'width:1200px;height:800px;position:relative';
  document.body.append(host);
  dispose = render(() => <NativeCanvas />, host);
  const version = toRenderVersion(sharedHostsVersion());
  const controls = [...host.querySelectorAll('.native-canvas-tools button')];
  let sharedHost: Element | null = null;
  for (const locale of SUPPORTED_LOCALES) {
    window.serviceCanvas!.update({ render_id: 'localization-test', version, historical: false, dark: false, contrast: false, locale });
    await expect.poll(() => host!.querySelector('.tessiven-shared-host')).not.toBeNull();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const t = tessivenText(locale);
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe(t('canvasView'));
    expect(controls.map(button => button.getAttribute('aria-label'))).toEqual([t('zoomOut'), t('zoomIn'), t('fit')]);
    expect(host.querySelector('output')?.getAttribute('aria-label')).toBe(t('zoomLevel'));
    expect([...host.querySelectorAll('.native-canvas-tools button')]).toEqual(controls);
    expect(document.documentElement.lang).toBe(locale);
    const badge = host.querySelector('.tessiven-shared-host');
    expect(badge?.getAttribute('aria-label')).toBe(t('sharedHost', { count: 2 }));
    if (sharedHost) expect(badge).toBe(sharedHost);
    sharedHost = badge;
  }
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-Hant-HK']);
  window.serviceCanvas!.update({ render_id: 'localization-test', version, historical: false, dark: false, contrast: false });
  expect(document.documentElement.lang).toBe('zh-TW');
  expect(controls[0].getAttribute('aria-label')).toBe(tessivenText('zh-TW')('zoomOut'));
});
