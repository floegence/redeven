import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, FileText, FolderOpen } from '@floegence/floe-webapp-core/icons';
import { Dialog } from '../../primitives/EnvAppModal';
import { useI18n } from '../../i18n';
import { fetchLocalApiJSON } from '../../services/localApi';
import { formatUnknownError } from '../../maintenance/shared';
import type { SkillCatalogEntry, SkillBrowseTreeResponse, SkillBrowseFileResponse } from './types';

export function SkillFilesDialog(props: { entry: SkillCatalogEntry | null; onClose: () => void; canInteract: boolean }) {
  const i18n = useI18n();
  const [tree, setTree] = createSignal<SkillBrowseTreeResponse | null>(null);
  const [file, setFile] = createSignal<SkillBrowseFileResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let requestID = 0;
  let lastRequest: { kind: 'tree' | 'file'; path: string } = { kind: 'tree', path: '' };
  const load = async (kind: 'tree' | 'file', path = '') => {
    const entry = props.entry;
    if (!entry || !props.canInteract) return;
    lastRequest = { kind, path };
    const id = ++requestID;
    setLoading(true); setError(null);
    const query = new URLSearchParams({ skill_path: entry.path, [kind === 'tree' ? 'dir' : 'file']: path });
    try {
      if (kind === 'tree') {
        const response = await fetchLocalApiJSON<SkillBrowseTreeResponse>(`/_redeven_proxy/api/ai/skills/browse/tree?${query}`, { method: 'GET' });
        if (id === requestID) { setTree(response); setFile(null); }
      } else {
        const response = await fetchLocalApiJSON<SkillBrowseFileResponse>(`/_redeven_proxy/api/ai/skills/browse/file?${query}`, { method: 'GET' });
        if (id === requestID) setFile(response);
      }
    } catch (failure) { if (id === requestID) setError(formatUnknownError(failure) || i18n.t('settingsDesign.skillRequestFailed')); }
    finally { if (id === requestID) setLoading(false); }
  };
  createEffect(() => {
    const entry = props.entry;
    requestID += 1; setTree(null); setFile(null); setError(null); setLoading(false);
    if (entry && props.canInteract) void load('tree');
  });
  onCleanup(() => { requestID += 1; });
  const parentDirectory = () => (tree()?.dir ?? '').replace(/\/?[^/]+\/?$/, '');
  return (
    <Dialog open={Boolean(props.entry)} onOpenChange={(open) => { if (!open) props.onClose(); }} title={props.entry?.name ?? i18n.t('settingsDesign.skillFiles')}
      description={props.entry?.description} class="redeven-settings-dialog w-[min(52rem,94vw)]"
      footer={<Button variant="outline" onClick={props.onClose}>{i18n.t('common.actions.close')}</Button>}>
      <Show when={error()}><div class="mb-4 flex items-center justify-between gap-3"><p role="alert" class="text-sm text-destructive">{error()}</p><Button size="sm" variant="outline" disabled={loading() || !props.canInteract} onClick={() => void load(lastRequest.kind, lastRequest.path)}>{i18n.t('common.actions.retry')}</Button></div></Show>
      <Show when={loading()}><p role="status" class="mb-3 text-xs text-muted-foreground">{i18n.t('skillsSettings.loading')}</p></Show>
      <Show when={file()} fallback={<>
        <div class="mb-3 flex items-center gap-2">
          <Button size="sm" variant="outline" icon={ChevronLeft} disabled={!tree()?.dir || tree()?.dir === '.' || loading()} onClick={() => void load('tree', parentDirectory())}>{i18n.t('settingsDesign.parentFolder')}</Button>
          <code class="min-w-0 break-all text-xs text-muted-foreground">{tree()?.dir || props.entry?.path}</code>
        </div>
        <div class="redeven-settings-list rounded-lg border">
          <For each={tree()?.entries}>{(entry) => <Button variant="ghost" class="h-auto w-full justify-start rounded-none px-4 py-3 text-left" icon={entry.is_dir ? FolderOpen : FileText} disabled={loading() || !props.canInteract} onClick={() => void load(entry.is_dir ? 'tree' : 'file', entry.path)}><span class="break-all">{entry.name}</span></Button>}</For>
        </div>
      </>}>
        {(current) => <>
          <Button size="sm" variant="outline" icon={ChevronLeft} onClick={() => setFile(null)}>{i18n.t('settingsDesign.skillFiles')}</Button>
          <code class="my-3 block break-all text-xs text-muted-foreground">{current().file}</code>
          <Show when={current().encoding !== 'utf8'}><code class="mb-3 block text-xs text-muted-foreground">{current().encoding}</code></Show>
          <Show when={current().truncated}><p class="mb-3 text-xs text-warning">{i18n.t('settingsDesign.truncatedFile')}</p></Show>
          <pre class="redeven-settings-inset max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border p-4 text-xs">{current().content}</pre>
        </>}
      </Show>
    </Dialog>
  );
}
