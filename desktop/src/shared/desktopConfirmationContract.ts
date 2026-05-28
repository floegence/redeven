export type DesktopConfirmationResult = 'confirm' | 'cancel';
export type DesktopConfirmationActionTone = 'danger' | 'warning';
export type DesktopConfirmationPlatformAction = 'quit_app';

export type DesktopConfirmationDialogModel = Readonly<{
  title: string;
  message: string;
  detail: string;
  confirm_label: string;
  cancel_label: string;
  confirm_tone: DesktopConfirmationActionTone;
  platform_action?: DesktopConfirmationPlatformAction;
  platform_title?: string;
  platform_confirm_label?: string;
}>;
