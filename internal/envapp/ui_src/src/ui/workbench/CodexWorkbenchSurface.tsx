import '../codex/codex-feature.css';
import { CodexPage } from '../codex/CodexPage';
import { CodexProvider } from '../codex/CodexProvider';
import { CodexSidebarShell } from '../codex/CodexSidebarShell';
import { EnvWorkbenchConversationShell } from './EnvWorkbenchConversationShell';
import { useI18n } from '../i18n';

export function CodexWorkbenchSurface() {
  const i18n = useI18n();
  return (
    <CodexProvider>
      <EnvWorkbenchConversationShell
        railLabel={i18n.t('workbench.notices.codexThreads')}
        rail={<CodexSidebarShell />}
        workbench={<CodexPage />}
      />
    </CodexProvider>
  );
}
