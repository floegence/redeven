import { Show, createMemo, type JSX } from 'solid-js';
import { windowStatusIllustrationSvg } from '@floegence/floe-webapp-core/window-status';
import { useI18n } from './i18n';

export type AccessGatePhase =
  | 'checking'
  | 'unlock_required'
  | 'resuming'
  | 'resume_blocked'
  | 'ready';

const ACCESS_GATE_IDS = {
  title: 'redeven-access-gate-title',
  description: 'redeven-access-gate-description',
  passwordInput: 'redeven-access-password',
  passwordHelp: 'redeven-access-password-help',
  resumeHint: 'redeven-access-resume-hint',
  error: 'redeven-access-error',
  notice: 'redeven-access-notice',
} as const;

export type AccessGateFeedback = Readonly<{ message: string; invalidInput: boolean }>;

export type EnvironmentAccessGateProps = Readonly<{
  phase: AccessGatePhase;
  secondFactor?: boolean;
  recoveryCode?: boolean;
  onToggleRecovery?: () => void;
  onBackToPassword?: () => void;
  local: boolean;
  environmentName: string;
  pending: boolean;
  unlocking: boolean;
  recoveryBusy: boolean;
  retryActive: boolean;
  retryDuration: string;
  password: string;
  feedback: AccessGateFeedback | null;
  languageMenu: JSX.Element;
  inputRef: (input: HTMLInputElement) => void;
  onPasswordInput: (value: string) => void;
  onSubmit: (event: SubmitEvent) => Promise<void>;
  onRetry: () => Promise<void>;
  onReload: () => void;
}>;

export function EnvironmentAccessGate(props: EnvironmentAccessGateProps) {
  const i18n = useI18n();
  const accessGateTitle = createMemo(() => {
    if (props.secondFactor) return i18n.t('accessGate.twoFactorTitle');
    switch (props.phase) {
      case 'checking':
        return i18n.t('accessGate.checkingTitle');
      case 'resuming':
        return i18n.t('accessGate.resumingTitle');
      case 'resume_blocked':
        return i18n.t('accessGate.resumeBlockedTitle');
      case 'unlock_required':
        return props.local
          ? i18n.t('accessGate.unlockLocalRuntimeTitle')
          : i18n.t('accessGate.unlockRuntimeTitle');
      default:
        return props.local
          ? i18n.t('accessGate.localRuntimeTitle')
          : i18n.t('accessGate.environmentTitle');
    }
  });
  const accessGateDescription = createMemo(() => {
    if (props.secondFactor)
      return i18n.t(
        props.recoveryCode
          ? 'accessGate.recoveryHelp'
          : 'accessGate.authenticatorHelp',
      );
    switch (props.phase) {
      case 'checking':
        return i18n.t('accessGate.checkingDescription');
      case 'resuming':
        return i18n.t('accessGate.resumingDescription');
      case 'resume_blocked':
        return i18n.t('accessGate.resumeBlockedDescription');
      case 'unlock_required':
        return props.local
          ? i18n.t('accessGate.unlockLocalDescription')
          : i18n.t('accessGate.unlockRemoteDescription');
      default:
        return i18n.t('accessGate.readyDescription');
    }
  });
  const accessGateCheckingLabel = createMemo(() =>
    i18n.t('accessGate.checkingLabel'),
  );
  const accessGateResumeHint = createMemo(() =>
    i18n.t('accessGate.resumeHint'),
  );
  const accessGatePasswordLabel = createMemo(() =>
    i18n.t(
      props.secondFactor
        ? props.recoveryCode
          ? 'accessGate.recoveryLabel'
          : 'accessGate.authenticatorLabel'
        : 'accessGate.passwordLabel',
    ),
  );
  const accessGatePasswordHelp = createMemo(() => {
    const base = props.local
      ? i18n.t('accessGate.localPasswordHelp')
      : i18n.t('accessGate.remotePasswordHelp');
    if (props.retryActive) {
      return i18n.t('accessGate.retryPasswordHelp', {
        base,
        duration: props.retryDuration,
      });
    }
    return base;
  });
  const accessGateUnlockLabel = createMemo(() => {
    if (props.unlocking) return i18n.t('accessGate.unlockingAction');
    if (props.retryActive) {
      return i18n.t('accessGate.retryInAction', {
        duration: props.retryDuration,
      });
    }
    return i18n.t('accessGate.unlockAction');
  });
  const accessGateRegionDescribedBy = createMemo(() => {
    const ids: string[] = [ACCESS_GATE_IDS.description, ACCESS_GATE_IDS.notice];
    if (props.phase === 'resuming' || props.phase === 'resume_blocked') {
      ids.push(ACCESS_GATE_IDS.resumeHint);
    }
    if (props.feedback?.message) {
      ids.push(ACCESS_GATE_IDS.error);
    }
    return ids.join(' ');
  });
  const accessGatePasswordDescribedBy = createMemo(() => {
    const ids: string[] = [ACCESS_GATE_IDS.passwordHelp];
    if (props.feedback?.message) {
      ids.push(ACCESS_GATE_IDS.error);
    }
    return ids.join(' ');
  });

  return (
    <div class="floe-window-status z-20" data-testid="environment-access-gate">
      <div class="absolute right-4 top-4">{props.languageMenu}</div>
      <section
        class="floe-window-status__content"
        aria-labelledby={ACCESS_GATE_IDS.title}
        aria-describedby={accessGateRegionDescribedBy()}
        aria-busy={props.pending || props.unlocking || props.recoveryBusy}
      >
        {/* eslint-disable-next-line solid/no-innerhtml -- Published artwork is fixed markup with no user or environment input. */}
        <div innerHTML={windowStatusIllustrationSvg('access')} />
        <p class="floe-window-status__identity">{props.environmentName}</p>
        <h1 id={ACCESS_GATE_IDS.title} class="floe-window-status__title">
          {accessGateTitle()}
        </h1>
        <p
          id={ACCESS_GATE_IDS.description}
          class="floe-window-status__description"
        >
          {accessGateDescription()}
        </p>

        <Show when={props.phase === 'unlock_required'}>
          <form
            class="floe-window-status__form flex flex-col gap-3"
            onSubmit={(event) => void props.onSubmit(event)}
          >
            <div class="space-y-2">
              <label
                for={ACCESS_GATE_IDS.passwordInput}
                class="text-sm font-medium text-foreground"
              >
                {accessGatePasswordLabel()}
              </label>
              <input
                ref={props.inputRef}
                id={ACCESS_GATE_IDS.passwordInput}
                type={props.secondFactor ? 'text' : 'password'}
                inputmode={
                  props.secondFactor
                    ? props.recoveryCode
                      ? 'text'
                      : 'numeric'
                    : undefined
                }
                autocomplete={
                  props.secondFactor ? 'one-time-code' : 'current-password'
                }
                placeholder={
                  props.secondFactor
                    ? undefined
                    : i18n.t('accessGate.passwordPlaceholder')
                }
                value={props.password}
                onInput={(event) =>
                  props.onPasswordInput(event.currentTarget.value)
                }
                disabled={props.pending || props.unlocking}
                aria-describedby={accessGatePasswordDescribedBy()}
                aria-invalid={props.feedback?.invalidInput ?? false}
                class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p
                id={ACCESS_GATE_IDS.passwordHelp}
                class="text-xs leading-5 text-muted-foreground"
              >
                {props.secondFactor ? '' : accessGatePasswordHelp()}
              </p>
            </div>
            <button
              type="submit"
              disabled={
                props.pending ||
                props.unlocking ||
                props.retryActive ||
                !props.password
              }
              class="floe-window-status__button"
            >
              {accessGateUnlockLabel()}
            </button>
            <Show when={props.secondFactor}>
              <div class="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  class="cursor-pointer text-xs text-muted-foreground"
                  onClick={props.onToggleRecovery}
                >
                  {i18n.t(
                    props.recoveryCode
                      ? 'accessGate.useAuthenticator'
                      : 'accessGate.useRecovery',
                  )}
                </button>
                <button
                  type="button"
                  class="cursor-pointer text-xs text-muted-foreground"
                  onClick={props.onBackToPassword}
                >
                  {i18n.t('accessGate.backToPassword')}
                </button>
              </div>
            </Show>
          </form>
        </Show>

        <Show when={props.phase === 'checking'}>
          <div class="floe-window-status__activity" role="status">
            <span data-floe-progress-shimmer="text">
              {accessGateCheckingLabel()}
            </span>
          </div>
        </Show>

        <Show
          when={props.phase === 'resuming' || props.phase === 'resume_blocked'}
        >
          <>
            <div
              id={ACCESS_GATE_IDS.resumeHint}
              class="floe-window-status__activity text-muted-foreground"
            >
              <span
                data-floe-progress-shimmer={
                  props.recoveryBusy ? 'text' : undefined
                }
              >
                {accessGateResumeHint()}
              </span>
            </div>
            <div class="floe-window-status__actions">
              <button
                type="button"
                disabled={props.recoveryBusy || props.unlocking}
                onClick={() => void props.onRetry()}
                class="floe-window-status__button"
              >
                {props.recoveryBusy
                  ? i18n.t('accessGate.preparingSecureSessionAction')
                  : i18n.t('accessGate.retryConnectionAction')}
              </button>
              <button
                type="button"
                onClick={() => props.onReload()}
                class="floe-window-status__button"
                data-variant="secondary"
              >
                {i18n.t('accessGate.reloadPageAction')}
              </button>
            </div>
          </>
        </Show>

        <Show when={props.feedback?.message}>
          <div
            id={ACCESS_GATE_IDS.error}
            role="alert"
            class="mx-auto mt-3 max-w-[316px] text-left text-xs leading-5 text-error"
          >
            {props.feedback?.message}
          </div>
        </Show>

        <div
          id={ACCESS_GATE_IDS.notice}
          class="mx-auto mt-5 max-w-[316px] text-xs leading-5 text-muted-foreground"
        >
          {i18n.t('accessGate.notice')}
        </div>
      </section>
    </div>
  );
}
