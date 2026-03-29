import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { getExtDot, mimeFromExtDot } from '../utils/filePreview';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { basenameFromPath, fileItemFromPath } from '../utils/filePreviewItem';
import { useFilePreviewContext } from '../widgets/FilePreviewContext';
import { compactPathLabel } from './presentation';
import type { CodexUserInputEntry } from './types';

const LOCAL_IMAGE_MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

function inputType(entry: CodexUserInputEntry): string {
  return String(entry.type ?? '').trim();
}

function inputText(entry: CodexUserInputEntry): string {
  return String(entry.text ?? '');
}

function inputURL(entry: CodexUserInputEntry): string {
  return String(entry.url ?? '').trim();
}

function inputPath(entry: CodexUserInputEntry): string {
  return String(entry.path ?? '').trim();
}

function inputName(entry: CodexUserInputEntry, fallback = 'File'): string {
  const named = String(entry.name ?? '').trim();
  if (named) return named;
  const path = inputPath(entry);
  return path ? basenameFromPath(path) : fallback;
}

function isFileReferencePath(path: string): boolean {
  const normalizedPath = String(path ?? '').trim();
  if (!normalizedPath) return false;
  if (normalizedPath.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(normalizedPath)) return true;
  return false;
}

function RawTextBlock(props: {
  text: string;
}) {
  if (!props.text.length) return null;
  return (
    <div data-codex-user-input-type="text" class="codex-chat-user-raw-text">
      {props.text}
    </div>
  );
}

function RemoteImageInput(props: {
  entry: CodexUserInputEntry;
  index: number;
}) {
  const src = createMemo(() => inputURL(props.entry));
  const alt = createMemo(() => inputName(props.entry, `Attachment ${props.index + 1}`));

  if (!src()) return null;

  return (
    <figure data-codex-user-input-type="image" class="codex-chat-user-image-card">
      <img
        class="codex-chat-user-image"
        src={src()}
        alt={alt()}
        loading="lazy"
        decoding="async"
      />
      <Show when={String(props.entry.name ?? '').trim()}>
        <figcaption class="codex-chat-user-image-caption">{alt()}</figcaption>
      </Show>
    </figure>
  );
}

function FileCardCopy(props: {
  kicker: string;
  title: string;
  path: string;
}) {
  return (
    <div class="codex-chat-user-file-card-copy">
      <span class="codex-chat-user-file-card-kicker">{props.kicker}</span>
      <span class="codex-chat-user-file-card-title">{props.title}</span>
      <span class="codex-chat-user-file-card-path">{compactPathLabel(props.path, props.path)}</span>
    </div>
  );
}

function LocalImageInput(props: {
  entry: CodexUserInputEntry;
}) {
  const protocol = useProtocol();
  const filePreview = useFilePreviewContext();
  const path = createMemo(() => inputPath(props.entry));
  const title = createMemo(() => inputName(props.entry, 'Local image'));
  const [thumbnailURL, setThumbnailURL] = createSignal('');
  let activeObjectURL = '';
  let requestSeq = 0;

  const openPreview = () => {
    const normalizedPath = path();
    if (!normalizedPath) return;
    void filePreview.openPreview(fileItemFromPath(normalizedPath, title()));
  };

  createEffect(() => {
    const client = protocol.client();
    const normalizedPath = path();
    const currentRequest = ++requestSeq;

    if (activeObjectURL) {
      URL.revokeObjectURL(activeObjectURL);
      activeObjectURL = '';
    }
    setThumbnailURL('');

    if (!client || !normalizedPath) return;

    void (async () => {
      try {
        const { bytes, meta } = await readFileBytesOnce({
          client,
          path: normalizedPath,
          maxBytes: LOCAL_IMAGE_MAX_PREVIEW_BYTES,
        });
        if (currentRequest !== requestSeq || meta.truncated) return;

        const mime = mimeFromExtDot(getExtDot(normalizedPath)) ?? 'image/*';
        const objectURL = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (currentRequest !== requestSeq) {
          URL.revokeObjectURL(objectURL);
          return;
        }

        activeObjectURL = objectURL;
        setThumbnailURL(objectURL);
      } catch {
        if (currentRequest === requestSeq) {
          setThumbnailURL('');
        }
      }
    })();
  });

  onCleanup(() => {
    requestSeq += 1;
    if (activeObjectURL) {
      URL.revokeObjectURL(activeObjectURL);
      activeObjectURL = '';
    }
  });

  if (!path()) return null;

  return (
    <button
      type="button"
      data-codex-user-input-type="localImage"
      data-codex-user-input-has-thumbnail={thumbnailURL() ? 'true' : 'false'}
      class="codex-chat-user-file-card codex-chat-user-file-card-interactive codex-chat-user-file-card-image"
      title={path()}
      onClick={openPreview}
    >
      <Show when={thumbnailURL()}>
        <img
          class="codex-chat-user-local-image"
          src={thumbnailURL()}
          alt={title()}
          loading="lazy"
          decoding="async"
        />
      </Show>
      <FileCardCopy kicker="Local image" title={title()} path={path()} />
    </button>
  );
}

function LocalFileButton(props: {
  kicker: string;
  entry: CodexUserInputEntry;
  class?: string;
}) {
  const filePreview = useFilePreviewContext();
  const path = createMemo(() => inputPath(props.entry));
  const title = createMemo(() => inputName(props.entry));

  const openPreview = () => {
    const normalizedPath = path();
    if (!normalizedPath) return;
    void filePreview.openPreview(fileItemFromPath(normalizedPath, title()));
  };

  if (!path()) return null;

  return (
    <button
      type="button"
      data-codex-user-input-type={inputType(props.entry)}
      class={`codex-chat-user-file-card codex-chat-user-file-card-interactive ${props.class ?? ''}`.trim()}
      title={path()}
      onClick={openPreview}
    >
      <FileCardCopy kicker={props.kicker} title={title()} path={path()} />
    </button>
  );
}

function MentionInput(props: {
  entry: CodexUserInputEntry;
}) {
  const path = createMemo(() => String(props.entry.path ?? '').trim());
  if (isFileReferencePath(path())) {
    return <LocalFileButton kicker="File" entry={props.entry} class="codex-chat-user-file-card-mention" />;
  }

  const label = createMemo(() => {
    const name = String(props.entry.name ?? '').trim();
    return name || path() || 'Mention';
  });
  const subtitle = createMemo(() => path());

  if (!label()) return null;

  return (
    <div data-codex-user-input-type="mention" class="codex-chat-user-pill codex-chat-user-pill-mention" title={subtitle()}>
      <span class="codex-chat-user-pill-kicker">Mention</span>
      <span class="codex-chat-user-pill-title">{label()}</span>
      <Show when={subtitle() && subtitle() !== label()}>
        <span class="codex-chat-user-pill-detail">{subtitle()}</span>
      </Show>
    </div>
  );
}

function UnknownInput(props: {
  entry: CodexUserInputEntry;
}) {
  const summary = createMemo(() => {
    const text = inputText(props.entry);
    if (text) return text;
    const path = inputPath(props.entry);
    if (path) return path;
    const url = inputURL(props.entry);
    if (url) return url;
    return inputType(props.entry) || 'Unsupported input';
  });

  if (!summary()) return null;

  return (
    <div data-codex-user-input-type={inputType(props.entry) || 'unknown'} class="codex-chat-user-pill codex-chat-user-pill-unknown">
      <span class="codex-chat-user-pill-kicker">{inputType(props.entry) || 'Input'}</span>
      <span class="codex-chat-user-pill-title">{summary()}</span>
    </div>
  );
}

function renderStructuredInput(entry: CodexUserInputEntry, index: number): JSX.Element | null {
  switch (inputType(entry)) {
    case 'text':
      return <RawTextBlock text={inputText(entry)} />;
    case 'image':
      return <RemoteImageInput entry={entry} index={index} />;
    case 'localImage':
      return <LocalImageInput entry={entry} />;
    case 'skill':
      return <LocalFileButton kicker="Skill" entry={entry} class="codex-chat-user-file-card-skill" />;
    case 'mention':
      return <MentionInput entry={entry} />;
    default:
      return <UnknownInput entry={entry} />;
  }
}

export function CodexUserMessageContent(props: {
  inputs?: readonly CodexUserInputEntry[] | null;
  fallbackText?: string | null;
}) {
  const inputs = createMemo(() => [...(props.inputs ?? [])]);
  const fallbackText = createMemo(() => String(props.fallbackText ?? ''));
  const hasTextInput = createMemo(() => inputs().some((entry) => (
    inputType(entry) === 'text' && Boolean(inputText(entry).trim())
  )));

  return (
    <div class="codex-chat-user-content">
      <Show when={!hasTextInput() && fallbackText().trim()}>
        <RawTextBlock text={fallbackText()} />
      </Show>
      <Show when={inputs().length > 0} fallback={null}>
        {inputs().map((entry, index) => renderStructuredInput(entry, index))}
      </Show>
    </div>
  );
}
