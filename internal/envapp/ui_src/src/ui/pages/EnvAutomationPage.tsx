import { DirectoryPicker } from '@floegence/floe-webapp-core/ui';
import { useEnvFilesystemPicker } from '../services/filesystemPicker';
import { useI18n } from '../i18n';
import { automationText } from '../automation/messages';
import { createSignal, onCleanup } from 'solid-js';
import { createFlowerComposerDraftCoordinator } from '../../../../../flower_ui/src';
import { EnvAIPage } from './EnvAIPage';
import { useEnvContext } from './EnvContext';
import { AutomationWorkspace } from '../automation/AutomationWorkspace';
export default function EnvAutomationPage() {
  const picker = useEnvFilesystemPicker(),
    i18n = useI18n();
  const [select, setSelect] = createSignal<{
    path: string;
    accept: (path: string) => void;
  }>();
  const env = useEnvContext(),
    drafts =
      env.flowerDraftCoordinator ?? createFlowerComposerDraftCoordinator();
  onCleanup(() => {
    if (!env.flowerDraftCoordinator) drafts.dispose();
  });
  return (
    <>
      <AutomationWorkspace
        selectDirectory={(path, accept) => setSelect({ path, accept })}
        canWrite={
          env.env()?.permissions?.can_write === true &&
          env.env()?.permissions?.can_execute === true
        }
        storageKey={env.flowerScopeKey?.() ?? env.env_id()}
        renderFlower={(threadID, workflowID, onChanged) => (
          <EnvAIPage
            draftCoordinator={drafts}
            presentation="companion"
            engaged
            transcriptVisible
            embeddedConversation={{
              scope: `automation:${workflowID}`,
              threadID,
              htmlPreviews: false,
              onAccepted: onChanged,
              render: (parts) => (
                <div class="flex min-h-0 flex-1 flex-col">
                  <div class="min-h-0 flex-1 overflow-hidden">
                    {parts.conversation}
                  </div>
                  {parts.composer}
                  {parts.actionOverlays}
                </div>
              ),
            }}
          />
        )}
      />
      <DirectoryPicker
        {...picker}
        open={!!select()}
        onOpenChange={(open) => {
          if (!open) setSelect(undefined);
        }}
        initialPath={select()?.path || '/'}
        title={automationText(i18n.locale(), 'directory')}
        confirmText={i18n.t('common.actions.save')}
        cancelText={i18n.t('common.actions.cancel')}
        onSelect={(path) => {
          select()?.accept(path);
          setSelect(undefined);
        }}
      />
    </>
  );
}
