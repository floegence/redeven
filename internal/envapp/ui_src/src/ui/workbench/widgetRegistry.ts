import type { EnvWorkbenchWidgetDefinition, EnvWorkbenchWidgetType } from './types';

export type EnvWorkbenchRegistryEntry = EnvWorkbenchWidgetDefinition;

export function resolveEnvWorkbenchWidgetDefinitions(
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[],
): readonly EnvWorkbenchWidgetDefinition[] {
  return Array.isArray(widgetDefinitions) ? widgetDefinitions : [];
}

export function getEnvWorkbenchWidgetEntry(
  type: EnvWorkbenchWidgetType,
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[],
): EnvWorkbenchRegistryEntry {
  const registry = resolveEnvWorkbenchWidgetDefinitions(widgetDefinitions);
  const entry = registry.find((candidate) => candidate.type === type);
  if (entry) {
    return entry;
  }
  if (registry[0]) {
    return registry[0];
  }
  throw new Error(`Unknown env workbench widget type: ${type}`);
}

export function createEnvWorkbenchFilterState(
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[],
  source?: Partial<Record<EnvWorkbenchWidgetType, boolean>>,
): Record<EnvWorkbenchWidgetType, boolean> {
  const registry = resolveEnvWorkbenchWidgetDefinitions(widgetDefinitions);
  const result: Record<EnvWorkbenchWidgetType, boolean> = {};

  registry.forEach((entry) => {
    result[entry.type] = typeof source?.[entry.type] === 'boolean' ? source[entry.type]! : true;
  });

  return result;
}
