import { secureRandomUUID } from '@floegence/floe-webapp-core';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { TessivenGraph, type GraphBrowseState } from './TessivenGraph';
import { TessivenIcon } from './TessivenIcon';
import { compareDocuments, type Difference } from './projection';
import { TessivenResourceDialog } from './TessivenResourceDialog';
import type {
  Canvas,
  Instance,
  SaveResult,
  Selection,
  TessivenText,
  TessivenTransport,
  Validation,
  Version,
  VersionSummary,
} from './types';
import './tessiven.css';

type Editor = {
  source: 'manual' | 'import';
  yaml: string;
  canvasID?: string;
  expected: number;
  requestID: string;
  summary: string;
};
type Library = { canvases: Canvas[]; next_cursor?: string };
const initialDocument = (title: string) =>
  `apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata:\n  title: ${JSON.stringify(title)}\nnodes: []\ngroups: []\nservices: []\ninstances: []\nresources: []\nrelations: []\nevidence: []\n`;

export function TessivenPage(props: {
  transport: TessivenTransport;
  t: TessivenText;
  locale?: string;
  visible?: boolean;
  canWrite: boolean;
  onAsk: (selection: Selection | null) => void;
  onOpenService: (
    opening: { app_path: string; forward: unknown },
    runtime: string,
  ) => void | Promise<void>;
  openRequest?: { canvasID: string; version?: number; nonce: number } | null;
}) {
  const [library, setLibrary] = createSignal<Library>({ canvases: [] });
  const browseStates = new Map<string, GraphBrowseState>();
  const [query, setQuery] = createSignal('');
  const [archived, setArchived] = createSignal(false);
  const [canvas, setCanvas] = createSignal<Canvas>();
  const [version, setVersion] = createSignal<Version>();
  const [browseHistory, setBrowseHistory] = createSignal(false);
  const [history, setHistory] = createSignal<VersionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [differences, setDifferences] = createSignal<Difference[] | null>(null);
  const [locate, setLocate] = createSignal<string>();
  const [editor, setEditor] = createSignal<Editor>();
  const [validation, setValidation] = createSignal<Validation>();
  const [rename, setRename] = createSignal<string>();
  const [instance, setInstance] = createSignal<Instance>();
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [streamError, setStreamError] = createSignal(false);
  let libraryGeneration = 0,
    viewGeneration = 0,
    disposed = false;
  let importInput: HTMLInputElement | undefined;
  const historical = () =>
    browseHistory() ||
    !!canvas()?.archived ||
    version()?.number !== canvas()?.latest_version;
  const canEdit = () => props.canWrite && !historical();
  const selection = (): Selection | null =>
    version()
      ? {
          canvas_id: version()!.canvas_id,
          version_id: version()!.number,
          object_refs: [],
        }
      : null;
  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause);
  const request = props.transport.request;
  async function action<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (cause) {
      if (!disposed) setError(message(cause));
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  async function loadLibrary(append = false) {
    const generation = ++libraryGeneration;
    const search = new URLSearchParams({
      query: query(),
      archived: String(archived()),
    });
    if (append && library().next_cursor)
      search.set('cursor', library().next_cursor!);
    try {
      const result = await request<Library>('GET', `/canvases?${search}`);
      if (generation === libraryGeneration && !disposed) {
        setLibrary((previous) => ({
          ...result,
          canvases: append
            ? [...previous.canvases, ...result.canvases]
            : result.canvases,
        }));
      }
    } catch (cause) {
      if (generation === libraryGeneration && !disposed)
        setError(message(cause));
    } finally {
      if (generation === libraryGeneration && !disposed) setLoading(false);
    }
  }
  async function openCanvas(id: string, number?: number) {
    const generation = ++viewGeneration;
    setError('');
    setLoading(true);
    try {
      const [nextCanvas, nextVersion] = await Promise.all([
        request<Canvas>('GET', `/canvases/${encodeURIComponent(id)}`),
        request<Version>(
          'GET',
          `/canvases/${encodeURIComponent(id)}/versions/${number ?? 'latest'}`,
        ),
      ]);
      if (disposed || generation !== viewGeneration) return;
      setCanvas(nextCanvas);
      setVersion(nextVersion);
      setBrowseHistory(number !== undefined);
      setInstance(undefined);
      setDifferences(null);
      setLocate(undefined);
    } catch (cause) {
      if (!disposed && generation === viewGeneration) setError(message(cause));
    } finally {
      if (!disposed && generation === viewGeneration) setLoading(false);
    }
  }
  async function refresh() {
    void loadLibrary();
    const current = canvas();
    if (!current) return;
    const generation = viewGeneration;
    try {
      const next = await request<Canvas>('GET', `/canvases/${current.id}`);
      if (disposed || generation !== viewGeneration) return;
      setCanvas(next);
      // A saved revision never replaces a version being read or edited.
    } catch (cause) {
      if (!disposed) setError(message(cause));
    }
  }
  let unsubscribe: (() => void) | undefined;
  function connect() {
    unsubscribe?.();
    setStreamError(false);
    unsubscribe = props.transport.subscribe(
      () => {
        setStreamError(false);
        void refresh();
      },
      () => setStreamError(true),
    );
  }
  onMount(connect);
  onCleanup(() => {
    disposed = true;
    libraryGeneration++;
    viewGeneration++;
    unsubscribe?.();
  });
  createEffect(() => {
    query();
    archived();
    const timer = setTimeout(() => void loadLibrary(), 150);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    const target = props.openRequest;
    if (target) untrack(() => void openCanvas(target.canvasID, target.version));
  });
  function accepted(result: SaveResult) {
    viewGeneration++;
    setCanvas(result.canvas);
    setVersion(result.version);
    setBrowseHistory(false);
    setEditor(undefined);
    setRename(undefined);
    setHistoryOpen(false);
    setDifferences(null);
    setInstance(undefined);
    void loadLibrary();
  }
  function edit(
    yaml = version()?.document_yaml ?? initialDocument(props.t('untitled')),
    create = false,
  ) {
    setValidation(undefined);
    setEditor({
      source: 'manual',
      yaml,
      expected: create ? 0 : (version()?.number ?? 0),
      canvasID: create ? undefined : canvas()?.id,
      requestID: secureRandomUUID(),
      summary: '',
    });
  }
  function changeEditor(change: Partial<Editor>) {
    setEditor(
      (previous) =>
        previous && { ...previous, ...change, requestID: secureRandomUUID() },
    );
    setValidation(undefined);
  }
  async function saveEditor() {
    const draft = editor();
    if (!draft) return;
    await action(async () => {
      const checked = await request<Validation>('POST', '/validate', {
        document_yaml: draft.yaml,
      });
      setValidation(checked);
      if (!checked.valid) return;
      const result = await request<SaveResult>(
        'POST',
        draft.canvasID ? `/canvases/${draft.canvasID}/versions` : '/canvases',
        {
          request_id: draft.requestID,
          expected_version: draft.expected,
          document_yaml: draft.yaml,
          summary: draft.summary,
          source: draft.source,
        },
      );
      accepted(result);
    });
  }
  let revisionAttempt: { payload: string; id: string } | undefined;
  async function revise(kind: 'rename' | 'duplicate' | 'restore') {
    const current = canvas(),
      displayed = version();
    if (!current || !displayed) return;
    await action(async () => {
      const body = {
        expected_version: current.latest_version,
        version: displayed.number,
        ...(kind === 'rename' ? { title: rename() } : {}),
      };
      const payload = JSON.stringify({ canvas: current.id, kind, ...body });
      if (revisionAttempt?.payload !== payload)
        revisionAttempt = { payload, id: secureRandomUUID() };
      const result = await request<SaveResult>(
        'POST',
        `/canvases/${current.id}/${kind}`,
        { ...body, request_id: revisionAttempt.id },
      );
      revisionAttempt = undefined;
      accepted(result);
    });
  }
  async function archive() {
    const current = canvas();
    if (!current) return;
    await action(async () => {
      await request('POST', `/canvases/${current.id}/archive`, {
        expected_version: current.latest_version,
        archived: !current.archived,
      });
      setCanvas({ ...current, archived: !current.archived });
      void loadLibrary();
    });
  }
  async function loadHistory(append = false) {
    const current = canvas();
    if (!current) return;
    await action(async () => {
      const before = append ? history().at(-1)?.number : undefined;
      const values = await request<VersionSummary[]>(
        'GET',
        `/canvases/${current.id}/versions${before ? `?before=${before}` : ''}`,
      );
      setHistory((previous) => (append ? [...previous, ...values] : values));
      setHistoryOpen(true);
    });
  }
  async function compare(number: number) {
    const current = version();
    if (!current) return;
    await action(async () => {
      const other = await request<Version>(
        'GET',
        `/canvases/${current.canvas_id}/versions/${number}`,
      );
      setDifferences(compareDocuments(other.document, current.document));
      setHistoryOpen(false);
    });
  }
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError(props.t('fileTooLarge'));
      return;
    }
    try {
      edit(await file.text(), true);
      setEditor((previous) => previous && { ...previous, source: 'import' });
    } catch (cause) {
      setError(message(cause));
    }
    if (importInput) importInput.value = '';
  }
  const [objectSearch, setObjectSearch] = createSignal('');
  const [objectsOpen, setObjectsOpen] = createSignal(false);
  const objects = createMemo(() => {
    const doc = version()?.document;
    if (!doc) return [];
    return (
      [
        'nodes',
        'groups',
        'services',
        'instances',
        'resources',
        'relations',
        'evidence',
      ] as const
    )
      .flatMap((kind) =>
        (doc[kind] ?? []).map((value) => ({
          id: value.id,
          name: 'name' in value ? value.name : value.id,
          kind,
        })),
      )
      .filter((value) =>
        `${value.name} ${value.id}`
          .toLocaleLowerCase()
          .includes(objectSearch().toLocaleLowerCase()),
      );
  });
  return (
    <section class="tessiven" aria-label="Tessiven">
      <header class="tessiven-toolbar">
        <div class="tessiven-title">
          <Show when={canvas()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                viewGeneration++;
                setCanvas(undefined);
                setVersion(undefined);
                setError('');
              }}
            >
              {props.t('library')}
            </Button>
          </Show>
          <TessivenIcon kind="tessiven" />
          <div>
            <h1>{version()?.document.metadata.title ?? canvas()?.title ?? 'Tessiven'}</h1>
            <small>
              {canvas()
                ? props.t('version', { version: version()?.number ?? 0 })
                : props.t('subtitle')}
            </small>
          </div>
        </div>
        <div class="tessiven-actions">
          <Show when={!canvas()}>
            <input
              aria-label={props.t('searchCanvases')}
              placeholder={props.t('searchCanvases')}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setArchived(!archived())}
            >
              {props.t(archived() ? 'showActive' : 'showArchived')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canWrite}
              onClick={() => importInput?.click()}
            >
              {props.t('import')}
            </Button>
            <Button
              size="sm"
              disabled={!props.canWrite}
              onClick={() => edit(initialDocument(props.t('untitled')), true)}
            >
              {props.t('newCanvas')}
            </Button>
          </Show>
          <Show when={version()}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setObjectsOpen(true)}
            >
              {props.t('findObject')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadHistory()}
            >
              {props.t('history')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => edit()}>
              {props.t('editDSL')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                download(
                  version()!.document_yaml,
                  `${canvas()!.id}-v${version()!.number}.yaml`,
                  'application/yaml',
                )
              }
            >
              {props.t('export')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit()}
              onClick={() => {
                setRename(canvas()!.title);
              }}
            >
              {props.t('rename')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!props.canWrite || busy()}
              onClick={() => void revise('duplicate')}
            >
              {props.t('duplicate')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!props.canWrite || busy()}
              onClick={() => void archive()}
            >
              {props.t(canvas()?.archived ? 'unarchive' : 'archive')}
            </Button>
          </Show>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onAsk(selection())}
          >
            {props.t('askFlower')}
          </Button>
        </div>
      </header>
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".yaml,.yml,.json"
        onChange={(event) => void importFile(event.currentTarget.files?.[0])}
      />
      <Show when={error()}>
        <div role="alert" class="tessiven-error">
          {error()}
        </div>
      </Show>
      <Show when={streamError()}>
        <div class="tessiven-notice" role="status">
          {props.t('connectionLost')}
          <Button size="sm" variant="outline" onClick={connect}>
            {props.t('reconnect')}
          </Button>
        </div>
      </Show>
      <Show when={canvas() && historical()}>
        <div class="tessiven-notice">
          <span>
            {props.t(
              canvas()?.archived
                ? 'archivedNotice'
                : browseHistory()
                  ? 'historyNotice'
                  : 'newVersionNotice',
            )}
          </span>
          <Show when={!canvas()?.archived}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openCanvas(canvas()!.id)}
            >
              {props.t('latest')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canWrite || busy()}
              onClick={() => void revise('restore')}
            >
              {props.t('restore')}
            </Button>
          </Show>
        </div>
      </Show>
      <Show
        when={!canvas()}
        fallback={
          <Show when={version()} keyed>
            {(current) => (
              <TessivenGraph
                browseState={browseStates.get(current.canvas_id)}
                onBrowseState={(state) =>
                  browseStates.set(current.canvas_id, state)
                }
                visible={props.visible}
                version={current}
                historical={historical()}
                t={props.t}
                onAsk={props.onAsk}
                onInspect={setInstance}
                locate={locate()}
              />
            )}
          </Show>
        }
      >
        <div class="tessiven-library">
          <div class="tessiven-intro">
            <h2>{props.t('libraryTitle')}</h2>
            <p>{props.t('libraryDescription')}</p>
          </div>
          <Show
            when={!loading()}
            fallback={<p role="status">{props.t('loading')}</p>}
          >
            <Show
              when={library().canvases.length}
              fallback={
                <div class="tessiven-empty">
                  <TessivenIcon kind="tessiven" />
                  <p>{props.t(query() ? 'noMatches' : 'emptyLibrary')}</p>
                </div>
              }
            >
              <div class="tessiven-library-grid">
                <For each={library().canvases}>
                  {(item) => (
                    <article class="tessiven-library-card">
                      <button onClick={() => void openCanvas(item.id)}>
                        <TessivenIcon kind="tessiven" />
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                      </button>
                      <footer>
                        <span>
                          {props.t('version', { version: item.latest_version })}
                        </span>
                        <time>
                          {new Date(item.updated_at).toLocaleDateString(
                            props.locale,
                          )}
                        </time>
                      </footer>
                    </article>
                  )}
                </For>
              </div>
              <Show when={library().next_cursor}>
                <Button variant="ghost" onClick={() => void loadLibrary(true)}>
                  {props.t('loadMore')}
                </Button>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={version()}>
        <footer class="tessiven-footer">
          <span>
            {props.t('savedAt', {
              time: new Date(version()!.created_at).toLocaleString(
                props.locale,
              ),
            })}
          </span>
          <span>{props.t('canvasHint')}</span>
        </footer>
      </Show>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && !!editor()}
        onOpenChange={(open) => {
          if (!open && !busy()) setEditor(undefined);
        }}
        title={props.t('editDSL')}
        bodyDescription={props.t('editorDescription')}
        class="tessiven-dialog"
        footer={
          <div class="tessiven-editor-footer">
            <Button
              variant="ghost"
              onClick={() =>
                void action(async () =>
                  download(
                    JSON.stringify(await request('GET', '/schema'), null, 2),
                    'tessiven-v1.schema.json',
                    'application/json',
                  ),
                )
              }
            >
              {props.t('schema')}
            </Button>
            <Button
              variant="outline"
              disabled={busy()}
              onClick={() =>
                void action(async () =>
                  setValidation(
                    await request('POST', '/validate', {
                      document_yaml: editor()?.yaml,
                    }),
                  ),
                )
              }
            >
              {props.t('validate')}
            </Button>
            <Button
              disabled={
                busy() ||
                !props.canWrite ||
                (!!editor()?.canvasID && historical())
              }
              loading={busy()}
              onClick={() => void saveEditor()}
            >
              {props.t('saveVersion')}
            </Button>
          </div>
        }
      >
        <div class="tessiven tessiven-editor">
          <Show when={error()}>
            <div role="alert" class="tessiven-error">
              {error()}
            </div>
          </Show>
          <textarea
            aria-label={props.t('documentLabel')}
            readOnly={!!editor()?.canvasID && historical()}
            spellcheck={false}
            value={editor()?.yaml ?? ''}
            onInput={(event) =>
              changeEditor({ yaml: event.currentTarget.value })
            }
          />
          <label class="tessiven-field">
            <span>{props.t('changeSummary')}</span>
            <input
              value={editor()?.summary ?? ''}
              maxLength={2000}
              onInput={(event) =>
                changeEditor({ summary: event.currentTarget.value })
              }
            />
          </label>
          <Show when={validation()}>
            <div class="tessiven-diagnostics" role="status">
              <Show when={validation()!.valid}>{props.t('validDocument')}</Show>
              <For each={validation()!.diagnostics}>
                {(item) => (
                  <p>
                    {item.line}:{item.column} · {item.path} · {item.message}
                  </p>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Dialog>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && rename() !== undefined}
        onOpenChange={(open) => {
          if (!open) setRename(undefined);
        }}
        title={props.t('rename')}
        footer={
          <Button
            disabled={busy() || !rename()?.trim()}
            onClick={() => void revise('rename')}
          >
            {props.t('saveVersion')}
          </Button>
        }
      >
        <div class="tessiven">
          <label class="tessiven-field">
            <span>{props.t('canvasTitle')}</span>
            <input
              value={rename() ?? ''}
              maxLength={200}
              onInput={(event) => {
                setRename(event.currentTarget.value);
              }}
            />
          </label>
          <Show when={error()}>
            <p role="alert">{error()}</p>
          </Show>
        </div>
      </Dialog>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && historyOpen()}
        onOpenChange={setHistoryOpen}
        class="tessiven-history-dialog"
        title={props.t('history')}
      >
        <div class="tessiven-history">
          <For each={history()}>
            {(item) => (
              <article class="tessiven-version-row">
                <div>
                  <strong>
                    {props.t('version', { version: item.number })}
                  </strong>
                  <small>
                    {new Date(item.created_at).toLocaleString(props.locale)} ·{' '}
                    {props.t(`source.${item.source}`)}
                  </small>
                  <p>{item.summary}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setHistoryOpen(false);
                    void openCanvas(item.canvas_id, item.number);
                  }}
                >
                  {props.t('view')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void compare(item.number)}
                >
                  {props.t('compare')}
                </Button>
              </article>
            )}
          </For>
          <Show when={history().length >= 100 && history().length % 100 === 0}>
            <Button onClick={() => void loadHistory(true)}>
              {props.t('loadMore')}
            </Button>
          </Show>
        </div>
      </Dialog>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && differences() !== null}
        onOpenChange={(open) => {
          if (!open) setDifferences(null);
        }}
        class="tessiven-history-dialog"
        title={props.t('compare')}
        bodyDescription={props.t('compareDescription')}
      >
        <div class="tessiven-history">
          <Show
            when={differences()?.length}
            fallback={<p>{props.t('noChanges')}</p>}
          >
            <For each={differences() ?? []}>
              {(item) => (
                <button
                  class="tessiven-diff"
                  disabled={
                    item.change === 'removed' ||
                    ['metadata', 'presentation'].includes(item.kind)
                  }
                  onClick={() => {
                    setLocate(item.id);
                    setDifferences(null);
                  }}
                >
                  <span>{props.t(`change.${item.change}`)}</span>
                  <strong>{item.id}</strong>
                  <small>{props.t(`collection.${item.kind}`)}</small>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Dialog>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && objectsOpen()}
        onOpenChange={setObjectsOpen}
        class="tessiven-history-dialog"
        title={props.t('findObject')}
      >
        <div class="tessiven tessiven-history">
          <input
            aria-label={props.t('searchObjects')}
            placeholder={props.t('searchObjects')}
            value={objectSearch()}
            onInput={(event) => setObjectSearch(event.currentTarget.value)}
          />
          <For each={objects().slice(0, 100)}>
            {(item) => (
              <div class="tessiven-version-row">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setLocate(item.id);
                    setObjectsOpen(false);
                  }}
                >
                  {item.name}
                </Button>
                <small>{props.t(`collection.${item.kind}`)}</small>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setObjectsOpen(false);
                    props.onAsk({ ...selection()!, object_refs: [item.id] });
                  }}
                >
                  {props.t('askFlower')}
                </Button>
              </div>
            )}
          </For>
          <Show when={objects().length > 100}>
            <p>{props.t('refineSearch')}</p>
          </Show>
        </div>
      </Dialog>
      <Show when={props.visible !== false && instance() && version()}>
        <TessivenResourceDialog
          locale={props.locale}
          instance={instance()!}
          version={version()!}
          historical={historical()}
          transport={props.transport}
          t={props.t}
          onClose={() => setInstance(undefined)}
          onOpen={props.onOpenService}
        />
      </Show>
    </section>
  );
}
