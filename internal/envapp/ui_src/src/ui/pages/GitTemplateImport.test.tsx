// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { Show } from 'solid-js';
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
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(button, label).toBeDefined();
    button!.click();
  };
  afterEach(() => {
    dispose?.();
    host?.remove();
    delete window.redevenDesktopTemplateSources;
    api.request.mockReset();
  });

  it('defaults to Desktop acquisition and sends original files without the private token to Runtime', async () => {
    const snapshot = {
      source: template.git_source!,
      files: [{ path: 'redeven-service-template.json', mode: '100644', content: 'e30K' }],
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
    const token = host.querySelector<HTMLInputElement>('input[type=password]')!;
    token.value = 'temporary-private-token';
    token.dispatchEvent(new Event('input', { bubbles: true }));
    click('Check template updates');
    await vi.waitFor(() => expect(host.textContent).toContain('Review these changes'));
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'capture', token: 'temporary-private-token' }),
    );
    const transfer = JSON.parse(api.request.mock.calls[0][1].body);
    expect(transfer.snapshot).toEqual(snapshot);
    expect(transfer.token).toBeUndefined();
    expect(api.request.mock.calls.some(([url]) => String(url).includes('source-confirmations'))).toBe(false);
    click('Confirm template update');
    await vi.waitFor(() =>
      expect(api.request.mock.calls.some(([url]) => String(url).includes('source-confirmations'))).toBe(true),
    );
    const confirmation = JSON.parse(
      api.request.mock.calls.find(([url]) => String(url).includes('source-confirmations'))![1].body,
    );
    expect(confirmation).toEqual(
      expect.objectContaining({ candidate_id: 'candidate', sha256: snapshot.sha256, expected_sha256: snapshot.sha256 }),
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
    click('Check template updates');
    await vi.waitFor(() => expect(host.textContent).toContain('already up to date'));
    const request = JSON.parse(api.request.mock.calls[0][1].body);
    expect(request.source).toEqual({ repository: 'owner/repo', ref: 'develop', path: '' });
    expect(request.snapshot).toBeUndefined();
    expect(
      [...host.querySelectorAll('button')].find((button) => button.textContent === 'Confirm template update')?.disabled,
    ).toBe(true);
  });
});
