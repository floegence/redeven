import { describe, expect, it } from 'vitest';

import {
  getMonitorProcessCpuUsagePresentation,
  getMonitorProcessMemoryUsagePresentation,
} from './monitorProcessUsageTone';

const GIBIBYTE = 1024 ** 3;

describe('monitorProcessUsageTone', () => {
  it('resolves CPU usage thresholds to semantic tones', () => {
    expect(getMonitorProcessCpuUsagePresentation(Number.NaN)).toMatchObject({ tone: 'muted', className: 'text-muted-foreground' });
    expect(getMonitorProcessCpuUsagePresentation(19.9)).toMatchObject({ tone: 'muted', className: 'text-muted-foreground' });
    expect(getMonitorProcessCpuUsagePresentation(20)).toMatchObject({ tone: 'success', className: 'text-success' });
    expect(getMonitorProcessCpuUsagePresentation(49.9)).toMatchObject({ tone: 'success', className: 'text-success' });
    expect(getMonitorProcessCpuUsagePresentation(50)).toMatchObject({ tone: 'warning', className: 'text-warning' });
    expect(getMonitorProcessCpuUsagePresentation(99.9)).toMatchObject({ tone: 'warning', className: 'text-warning' });
    expect(getMonitorProcessCpuUsagePresentation(100)).toMatchObject({ tone: 'error', className: 'text-error' });
    expect(getMonitorProcessCpuUsagePresentation(188.4)).toMatchObject({ tone: 'error', className: 'text-error' });
  });

  it('resolves memory usage thresholds to semantic tones', () => {
    expect(getMonitorProcessMemoryUsagePresentation(-1)).toMatchObject({ tone: 'muted', className: 'text-muted-foreground' });
    expect(getMonitorProcessMemoryUsagePresentation(512 * 1024 * 1024)).toMatchObject({ tone: 'muted', className: 'text-muted-foreground' });
    expect(getMonitorProcessMemoryUsagePresentation(1 * GIBIBYTE)).toMatchObject({ tone: 'success', className: 'text-success' });
    expect(getMonitorProcessMemoryUsagePresentation((10 * GIBIBYTE) - 1)).toMatchObject({ tone: 'success', className: 'text-success' });
    expect(getMonitorProcessMemoryUsagePresentation(10 * GIBIBYTE)).toMatchObject({ tone: 'warning', className: 'text-warning' });
    expect(getMonitorProcessMemoryUsagePresentation(24 * GIBIBYTE)).toMatchObject({ tone: 'warning', className: 'text-warning' });
  });
});
