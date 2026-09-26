import '../index.css';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createTestI18nHelpers } from '../ui/i18n/locales/testDictionaries';
import { SUPPORTED_LOCALES } from '../ui/i18n/localeMeta';
import { renderHostApplicationLaunchDocument } from '../ui/services/hostApplicationLaunchDocument';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  delete document.documentElement.dataset.floeShellTheme;
});

it.each(SUPPORTED_LOCALES.flatMap(locale => ['light', 'dark'].map(mode => ({ locale, mode }))))(
  'keeps browser launch recovery readable and actionable in $locale / $mode', async ({ locale, mode }) => {
    await page.viewport(390, 640);
    document.documentElement.classList.add(mode);
    document.documentElement.dataset.floeShellTheme = `porcelain-${mode}`;
    const frame = document.createElement('iframe');
    frame.title = 'Application launch';
    frame.style.cssText = 'width:360px;height:580px;border:0';
    document.body.append(frame);
    const popup = frame.contentWindow!;
    const copy = createTestI18nHelpers(locale);
    const retry = vi.fn();
    renderHostApplicationLaunchDocument(popup, {
      title: 'Text Editor <test>', icon: '', locale,
      heading: copy.t('hostApplications.errors.failed'), detail: '', failed: true,
    }, { retry: copy.t('hostApplications.retry'), dismiss: copy.t('hostApplications.dismiss'), onRetry: retry });
    const doc = frame.contentDocument!;
    await Promise.all(doc.getAnimations().map(animation => animation.finished));
    expect(doc.documentElement.lang).toBe(locale);
    expect(doc.querySelector('h1')!.textContent).toBe('Text Editor <test>');
    expect(doc.querySelector('h1 test')).toBeNull();
    expect(doc.querySelector('[role=alert]')!.textContent).toBe(copy.t('hostApplications.errors.failed'));
    expect(doc.querySelector('[role=progressbar]')).toBeNull();
    expect(popup.getComputedStyle(doc.querySelector('#heading')!).fontSize).toBe('12px');
    expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth);
    expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(doc.documentElement.clientHeight);
    const buttons = [...doc.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      expect(button.getBoundingClientRect().bottom).toBeLessThan(580);
      expect(popup.getComputedStyle(button).cursor).toBe('pointer');
      expect(popup.getComputedStyle(button).fontSize).toBe('12px');
    }
    buttons[0].focus();
    expect(doc.activeElement).toBe(buttons[0]);
    if (locale === 'en-US' || locale === 'zh-CN') {
      await page.screenshot({ element: frame, path: `__screenshots__/launch-error-${locale}-${mode}.png` });
    }
    buttons[0].click(); buttons[0].click();
    expect(retry).toHaveBeenCalledOnce();
  },
);
