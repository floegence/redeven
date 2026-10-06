import '../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import {
  TessivenFlowerPanel,
  type CanvasFlowerRequest,
} from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import type {
  TessivenTransport,
  Version,
} from '../../../../tessiven_ui/src/types';
import type { FlowerTurnLauncherSubmitInput } from '../../../../flower_ui/src/FlowerTurnLauncherWindow';
import '../../../../tessiven_ui/src/tessiven.css';
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
});
const selection = {
  canvas_id: 'commerce',
  version_id: 2,
  object_refs: ['api'],
};
function mount() {
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'position:fixed;inset:0';
  document.body.append(host);
}
const input = () => page.getByRole('textbox');
const send = () =>
  page.getByRole('button', { name: 'Send to Flower', exact: true });
it('edits in place, preserves drafts, and continues the accepted conversation with a fresh request', async () => {
  await page.viewport(1100, 700);
  mount();
  const [open, setOpen] = createSignal(true);
  const [request, setRequest] = createSignal<CanvasFlowerRequest>({
    selection,
    label: 'Orders API',
    nonce: 1,
  });
  const submit = vi.fn(
    async (_input: FlowerTurnLauncherSubmitInput, _threadID?: string) =>
      'thread-1',
  );
  const navigate = vi.fn();
  const compare = vi.fn();
  const [savedVersion, setSavedVersion] = createSignal<Version>();
  dispose = render(
    () => (
      <TessivenFlowerPanel
        request={request()}
        version={savedVersion()}
        onCompareVersion={compare}
        open={open()}
        t={tessivenText('en-US')}
        onSend={submit}
        onOpenConversation={navigate}
        onClose={() => setOpen(false)}
      />
    ),
    host,
  );
  await input().fill('Add the storage dependency');
  setOpen(false);
  setOpen(true);
  await expect.element(input()).toHaveValue('Add the storage dependency');
  const textarea = host.querySelector('textarea')!;
  textarea.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  );
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      isComposing: true,
    }),
  );
  expect(submit).not.toHaveBeenCalled();
  textarea.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  );
  await send().click();
  await expect
    .element(page.getByText('Sent to Flower', { exact: true }))
    .toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
  await expect
    .element(page.getByText('Canvas updated', { exact: true }))
    .not.toBeInTheDocument();
  setSavedVersion({
    canvas_id: 'commerce',
    number: 3,
    source: 'flower',
    summary: 'Added the storage dependency',
    created_at: 1,
    digest: 'test',
    document_yaml: '',
    document: {
      apiVersion: 'redeven.io/tessiven/v1',
      kind: 'ServiceCanvas',
      metadata: { title: 'Commerce' },
    },
  });
  await expect
    .element(page.getByText('Canvas updated', { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText('Added the storage dependency', { exact: true }))
    .toBeVisible();
  await page
    .getByRole('button', { name: 'Review changes', exact: true })
    .click();
  expect(compare).toHaveBeenCalledWith(2);
  expect(submit.mock.calls[0][0].intent.context_action).toMatchObject({
    context: [{ kind: 'tessiven_selection', ...selection }],
  });
  expect(submit.mock.calls[0][1]).toBeUndefined();
  setRequest({
    selection: { ...selection, version_id: 3, object_refs: [] },
    label: 'Commerce',
    nonce: 2,
  });
  await input().fill('Now explain the relationship');
  await send().click();
  await expect.poll(() => submit.mock.calls.length).toBe(2);
  expect(submit.mock.calls[1][1]).toBe('thread-1');
  expect(submit.mock.calls[1][0].client_request_id).not.toBe(
    submit.mock.calls[0][0].client_request_id,
  );
  expect(submit.mock.calls[1][0].intent.context_action).toMatchObject({
    context: [{ version_id: 3, object_refs: [] }],
  });
  await page
    .getByRole('button', { name: 'Open conversation', exact: true })
    .click();
  expect(navigate).toHaveBeenCalledWith('thread-1');
});
it('retries unknown delivery with the same scope and payload across closing and attempted retargeting', async () => {
  mount();
  const [open, setOpen] = createSignal(true);
  const [request, setRequest] = createSignal<CanvasFlowerRequest>({
    selection,
    label: 'Orders API',
    nonce: 1,
  });
  const submit = vi.fn(
    async (_input: FlowerTurnLauncherSubmitInput, _threadID?: string) => {
      if (submit.mock.calls.length === 1)
        throw flowerTurnAdmissionError(
          'unknown',
          new Error('Connection interrupted'),
        );
      return 'recovered-thread';
    },
  );
  dispose = render(
    () => (
      <TessivenFlowerPanel
        request={request()}
        open={open()}
        t={tessivenText('en-US')}
        onSend={submit}
        onOpenConversation={() => {}}
        onClose={() => setOpen(false)}
      />
    ),
    host,
  );
  await input().fill('Map this service');
  await send().click();
  await expect.element(input()).toBeDisabled();
  setOpen(false);
  setRequest({
    selection: { ...selection, version_id: 8, object_refs: ['different'] },
    label: 'Different object',
    prompt: 'Replace the prompt',
    nonce: 2,
  });
  setOpen(true);
  await expect.element(input()).toHaveValue('Map this service');
  await expect
    .element(page.getByText('Orders API', { exact: true }))
    .toBeVisible();
  await page
    .getByRole('button', { name: 'Retry sending', exact: true })
    .click();
  await expect.poll(() => submit.mock.calls.length).toBe(2);
  expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  await expect.element(input()).toBeEnabled();
  await expect.element(input()).toHaveValue('');
});
it('keeps rejected input editable and the canvas editor usable at phone widths', async () => {
  await page.viewport(390, 720);
  mount();
  dispose = render(
    () => (
      <TessivenFlowerPanel
        request={{ selection, label: 'Orders API', nonce: 1 }}
        open
        t={tessivenText('en-US')}
        onSend={async () => {
          throw flowerTurnAdmissionError(
            'rejected',
            new Error('Model is not configured'),
          );
        }}
        onOpenConversation={() => {}}
        onClose={() => {}}
      />
    ),
    host,
  );
  await input().fill('Explain this service');
  await send().click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Model is not configured');
  await expect.element(input()).toBeEnabled();
  await expect.element(input()).toHaveValue('Explain this service');
  expect(host.scrollWidth).toBeLessThanOrEqual(390);
  expect(
    host.querySelector('textarea')!.getBoundingClientRect().width,
  ).toBeGreaterThan(300);
});
it('keeps archive in the library menu and renders no additional bottom bar', async () => {
  await page.viewport(1100, 700);
  mount();
  const request = vi.fn(async (_method: string, _path: string) => ({
    canvases: [],
  }));
  dispose = render(
    () => (
      <TessivenPage
        transport={{ request, subscribe: () => () => {} } as TessivenTransport}
        t={tessivenText('en-US')}
        canWrite
        onSendFlower={async () => 'thread'}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
      />
    ),
    host,
  );
  await expect
    .element(page.getByRole('heading', { name: 'Tessiven', exact: true }))
    .toBeVisible();
  expect(host.querySelector('[role="tab"]')).toBeNull();
  expect(
    host.querySelector(
      '.tessiven-footer, .tessiven-flower-dock, .tessiven-library-heading',
    ),
  ).toBeNull();
  await expect
    .element(page.getByText('Archived canvases', { exact: true }))
    .not.toBeInTheDocument();
  await page
    .getByRole('button', { name: 'Library actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Archived canvases', exact: true })
    .click();
  await expect
    .poll(() =>
      request.mock.calls.some((args) => args[1].includes('archived=true')),
    )
    .toBe(true);
  await expect
    .element(
      page.getByRole('heading', { name: 'Archived canvases', exact: true }),
    )
    .toBeVisible();
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  await expect
    .element(page.getByRole('heading', { name: 'Tessiven', exact: true }))
    .toBeVisible();
});

it('retains each canvas draft, follows saved versions, and restores focus when the editor closes', async () => {
  await page.viewport(1100, 700);
  mount();
  const [opening, setOpening] = createSignal({ canvasID: 'first', nonce: 1 });
  let latest = 1;
  let changed = () => {};
  const request = async (_method: string, path: string) => {
    if (path.startsWith('/canvases?')) return { canvases: [] };
    const id = path.split('/')[2];
    if (path.includes('/versions/'))
      return {
        canvas_id: id,
        number: latest,
        document_yaml: '',
        digest: 'test',
        created_at: 1,
        source: 'flower',
        summary: 'Updated canvas',
        document: {
          apiVersion: 'redeven.io/tessiven/v1',
          kind: 'ServiceCanvas',
          metadata: { title: id },
        },
      };
    return {
      id,
      title: id,
      latest_version: latest,
      archived: false,
      created_at: 1,
      updated_at: 1,
    };
  };
  const submit = vi.fn(
    async (_input: FlowerTurnLauncherSubmitInput) => 'thread',
  );
  dispose = render(
    () => (
      <TessivenPage
        transport={
          {
            request,
            subscribe: (notify) => {
              changed = notify;
              return () => {};
            },
          } as TessivenTransport
        }
        t={tessivenText('en-US')}
        canWrite
        openRequest={opening()}
        onSendFlower={submit}
        onOpenFlower={() => {}}
        onOpenService={() => {}}
      />
    ),
    host,
  );
  const open = () =>
    page.getByRole('button', { name: 'Edit with Flower', exact: true });
  await open().click();
  await input().fill('First canvas draft');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.element(open()).toHaveFocus();
  setOpening({ canvasID: 'second', nonce: 2 });
  await expect
    .element(page.getByRole('heading', { name: 'second', exact: true }))
    .toBeVisible();
  await open().click();
  await input().fill('Second canvas draft');
  setOpening({ canvasID: 'first', nonce: 3 });
  await expect
    .element(page.getByRole('heading', { name: 'first', exact: true }))
    .toBeVisible();
  await expect.element(open()).toHaveAttribute('aria-expanded', 'false');
  await open().click();
  await expect.element(input()).toHaveValue('First canvas draft');
  latest = 2;
  changed();
  await expect
    .poll(
      () =>
        host.querySelector(
          '.tessiven-flower-panel:not([hidden]) .tessiven-flower-scope',
        )?.textContent,
    )
    .toContain('Version 2');
  await send().click();
  await expect.poll(() => submit.mock.calls.length).toBe(1);
  expect(submit.mock.calls[0][0].intent.context_action).toMatchObject({
    context: [{ canvas_id: 'first', version_id: 2 }],
  });
});
