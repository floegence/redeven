import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';

import type {
  DesktopConfirmationDialogModel,
  DesktopConfirmationResult,
} from '../shared/desktopConfirmationContract';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function platformAdjustedTitle(
  model: DesktopConfirmationDialogModel,
  platform: NodeJS.Platform,
): string {
  if (platform !== 'darwin' && model.platform_action === 'quit_app') {
    return compact(model.platform_title) || model.title;
  }
  return model.title;
}

function platformAdjustedConfirmLabel(
  model: DesktopConfirmationDialogModel,
  platform: NodeJS.Platform,
): string {
  if (platform !== 'darwin' && model.platform_action === 'quit_app') {
    return compact(model.platform_confirm_label) || model.confirm_label;
  }
  return model.confirm_label;
}

export function buildDesktopConfirmationMessageBoxOptions(args: Readonly<{
  model: DesktopConfirmationDialogModel;
  platform?: NodeJS.Platform;
}>): MessageBoxOptions {
  const platform = args.platform ?? process.platform;
  const confirmLabel = platformAdjustedConfirmLabel(args.model, platform);
  const detail = compact(args.model.detail);

  return {
    type: args.model.confirm_tone === 'danger' ? 'warning' : 'question',
    title: platformAdjustedTitle(args.model, platform),
    message: args.model.message,
    detail: detail === '' ? undefined : detail,
    buttons: [confirmLabel, args.model.cancel_label],
    defaultId: 1,
    cancelId: 1,
    noLink: platform === 'win32',
  };
}

export async function showDesktopConfirmationDialog(args: Readonly<{
  model: DesktopConfirmationDialogModel;
  parentWindow?: BrowserWindow | null;
  platform?: NodeJS.Platform;
}>): Promise<DesktopConfirmationResult> {
  const actualParent = args.parentWindow && !args.parentWindow.isDestroyed()
    ? args.parentWindow
    : undefined;
  const platform = args.platform ?? process.platform;
  const options = buildDesktopConfirmationMessageBoxOptions({
    model: args.model,
    platform,
  });
  const result = actualParent
    ? await dialog.showMessageBox(actualParent, options)
    : await dialog.showMessageBox(options);
  return result.response === 0 ? 'confirm' : 'cancel';
}
