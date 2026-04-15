export type DesktopActionToastTone = 'info' | 'success' | 'warning' | 'error';

export type DesktopActionToast = Readonly<{
  id: number;
  tone: DesktopActionToastTone;
  message: string;
}>;

export const DESKTOP_ACTION_TOAST_LIMIT = 3;

type QueueDesktopActionToastArgs = Readonly<{
  current: readonly DesktopActionToast[];
  next: DesktopActionToast;
  limit?: number;
}>;

export type QueueDesktopActionToastResult = Readonly<{
  toasts: readonly DesktopActionToast[];
  active_toast: DesktopActionToast | null;
  removed_toast_ids: readonly number[];
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function queueDesktopActionToast(
  args: QueueDesktopActionToastArgs,
): QueueDesktopActionToastResult {
  const message = compact(args.next.message);
  if (message === '') {
    return {
      toasts: args.current,
      active_toast: null,
      removed_toast_ids: [],
    };
  }

  const limit = Number.isInteger(args.limit) && Number(args.limit) > 0
    ? Number(args.limit)
    : DESKTOP_ACTION_TOAST_LIMIT;
  const duplicateIDs = args.current
    .filter((toast) => toast.message === message && toast.tone === args.next.tone)
    .map((toast) => toast.id);
  const deduped = args.current.filter((toast) => !duplicateIDs.includes(toast.id));
  const nextToast: DesktopActionToast = {
    id: args.next.id,
    tone: args.next.tone,
    message,
  };
  const combined = [...deduped, nextToast];
  const overflowCount = Math.max(0, combined.length - limit);
  const overflowIDs = overflowCount > 0
    ? combined.slice(0, overflowCount).map((toast) => toast.id)
    : [];

  return {
    toasts: overflowCount > 0 ? combined.slice(overflowCount) : combined,
    active_toast: nextToast,
    removed_toast_ids: [...duplicateIDs, ...overflowIDs],
  };
}
