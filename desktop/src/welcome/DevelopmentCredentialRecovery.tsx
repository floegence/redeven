import { createSignal, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Lock } from '@floegence/floe-webapp-core/icons';
import type { DesktopI18n } from '../shared/i18n';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

export function DevelopmentCredentialRecovery(props: {
  recovery: NonNullable<DesktopWelcomeSnapshot['credential_recovery']>;
  i18n: DesktopI18n;
  migrate: () => Promise<DesktopLauncherActionResult>;
  quit: () => Promise<DesktopLauncherActionResult>;
}) {
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const migrate = async () => {
    if (busy()) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await props.migrate();
      setFailed(!result.ok);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground" data-redeven-credential-recovery>
      <section class="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm" aria-labelledby="development-credentials-title">
        <div class="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Lock class="h-5 w-5" /></div>
        <h1 id="development-credentials-title" class="text-xl font-semibold tracking-tight">{props.i18n.t('developmentCredentials.title')}</h1>
        <p class="mt-3 text-sm leading-6 text-muted-foreground">{props.i18n.t(props.recovery.can_migrate ? 'developmentCredentials.description' : 'developmentCredentials.unavailable')}</p>
        <Show when={failed() || props.recovery.failed}>
          <p role="alert" class="mt-4 text-sm leading-6 text-destructive">{props.i18n.t('developmentCredentials.failed')}</p>
        </Show>
        <div class="mt-6 flex flex-wrap gap-3">
          <Show when={props.recovery.can_migrate}>
            <Button loading={busy()} disabled={busy()} onClick={() => void migrate()}>{props.i18n.t('developmentCredentials.migrate')}</Button>
          </Show>
          <Button variant="outline" disabled={busy()} onClick={() => void props.quit()}>{props.i18n.t('developmentCredentials.quit')}</Button>
        </div>
      </section>
    </main>
  );
}
