import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  groupedVisibleOperationNextActions,
  visibleOperationNextActions,
} from './operationNextActions';

function failedProgress(
  nextActions: NonNullable<DesktopLauncherActionProgress['next_actions']>,
): DesktopLauncherActionProgress {
  return {
    action: 'open_local_environment',
    operation_key: 'local:host:local:open',
    subject_kind: 'local_environment',
    subject_id: 'local',
    environment_id: 'local',
    started_at_unix_ms: 100,
    updated_at_unix_ms: 120,
    status: 'failed',
    phase: 'failed',
    title: 'Open failed',
    detail: 'Desktop could not open the local environment.',
    next_actions: nextActions,
  };
}

describe('operationNextActions', () => {
  it('renders only supported next actions in stable order without duplicating fallbacks', () => {
    const progress = failedProgress([
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log',
      },
      {
        kind: 'retry',
        operation_key: 'local:host:local:open',
        label: 'Retry',
      },
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'update_runtime',
        environment_id: 'local',
        label: 'Update runtime',
      },
      {
        kind: 'manage_desktop_update',
        environment_id: 'local',
        label: 'Update Redeven Desktop',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log again',
      },
    ]);

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
      expect.objectContaining({ kind: 'update_runtime', label: 'Update runtime' }),
      expect.objectContaining({ kind: 'manage_desktop_update', label: 'Update Redeven Desktop' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
      expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
    ]);
  });

  it('groups recovery and utility actions so failure popovers never place three actions in one row', () => {
    const progress = failedProgress([
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
    ]);

    expect(groupedVisibleOperationNextActions(progress)).toEqual([
      {
        kind: 'primary',
        actions: [
          expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
        ],
      },
      {
        kind: 'secondary',
        actions: [
          expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
          expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
        ],
      },
    ]);
  });

  it('keeps long recovery actions full-width before utility actions', () => {
    const progress = failedProgress([
      {
        kind: 'manage_desktop_update',
        environment_id: 'local',
        label: 'Update Redeven Desktop',
      },
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
    ]);

    expect(groupedVisibleOperationNextActions(progress)).toEqual([
      {
        kind: 'primary',
        actions: [
          expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
          expect.objectContaining({ kind: 'manage_desktop_update', label: 'Update Redeven Desktop' }),
        ],
      },
      {
        kind: 'secondary',
        actions: [
          expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
          expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
        ],
      },
    ]);
  });

  it('hides Runtime and Desktop next actions from Gateway progress panels', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'check_gateway',
          gateway_id: 'bastion',
          label: 'Check Gateway',
        },
        {
          kind: 'refresh_status',
          environment_id: 'gateway:bastion',
          label: 'Refresh status',
        },
        {
          kind: 'update_runtime',
          environment_id: 'gateway:bastion',
          label: 'Update Runtime',
        },
        {
          kind: 'refresh_gateway_status',
          gateway_id: 'bastion',
          label: 'Refresh status',
        },
        {
          kind: 'refresh_gateway_catalog',
          gateway_id: 'bastion',
          start_policy: 'start_if_needed',
          label: 'Sync Gateway',
        },
        {
          kind: 'update_gateway',
          gateway_id: 'bastion',
          label: 'Update Gateway service',
        },
        {
          kind: 'retry',
          operation_key: 'gateway:bastion:start',
          retry_action: {
            kind: 'refresh_gateway_status',
            gateway_id: 'bastion',
          },
          label: 'Retry',
        },
        {
          kind: 'manage_desktop_update',
          environment_id: 'gateway:bastion',
          label: 'Update Redeven Desktop',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:start',
          label: 'Copy log',
        },
        {
          kind: 'dismiss',
          operation_key: 'gateway:bastion:start',
          label: 'Dismiss',
        },
      ]),
      action: 'start_gateway',
      operation_key: 'gateway:bastion:start',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
    };

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'check_gateway', label: 'Check Gateway' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
    ]);
    expect(visibleOperationNextActions(progress)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manage_desktop_update' }),
      expect.objectContaining({ kind: 'refresh_status' }),
      expect.objectContaining({ kind: 'update_runtime' }),
      expect.objectContaining({ kind: 'update_gateway' }),
      expect.objectContaining({ kind: 'retry' }),
      expect.objectContaining({ kind: 'refresh_gateway_status' }),
      expect.objectContaining({ kind: 'refresh_gateway_catalog' }),
      expect.objectContaining({ kind: 'dismiss' }),
    ]));
  });

  it('shows Gateway service recommendations after a diagnostic check completes', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'start_gateway',
          gateway_id: 'bastion',
          label: 'Start Gateway',
        },
        {
          kind: 'update_gateway',
          gateway_id: 'bastion',
          label: 'Update Gateway',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:check',
          label: 'Copy log',
        },
        {
          kind: 'dismiss',
          operation_key: 'gateway:bastion:check',
          label: 'Dismiss',
        },
      ]),
      action: 'check_gateway',
      operation_key: 'gateway:bastion:check',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
      status: 'succeeded',
    };

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'start_gateway', label: 'Start Gateway' }),
      expect.objectContaining({ kind: 'update_gateway', label: 'Update Gateway' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
    ]);
  });

  it('keeps legacy Gateway recovery ordering when Check Gateway is absent', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'resolve_gateway',
          gateway_id: 'bastion',
          resolve_focus: 'ssh_host',
          label: 'Resolve Gateway',
        },
        {
          kind: 'refresh_gateway_catalog',
          gateway_id: 'bastion',
          start_policy: 'start_if_needed',
          label: 'Sync Gateway',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:sync',
          label: 'Copy log',
        },
      ]),
      action: 'sync_gateway',
      operation_key: 'gateway:bastion:sync',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
    };

    expect(visibleOperationNextActions(progress).slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'resolve_gateway', label: 'Resolve Gateway' }),
      expect.objectContaining({ kind: 'refresh_gateway_catalog', label: 'Sync Gateway' }),
    ]);
  });

  it('keeps specific Gateway recovery actions before generic catalog sync', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'resolve_gateway',
          gateway_id: 'bastion',
          resolve_focus: 'ssh_host',
          label: 'Resolve Gateway',
        },
        {
          kind: 'refresh_gateway_catalog',
          gateway_id: 'bastion',
          start_policy: 'start_if_needed',
          label: 'Sync Gateway',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:sync',
          label: 'Copy log',
        },
      ]),
      action: 'sync_gateway',
      operation_key: 'gateway:bastion:sync',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
    };

    expect(visibleOperationNextActions(progress).slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'resolve_gateway', label: 'Resolve Gateway' }),
      expect.objectContaining({ kind: 'refresh_gateway_catalog', label: 'Sync Gateway' }),
    ]);
  });

  it('keeps focused Gateway resolve actions ahead of generic retry', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'retry',
          operation_key: 'gateway:bastion:sync',
          retry_action: {
            kind: 'sync_gateway',
            gateway_id: 'bastion',
          },
          label: 'Sync Gateway',
        },
        {
          kind: 'resolve_gateway',
          gateway_id: 'bastion',
          resolve_focus: 'container',
          label: 'Resolve Gateway',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:sync',
          label: 'Copy log',
        },
      ]),
      action: 'sync_gateway',
      operation_key: 'gateway:bastion:sync',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
    };

    expect(visibleOperationNextActions(progress).slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'resolve_gateway', resolve_focus: 'container' }),
      expect.objectContaining({ kind: 'retry', label: 'Sync Gateway' }),
    ]);
  });
});
