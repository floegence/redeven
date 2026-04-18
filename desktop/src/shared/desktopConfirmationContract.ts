export type DesktopConfirmationResult = 'confirm' | 'cancel';
export type DesktopConfirmationActionTone = 'danger' | 'warning';

export type DesktopConfirmationDialogModel = Readonly<{
  title: string;
  message: string;
  detail: string;
  confirm_label: string;
  cancel_label: string;
  confirm_tone: DesktopConfirmationActionTone;
}>;
