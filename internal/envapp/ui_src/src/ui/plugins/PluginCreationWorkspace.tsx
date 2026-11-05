import { createSignal, type JSX } from 'solid-js';
import { ArrowLeft, CheckCircle, MessageSquare, Trash, Wand } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';

export type PluginCreationMode = 'chat' | 'direct';

export type PluginCreationWorkspaceProps = Readonly<{
  open: boolean;
  mode: PluginCreationMode;
  projectID: string;
  threadID?: string;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: PluginCreationMode) => void;
  onDeleteProject: () => void;
  candidateReady?: boolean;
  onBuildCandidate?: () => void | Promise<void>;
  onInstall?: () => void;
  /** Flower is embedded by the host, keeping Flower/Floret ownership intact. */
  renderFlower?: () => JSX.Element;
}>;

export function PluginCreationWorkspace(props: PluginCreationWorkspaceProps): JSX.Element {
  const i18n = useI18n();
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [clearDraftOpen, setClearDraftOpen] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [installing, setInstalling] = createSignal(false);
  const install = async () => {
    if (!props.onInstall) return;
    setInstalling(true);
    try { await props.onInstall(); } finally { setInstalling(false); }
  };
  return <Dialog open={props.open} onOpenChange={props.onOpenChange} presentation="bottom-drawer"
    title={i18n.t('uiCopy.plugin.creationTitle')} class="redeven-plugin-creation-workspace" contentClass="p-0 overflow-hidden">
    <div class="flex h-[min(86vh,760px)] min-h-0 flex-col bg-background text-foreground" data-plugin-creation-workspace
      data-project-id={props.projectID} data-thread-id={props.threadID ?? ''}>
      <header class="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div class="flex min-w-0 items-center gap-2"><Wand class="h-4 w-4" /><div class="min-w-0"><h2 class="truncate font-medium">{i18n.t('uiCopy.plugin.creationTitle')}</h2><p class="truncate text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.threadLocked')}</p></div></div>
        <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}><Trash class="mr-1 h-3.5 w-3.5" />{i18n.t('uiCopy.plugin.deleteProject')}</Button>
      </header>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
        <section class="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-lg border" aria-label={i18n.t('uiCopy.plugin.flowerCreationTitle')}>
          <div class="flex items-center justify-between border-b px-3 py-2"><span class="flex items-center gap-2 text-sm font-medium"><MessageSquare class="h-4 w-4" />{i18n.t('uiCopy.plugin.flowerCreationTitle')}</span><div class="flex gap-1"><Button size="sm" variant={props.mode === 'chat' ? 'default' : 'ghost'} onClick={() => props.onModeChange('chat')}>{i18n.t('uiCopy.plugin.chatCreate')}</Button><Button size="sm" variant={props.mode === 'direct' ? 'default' : 'ghost'} onClick={() => props.onModeChange('direct')}>{i18n.t('uiCopy.plugin.directCreate')}</Button></div></div>
          <div class="min-h-0 flex-1 overflow-auto">{props.renderFlower?.() ?? <div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.flowerCreationHint')}</div>}</div>
        </section>
        <aside class="flex min-h-[360px] min-w-0 flex-col gap-3 rounded-lg border p-4">
          <div><h3 class="font-medium">{i18n.t('uiCopy.plugin.draftTitle')}</h3><p class="mt-1 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.draftHint')}</p></div>
          <textarea class="min-h-28 resize-y rounded-md border bg-transparent p-2 text-sm" value={draft()} onInput={e => setDraft(e.currentTarget.value)} placeholder={i18n.t('uiCopy.plugin.draftPlaceholder')} />
          <Button variant="ghost" size="sm" class="justify-start" disabled={!draft()} onClick={() => setClearDraftOpen(true)}><Trash class="mr-2 h-3.5 w-3.5" />{i18n.t('uiCopy.plugin.clearDraft')}</Button>
          <div class="rounded-md border p-3 text-sm"><div class="flex items-center gap-2 font-medium"><CheckCircle class="h-4 w-4" />{i18n.t('uiCopy.plugin.previewTitle')}</div><p class="mt-1 text-xs text-muted-foreground">{props.candidateReady ? i18n.t('uiCopy.plugin.candidateReady') : i18n.t('uiCopy.plugin.candidatePending')}</p><Button variant="ghost" class="mt-3 w-full" disabled={!props.onBuildCandidate} onClick={() => void props.onBuildCandidate?.()}>{i18n.t('uiCopy.plugin.generateCandidate')}</Button><Button class="mt-2 w-full" disabled={!props.candidateReady || installing()} onClick={() => void install()}>{installing() ? i18n.t('uiCopy.plugin.installing') : i18n.t('uiCopy.plugin.installAndOpen')}</Button></div>
          <Button variant="ghost" class="mt-auto justify-start" onClick={() => props.onOpenChange(false)}><ArrowLeft class="mr-2 h-4 w-4" />{i18n.t('uiCopy.plugin.backToCenter')}</Button>
        </aside>
      </div>
    </div>
    <ConfirmDialog open={clearDraftOpen()} onOpenChange={setClearDraftOpen} title={i18n.t('uiCopy.plugin.clearDraftConfirmTitle')} bodyDescription={i18n.t('uiCopy.plugin.clearDraftConfirmDescription')} confirmText={i18n.t('uiCopy.plugin.clearDraft')} onConfirm={() => { setDraft(''); setClearDraftOpen(false); }} />
    <ConfirmDialog open={deleteOpen()} onOpenChange={setDeleteOpen} title={i18n.t('uiCopy.plugin.deleteProjectConfirmTitle')} bodyDescription={i18n.t('uiCopy.plugin.deleteProjectConfirmDescription')} confirmText={i18n.t('uiCopy.plugin.deleteProject')} onConfirm={() => { setDeleteOpen(false); props.onDeleteProject(); }} />
  </Dialog>;
}
