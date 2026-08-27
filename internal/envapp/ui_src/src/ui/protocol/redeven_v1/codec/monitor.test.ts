import { describe, expect, it } from 'vitest';

import { fromWireRuntimeProcessMetricsResponse } from './monitor';

describe('Runtime process metrics codec', () => {
  it('maps the wire fields without changing multicore CPU values', () => {
    expect(fromWireRuntimeProcessMetricsResponse({
      cpu_percent: 142.25,
      memory_bytes: 268_435_456,
      sampled_at_ms: 9876,
    })).toEqual({
      cpuPercent: 142.25,
      memoryBytes: 268_435_456,
      sampledAtMs: 9876,
    });
  });

  it('keeps decoded usage values non-negative', () => {
    expect(fromWireRuntimeProcessMetricsResponse({
      cpu_percent: -1,
      memory_bytes: -2,
      sampled_at_ms: -3,
    })).toEqual({
      cpuPercent: 0,
      memoryBytes: 0,
      sampledAtMs: 0,
    });
  });
});
