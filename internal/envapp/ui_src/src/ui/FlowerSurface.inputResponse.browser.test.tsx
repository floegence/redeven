import '../index.css';
import './flower-feature.css';

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { page, userEvent } from 'vitest/browser';

import {
  adapter,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower input response presentation', () => {
  beforeEach(async () => { await page.viewport(1280, 900); });
  it('renders the Continue action as a capsule without reshaping the decision surface', async () => {
    const waitingThread = thread({
      thread_id: 'thread-input-capsule',
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-capsule"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-capsule"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="input_request"]') as HTMLElement;
    const continueButton = surface.querySelector('.flower-composer-continue') as HTMLButtonElement;
    expect(window.getComputedStyle(continueButton).borderRadius).toBe('9999px');
    const continueRect = continueButton.getBoundingClientRect();
    expect(continueRect.width).toBeGreaterThan(continueRect.height);
    expect(window.getComputedStyle(surface).borderRadius).not.toBe('9999px');
  });

  it('renders settled questions and answers in one ordered receipt without choices', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    onTestFinished(() => write.mockRestore());
    const settledThread = thread({
      thread_id: 'thread-input-response-receipt',
      status: 'success',
      messages: [{
        id: 'interaction-input-response',
        thread_id: 'thread-input-response-receipt',
        turn_id: 'turn-input-response',
        run_id: 'run-input-response',
        role: 'user',
        content: 'Second question?\nsecond answer\n\nFirst question?\nfirst answer\n\nDeployment token?',
        status: 'complete',
        created_at_ms: 21_000,
        blocks: [{
          type: 'input-response',
          questions: [
            { question_id: 'second', question: 'Second question?', answer: 'second answer' },
            { question_id: 'first', question: 'First question?', answer: 'first answer' },
            { question_id: 'token', question: 'Deployment token?', redacted: true },
          ],
        }],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [settledThread]),
      loadThread: vi.fn(async () => liveBootstrap(settledThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-response-receipt"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-response-receipt"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-response]')));

    const receipt = runtime.querySelector('[data-flower-input-response]') as HTMLElement;
    const rows = Array.from(receipt.querySelectorAll<HTMLElement>('[data-flower-input-response-question]'));
    expect(rows.map((row) => row.dataset.flowerInputResponseQuestion)).toEqual(['second', 'first', 'token']);
    expect(rows[0]?.textContent).toContain('Second question?');
    expect(rows[0]?.textContent).toContain('second answer');
    expect(rows[1]?.textContent).toContain('First question?');
    expect(rows[1]?.textContent).toContain('first answer');
    expect(rows[2]?.textContent).toContain('Deployment token?');
    expect(rows[2]?.textContent).toContain('Answer hidden');
    expect(receipt.querySelector('.flower-input-request-choice')).toBeNull();
    expect(receipt.querySelector('button, details, [hidden]')).toBeNull();
    expect(receipt.querySelector('.flower-input-response-status-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(receipt.textContent).not.toContain('secret-token');
    expect(getComputedStyle(receipt).fontSize).toBe('14px');
    expect(getComputedStyle(receipt.querySelector('.flower-input-response-status')!).fontSize).toBe('12px');
    for (const content of receipt.querySelectorAll('.flower-input-response-question, .flower-input-response-answer')) {
      expect(getComputedStyle(content).fontSize).toBe('14px');
      expect(parseFloat(getComputedStyle(content).lineHeight)).toBeGreaterThanOrEqual(22);
    }
    expect(getComputedStyle(receipt).borderRadius).toBe('12px');
    expect(getComputedStyle(receipt).paddingInlineStart).toBe('16px');
    expect(getComputedStyle(receipt.querySelector('.flower-input-response-question')!).fontWeight).toBe('400');
    expect(getComputedStyle(receipt.querySelector('.flower-input-response-answer')!).fontWeight).toBe('500');
    const copy = runtime.querySelector<HTMLButtonElement>('.flower-message-copy-button-user')!;
    await userEvent.click(copy);
    expect(write).toHaveBeenLastCalledWith('Second question?\nsecond answer\n\nFirst question?\nfirst answer\n\nDeployment token?\nAnswer hidden');
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    expect(getComputedStyle(editor).fontSize).toBe('14px');
    expect(parseFloat(getComputedStyle(editor).lineHeight)).toBeGreaterThanOrEqual(22);
    await page.screenshot({ element: runtime, path: '__screenshots__/flower-reading-14px-receipt.png' });
    await page.viewport(375, 900);
    await waitFor(() => receipt.getBoundingClientRect().width < 375);
    expect(receipt.scrollWidth).toBeLessThanOrEqual(receipt.clientWidth + 1);
  });

  it('keeps complete long questions, multiline answers and selection stable across themes and narrow screens', async () => {
    const question = '新方案消除现网 cosign 前置要求，还需要正式 Runtime 发版和公网安装入口切换。你已明确授权代码提交、合并、清理和 push；是否也授权本次完成正式发布与线上切换？';
    const answer = '本次只交付代码\n保留现有入口，等验证完成后再切换。';
    const selected = thread({ status: 'success', messages: [{
      id: 'long-receipt', turn_id: 'long-receipt-turn', run_id: 'long-receipt-run',
      role: 'user', content: `${question}\n${answer}`, status: 'complete', created_at_ms: 22_000,
      blocks: [{ type: 'input-response', questions: [{ question_id: 'release', question, answer }] }],
    }] });
    const root = document.documentElement;
    const originalClass = root.className;
    const originalTheme = root.getAttribute('data-floe-shell-theme');
    onTestFinished(() => {
      root.className = originalClass;
      if (originalTheme === null) root.removeAttribute('data-floe-shell-theme');
      else root.setAttribute('data-floe-shell-theme', originalTheme);
      window.getSelection()?.removeAllRanges();
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected),
    });
    runtime.style.cssText = 'width:100%;height:900px';
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${selected.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-response]')));
    const receipt = runtime.querySelector<HTMLElement>('[data-flower-input-response]')!;
    await waitFor(() => !runtime.querySelector('.flower-chat-transcript[data-flower-tail-preparing]'));
    await document.fonts.ready;
    const prompt = receipt.querySelector<HTMLElement>('dt')!;
    const response = receipt.querySelector<HTMLElement>('dd')!;
    for (const width of [1280, 390, 320]) {
      await page.viewport(width, 900);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const range = document.createRange(); range.selectNodeContents(prompt);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      for (const theme of ['classic-dark', 'classic-light', 'solarized-light']) {
        root.classList.toggle('dark', theme === 'classic-dark');
        root.classList.toggle('light', theme !== 'classic-dark');
        root.dataset.floeShellTheme = theme;
        const label = `${width}/${theme}`;
        expect(prompt.textContent, label).toBe(question);
        expect(response.textContent, label).toBe(answer);
        expect(getComputedStyle(prompt).color, label).toBe(getComputedStyle(response).color);
        expect(getComputedStyle(response).whiteSpace, label).toBe('pre-wrap');
        expect(window.getSelection()!.toString(), label).toBe(question);
        expect(runtime.querySelector('[data-flower-input-response]'), label).toBe(receipt);
        expect(receipt.scrollWidth, label).toBeLessThanOrEqual(receipt.clientWidth + 1);
        await expect.element(page.elementLocator(prompt)).toBeVisible();
        await expect.element(page.elementLocator(response)).toBeVisible();
        if (width !== 390) {
          window.getSelection()!.removeAllRanges();
          await page.screenshot({ element: runtime, path: `__screenshots__/flower-full-context-${theme}-${width}.png` });
          window.getSelection()!.addRange(range);
        }
      }
    }
  });
});
