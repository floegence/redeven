import { expectSingleLineButtonLabels } from '../../test/buttonLayoutAssertions';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  ManagedServiceManagementDrawer,
  managementProblemKey,
  type ManagementRequest,
} from './ManagedServiceManagementDrawer';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../services/localApi', async (original) => ({
  ...(await original<typeof import('../services/localApi')>()),
  fetchLocalApiJSON: api.fetch,
}));
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 280));
}
const service = {
  service_id: 'reviewed-instance',
  name: 'Example service',
  workspace_path: '/workspaces/example/instance',
  status: 'uninstall_pending',
  management_state: 'active',
};
describe('Managed service recovery drawer', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    api.fetch.mockReset();
    localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
  });
  function mount(
    onExecute: (
      request: ManagementRequest & { plan_digest: string },
    ) => Promise<void>,
    scoped = false,
    archived = false,
    inspect = false,
    overrides: Partial<Parameters<typeof ManagedServiceManagementDrawer>[0]> = {},
  ) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    if (scoped) {
      host.setAttribute('data-floe-dialog-surface-host', 'true');
      host.setAttribute('data-floe-surface-portal-layer', 'true');
      host.style.cssText =
        'position:absolute;left:180px;top:80px;width:660px;height:600px';
    }
    dispose = render(
      () => (
        <I18nProvider><ManagedServiceManagementDrawer
          service={
            archived ? { ...service, management_state: 'uninstalled' } : service
          }
          initialAction={inspect ? "inspect" : "uninstall"}
          administrator
          onClose={() => undefined}
          onExecute={onExecute}
          onResource={() => undefined}
          onService={() => undefined}
          onSettings={() => undefined}
          onLegacyRestore={() => undefined}
          onReinstall={() => undefined}
          canLegacyRestore={false}
          {...overrides}
        /></I18nProvider>
      ),
      host,
    );
  }
  it('inspects a healthy service without a mutation plan or recovery suggestion', async () => {
    api.fetch.mockResolvedValue({...service,status:'running',actions:{open:{available:true},recover:{available:false}},opening:{state:'unprepared'},facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[]}});
    const open=vi.fn(),close=vi.fn();
    mount(async()=>undefined,false,false,true,{onOpen:open,onClose:close});await settle();
    expect(api.fetch.mock.calls).toHaveLength(1);
    expect(api.fetch.mock.calls[0][0]).toContain('/inspection');
    expect(api.fetch.mock.calls[0][1].method).toBeUndefined();
    expect(document.body.textContent).not.toContain('Recover service');
    await userEvent.click(page.getByRole('button',{name:'Open service',exact:true}));
    expect(open).toHaveBeenCalledWith(false);
    await userEvent.keyboard('{Escape}');expect(close).toHaveBeenCalled();
  });
  it('keeps facts when rechecking fails and lets the user retry', async () => {
    api.fetch.mockResolvedValueOnce({...service,status:'running',facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[]}}).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({...service,status:'stopped',facts:{presence:'present',runtime:'stopped',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[]}});
    mount(async()=>undefined,false,false,true);await settle();
    const recheck=()=>page.elementLocator(document.querySelector<HTMLButtonElement>('.service-management-section-heading button')!);
    await userEvent.click(recheck());await settle();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('.service-management-conclusion')?.textContent).toBe('Running');
    await userEvent.click(recheck());await settle();
    expect(document.querySelector('.service-management-conclusion')?.textContent).toBe('Stopped');
  });
  it('keeps the last verified facts when inspection reports unknown engine state',async()=>{
    const checked=Date.now()-60000;
    api.fetch.mockResolvedValueOnce({...service,status:'running',facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:checked,resources:[]}}).mockResolvedValueOnce({...service,status:'inspection_unavailable',problem_code:'ENGINE_NOT_RUNNING',facts:{presence:'unknown',runtime:'unknown',ownership:'unknown',checked_at_unix_ms:Date.now(),resources:[]},actions:{recover:{available:false}}});
    mount(async()=>undefined,false,false,true);await settle();
    const previous=document.querySelector('.service-management-situation')!.textContent;
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('.service-management-section-heading button')!));await settle();
    expect(document.querySelector('.service-management-conclusion')?.textContent).toBe('Running');
    expect(document.querySelector('.service-management-situation')!.textContent).toBe(previous);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Recover service');
  });
  it('reprepares an entrance explicitly and reviews restart impact before execution',async()=>{
    const restart=vi.fn(),open=vi.fn();
    api.fetch.mockResolvedValue({...service,status:'running',opening:{state:'error',error_code:'OPENING_URL_MISSING'},actions:{open:{available:true},restart:{available:true}},facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[]}});
    mount(async()=>undefined,false,false,true,{onOpen:open,onRestart:restart});await settle();
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('.service-management-section:last-child button')!));expect(open).toHaveBeenCalledWith(true);
    await userEvent.click(page.getByRole('button',{name:'Restart',exact:true}));expect(restart).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Pending settings will be applied');
    await userEvent.click(page.getByRole('button',{name:'Cancel',exact:true}));expect(restart).not.toHaveBeenCalled();
  });
  it.each(['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'])('keeps %s management actions single-line at 320px', async locale => {
    await page.viewport(320, 800);
    localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      request: JSON.parse(String(init.body)), plan_digest: 'single-line-plan', path: 'uninstall', blockers: [],
      facts: { presence: 'absent', runtime: 'stopped', ownership: 'verified', resources: [] },
    }));
    mount(async () => undefined, false, true);
    await vi.waitFor(() => expect(document.querySelector('.service-management-execute')).not.toBeNull());
    await document.fonts.ready; await settle();
    const panel = document.querySelector<HTMLElement>('[data-testid="service-management-drawer"]')!;
    expectSingleLineButtonLabels(panel);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    const bounds = panel.getBoundingClientRect();
    for (const button of panel.querySelectorAll('button')) {
      if (!button.checkVisibility()) continue;
      expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
    }
  });
  it.each(['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU'])('keeps %s entrance recovery readable at 320px',async locale=>{
    await page.viewport(320,800);localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY,locale);
    api.fetch.mockResolvedValue({...service,status:'running',opening:{state:'error',error_code:'OPENING_URL_MISSING'},actions:{open:{available:true},restart:{available:true}},facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[]}});
    mount(async()=>undefined,false,true,true);await settle();await document.fonts.ready;
    const panel=document.querySelector<HTMLElement>('[data-testid="service-management-drawer"]')!;
    expectSingleLineButtonLabels(panel);expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    const bounds=panel.getBoundingClientRect();
    for(const button of panel.querySelectorAll('button')) {
      if(!button.checkVisibility())continue;
      expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
    }
  });
  it('maps observed absence and missing configuration to actionable explanations', () => {
    expect(managementProblemKey('INSTANCE_MISSING')).toBe(
      'webServices.management.problems.missingInstance',
    );
    expect(
      managementProblemKey('CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE'),
    ).toBe('webServices.management.problems.configurationRequired');
  });
  it('shows one copyable workspace identity when the reviewed inventory contains it', async () => {
    api.fetch.mockResolvedValue({ request: { action: 'uninstall' }, plan_digest: 'reviewed', path: 'uninstall', blockers: [], facts: { presence: 'present', runtime: 'stopped', ownership: 'verified', resources: [{ resource_id: 'workspace', kind: 'directory', identity: service.workspace_path, presence: 'present', ownership: 'verified' }] } });
    mount(async () => undefined);
    await settle();
    const drawer = document.querySelector('[data-testid="service-management-drawer"]')!;
    expect(drawer.textContent?.split(service.workspace_path)).toHaveLength(2);
    expect(drawer.querySelectorAll('[aria-label="Copy workspace path"]')).toHaveLength(1);
  });

  it('cleans a retained archive only after explicit resource selection', async () => {
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      request: JSON.parse(String(init.body)),
      plan_digest: 'reviewed-cleanup',
      path: 'uninstall',
      blockers: [],
      facts: {
        presence: 'absent',
        runtime: 'stopped',
        ownership: 'verified',
        resources: [],
      },
    }));
    const execute = vi.fn(async (_request: ManagementRequest) => undefined);
    mount(execute, false, true);
    await settle();
    const buttons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
        (button) =>
          button.innerText.trim() === 'Clean up retained resources',
      );
    expect(buttons().at(-1)?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      'Unselected resources will be kept.',
    );
    await userEvent.click(
      page.getByText('Delete service data', { exact: true }),
    );
    await settle();
    await userEvent.click(buttons().at(-1)!);
    await settle();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'uninstall',
        delete_data: true,
        plan_digest: 'reviewed-cleanup',
      }),
    );
  });
  it('reviews shared running and stopped references and explicitly preserves them before uninstall', async () => {
    await page.viewport(390, 760);
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return {
        request,
        plan_digest: request.delete_data ? 'delete-plan' : 'retain-plan',
        path: 'uninstall',
        blockers: request.delete_data ? ['RESOURCE_IN_USE'] : [],
        facts: {
          presence: 'absent',
          ownership: 'verified',
          runtime: 'stopped',
          checked_at_unix_ms: Date.now(),
          resources: [
            {
              resource_id: 'data',
              kind: 'volume',
              identity: 'shared-data',
              presence: 'present',
              ownership: 'unverified',
              problem_code: 'RESOURCE_IN_USE',
              references: [
                {
                  container_id: 'one',
                  name: 'Running desktop',
                  state: 'running',
                },
                {
                  container_id: 'two',
                  name: 'Stopped desktop',
                  state: 'exited',
                },
              ],
            },
          ],
        },
      };
    });
    const execute = vi.fn(async (_request: ManagementRequest) => undefined);
    mount(execute);
    await settle();
    await userEvent.click(
      page.getByText('Delete service data', { exact: true }),
    );
    await settle();
    expect(execute).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Running desktop');
    expect(document.body.textContent).toContain('Stopped desktop');
    await userEvent.click(
      page.getByRole('button', {
        name: 'Keep these resources and review uninstall',
        exact: true,
      }),
    );
    await settle();
    const confirm = page.getByRole('button', {
      name: 'Keep data and complete uninstall',
      exact: true,
    });
    await userEvent.click(confirm);
    await settle();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'uninstall',
        plan_digest: 'retain-plan',
      }),
    );
    expect(execute.mock.calls[0]?.[0]).not.toMatchObject({ delete_data: true });
    const panel = document.querySelector<HTMLElement>(
      '[data-floe-dialog-panel]',
    )!;
    expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it('offers a confirmed detach while the external engine cannot be checked', async () => {
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return {
        request,
        plan_digest: 'offline-detach',
        path: request.action,
        blockers: request.action === 'detach' ? [] : ['DOCKER_UNAVAILABLE'],
        facts: {
          presence: 'unknown',
          ownership: 'unknown',
          runtime: 'unknown',
          resources: [],
        },
      };
    });
    const execute = vi.fn(async (_request: ManagementRequest) => undefined);
    mount(execute);
    await settle();
    await userEvent.click(page.getByText('Advanced actions', { exact: true }));
    await userEvent.click(
      page.getByRole('button', {
        name: 'Detach and keep resources',
        exact: true,
      }),
    );
    await settle();
    expect(document.body.textContent).toContain(
      'The service may still be running.',
    );
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).filter(
      (button) => button.innerText.trim() === 'Detach and keep resources',
    );
    await userEvent.click(buttons[0]);
    await settle();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'detach',
        plan_digest: 'offline-detach',
      }),
    );
  });
  it('keeps the review and confirmation inside its Workbench surface', async () => {
    await page.viewport(1200, 800);
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      request: JSON.parse(String(init.body)),
      plan_digest: 'surface-plan',
      path: 'uninstall',
      blockers: [],
      facts: {
        presence: 'absent',
        ownership: 'verified',
        runtime: 'stopped',
        resources: [],
      },
    }));
    const execute = vi.fn(async (_request: ManagementRequest) => undefined);
    mount(execute, true);
    await settle();
    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    await Promise.all(panel.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished));
    const bounds = panel.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(180);
    expect(bounds.right).toBeLessThanOrEqual(840);
    expect(bounds.top).toBeGreaterThanOrEqual(80);
    expect(bounds.bottom).toBeLessThanOrEqual(680);
    const other = document.createElement('button');
    other.textContent = 'Other Workbench surface';
    other.style.cssText = 'position:absolute;left:900px;top:100px';
    document.body.appendChild(other);
    const click = vi.fn();
    other.addEventListener('click', click);
    await userEvent.click(other);
    expect(click).toHaveBeenCalledOnce();
    await userEvent.click(
      page.getByRole('button', {
        name: 'Keep data and complete uninstall',
        exact: true,
      }),
    );
    await settle();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ plan_digest: 'surface-plan' }),
    );
  });
  it('ignores a late previous review after the user selects detachment', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    api.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      if (request.action === 'uninstall')
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return {
        request,
        plan_digest: 'current-detach',
        path: 'detach',
        blockers: [],
        facts: {
          presence: 'unknown',
          ownership: 'unknown',
          runtime: 'unknown',
          resources: [],
        },
      };
    });
    const execute = vi.fn(async (_request: ManagementRequest) => undefined);
    mount(execute);
    await settle();
    await userEvent.click(page.getByText('Advanced actions', { exact: true }));
    await userEvent.click(
      page.getByRole('button', {
        name: 'Detach and keep resources',
        exact: true,
      }),
    );
    await settle();
    resolveOld({
      request: { action: 'uninstall', delete_data: true },
      plan_digest: 'obsolete-delete',
      path: 'uninstall',
      blockers: ['RESOURCE_IN_USE'],
      facts: { resources: [] },
    });
    await settle();
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find(
      (button) => button.innerText.trim() === 'Detach and keep resources',
    )!;
    await userEvent.click(confirm);
    await settle();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'detach',
        plan_digest: 'current-detach',
      }),
    );
  });
});
