// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitTemplateImport } from './GitTemplateImport';
import type { ManagedCatalogTemplate } from './EnvPortForwardsPage';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/localApi', async (original) => ({
  ...(await original<typeof import('../services/localApi')>()),
  fetchLocalApiJSON: api.request,
}));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Input: (props: any) => (
    <input type={props.type} value={props.value} disabled={props.disabled} onInput={props.onInput} />
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog">
        {props.title}
        {props.children}
        {props.footer}
      </div>
    </Show>
  ),
}));

import { template } from './gitTemplateImportFixture';

describe('GitHub template import review', () => {
  let dispose: (() => void) | undefined;
  let host: HTMLDivElement;
  const mount = (existing?: ManagedCatalogTemplate) => {
    host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => (
        <GitTemplateImport open template={existing} onClose={vi.fn()} onImported={vi.fn()} serviceName={(id) => id} />
      ),
      host,
    );
  };
  const click = (label: string) => {
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    expect(button, label).toBeDefined();
    button!.click();
  };
  afterEach(() => {
    dispose?.();
    host?.remove();
    delete window.redevenDesktopTemplateSources;
    api.request.mockReset();
  });

  it('explains the complete transfer route and keeps optional source fields collapsed', () => {
    window.redevenDesktopTemplateSources = {
      acquire: vi.fn(),
      cancel: vi.fn(),
    };
    mount();
    const local = host.querySelector<HTMLInputElement>('input[value=desktop_transfer]')!;
    const remote = host.querySelector<HTMLInputElement>('input[value=remote_download]')!;
    expect(local?.checked).toBe(true);
    expect(local?.labels?.[0]?.textContent?.trim()).toBe('Via Desktop');
    expect(remote?.labels?.[0]?.textContent?.trim()).toBe('Direct to remote');
    expect(host.textContent).toContain('Desktop downloads the template, then transfers it to this environment.');
    expect(host.querySelector<HTMLDetailsElement>('[data-source-options]')?.open).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>('[data-private-repository]')?.open).toBe(false);
    remote.click();
    expect(host.textContent).toContain('This environment downloads the template directly from GitHub.');
  });

  it('separates discovery, selection and review, and preserves the source when going back', async () => {
    api.request.mockResolvedValue({
      source: template.git_source,
      templates: [
        {
          path: 'templates/alpha',
          entrypoint: 'redeven-service-template.json',
        },
        { path: 'templates/beta', entrypoint: 'redeven-service-template.json' },
      ],
    });
    mount();
    const repository = host.querySelector<HTMLInputElement>('input:not([type=password])')!;
    repository.value = 'https://github.com/owner/repo';
    repository.dispatchEvent(new Event('input', { bubbles: true }));
    click('Find templates');
    await vi.waitFor(() => expect(host.textContent).toContain('Choose a template'));
    expect(api.request).toHaveBeenCalledTimes(1);
    const selected = host.querySelector<HTMLInputElement>('input[value="templates/beta"]')!;
    selected.click();
    expect(api.request).toHaveBeenCalledTimes(1);
    api.request.mockResolvedValue({
      candidate_id: 'selected',
      sha256: 'b'.repeat(64),
      expected_sha256: '',
      changed: true,
      template,
      files: [],
      affected_service_ids: [],
      source_document_version: 3,
      source_spec_version: 6,
    });
    click('Review template');
    await vi.waitFor(() => expect(host.textContent).toContain('Review the template'));
    expect(JSON.parse(api.request.mock.calls[1][1].body).source.path).toBe('templates/beta');
    expect(api.request.mock.calls.some(([url]) => String(url).includes('source-confirmations'))).toBe(false);
    click('Edit source');
    expect(host.querySelector<HTMLInputElement>('input:not([type=password])')?.value).toBe(
      'https://github.com/owner/repo',
    );
  });

  it('ignores a cancelled discovery without interrupting a new request after reopening', async () => {
    let resolveDiscovery!: (value: unknown) => void;
    let resolveCurrent!: (value: unknown) => void;
    api.request
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDiscovery = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCurrent = resolve;
        }),
      );
    host = document.createElement('div');
    document.body.append(host);
    const [open, setOpen] = createSignal(true);
    dispose = render(
      () => (
        <GitTemplateImport open={open()} onClose={() => setOpen(false)} onImported={vi.fn()} serviceName={(id) => id} />
      ),
      host,
    );
    const enterRepository = () => {
      const input = host.querySelector<HTMLInputElement>('input:not([type=password])')!;
      input.value = 'owner/repo';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    enterRepository();
    click('Find templates');
    click('Cancel');
    setOpen(true);
    enterRepository();
    click('Find templates');
    const find = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Find templates')!;
    resolveDiscovery({ source: template.git_source, templates: [{ path: 'stale', entrypoint: 'template.json' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector('input[value=stale]')).toBeNull();
    expect(host.textContent).not.toContain('Choose a template');
    expect(find.disabled).toBe(true);
    resolveCurrent({
      source: template.git_source,
      templates: [{ path: 'current', entrypoint: 'redeven-service-template.json' }],
    });
    await vi.waitFor(() => expect(host.querySelector('input[value=current]')).not.toBeNull());
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it('defaults to Desktop acquisition and sends original files without the private token to Runtime', async () => {
    const snapshot = {
      source: template.git_source!,
      files: [
        {
          path: 'redeven-service-template.json',
          mode: '100644',
          content: 'e30K',
        },
      ],
      sha256: 'b'.repeat(64),
    };
    const acquire = vi.fn().mockResolvedValue({ ok: true, snapshot });
    window.redevenDesktopTemplateSources = { acquire, cancel: vi.fn() };
    api.request.mockResolvedValue({
      candidate_id: 'candidate',
      sha256: snapshot.sha256,
      expected_sha256: snapshot.sha256,
      changed: true,
      template,
      files: [{ path: 'scripts/start.sh', change: 'modified' }],
      affected_service_ids: ['service'],
      source_document_version: 2,
      source_spec_version: 5,
    });
    mount(template);
    host.querySelector<HTMLDetailsElement>('[data-private-repository]')!.open = true;
    const token = host.querySelector<HTMLInputElement>('input[type=password]')!;
    token.value = 'temporary-private-token';
    token.dispatchEvent(new Event('input', { bubbles: true }));
    click('Check updates');
    await vi.waitFor(() => expect(host.textContent).toContain('Review the template'));
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'capture',
        token: 'temporary-private-token',
      }),
    );
    const transfer = JSON.parse(api.request.mock.calls[0][1].body);
    expect(transfer.snapshot).toEqual(snapshot);
    expect(transfer.token).toBeUndefined();
    expect(api.request.mock.calls.some(([url]) => String(url).includes('source-confirmations'))).toBe(false);
    click('Update template');
    await vi.waitFor(() =>
      expect(api.request.mock.calls.some(([url]) => String(url).includes('source-confirmations'))).toBe(true),
    );
    const confirmation = JSON.parse(
      api.request.mock.calls.find(([url]) => String(url).includes('source-confirmations'))![1].body,
    );
    expect(confirmation).toEqual(
      expect.objectContaining({
        candidate_id: 'candidate',
        sha256: snapshot.sha256,
        expected_sha256: snapshot.sha256,
      }),
    );
  });
  it('uses remote acquisition in a browser and never confirms an unchanged directory', async () => {
    api.request.mockResolvedValue({
      candidate_id: 'unchanged',
      sha256: 'b'.repeat(64),
      expected_sha256: 'b'.repeat(64),
      changed: false,
      template,
      files: [],
      affected_service_ids: [],
      source_document_version: 3,
      source_spec_version: 6,
    });
    mount(template);
    click('Check updates');
    await vi.waitFor(() => expect(host.textContent).toContain('already up to date'));
    const request = JSON.parse(api.request.mock.calls[0][1].body);
    expect(request.source).toEqual({
      repository: 'owner/repo',
      ref: 'develop',
      path: '',
    });
    expect(request.snapshot).toBeUndefined();
    expect(
      [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Update template')?.disabled,
    ).toBe(true);
  });
});
