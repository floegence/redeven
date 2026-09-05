import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  ArchiveFileIcon,
  type ArchiveFileClassification,
  type FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { FolderOpen } from '@floegence/floe-webapp-core/icons';
import { Button, DirectoryPicker } from '@floegence/floe-webapp-core/ui';
import { RpcError } from '@floegence/floe-webapp-protocol';

import { createFilesystemPickerDataSource } from '../../../../../flower_ui/src/filePicker/createFilesystemPickerDataSource';
import { toPickerTreeAbsolutePath } from '../../../../../flower_ui/src/filePicker/directoryPickerTree';
import type { FsExtractRequest, FsExtractResponse, FsFileInfo } from '../protocol/redeven_v1';
import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
import { getParentDir, validateFileBrowserEntryName } from './FileBrowserShared';

export type ArchiveExtractionRequest = {
  item: FileItem;
  classification: ArchiveFileClassification;
  pickerRootPath: string;
  pickerRootLabel?: string;
};

export type ArchiveExtractionDialogProps = {
  open: boolean;
  request: ArchiveExtractionRequest | null;
  listDirectory: (path: string) => Promise<FsFileInfo[]>;
  isWritablePath: (path: string) => boolean;
  onExtract: (
    request: FsExtractRequest,
    options: { signal: AbortSignal },
  ) => Promise<FsExtractResponse>;
  onComplete: (response: FsExtractResponse) => void | Promise<void>;
  onClose: () => void;
};

type ExtractionStatus = 'idle' | 'extracting' | 'canceling' | 'finishing';

export function ArchiveExtractionDialog(props: ArchiveExtractionDialogProps) {
  const i18n = useI18n();
  const [outputName, setOutputName] = createSignal('');
  const [destinationParent, setDestinationParent] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [passwordVisible, setPasswordVisible] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [status, setStatus] = createSignal<ExtractionStatus>('idle');
  let activeController: AbortController | null = null;
  let activeRequestKey = '';

  const picker = createFilesystemPickerDataSource({
    homePath: () => props.request?.pickerRootPath,
    listDirectory: props.listDirectory,
  });

  const validationError = createMemo(() => {
    const name = outputName().trim();
    if (!name) return i18n.t('files.validationNameRequired');
    const error = validateFileBrowserEntryName(name);
    if (error === 'Name cannot be "." or "..".') return i18n.t('files.validationDotName');
    if (error === 'Name cannot contain path separators.') return i18n.t('files.validationPathSeparator');
    return error ?? '';
  });

  const multipart = () => props.request?.classification.kind === 'multipart';
  const busy = () => status() !== 'idle';

  const reset = (request: ArchiveExtractionRequest) => {
    activeController?.abort();
    activeController = null;
    setOutputName(request.classification.defaultOutputName);
    setDestinationParent(getParentDir(request.item.path));
    setPassword('');
    setPasswordVisible(false);
    setErrorMessage('');
    setPickerOpen(false);
    setStatus('idle');
    picker.reset();
  };

  createEffect(() => {
    const request = props.request;
    if (!props.open || !request) {
      activeRequestKey = '';
      activeController?.abort();
      activeController = null;
      setPassword('');
      setPickerOpen(false);
      setStatus('idle');
      return;
    }
    const key = `${request.item.path}\u0000${request.classification.format}\u0000${request.classification.kind}`;
    if (key === activeRequestKey) return;
    activeRequestKey = key;
    reset(request);
  });

  onCleanup(() => {
    activeController?.abort();
    activeController = null;
    setPassword('');
  });

  const messageForError = (error: unknown): string => {
    if (error instanceof RpcError) {
      switch (error.code) {
        case 400:
          return i18n.t('files.archiveExtraction.invalidRequest');
        case 403:
          return i18n.t('files.archiveExtraction.permissionDenied');
        case 404:
          return i18n.t('files.archiveExtraction.sourceMissing');
        case 42211:
          return i18n.t('files.archiveExtraction.unsupportedFormat');
        case 42212:
          return i18n.t('files.archiveExtraction.multipartUnsupported');
        case 42213:
          return i18n.t('files.archiveExtraction.passwordRequired');
        case 42214:
          return i18n.t('files.archiveExtraction.wrongPassword');
        case 42215:
          return i18n.t('files.archiveExtraction.unsafeArchive');
        case 42216:
          return i18n.t('files.archiveExtraction.unsupportedEntry');
        case 42217:
          return i18n.t('files.archiveExtraction.corruptArchive');
        case 50311:
          return i18n.t('files.archiveExtraction.insufficientResources');
        case 50711:
          return i18n.t('files.archiveExtraction.insufficientSpace');
        case 50011:
          return i18n.t('files.archiveExtraction.cleanupFailed');
      }
    }
    return i18n.t('files.archiveExtraction.genericFailure');
  };

  const requestClose = () => {
    if (status() === 'extracting') {
      setStatus('canceling');
      activeController?.abort();
      return;
    }
    if (status() === 'canceling' || status() === 'finishing') return;
    setPassword('');
    props.onClose();
  };

  const openPicker = () => {
    if (busy()) return;
    picker.reset();
    void picker.ensureRootLoaded();
    setPickerOpen(true);
  };

  const submit = async () => {
    const request = props.request;
    if (!request || busy() || multipart()) return;
    const nextName = outputName().trim();
    const nextParent = destinationParent();
    if (validationError()) {
      setErrorMessage(validationError());
      return;
    }
    if (!props.isWritablePath(nextParent)) {
      setErrorMessage(i18n.t('files.archiveExtraction.permissionDenied'));
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    setErrorMessage('');
    setStatus('extracting');
    try {
      const response = await props.onExtract({
        sourcePath: request.item.path,
        destinationParentPath: nextParent,
        destinationName: nextName,
        ...(password() ? { password: password() } : {}),
      }, { signal: controller.signal });
      if (activeController === controller) activeController = null;
      setStatus('finishing');
      await props.onComplete(response);
      setPassword('');
      props.onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        setPassword('');
        props.onClose();
        return;
      }
      if (error instanceof RpcError && (error.code === 42213 || error.code === 42214)) {
        setPasswordVisible(true);
      }
      setErrorMessage(messageForError(error));
    } finally {
      if (activeController === controller) activeController = null;
      setStatus('idle');
    }
  };

  return (
    <>
      <Dialog
        open={props.open && Boolean(props.request) && !pickerOpen()}
        onOpenChange={(open) => { if (!open) requestClose(); }}
        title={i18n.t('files.archiveExtraction.title')}
        class="w-[min(32rem,calc(100vw-1rem))]"
        footer={(
          <div class="flex w-full justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={status() === 'canceling' || status() === 'finishing'}
              onClick={requestClose}
            >
              {status() === 'canceling'
                ? i18n.t('files.archiveExtraction.canceling')
                : i18n.t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant="default"
              loading={busy()}
              disabled={multipart() || busy()}
              onClick={() => void submit()}
            >
              {status() === 'idle'
                ? i18n.t('files.archiveExtraction.extract')
                : i18n.t('files.archiveExtraction.extracting')}
            </Button>
          </div>
        )}
      >
        <div class="space-y-4" data-testid="archive-extraction-dialog">
          <div class="flex min-w-0 items-center gap-3 border-b border-border pb-3">
            <ArchiveFileIcon class="h-9 w-9 shrink-0" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-foreground" title={props.request?.item.name}>
                {props.request?.item.name}
              </div>
              <div class="mt-0.5 text-xs text-muted-foreground">
                {props.request?.classification.format.toUpperCase()}
              </div>
            </div>
          </div>

          <Show when={multipart()}>
            <div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground" role="alert">
              {i18n.t('files.archiveExtraction.multipartUnsupported')}
            </div>
          </Show>

          <label class="block text-xs font-medium text-foreground">
            {i18n.t('files.archiveExtraction.outputName')}
            <input
              class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              value={outputName()}
              disabled={busy() || multipart()}
              aria-invalid={Boolean(errorMessage() && validationError())}
              onInput={(event) => {
                setOutputName(event.currentTarget.value);
                setErrorMessage('');
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
              autofocus
            />
          </label>

          <label class="block text-xs font-medium text-foreground">
            {i18n.t('files.archiveExtraction.destinationFolder')}
            <span class="mt-1 flex items-stretch gap-1.5">
              <input
                class="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                value={destinationParent()}
                disabled={busy() || multipart()}
                onInput={(event) => {
                  setDestinationParent(event.currentTarget.value);
                  setErrorMessage('');
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
              />
              <Button
                type="button"
                variant="outline"
                class="h-9 w-9 shrink-0 p-0"
                title={i18n.t('files.archiveExtraction.browseDestination')}
                aria-label={i18n.t('files.archiveExtraction.browseDestination')}
                disabled={busy() || multipart()}
                onClick={openPicker}
              >
                <FolderOpen class="h-4 w-4" />
              </Button>
            </span>
          </label>

          <Show when={passwordVisible()}>
            <label class="block text-xs font-medium text-foreground">
              {i18n.t('files.archiveExtraction.password')}
              <input
                type="password"
                autocomplete="off"
                class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                value={password()}
                disabled={busy()}
                onInput={(event) => {
                  setPassword(event.currentTarget.value);
                  setErrorMessage('');
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
                autofocus
              />
            </label>
          </Show>

          <Show when={errorMessage()}>
            {(message) => <div class="text-sm text-destructive" role="alert">{message()}</div>}
          </Show>
        </div>
      </Dialog>

      <DirectoryPicker
        open={props.open && pickerOpen()}
        onOpenChange={setPickerOpen}
        files={picker.files()}
        initialPath={destinationParent()}
        homePath={props.request?.pickerRootPath ?? '/'}
        homeLabel={props.request?.pickerRootLabel}
        title={i18n.t('files.archiveExtraction.selectDestination')}
        confirmText={i18n.t('common.actions.confirm')}
        cancelText={i18n.t('common.actions.cancel')}
        onExpand={picker.expandPath}
        ensurePath={picker.ensurePath}
        onSelect={(path) => {
          setDestinationParent(toPickerTreeAbsolutePath(path, props.request?.pickerRootPath));
          setErrorMessage('');
        }}
      />
    </>
  );
}
