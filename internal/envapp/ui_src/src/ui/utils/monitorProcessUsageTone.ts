export type MonitorProcessUsageTone = 'muted' | 'success' | 'warning' | 'error';

export interface MonitorProcessUsageRule {
  minInclusive: number;
  tone: MonitorProcessUsageTone;
}

export interface MonitorProcessUsagePresentation {
  tone: MonitorProcessUsageTone;
  className: string;
}

const GIBIBYTE = 1024 ** 3;

export const CPU_USAGE_TONE_RULES: ReadonlyArray<MonitorProcessUsageRule> = [
  { minInclusive: 100, tone: 'error' },
  { minInclusive: 50, tone: 'warning' },
  { minInclusive: 20, tone: 'success' },
  { minInclusive: 0, tone: 'muted' },
];

export const MEMORY_USAGE_TONE_RULES: ReadonlyArray<MonitorProcessUsageRule> = [
  { minInclusive: 10 * GIBIBYTE, tone: 'warning' },
  { minInclusive: 1 * GIBIBYTE, tone: 'success' },
  { minInclusive: 0, tone: 'muted' },
];

export const MONITOR_PROCESS_USAGE_TONE_CLASS: Record<MonitorProcessUsageTone, string> = {
  muted: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

function normalizeUsageValue(value: number): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
}

function resolveMonitorProcessUsageTone(value: number, rules: ReadonlyArray<MonitorProcessUsageRule>): MonitorProcessUsageTone {
  const normalized = normalizeUsageValue(value);
  const matchedRule = rules.find((rule) => normalized >= rule.minInclusive);
  return matchedRule?.tone ?? 'muted';
}

function buildMonitorProcessUsagePresentation(value: number, rules: ReadonlyArray<MonitorProcessUsageRule>): MonitorProcessUsagePresentation {
  const tone = resolveMonitorProcessUsageTone(value, rules);
  return {
    tone,
    className: MONITOR_PROCESS_USAGE_TONE_CLASS[tone],
  };
}

export function getMonitorProcessCpuUsagePresentation(cpuPercent: number): MonitorProcessUsagePresentation {
  return buildMonitorProcessUsagePresentation(cpuPercent, CPU_USAGE_TONE_RULES);
}

export function getMonitorProcessMemoryUsagePresentation(memoryBytes: number): MonitorProcessUsagePresentation {
  return buildMonitorProcessUsagePresentation(memoryBytes, MEMORY_USAGE_TONE_RULES);
}
