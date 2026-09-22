import { Show, For, createSignal, createEffect, createMemo, on, onCleanup } from 'solid-js';
import {
  Button,
  Checkbox,
  Dialog,
  Input,
} from '@floegence/floe-webapp-core/ui';
import {
  Shield,
  ShieldCheck,
  Key,
  Copy,
  Download,
  Check,
  ChevronRight,
  Lock,
  AlertCircle,
} from '@floegence/floe-webapp-core/icons';
import './TwoFactorSettings.css';
import type { DesktopI18n } from '../shared/i18n';
import type {
  SecurityAction,
  SecurityRequest,
  SecurityResult,
} from '../shared/runtimeSecurity';

export function TwoFactorSettings(props: {
  environmentID: string;
  runtimeStartedAt?: number;
  configureHTTPS: () => void;
  onHTTPSReady?: () => void;
  i18n: DesktopI18n;
  manage: (request: SecurityRequest) => Promise<SecurityResult>;
}) {
  const [status, setStatus] = createSignal<SecurityResult>();
  const [view, setView] = createSignal<
    'closed' | 'manage' | 'verifyOwner' | 'scan' | 'recovery'
  >('closed');
  const [action, setAction] = createSignal<SecurityAction>('setup');
  const [operation, setOperation] = createSignal<SecurityResult>();
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const needsPassword = () =>
    !status()?.password_configured || status()?.recovery_pending;
  const [code, setCode] = createSignal('');
  const [useRecovery, setUseRecovery] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [keyCopied, setKeyCopied] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const requiresHTTPS = () => status()?.https_ready === false;
  let errorNotice: HTMLDivElement | undefined;
  createEffect(() => {
    if (error()) queueMicrotask(() => errorNotice?.scrollIntoView({ block: 'nearest' }));
  });
  let generation = 0;
  const text = (
    key:
      | 'connectTitle'
      | 'stepConnect'
      | 'stepSave'
      | 'copied'
      | 'copyKey'
      | 'title'
      | 'scope'
      | 'on'
      | 'off'
      | 'unavailable'
      | 'setup'
      | 'manage'
      | 'scan'
      | 'manual'
      | 'code'
      | 'password'
      | 'continue'
      | 'recoveryTitle'
      | 'recoveryHelp'
      | 'copy'
      | 'download'
      | 'saved'
      | 'enable'
      | 'replace'
      | 'rotate'
      | 'disable'
      | 'confirm'
      | 'cancel'
      | 'ownerHelp'
      | 'useRecovery'
      | 'useAuthenticator'
      | 'recoveryCode'
      | 'done'
      | 'locked'
      | 'newPassword'
      | 'confirmPassword'
      | 'setupPassword'
      | 'retry'
      | 'invalidCredentials'
      | 'invalidCode'
      | 'disableHelp'
      | 'retryLater',
  ) => props.i18n.t(`security.${key}`);
  const close = () => {
    const id = operation()?.operation_id;
    if (id)
      void props
        .manage({ action: 'cancel', operation_id: id })
        .catch(() => undefined);
    generation++;
    setView('closed');
    setOperation(undefined);
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setError('');
    setSaved(false);
    setCopied(false);
    setKeyCopied(false);
    setBusy(false);
  };
  const run = async (
    request: SecurityRequest,
    next?: 'scan' | 'recovery' | 'closed',
  ) => {
    if (busy()) return;
    const current = generation;
    setBusy(true);
    setError('');
    try {
      const result = await props.manage(request);
      if (current !== generation) return;
      if (request.action === 'status') setStatus(result);
      else if (next === 'closed') {
        setStatus(result);
        setOperation(undefined);
        close();
      } else {
        setOperation(result);
        if (next) setView(next);
      }
      setPassword('');
      setConfirmPassword('');
      setCode('');
    } catch (failure) {
      if (current === generation) {
        const code = failure instanceof Error ? failure.message : '';
        if (code === 'SETTINGS_CLOSED') return;
        if (code === 'SECURITY_HTTPS_REQUIRED') {
          close();
          setStatus((previous) => previous ? { ...previous, https_ready: false } : previous);
          return;
        }
        if (request.action === 'commit' && (code.startsWith('RUNTIME_CONTROL_') || code === 'SECURITY_UNAVAILABLE')) {
          // A lost response is not permission to replay a security mutation.
          close();
          const reconciliation = generation;
          try {
            const authoritative = await props.manage({ action: 'status' });
            if (generation !== reconciliation) return;
            setStatus(authoritative);
            setError(props.i18n.t('security.actionUncertain'));
          } catch { if (generation === reconciliation) setError(props.i18n.t('environmentCenter.runtimeUnavailableNow')); }
          return;
        }
        setError(
          code === 'SETTINGS_RUNTIME_PREPARING' ? props.i18n.t('environmentStatus.runtimePreparing')
            : code === 'SETTINGS_RUNTIME_INCOMPATIBLE' ? props.i18n.t('environmentStatus.runtimeNeedsUpdate')
            : code === 'SECURITY_UNAVAILABLE' || code.startsWith('RUNTIME_CONTROL_') ? props.i18n.t('environmentCenter.runtimeUnavailableNow')
            : code === 'SECURITY_RESTART_REQUIRED'
            ? props.i18n.t('environmentStatus.restartRequired')
            : code === 'SECURITY_START_REQUIRED'
              ? props.i18n.t('environmentCenter.startRuntimeFirst')
              : text(
                  code === 'ACCESS_PASSWORD_RETRY_LATER'
                    ? 'retryLater'
                    : code === 'ACCESS_PASSWORD_INVALID'
                      ? 'invalidCredentials'
                      : code === 'ACCESS_FACTOR_INVALID'
                        ? 'invalidCode'
                        : 'retry',
                ),
        );
      }
    } finally {
      if (current === generation) {
        setBusy(false);
        if (request.action === 'status' && status()?.https_ready) props.onHTTPSReady?.();
      }
    }
  };
  // Status snapshots refresh independently of the selected environment. Only
  // an identity change may discard an in-progress enrollment or owner check.
  const runtimeIdentity = createMemo<{ environmentID: string; startedAt: number }>((previous) => ({
    environmentID: props.environmentID,
    startedAt: props.runtimeStartedAt ?? (previous?.environmentID === props.environmentID ? previous.startedAt : 0),
  }));
  const environmentID = createMemo(() => `${runtimeIdentity().environmentID}:${runtimeIdentity().startedAt}`);
  createEffect(
    on(
      environmentID,
      (_, previous) => {
        const interrupted = previous !== undefined && view() !== 'closed';
        close();
        const current = generation;
        setStatus(undefined);
        void run({ action: 'status' }).then(() => {
          if (generation === current && interrupted && !error()) setError(props.i18n.t('security.runtimeChanged'));
        });
      },
    ),
  );
  onCleanup(close);
  const begin = (selected: SecurityAction) => {
    if ((selected === 'setup' || selected === 'replace') && requiresHTTPS()) {
      close();
      props.configureHTTPS();
      return;
    }
    setError('');
    setAction(selected);
    setCode('');
    setUseRecovery(false);
    setSaved(false);
    setCopied(false);
    setKeyCopied(false);
    if (
      selected === 'setup' &&
      status()?.password_configured &&
      !status()?.recovery_pending
    )
      void run({ action: selected }, 'scan');
    else setView('verifyOwner');
  };
  const confirmOwner = () => {
    if (!password() || (needsPassword() && password() !== confirmPassword()))
      return;
    return run(
      {
        action: action(),
        password: password(),
        ...(useRecovery() ? { recovery_code: code() } : { code: code() }),
      },
      action() === 'disable'
        ? 'recovery'
        : action() === 'rotate'
          ? 'recovery'
          : 'scan',
    );
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        operation()?.recovery_codes?.join('\n') ?? '',
      );
      setCopied(true);
    } catch {
      setError(text('download'));
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([operation()?.recovery_codes?.join('\n') ?? ''], {
        type: 'text/plain',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'redeven-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(operation()?.secret ?? '');
      setKeyCopied(true);
    } catch {
      setError(text('retry'));
    }
  };
  const isEnrollment = () => action() === 'setup' || action() === 'replace';
  return (
    <>
      <section class="two-factor-setting">
        <div class="two-factor-setting-identity">
          <span class="two-factor-setting-icon" aria-hidden="true">
            <Shield size={19} />
          </span>
          <div class="two-factor-setting-copy">
            <h3>{text('title')}</h3>
            <p>{text('scope')}</p>
          </div>
        </div>
        <div class="environment-access-control two-factor-setting-actions">
          <span
            class="two-factor-status"
            data-enabled={status()?.enabled && !status()?.recovery_pending}
          >
            <span aria-hidden="true" />
            {status()
              ? text(
                  status()!.recovery_pending
                    ? 'locked'
                    : status()!.enabled
                      ? 'on'
                      : 'off',
                )
              : busy() ? props.i18n.t('environmentStatus.checking') : text('unavailable')}
          </span>
          <Show when={!requiresHTTPS()}>
            <Button
              size="sm"
              variant="outline"
              disabled={!status() || busy()}
              onClick={() =>
                status()!.enabled && !status()!.recovery_pending
                  ? setView('manage')
                  : begin('setup')
              }
            >
              {text(
                status()?.enabled && !status()?.recovery_pending
                  ? 'manage'
                  : 'setup',
              )}
            </Button>
          </Show>
        </div>
        <Show when={requiresHTTPS()}>
          <div class="two-factor-notice two-factor-prerequisite" role="status">
            <Lock size={18} aria-hidden="true" />
            <div class="two-factor-notice-copy">
              <h4>{props.i18n.t('security.httpsTitle')}</h4>
              <p>{props.i18n.t('security.httpsHelp')}</p>
            </div>
            <Button size="sm" variant="outline" class="two-factor-notice-action" onClick={props.configureHTTPS}>
              {props.i18n.t('security.configureHTTPS')}<ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </Show>
        <Show when={view() === 'closed' && error()}>
          <div ref={errorNotice} role="alert" class="two-factor-notice two-factor-error">
            <AlertCircle size={18} aria-hidden="true" />
            <p class="two-factor-notice-copy">{error()}</p>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void run({ action: 'status' })}>{props.i18n.t('common.retry')}</Button>
          </div>
        </Show>
      </section>
      <Dialog
        open={view() !== 'closed'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={text('title')}
        closeLabel={text('cancel')}
        class="two-factor-dialog"
        contentClass="two-factor-dialog-body"
      >
        <div class="two-factor-flow">
          <Show when={error()}>
            <div ref={errorNotice} role="alert" class="two-factor-notice two-factor-error">
              <AlertCircle size={18} aria-hidden="true" />
              <p class="two-factor-notice-copy">{error()}</p>
            </div>
          </Show>
          <Show
            when={
              isEnrollment() && (view() === 'scan' || view() === 'recovery')
            }
          >
            <ol class="two-factor-progress">
              <li
                aria-current={view() === 'scan' ? 'step' : undefined}
                data-complete={view() === 'recovery'}
              >
                <span class="two-factor-step-number" aria-hidden="true">
                  <Show when={view() === 'recovery'} fallback="1">
                    <Check size={12} />
                  </Show>
                </span>
                <span>{text('stepConnect')}</span>
              </li>
              <li aria-current={view() === 'recovery' ? 'step' : undefined}>
                <span class="two-factor-step-number" aria-hidden="true">
                  2
                </span>
                <span>{text('stepSave')}</span>
              </li>
            </ol>
          </Show>
          <Show when={view() === 'manage'}>
            <div class="two-factor-heading">
              <span class="two-factor-emblem" aria-hidden="true">
                <ShieldCheck size={24} />
              </span>
              <h3>{text('on')}</h3>
              <p>
                {props.i18n.t('security.remaining', {
                  count: status()?.recovery_codes_remaining ?? 0,
                })}
              </p>
            </div>
            <div class="two-factor-management">
              <button onClick={() => begin('replace')}>
                <Shield size={17} />
                <span>{text('replace')}</span>
                <ChevronRight size={15} />
              </button>
              <button onClick={() => begin('rotate')}>
                <Key size={17} />
                <span>{text('rotate')}</span>
                <ChevronRight size={15} />
              </button>
            </div>
            <Button
              variant="ghost"
              class="two-factor-disable"
              onClick={() => begin('disable')}
            >
              {text('disable')}
            </Button>
          </Show>
          <Show when={view() === 'verifyOwner'}>
            <div class="two-factor-heading">
              <span class="two-factor-emblem" aria-hidden="true">
                <Shield size={24} />
              </span>
              <h3>
                {text(
                  needsPassword()
                    ? 'newPassword'
                    : action() === 'disable'
                      ? 'disable'
                      : action() === 'rotate'
                        ? 'rotate'
                        : 'replace',
                )}
              </h3>
              <p>{text(needsPassword() ? 'setupPassword' : 'ownerHelp')}</p>
            </div>
            <form
              class="two-factor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmOwner();
              }}
            >
              <label class="two-factor-field">
                <span>
                  {text(needsPassword() ? 'newPassword' : 'password')}
                </span>
                <Input
                  type="password"
                  autocomplete={
                    needsPassword() ? 'new-password' : 'current-password'
                  }
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
              </label>
              <Show when={needsPassword()}>
                <label class="two-factor-field">
                  <span>{text('confirmPassword')}</span>
                  <Input
                    type="password"
                    autocomplete="new-password"
                    value={confirmPassword()}
                    onInput={(event) =>
                      setConfirmPassword(event.currentTarget.value)
                    }
                  />
                </label>
              </Show>
              <Show when={status()?.enabled && !status()?.recovery_pending}>
                <label class="two-factor-field">
                  <span>{text(useRecovery() ? 'recoveryCode' : 'code')}</span>
                  <Input
                    type="text"
                    inputmode={useRecovery() ? 'text' : 'numeric'}
                    autocomplete="one-time-code"
                    value={code()}
                    onInput={(event) => setCode(event.currentTarget.value)}
                  />
                </label>
                <button
                  class="two-factor-text-action"
                  type="button"
                  onClick={() => {
                    setUseRecovery(!useRecovery());
                    setCode('');
                  }}
                >
                  {text(useRecovery() ? 'useAuthenticator' : 'useRecovery')}
                </button>
              </Show>
              <Button
                class="two-factor-primary"
                type="submit"
                disabled={
                  busy() ||
                  !password() ||
                  (needsPassword() && password() !== confirmPassword()) ||
                  (!needsPassword() && !code())
                }
                loading={busy()}
              >
                {text('continue')}
              </Button>
            </form>
          </Show>
          <Show when={view() === 'scan'}>
            <div class="two-factor-heading">
              <h3>{text('connectTitle')}</h3>
              <p>{text('scan')}</p>
            </div>
            <div class="two-factor-pairing">
              <div class="two-factor-qr">
                <img
                  src={operation()?.qr_image}
                  alt={text('scan')}
                  width="192"
                  height="192"
                />
              </div>
              <details class="two-factor-manual">
                <summary>
                  {text('manual')}
                  <ChevronRight size={12} aria-hidden="true" />
                </summary>
                <div class="two-factor-manual-key">
                  <code>{operation()?.secret}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyKey()}
                    aria-label={text(keyCopied() ? 'copied' : 'copyKey')}
                  >
                    <Show when={keyCopied()} fallback={<Copy size={14} />}>
                      <Check size={14} />
                    </Show>
                  </Button>
                </div>
              </details>
            </div>
            <form
              class="two-factor-form two-factor-verify"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  {
                    action: 'verify',
                    operation_id: operation()?.operation_id,
                    code: code(),
                  },
                  'recovery',
                );
              }}
            >
              <label class="two-factor-field">
                <span>{text('code')}</span>
                <Input
                  class="two-factor-code-input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="000 000"
                  value={code()}
                  aria-invalid={!!error()}
                  onInput={(event) => setCode(event.currentTarget.value)}
                />
              </label>
              <Button
                class="two-factor-primary"
                type="submit"
                disabled={busy() || !/^\d{6}$/.test(code().replaceAll(' ', ''))}
                loading={busy()}
              >
                {text('continue')}
              </Button>
            </form>
          </Show>
          <Show when={view() === 'recovery'}>
            <Show when={action() === 'disable'}>
              <div class="two-factor-heading">
                <span class="two-factor-emblem" aria-hidden="true">
                  <Shield size={24} />
                </span>
                <h3>{text('disable')}</h3>
                <p>{text('disableHelp')}</p>
              </div>
            </Show>
            <Show when={action() !== 'disable'}>
              <div class="two-factor-heading">
                <h3>{text('recoveryTitle')}</h3>
                <p>{text('recoveryHelp')}</p>
              </div>
              <div class="two-factor-recovery-sheet">
                <div class="two-factor-recovery-codes">
                  <For each={operation()?.recovery_codes}>
                    {(item, index) => (
                      <div class="two-factor-recovery-item">
                        <span aria-hidden="true">
                          {String(index() + 1).padStart(2, '0')}
                        </span>
                        <code>{item}</code>
                      </div>
                    )}
                  </For>
                </div>
                <div class="two-factor-recovery-actions">
                  <Button size="sm" variant="ghost" onClick={() => void copy()}>
                    <Show when={copied()} fallback={<Copy size={14} />}>
                      <Check size={14} />
                    </Show>
                    {text(copied() ? 'copied' : 'copy')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={download}>
                    <Download size={14} />
                    {text('download')}
                  </Button>
                </div>
              </div>
              <div class="two-factor-acknowledgement">
                <Checkbox
                  checked={saved()}
                  onChange={setSaved}
                  label={text('saved')}
                />
              </div>
            </Show>
            <Button
              class="two-factor-primary"
              disabled={busy() || (action() !== 'disable' && !saved())}
              loading={busy()}
              onClick={() =>
                void run(
                  {
                    action: 'commit',
                    operation_id: operation()?.operation_id,
                    saved: saved(),
                  },
                  'closed',
                )
              }
            >
              {text(
                action() === 'setup'
                  ? 'enable'
                  : action() === 'disable'
                    ? 'disable'
                    : 'confirm',
              )}
            </Button>
          </Show>
        </div>
      </Dialog>
    </>
  );
}
