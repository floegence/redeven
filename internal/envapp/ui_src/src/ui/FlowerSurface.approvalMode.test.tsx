// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { FlowerPermissionType } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function approvalThread() {
  return thread({
    thread_id: 'approval-mode', status: 'waiting_approval', permission_type: 'approval_required',
    approval_actions: [{
      action_id: 'approval-date', turn_id: 'turn-fixture', run_id: 'run-fixture', origin: 'main_tool',
      tool_id: 'tool-date', tool_name: 'terminal.exec', state: 'requested', status: 'pending',
      requested_at_ms: 1, can_approve: true,
      summary: { label: 'Check the current date', command: 'date', description: 'Read the system clock.',
        targets: [{ kind: 'working_directory', label: '/workspace' }] },
    }],
  });
}

describe('Flower approval permission controls', () => {
  it.each(['full', 'companion'] as const)('allows a permission change while %s approvals stay pending', async presentation => {
    const waiting = approvalThread();
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    const setThreadPermissionType = vi.fn((_threadID: string, _permissionType: FlowerPermissionType) => pending.promise);
    const submitApproval = vi.fn(adapter(true).submitApproval);
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => [waiting]),
      loadThread: vi.fn(async () => liveBootstrap(waiting)), setThreadPermissionType, submitApproval,
    }, { presentation, companionOpen: true, focusThreadRequest: { request_id: 'approval-mode', thread_id: waiting.thread_id } });
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-approval]')));
    const footer = runtime.querySelector('.flower-approval-queue-footer')!;
    const trigger = footer.querySelector<HTMLButtonElement>('button.flower-permission-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    trigger!.click();
    await waitFor(() => Boolean(runtime.querySelector('[role=option][data-permission-type=full_access]')));
    runtime.querySelector<HTMLButtonElement>('[role=option][data-permission-type=full_access]')!.click();
    expect(setThreadPermissionType).toHaveBeenCalledExactlyOnceWith(waiting.thread_id, 'full_access');
    expect(trigger!.disabled).toBe(true);
    expect(trigger!.dataset.permissionType).toBe('full_access');
    expect(runtime.querySelector<HTMLButtonElement>('.flower-approval-decision-approve')!.disabled).toBe(false);
    expect(footer.querySelector<HTMLButtonElement>('.flower-composer-stop-thread')!.disabled).toBe(false);
    expect(submitApproval).not.toHaveBeenCalled();
    pending.resolve(liveBootstrap({ ...waiting, permission_type: 'full_access', settings_revision: 2 }, 10));
    await waitFor(() => trigger!.disabled === false);
    expect(trigger!.dataset.permissionType).toBe('full_access');
    expect(runtime.querySelector('[data-flower-approval-action-id=approval-date]')).not.toBeNull();
    expect(runtime.querySelector('.flower-approval-scope')?.textContent).toBe('This time only');
    expect(runtime.querySelector('.flower-approval-body')?.textContent).toContain('Read the system clock.');
    expect(runtime.querySelector('.flower-approval-body')?.textContent).toContain('/workspace');
    expect(runtime.querySelector('.flower-approval-body details')).toBeNull();
    expect(runtime.textContent).not.toContain('View action details');
    expect(submitApproval).not.toHaveBeenCalled();
  });

  it('restores the confirmed permission when the change fails without settling approvals', async () => {
    const waiting = approvalThread();
    const setThreadPermissionType = vi.fn(async () => { throw new Error('Permission could not be saved'); });
    const submitApproval = vi.fn(adapter(true).submitApproval);
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => [waiting]), loadThread: vi.fn(async () => liveBootstrap(waiting)),
      setThreadPermissionType, submitApproval,
    }, { focusThreadRequest: { request_id: 'approval-mode-failure', thread_id: waiting.thread_id } });
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-approval]')));
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-approval-queue-footer button.flower-permission-trigger');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await waitFor(() => Boolean(runtime.querySelector('[role=option][data-permission-type=readonly]')));
    runtime.querySelector<HTMLButtonElement>('[role=option][data-permission-type=readonly]')!.click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1 && !trigger!.disabled);
    expect(trigger!.dataset.permissionType).toBe('approval_required');
    expect(runtime.querySelector('[data-flower-approval-action-id=approval-date]')).not.toBeNull();
    expect(submitApproval).not.toHaveBeenCalled();
  });
});
