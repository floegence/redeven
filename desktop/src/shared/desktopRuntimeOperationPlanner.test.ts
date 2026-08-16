import { describe, expect, it } from 'vitest';

import { buildDesktopRuntimeOperationPlans } from './desktopRuntimeOperationPlanner';

describe('desktopRuntimeOperationPlanner', () => {
  it('leaves workload confirmation to Gateway preflight without projecting client ownership', () => {
    const plans = buildDesktopRuntimeOperationPlans({
      surface: 'managed_runtime_card',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      running: true,
      openable: false,
      maintenance: {
        kind: 'runtime_restart_required',
        required_for: 'open',
        recovery_action: 'restart_runtime',
        can_desktop_start: false,
        can_desktop_restart: true,
        has_active_work: true,
        active_work_label: 'Active work may be interrupted',
        message: 'Runtime restart is required before opening.',
      },
    });

    expect(plans.open.availability).toBe('blocked');
    expect(plans.start.requires_confirmation).toBe(false);
    expect(plans.stop.requires_confirmation).toBe(false);
    expect(plans.restart.requires_confirmation).toBe(false);
    expect(plans.update.requires_confirmation).toBe(false);
    expect(JSON.stringify(plans)).not.toContain('owner');
    expect(JSON.stringify(plans)).not.toContain('takeover');
  });
});
