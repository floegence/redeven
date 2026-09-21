import { useI18n } from '../i18n';

export function ActivityPageLoading() {
  const i18n = useI18n();
  return (
    <div
      class="flex h-full min-h-0 items-center justify-center bg-background text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {i18n.t('shell.loadingPage')}
    </div>
  );
}
