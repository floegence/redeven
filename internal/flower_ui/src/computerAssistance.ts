import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';

export type ComputerAssistanceObservation = Readonly<{ kind: string; origin?: string; app?: string; foreground?: boolean }>;

export function isComputerSafetyAssistanceKind(value: unknown): value is string {
  return typeof value === 'string' && ['access', 'target', 'captcha', 'verification', 'login', 'private_input', 'inspection', 'untrusted_content', 'paused'].includes(value);
}

export function computerAssistanceFromError(error: unknown): ComputerAssistanceObservation | undefined {
  if (!error || typeof error !== 'object') return;
  const response = error as { code?: unknown; data?: { computer_assistance?: ComputerAssistanceObservation } };
  const observed = response.data?.computer_assistance;
  if (response.code !== 'computer_control_not_ready' || !observed || typeof observed !== 'object'
    || !isComputerSafetyAssistanceKind(observed.kind)) return;
  let origin: string | undefined;
  if (typeof observed.origin === 'string') {
    try {
      const url = new URL(observed.origin);
      if (['https:', 'http:'].includes(url.protocol) && url.origin === observed.origin) origin = url.origin;
    } catch { /* Invalid display facts never become grants. */ }
  }
  const app = typeof observed.app === 'string' && observed.app.length > 0 && observed.app.length <= 255
    && observed.app.trim() === observed.app && !['\0', '\r', '\n', '/', '\\'].some(value => observed.app!.includes(value)) ? observed.app : undefined;
  if (observed.kind === 'access' && !origin && !app && observed.foreground !== true) return;
  return { kind: observed.kind, origin, app, foreground: observed.foreground === true };
}

// Derive presentation from canonical tool facts. There is no separate waiting
// state: the current InputRequired interaction still owns continuation.
export function computerAssistance(item: FlowerActivityItem | undefined, copy: FlowerComputerCopy, observed?: ComputerAssistanceObservation, fullAccess = false) {
  const refs = item?.target_refs ?? [];
  const requested = observed ? { origin: observed.origin, app: observed.app, foreground: observed.foreground } : {
    origin: refs.find(ref => ref.kind === 'computer_origin')?.resource_ref,
    app: refs.find(ref => ref.kind === 'computer_app')?.resource_ref,
    foreground: refs.some(ref => ref.kind === 'computer_foreground'),
  };
  const reason = observed?.kind ?? item?.chips?.find(chip => chip.kind === 'computer_assistance')?.value;
  const reasonKind = reason === 'target' ? 'target' : requested.origin || requested.app || requested.foreground ? 'access' : reason ?? 'inspection';
  const kind = reasonKind === 'access' && fullAccess ? 'authorized' : reasonKind;
  const messages: Record<string, readonly [string, string]> = {
    connection: [copy.connectionTitle, copy.connectionHint],
    authorized: [copy.fullAccessTitle, copy.authorizedHint],
    access: [requested.origin ? copy.siteTitle : copy.accessTitle, copy.accessHint],
    target: [copy.targetTitle, copy.targetHint],
    captcha: [copy.captchaTitle, copy.captchaHint],
    verification: [copy.verificationTitle, copy.verificationHint],
    login: [copy.loginTitle, copy.loginHint],
    private_input: [copy.privateTitle, copy.privateHint],
    inspection: [copy.inspectionTitle, copy.inspectionHint],
    untrusted_content: [copy.untrustedTitle, copy.untrustedHint],
    paused: [copy.pausedTitle, copy.pausedHint],
  };
  const [title, instruction] = messages[kind] ?? messages.inspection;
  return { kind, title, instruction, requested };
}
