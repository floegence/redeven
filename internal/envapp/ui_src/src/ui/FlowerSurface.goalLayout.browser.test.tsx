import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

it.each([
  ['en-US', 'light', 1280, 'full'], ['zh-CN', 'dark', 1280, 'full'],
  ['en-US', 'dark', 390, 'full'], ['zh-CN', 'light', 390, 'full'],
  ['en-US', 'light', 1280, 'companion'], ['zh-CN', 'dark', 390, 'companion'],
] as const)('keeps Goal entry aligned and stationary through typing and exit (%s, %s, %ipx, %s)', async (locale, theme, width, presentation) => {
  await page.viewport(width, 900);
  const previousClass = document.documentElement.className;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  onTestFinished(() => { document.documentElement.className = previousClass; });
  const conversation = thread({ messages: Array.from({ length: 30 }, (_, index) => ({
    id: `message-${index}`, turn_id: `turn-${index}`, role: 'user', content: `Conversation message ${index}`,
    status: 'complete', created_at_ms: index + 1,
  })) });
  const manageGoal = vi.fn();
  const i18n = createTestI18nHelpers(locale);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), manageGoal, loadThread: async () => liveBootstrap(conversation) }, {
    presentation, companionOpen: true, layout: true,
    copy: createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) }),
    focusThreadRequest: { request_id: 'goal-layout', thread_id: conversation.thread_id },
  });
  surface.style.cssText = 'width:100%;height:800px';
  const input = () => surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await waitFor(() => Boolean(input()) && surface.textContent?.includes('Conversation message 29') === true);
  await document.fonts.ready;
  for (let index = 0; index < 5; index++) await frame();
  const editor = input();
  const composer = surface.querySelector<HTMLElement>('.flower-composer')!;
  const footer = surface.querySelector<HTMLElement>('.flower-composer-footer')!;
  const transcript = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
  const geometry = () => [composer.getBoundingClientRect().top, composer.getBoundingClientRect().height,
    footer.getBoundingClientRect().top, transcript.getBoundingClientRect().height, transcript.scrollTop, window.scrollY];
  const initial = geometry();
  const samples: number[][] = [];
  let sampling = true;
  const sample = () => { if (sampling) { samples.push(geometry()); requestAnimationFrame(sample); } };
  requestAnimationFrame(sample);
  onTestFinished(() => { sampling = false; });
  await userEvent.fill(editor, '/goal');
  await userEvent.keyboard(' ');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-command-chip')));
  for (let index = 0; index < 4; index++) await frame();
  expect(input()).toBe(editor);
  expect(editor.value).toBe('');
  const chip = surface.querySelector<HTMLElement>('.flower-goal-command-chip')!;
  const inputStyle = getComputedStyle(editor);
  const inputLineTop = editor.getBoundingClientRect().top + parseFloat(inputStyle.paddingTop) + parseFloat(inputStyle.borderTopWidth);
  const inputLineCenter = inputLineTop + parseFloat(inputStyle.lineHeight) / 2;
  expect.soft(Math.abs(chip.getBoundingClientRect().top + chip.getBoundingClientRect().height / 2 - inputLineCenter)).toBeLessThanOrEqual(1);
  expect.soft(getComputedStyle(chip).fontSize).toBe(inputStyle.fontSize);
  await userEvent.type(editor, locale === 'en-US' ? 'Verify result' : '验证目标');
  for (let index = 0; index < 4; index++) await frame();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !surface.querySelector('.flower-goal-command-chip'));
  for (let index = 0; index < 4; index++) await frame();
  sampling = false;
  const drift = Math.max(...samples.flatMap(sample => sample.map((value, index) => Math.abs(value - initial[index]!))));
  expect(drift, JSON.stringify({ initial, samples })).toBeLessThanOrEqual(1);
  expect(document.activeElement).toBe(editor);
  expect(manageGoal).not.toHaveBeenCalled();
  // Native paste/fill can leave the DOM ahead of an unchanged empty draft.
  await userEvent.fill(editor, '/goal ');
  for (let index = 0; index < 4; index++) await frame();
  expect(editor.value).toBe('');
  expect(editor.placeholder).toBe(locale === 'zh-CN' ? '设置目标' : 'Set a goal');
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await page.screenshot({ element: surface, path: `__screenshots__/goal-entry-${locale}-${theme}-${width}-${presentation}.png` });
  }
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-command-chip button')!);
  expect(editor.value).toBe('');
  await userEvent.fill(editor, '/goal Verify\nall requirements');
  expect(editor.value).toBe('Verify\nall requirements');
  await userEvent.keyboard('{Escape}');
  await userEvent.fill(editor, '/goal ');
  await userEvent.keyboard('{Backspace}');
  expect(surface.querySelector('.flower-goal-command-chip')).toBeNull();
});
