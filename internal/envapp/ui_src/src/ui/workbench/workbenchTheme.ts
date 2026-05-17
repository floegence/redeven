import {
  DEFAULT_WORKBENCH_THEME,
  isWorkbenchThemeId,
  type WorkbenchThemeId,
} from '@floegence/floe-webapp-core/workbench';

export function normalizeWorkbenchTheme(
  value: unknown,
  fallback: WorkbenchThemeId = DEFAULT_WORKBENCH_THEME,
): WorkbenchThemeId {
  return isWorkbenchThemeId(value) ? value : fallback;
}
