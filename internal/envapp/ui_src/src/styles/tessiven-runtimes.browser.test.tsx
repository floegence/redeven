import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { TessivenRuntimesDialog } from '../../../../tessiven_ui/src/TessivenRuntimesDialog';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { TessivenTransport } from '../../../../tessiven_ui/src/types';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});
function directory() {
  return {
    targets: Array.from({ length: 12 }, (_, index) => ({
      runtime_ref: `desktop:${index}`,
      generation: 'verified',
      identity: `identity-${index}`,
      name: `Environment ${index}`,
      source: 'desktop',
      location: 'current_device',
      observed_at: new Date().toISOString(),
      registered: true,
      online: true,
      connected: true,
      authenticated: index === 1 ? null : true,
      actions: index === 1 ? ['status', 'connect'] : ['status', 'connect', 'start', 'stop', 'restart', 'update'],
      ...(index === 1 ? { reason: 'registered_application_only' } : {}),
    })),
    sources: [
      {
        source: 'gateway:offline',
        location: 'current_device',
        state: 'unavailable',
        reason: 'gateway_unavailable',
      },
    ],
  };
}
function mount(locale: string, request: TessivenTransport['request']) {
  host = document.createElement('div');
  host.className = 'tessiven';
  host.setAttribute('data-floe-dialog-surface-host', 'true');
  document.body.append(host);
  dispose = render(
    () => (
      <TessivenRuntimesDialog
        transport={{ request, subscribe: () => () => {} }}
        t={tessivenText(locale)}
        canWrite
        onClose={() => {}}
      />
    ),
    host,
  );
}
it('preserves exact selection, keyboard focus and scroll across refresh and source failure', async () => {
  await page.viewport(900, 800);
  let next: ((value: ReturnType<typeof directory>) => void) | undefined;
  const request = vi.fn(async (_method: string, path: string) =>
    path === '/runtimes' ? directory() : { status: 'connected' },
  );
  mount('en-US', request as TessivenTransport['request']);
  await expect
    .poll(() => host.querySelectorAll('.tessiven-runtime-card').length)
    .toBe(12);
  const title = host.querySelectorAll<HTMLButtonElement>(
    '.tessiven-runtime-card-title',
  )[3]!;
  title.click();
  title.focus();
  await userEvent.keyboard('{Enter}');
  const card = title.closest('article')!;
  expect(card.getAttribute('data-selected')).toBe('true');
  const list = host.querySelector<HTMLElement>('.tessiven-runtime-list')!;
  list.scrollTop = 150;
  request.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        next = resolve;
      }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  title.focus();
  const position = list.scrollTop;
  next?.({
    ...directory(),
    targets: directory().targets.map((target) => ({
      ...target,
      online: false,
    })),
  });
  await expect
    .poll(() => host.querySelector('[aria-busy="false"]') !== null)
    .toBe(true);
  expect(host.querySelectorAll('.tessiven-runtime-card-title')[3]).toBe(title);
  expect(document.activeElement).toBe(title);
  expect(list.scrollTop).toBe(position);
  expect(card.getAttribute('data-selected')).toBe('true');
  expect(host.textContent).toContain('The Gateway catalog is unavailable');
  request.mockRejectedValueOnce(new Error('private backend error'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(() => host.querySelector('[role="alert"]')?.textContent)
    .toContain('Could not refresh');
  expect(host.querySelectorAll('.tessiven-runtime-card')).toHaveLength(12);
  expect(host.textContent).not.toContain('private backend error');
});
it('fits every shipped locale at narrow width and supports keyboard search', async () => {
  await page.viewport(360, 780);
  for (const locale of [
    'en-US',
    'de-DE',
    'es-ES',
    'fr-FR',
    'ja-JP',
    'ko-KR',
    'pt-BR',
    'ru-RU',
    'zh-CN',
    'zh-TW',
  ]) {
    mount(
      locale,
      vi.fn(async () => directory()) as TessivenTransport['request'],
    );
    await expect
      .poll(() => host.querySelectorAll('.tessiven-runtime-card').length)
      .toBe(12);
    const input = host.querySelector<HTMLInputElement>('input')!;
    input.focus();
    await userEvent.type(input, 'Environment 10');
    await expect
      .poll(() => host.querySelectorAll('.tessiven-runtime-card').length)
      .toBe(1);
    for (const button of host.querySelectorAll<HTMLButtonElement>(
      '.tessiven-runtime-actions button',
    )) {
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
      expect(getComputedStyle(button).cursor).toBe('pointer');
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }
    const card = host.querySelector<HTMLElement>('.tessiven-runtime-card')!;
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(360);
    if (locale === 'zh-CN') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await page.screenshot({
        element: host,
        path: '../../.vitest-attachments/tessiven-runtimes-zh-CN-narrow.png',
      });
    }
    dispose?.();
    host.remove();
  }
});
it('queries the original operation after an unknown result without replaying mutation', async () => {
  const mutations: unknown[] = [];
  const request = vi.fn(
    async (_method: string, path: string, body?: unknown) => {
      if (path === '/runtimes')
        return { ...directory(), targets: [directory().targets[0]] };
      if (path === '/runtimes/actions') {
        mutations.push(body);
        throw Object.assign(new Error('unknown'), {
          code: 'TESSIVEN_OUTCOME_UNKNOWN',
        });
      }
      return {
        status: 'succeeded',
        operation_id: (body as { operation_id: string }).operation_id,
      };
    },
  );
  mount('en-US', request as TessivenTransport['request']);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect.poll(() => host.textContent).toContain('The outcome is unknown');
  expect(mutations).toHaveLength(1);
  expect(
    page
      .getByRole('button', { name: 'Restart', exact: true })
      .element()
      .hasAttribute('disabled'),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Check operation', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .getByRole('button', { name: 'Restart', exact: true })
        .element()
        .hasAttribute('disabled'),
    )
    .toBe(false);
  expect(mutations).toHaveLength(1);
  expect(
    request.mock.calls.find((call) => call[1] === '/runtimes/inspect')?.[2],
  ).toMatchObject({
    action: 'operation',
    operation_id: `tessiven:${(mutations[0] as { request_id: string }).request_id}`,
  });
});
