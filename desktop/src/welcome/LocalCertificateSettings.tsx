import { Show, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup } from 'solid-js';
import { AlertCircle, Check, ChevronDown, Copy, FileText, Info, Lock, Refresh, ShieldCheck, Trash, Upload } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { desktopCertificateIdentity, isCertificateReplacement, type DesktopCertificateOperation, type DesktopCertificateReport, type DesktopCertificateRequest } from '../shared/desktopCertificate';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';

export function LocalCertificateSettings(props: Readonly<{
  environmentID: string;
  i18n: DesktopI18n;
  manage: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>;
  remote: boolean;
  onReadiness: (ready: boolean) => void;
  copyText: (value: string, label: string) => Promise<void>;
}>) {
  const [report, setReport] = createSignal<DesktopCertificateReport>();
  const [operation, setOperation] = createSignal<DesktopCertificateOperation>();
  const [queryFailed, setQueryFailed] = createSignal(false);
  const [copying, setCopying] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  const [managing, setManaging] = createSignal(false);
  const [confirmation, setConfirmation] = createSignal<'import' | 'regenerate' | 'remove'>();
  const managementID = createUniqueId();
  let manageButton: HTMLButtonElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  let revision = 0;
  function choose(action: 'import' | 'regenerate' | 'remove'): void {
    setConfirmation(action);
    queueMicrotask(() => cancelButton?.focus());
  }
  function cancelConfirmation(): void {
    setConfirmation(undefined);
    manageButton?.focus();
  }
  onCleanup(() => { revision += 1; });
  const identity = () => queryFailed() ? 'unknown' : desktopCertificateIdentity(report());
  const invalid = () => ['invalid', 'expired', 'not_yet_valid'].includes(identity());
  const legacyUntrusted = () => report()?.code === 'local_ui_device_ca_untrusted' && report()?.identity === 'ready' && report()?.trust === 'untrusted';
  const failed = () => report()?.status === 'failed' && !legacyUntrusted();

  async function perform(action: DesktopCertificateOperation, environmentID = props.environmentID): Promise<void> {
    if (operation()) return;
    const requestRevision = ++revision;
    setOperation(action);
    setQueryFailed(false);
    props.onReadiness(false);
    try {
      const result = await props.manage({ environment_id: environmentID, operation: action, ...(isCertificateReplacement(action) ? { confirmed: true } : {}) });
      if (revision !== requestRevision || props.environmentID !== environmentID) return;
      setReport(result);
      setConfirmation(undefined);
      if (isCertificateReplacement(action)) queueMicrotask(() => manageButton?.focus({ preventScroll: true }));
      setQueryFailed(result.status === 'failed' && (action === 'status' || result.failure_stage === 'status' || result.failure_stage === 'verify')
        && !['local_ui_device_ca_untrusted', 'local_ui_device_ca_missing', 'local_ui_device_ca_invalid', 'local_ui_device_ca_expired', 'local_ui_device_ca_not_yet_valid'].includes(result.code));
    } catch {
      if (revision !== requestRevision || props.environmentID !== environmentID) return;
      setReport((previous) => ({ ...previous, status: 'failed', code: 'local_ui_device_ca_operation_failed', failure_stage: 'status' }));
      setQueryFailed(true);
    } finally {
      if (revision === requestRevision && props.environmentID === environmentID) {
        setOperation(undefined);
        props.onReadiness(identity() === 'ready' && !queryFailed());
      }
    }
  }

  // Snapshot objects change during health updates; only a new target resets certificate state.
  const environmentID = createMemo(() => props.environmentID);
  createEffect(on(environmentID, (id) => {
    revision += 1;
    setCopyFailed(false);
    setManaging(false);
    setConfirmation(undefined);
    setReport(undefined);
    setOperation(undefined);
    setQueryFailed(false);
    void perform('status', id);
  }));

  const identityKey = (): DesktopTranslationKey => {
    if (!report() && operation()) return 'environmentStatus.checking';
    switch (identity()) {
      case 'ready': return 'settings.certificateReady';
      case 'missing': return 'settings.certificateMissing';
      case 'expired': return 'settings.certificateExpired';
      case 'not_yet_valid': return 'settings.certificateNotYetValid';
      case 'invalid': return 'settings.certificateInvalid';
      default: return 'settings.certificateUnknown';
    }
  };
  const errorKey = (): DesktopTranslationKey => {
    switch (report()?.code) {
      case 'local_ui_device_ca_permission_denied': return 'settings.certificatePermissionDenied';
      case 'local_ui_device_ca_timeout': return 'settings.certificateTimeout';
      case 'local_ui_device_ca_install_canceled': return 'settings.certificateCanceled';
      case 'local_ui_device_ca_install_failed': return 'settings.certificateInstallFailed';
      case 'local_ui_device_ca_trust_not_confirmed': return 'settings.certificateTrustNotConfirmed';
      case 'local_ui_certificate_upgrade_required': return 'settings.certificateUpgradeRequired';
      case 'local_ui_device_ca_busy': return 'settings.certificateBusy';
      default: return 'settings.certificateOperationFailed';
    }
  };
  const canInstall = () => !props.remote && report()?.can_install === true && report()?.certificate_kind !== 'server';
  const canceled = () => report()?.code === 'local_ui_device_ca_install_canceled';
  const showFailure = () => !operation() && (queryFailed() || failed() && (isCertificateReplacement(report()?.failure_stage) || !invalid() && identity() !== 'missing'));
  const actionKey = (action: 'import' | 'regenerate' | 'remove'): DesktopTranslationKey => action === 'import' ? 'settings.certificateImport' : action === 'regenerate' ? 'settings.certificateRegenerate' : 'settings.certificateRemove';
  const confirmationKey = (): DesktopTranslationKey => confirmation() === 'import' ? 'settings.certificateImportHelp' : confirmation() === 'regenerate' ? 'settings.certificateRegenerateHelp' : 'settings.certificateRemoveHelp';
  const validUntil = () => report()?.not_after
    ? props.i18n.t('settings.certificateValidUntil', { date: new Date(report()!.not_after!).toLocaleDateString(props.i18n.locale) })
    : '';

  async function copyDetails(): Promise<void> {
    if (copying()) return;
    const target = environmentID();
    setCopying(true);
    setCopyFailed(false);
    try {
      await props.copyText([
        report()?.certificate_path,
        report()?.fingerprint,
        validUntil(),
        failed() ? report()?.code : '',
        failed() ? report()?.message : '',
      ].filter(Boolean).join('\n'), props.i18n.t('settings.certificateDetails'));
    } catch {
      if (environmentID() === target) setCopyFailed(true);
    } finally {
      setCopying(false);
    }
  }

  return (
    <section aria-label={props.i18n.t('settings.certificateSetup')} aria-busy={Boolean(operation())}
      class="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/15">
      <header class="flex items-center justify-between gap-3 px-4 py-2.5">
        <h4 class="text-xs font-semibold text-foreground">{props.i18n.t('settings.certificateSetup')}</h4>
        <Button size="icon" variant="ghost" class="h-7 w-7 shrink-0" disabled={Boolean(operation())}
          aria-label={props.i18n.t('settings.certificateRefresh')} title={props.i18n.t('settings.certificateRefresh')}
          onClick={() => void perform('status')}>
          <Refresh class="h-3.5 w-3.5" classList={{ 'animate-spin': operation() === 'status' }} aria-hidden="true" />
        </Button>
      </header>
      <div class="space-y-3 px-4 pb-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2" aria-live="polite">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground" aria-hidden="true"><FileText class="h-4 w-4" /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span class="font-medium">{props.i18n.t('settings.certificateIdentity')}</span>
              <span class="inline-flex items-center gap-1.5" classList={{ 'text-destructive': invalid(), 'text-primary': identity() === 'ready', 'text-muted-foreground': !invalid() && identity() !== 'ready' }}>
                <Show when={identity() === 'ready'}><Check class="h-3.5 w-3.5" aria-hidden="true" /></Show>
                <Show when={invalid()}><AlertCircle class="h-3.5 w-3.5" aria-hidden="true" /></Show>
                {props.i18n.t(identityKey())}
              </span>
            </div>
            <Show when={identity() === 'ready' && validUntil()}><p class="mt-1 text-xs text-muted-foreground">{validUntil()}</p></Show>
          </div>
          <Show when={report()?.can_manage}>
            <Button ref={manageButton} size="sm" variant="outline" class="h-auto min-h-8 whitespace-normal" disabled={Boolean(operation())}
              aria-expanded={managing()} aria-controls={managementID}
              onClick={() => { setManaging(!managing()); setConfirmation(undefined); }}>
              {props.i18n.t('settings.certificateManage')}<ChevronDown class="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </Show>
          <Show when={identity() === 'missing'}>
            <Button size="sm" class="h-auto min-h-8 whitespace-normal text-left" disabled={Boolean(operation())}
              loading={operation() === 'setup' || operation() === 'generate'} onClick={() => void perform(canInstall() ? 'setup' : 'generate')}>
              {props.i18n.t(canInstall() ? 'settings.certificateSetupAction' : 'settings.generateCertificate')}
            </Button>
          </Show>
        </div>

        <Show when={managing()}>
          <div id={managementID} class="space-y-3 rounded-md bg-background/70 p-3" onKeyDown={(event) => {
            if (event.key === 'Escape' && !operation()) { event.preventDefault(); event.stopPropagation(); cancelConfirmation(); setManaging(false); }
          }}>
            <Show when={!confirmation()} fallback={
              <div class="space-y-3">
                <div class="space-y-1.5">
                  <p class="text-xs font-semibold">{props.i18n.t(actionKey(confirmation()!))}</p>
                  <p class="text-xs leading-relaxed text-muted-foreground">{props.i18n.t(confirmationKey())}</p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button ref={cancelButton} size="sm" variant="ghost" disabled={Boolean(operation())} onClick={cancelConfirmation}>{props.i18n.t('common.cancel')}</Button>
                  <Button size="sm" variant={confirmation() === 'remove' ? 'destructive' : 'default'} class="h-auto min-h-8 whitespace-normal"
                    disabled={Boolean(operation())} loading={isCertificateReplacement(operation())} onClick={() => void perform(confirmation()!)}>
                    {props.i18n.t(confirmation() === 'import' ? 'settings.certificateChooseFiles' : actionKey(confirmation()!))}
                  </Button>
                </div>
              </div>
            }>
              <div class="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => choose('import')}><Upload class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('settings.certificateImport')}</Button>
                <Button size="sm" variant="outline" onClick={() => choose('regenerate')}><Refresh class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('settings.certificateRegenerate')}</Button>
                <Show when={identity() !== 'missing'}><Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" onClick={() => choose('remove')}><Trash class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('settings.certificateRemove')}</Button></Show>
              </div>
              <p class="text-xs leading-relaxed text-muted-foreground">{props.i18n.t('settings.certificateManageHelp')}</p>
            </Show>
          </div>
        </Show>
        <Show when={report()?.status === 'updated' && !operation()}>
          <p role="status" class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Check class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{props.i18n.t(identity() === 'missing' ? 'settings.certificateRemoved' : 'settings.certificateChanged')}</p>
        </Show>
        <Show when={report() && report()?.can_manage === false && !operation()}><p class="text-xs text-muted-foreground">{props.i18n.t('settings.certificateUpgradeRequired')}</p></Show>

        <Show when={!props.remote && identity() === 'ready'}>
          <div class="flex flex-wrap items-start gap-3 border-t border-border/50 pt-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground" aria-hidden="true"><ShieldCheck class="h-4 w-4" /></span>
            <div class="min-w-0 flex-1 basis-48 space-y-1">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-live="polite">
                <span class="font-medium">{props.i18n.t('settings.certificateSystemTrust')}</span>
                <span class="inline-flex items-center gap-1.5" classList={{ 'text-primary': report()?.trust === 'trusted', 'text-muted-foreground': report()?.trust !== 'trusted' }}>
                  <Show when={report()?.trust === 'trusted'}><Check class="h-3.5 w-3.5" aria-hidden="true" /></Show>
                  {props.i18n.t(report()?.trust === 'trusted' ? 'settings.certificateTrusted' : 'settings.certificateUntrusted')}
                </span>
              </div>
              <p class="max-w-prose text-xs leading-relaxed text-muted-foreground">{props.i18n.t(report()?.certificate_kind === 'server' ? 'settings.certificateServerTrustHelp' : canInstall() ? 'settings.certificateTrustScope' : 'settings.certificateManualTrust')}</p>
            </div>
            <Show when={canInstall() && report()?.trust !== 'trusted'}>
              <Button size="sm" class="h-auto min-h-8 whitespace-normal text-left" disabled={Boolean(operation())}
                loading={operation() === 'install'} onClick={() => void perform('install')}>
                {props.i18n.t('settings.trustCertificate')}
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={props.remote}><p class="text-xs leading-relaxed text-muted-foreground">{props.i18n.t('settings.remoteCertificateHelp')}</p></Show>
        <Show when={identity() === 'missing' && !props.remote}>
          <p class="text-xs leading-relaxed text-muted-foreground">{props.i18n.t(report()?.certificate_kind === 'server' ? 'settings.certificateServerTrustHelp' : canInstall() ? 'settings.certificateTrustScope' : 'settings.certificateManualTrust')}</p>
        </Show>

        <Show when={operation() && operation() !== 'status'}>
          <p role="status" class="text-xs text-muted-foreground">{props.i18n.t(operation() === 'install' ? 'settings.certificateTrustBusy' : 'settings.certificateSetupBusy')}</p>
        </Show>
        <Show when={invalid() && !operation()}>
          <p role="alert" class="text-xs leading-relaxed text-destructive">{props.i18n.t('settings.certificateInvalidHelp')}</p>
        </Show>
        <Show when={showFailure()}>
          <div role={canceled() ? 'status' : 'alert'} class="flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-relaxed"
            classList={{ 'bg-muted/60 text-muted-foreground': canceled(), 'bg-destructive/5 text-destructive': !canceled() }}>
            <Show when={canceled()} fallback={<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
              <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Show>
            <p>{props.i18n.t(errorKey())}</p>
          </div>
        </Show>
        <Show when={identity() !== 'ready' && !operation()}><p class="text-xs leading-relaxed text-muted-foreground">{props.i18n.t('settings.certificateRestartBlocked')}</p></Show>
        <p class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Lock class="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{props.i18n.t('settings.certificateImmediateHelp')}
        </p>
      </div>

      <Show when={report()?.certificate_path || report()?.message}>
        <details class="group border-t border-border/50 text-xs">
          <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown class="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true" />
            {props.i18n.t('settings.certificateDetails')}
          </summary>
          <div class="space-y-3 px-4 pb-4">
            <Show when={report()?.certificate_path}>
              <div class="space-y-1.5">
                <p class="font-medium text-muted-foreground">{props.i18n.t('settings.certificateFile')}</p>
                <p class="select-text break-all rounded-md bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed">{report()?.certificate_path}</p>
              </div>
            </Show>
            <Show when={report()?.fingerprint}>
              <div class="space-y-1.5"><p class="font-medium text-muted-foreground">{props.i18n.t('settings.certificateFingerprint')}</p><p class="select-text break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{report()?.fingerprint}</p></div>
            </Show>
            <Show when={failed()}>
              <div class="space-y-1.5">
                <p class="font-medium text-muted-foreground">{props.i18n.t('settings.certificateDiagnostics')}</p>
                <pre tabIndex={0} class="max-h-32 select-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{[report()?.code, report()?.message].filter(Boolean).join('\n')}</pre>
              </div>
            </Show>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={copyFailed()}><p role="alert" class="text-xs text-destructive">{props.i18n.t('settings.certificateCopyFailed')}</p></Show>
              <Button size="sm" variant="outline" disabled={copying()} onClick={() => void copyDetails()}>
                <Copy class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('settings.certificateCopyDetails')}
              </Button>
            </div>
          </div>
        </details>
      </Show>
    </section>
  );
}
