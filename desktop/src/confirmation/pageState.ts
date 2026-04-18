import type { DesktopResolvedTheme } from '../shared/desktopTheme';
import {
  normalizeDesktopConfirmationDialogModel,
  type DesktopConfirmationDialogModel,
} from '../shared/desktopConfirmationContract';

export type DesktopConfirmationPageState = Readonly<{
  model: DesktopConfirmationDialogModel | null;
  resolvedTheme: DesktopResolvedTheme;
}>;

function normalizeDesktopConfirmationResolvedTheme(value: unknown): DesktopResolvedTheme {
  return String(value ?? '').trim() === 'dark' ? 'dark' : 'light';
}

export function loadDesktopConfirmationPageState(search: string): DesktopConfirmationPageState {
  const params = new URLSearchParams(search);
  const resolvedTheme = normalizeDesktopConfirmationResolvedTheme(params.get('theme'));
  const rawModel = params.get('model');
  if (!rawModel) {
    return {
      model: null,
      resolvedTheme,
    };
  }

  try {
    return {
      model: normalizeDesktopConfirmationDialogModel(JSON.parse(rawModel)),
      resolvedTheme,
    };
  } catch {
    return {
      model: null,
      resolvedTheme,
    };
  }
}
