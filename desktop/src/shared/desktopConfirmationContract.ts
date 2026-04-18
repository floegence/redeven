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

const DESKTOP_CONFIRMATION_ACTION_ORIGIN = 'https://redeven-desktop.invalid';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopConfirmationActionURL(action: DesktopConfirmationResult): string {
  return `${DESKTOP_CONFIRMATION_ACTION_ORIGIN}/confirmation/${action}`;
}

export function isDesktopConfirmationActionURL(rawURL: string): boolean {
  return compact(rawURL).startsWith(`${DESKTOP_CONFIRMATION_ACTION_ORIGIN}/`);
}

export function desktopConfirmationActionFromURL(rawURL: string): DesktopConfirmationResult | null {
  if (!isDesktopConfirmationActionURL(rawURL)) {
    return null;
  }
  const url = new URL(rawURL);
  switch (url.pathname) {
    case '/confirmation/confirm':
      return 'confirm';
    case '/confirmation/cancel':
      return 'cancel';
    default:
      return null;
  }
}

export function normalizeDesktopConfirmationActionTone(
  value: unknown,
  fallback: DesktopConfirmationActionTone = 'danger',
): DesktopConfirmationActionTone {
  return compact(value) === 'warning' ? 'warning' : fallback;
}

export function normalizeDesktopConfirmationDialogModel(raw: unknown): DesktopConfirmationDialogModel | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const title = compact(record.title);
  const message = compact(record.message);
  const detail = compact(record.detail);
  const confirmLabel = compact(record.confirm_label);
  const cancelLabel = compact(record.cancel_label);

  if (title === '' || message === '' || confirmLabel === '' || cancelLabel === '') {
    return null;
  }

  return {
    title,
    message,
    detail,
    confirm_label: confirmLabel,
    cancel_label: cancelLabel,
    confirm_tone: normalizeDesktopConfirmationActionTone(record.confirm_tone),
  };
}
