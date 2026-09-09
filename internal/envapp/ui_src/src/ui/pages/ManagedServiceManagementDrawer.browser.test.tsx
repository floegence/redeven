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
  });
  function mount(
    onExecute: (
      request: ManagementRequest & { plan_digest: string },
    ) => Promise<void>,
    scoped = false,
    archived = false,
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
        <ManagedServiceManagementDrawer
          service={
            archived ? { ...service, management_state: 'uninstalled' } : service
          }
          initialAction="uninstall"
          administrator
          onClose={() => undefined}
          onExecute={onExecute}
          onResource={() => undefined}
          onService={() => undefined}
          onSettings={() => undefined}
          onLegacyRestore={() => undefined}
          onReinstall={() => undefined}
          canLegacyRestore={false}
        />
      ),
      host,
    );
  }
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
          button.textContent?.trim() === 'Clean up retained resources',
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
      (button) => button.textContent?.trim() === 'Detach and keep resources',
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
    const bounds = document
      .querySelector<HTMLElement>('[data-floe-dialog-panel]')!
      .getBoundingClientRect();
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
      (button) => button.textContent?.trim() === 'Detach and keep resources',
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
