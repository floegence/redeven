import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { FlowerComputerCopy } from './computerUseCopy';

export type ComputerAssistanceObservation = Readonly<{ kind: string; origin?: string; app?: string; foreground?: boolean }>;

export function isComputerSafetyAssistanceKind(value: unknown): value is string {
  return typeof value === 'string' && ['access', 'target', 'captcha', 'verification', 'login', 'private_input', 'inspection', 'untrusted_content', 'paused'].includes(value);
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
    installation: [copy.browserInstallTitle, copy.browserInstallHint],
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
