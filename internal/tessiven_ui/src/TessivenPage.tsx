import type { JSX } from 'solid-js';
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
import { Button, Dialog, Dropdown } from '@floegence/floe-webapp-core/ui';
import { createGraphLayoutEngine } from '@floegence/floe-webapp-core/graph';
import {
  ArrowLeft,
  Clock,
  Download,
  FileCode,
  MoreHorizontal,
  Plus,
  Search,
} from '@floegence/floe-webapp-core/icons';
import {
  TessivenFlowerPanel,
  type CanvasFlowerRequest,
  type CanvasFlowerSurfaceProps,
} from './TessivenFlowerPanel';
import { TessivenGraph, type GraphBrowseState } from './TessivenGraph';
import { TessivenIcon } from './TessivenIcon';
import { TessivenLibraryCard } from './TessivenLibraryCard';
import { compareDocuments, type Difference } from './projection';
import { TessivenResourceDialog } from './TessivenResourceDialog';
import type {
  Canvas,
  Instance,
  SaveResult,
  Selection,
  TessivenText,
  TessivenTransport,
  Version,
  VersionSummary,
} from './types';
import './tessiven.css';

type Library = { canvases: Canvas[]; next_cursor?: string };

export function TessivenPage(props: {
  transport: TessivenTransport;
  t: TessivenText;
  locale?: string;
  visible?: boolean;
  canWrite: boolean;
  standalone?: boolean;
  renderFlower: (props: CanvasFlowerSurfaceProps) => JSX.Element;
  onOpenFlower: (threadID: string) => void;
  onOpenService: (
    opening: { app_path: string; forward: unknown },
    runtime: string,
  ) => void | Promise<void>;
  openRequest?: { canvasID: string; version?: number; nonce: number } | null;
}) {
  const thumbnailLayoutEngine = createGraphLayoutEngine();
  onCleanup(() => thumbnailLayoutEngine.dispose());
  const [library, setLibrary] = createSignal<Library>({ canvases: [] });
  const browseStates = new Map<string, GraphBrowseState>();
  const [query, setQuery] = createSignal('');
  const [archived, setArchived] = createSignal(false);
  const [canvas, setCanvas] = createSignal<Canvas>();
  const [version, setVersion] = createSignal<Version>();
  const [browseHistory, setBrowseHistory] = createSignal(false);
  const [history, setHistory] = createSignal<VersionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [sourceOpen, setSourceOpen] = createSignal(false);
  const [differences, setDifferences] = createSignal<Difference[] | null>(null);
  const [locate, setLocate] = createSignal<string>();
  const [instance, setInstance] = createSignal<Instance>();
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [streamError, setStreamError] = createSignal(false);
  let libraryGeneration = 0,
    viewGeneration = 0,
    refreshGeneration = 0,
    disposed = false;
  let creation: { request_id: string; title: string } | undefined;
  const historical = () =>
    browseHistory() ||
    !!canvas()?.archived ||
    version()?.number !== canvas()?.latest_version;
  const emptyCanvas = () => {
    const doc = version()?.document;
    return (
      !!doc &&
      ![doc.nodes, doc.services, doc.resources].some((items) => items?.length)
    );
  };
  const selection = (): Selection | null =>
    version()
      ? {
          canvas_id: version()!.canvas_id,
          version_id: version()!.number,
          object_refs: [],
        }
      : null;

  const [flowerSessions, setFlowerSessions] = createSignal<
    {
      id: string;
      request: () => CanvasFlowerRequest;
      update: (value: CanvasFlowerRequest) => void;
    }[]
  >([]);

  const flowerRequest = createMemo<CanvasFlowerRequest | undefined>(previous =>
    flowerSessions().find(session => session.id === canvas()?.id)?.request() ?? previous,
  );

  function selectionLabels(value: Selection) {
    const doc = version()?.document;
    return Object.fromEntries(value.object_refs.map((id) => {
      const item = (doc?.instances ?? []).find((item) => item.id === id);
      return [id,
        item?.name ??
        (item &&
          doc?.services?.find((service) => service.id === item.serviceRef)
            ?.name) ??
        [
          ...(doc?.nodes ?? []),
          ...(doc?.groups ?? []),
          ...(doc?.services ?? []),
          ...(doc?.resources ?? []),
        ].find((item) => item.id === id)?.name ??
        id
      ];
    }));
  }

  function askSelection(value: Selection, prompt?: string) {
    const next = {
      selection: value,
      labels: selectionLabels(value),
      prompt,
      nonce: Date.now(),
      flower_thread_id: canvas()?.flower_thread_id,
    };
    const existing = flowerSessions().find(
      (session) => session.id === value.canvas_id,
    );
    if (existing) existing.update(next);
    else {
      const [request, update] = createSignal(next);
      setFlowerSessions((sessions) => [
        ...sessions,
        { id: value.canvas_id, request, update },
      ]);
    }

  }
  async function bindFlowerThread(threadID: string) {
    const current = canvas();
    if (!current || current.flower_thread_id === threadID) return;
    await request('POST', `/canvases/${encodeURIComponent(current.id)}/flower-thread`, { thread_id: threadID });
    setCanvas({ ...current, flower_thread_id: threadID });
    const session = flowerSessions().find(item => item.id === current.id);
    if (session) session.update({ ...session.request(), flower_thread_id: threadID });
  }
  const ask = (prompt?: string) => {
    const value = selection();
    if (value) askSelection(value, prompt);
  };
  const removeFlowerReference = (objectRef: string) => {
    const session = flowerSessions().find(item => item.id === canvas()?.id);
    if (!session) return;
    const previous = session.request();
    const selection = { ...previous.selection, object_refs: previous.selection.object_refs.filter(id => id !== objectRef) };
    session.update({ ...previous, selection, labels: selectionLabels(selection), prompt: undefined });
  };
  createEffect(() => {
    const current = version();
    if (!current) return;
    untrack(() => {
      const session = flowerSessions().find(
        (item) => item.id === current.canvas_id,
      );
      if (!session) {
        const [request, update] = createSignal<CanvasFlowerRequest>({
          selection: { canvas_id: current.canvas_id, version_id: current.number, object_refs: [] },
          labels: {}, nonce: 0, flower_thread_id: currentCanvasFlowerThread(current.canvas_id),
        });
        setFlowerSessions(sessions => [...sessions, { id: current.canvas_id, request, update }]);
        return;
      }
      if (session.request().selection.version_id === current.number) return;
      const previous = session.request();
      session.update({
        ...previous,
        prompt: undefined,
        selection: { ...previous.selection, version_id: current.number },
            labels: selectionLabels(previous.selection),
        flower_thread_id: currentCanvasFlowerThread(current.canvas_id),
      });
    });
  });
  function currentCanvasFlowerThread(canvasID: string) {
    return canvas()?.id === canvasID ? canvas()?.flower_thread_id : undefined;
  }
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
    const view = viewGeneration,
      refresh = ++refreshGeneration;
    try {
      const next = await request<Canvas>('GET', `/canvases/${current.id}`);
      if (disposed || view !== viewGeneration || refresh !== refreshGeneration)
        return;
      setCanvas(next);
      // Follow Flower saves in the current view. Explicit history stays pinned.
      if (
        !browseHistory() &&
        !next.archived &&
        next.latest_version !== version()?.number
      ) {
        const saved = await request<Version>(
          'GET',
          `/canvases/${next.id}/versions/${next.latest_version}`,
        );
        if (
          disposed ||
          view !== viewGeneration ||
          refresh !== refreshGeneration ||
          browseHistory()
        )
          return;
        setVersion(saved);
        setInstance(undefined);
      }
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
  function back() {
    viewGeneration++;
    setCanvas(undefined);
    setVersion(undefined);
    setError('');
  }
  async function createCanvas() {
    if (!props.canWrite) return;
    creation ??= { request_id: secureRandomUUID(), title: props.t('untitled') };
    await action(async () => {
      const result = await request<SaveResult>('POST', '/canvases', creation);
      creation = undefined;
      if (disposed) return;
      viewGeneration++;
      setCanvas(result.canvas);
      setVersion(result.version);
      setBrowseHistory(false);
      setInstance(undefined);
      setDifferences(null);
      setLocate(undefined);
      void loadLibrary();
    });
  }
  async function archive() {
    const current = canvas();
    if (!current || !props.canWrite) return;
    await action(async () => {
      await request('POST', `/canvases/${current.id}/archive`, {
        expected_version: current.latest_version,
        archived: !current.archived,
      });
      back();
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
  function download() {
    const current = version();
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([current.document_yaml], { type: 'application/yaml' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.canvas_id}-v${current.number}.yaml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const date = (time: number) =>
    new Date(time).toLocaleDateString(props.locale, {
      month: 'short',
      day: 'numeric',
    });
  return (
    <section class="tessiven" aria-label="Tessiven">
      <header
        class={`tessiven-toolbar redeven-resource-header${props.standalone ? ' tessiven-toolbar--standalone' : ''}`}
        data-redeven-desktop-titlebar-drag-region={props.standalone ? 'true' : undefined}
        data-redeven-desktop-window-titlebar={props.standalone ? 'true' : undefined}
        data-redeven-desktop-window-titlebar-content={props.standalone ? 'true' : undefined}
      >
        <div class="tessiven-title">
          <Show
            when={canvas() || archived()}
            fallback={<TessivenIcon kind="tessiven" />}
          >
            <button
              class="tessiven-icon-button"
              onClick={() => {
                back();
                setArchived(false);
              }}
              aria-label={props.t('library')}
              title={props.t('library')}
            >
              <ArrowLeft />
            </button>
          </Show>
          <div class="tessiven-heading">
            <h1 title={version()?.document.metadata.title}>
              {version()?.document.metadata.title ??
                (archived() ? props.t('showArchived') : 'Tessiven')}
            </h1>
            <Show when={version()}>
              <button
                class="tessiven-version-link"
                title={props.t('history')}
                onClick={() => void loadHistory()}
              >
                {props.t('version', { version: version()?.number ?? 0 })}
              </button>
            </Show>
          </div>
          <Show when={version()?.source === 'example'}>
            <span class="tessiven-badge" title={props.t('exampleNotice')}>
              {props.t('example')}
            </span>
          </Show>
        </div>
        <div class="tessiven-actions">
          <Show when={!canvas()}>
            <label class="tessiven-search" data-floe-input-surface>
              <Search />
              <input
                aria-label={props.t('searchCanvases')}
                placeholder={props.t('searchCanvases')}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Button
              size="sm"
              disabled={!props.canWrite || busy()}
              loading={busy()}
              onClick={() => void createCanvas()}
            >
              <Plus class="h-4 w-4" />
              {props.t('newCanvas')}
            </Button>
            <Dropdown
              align="end"
              triggerClass="tessiven-icon-button"
              triggerAriaLabel={props.t('libraryMenu')}
              trigger={<MoreHorizontal />}
              items={[
                {
                  id: 'archive',
                  label: props.t(archived() ? 'library' : 'showArchived'),
                },
              ]}
              onSelect={() => {
                setArchived(!archived());
                setQuery('');
              }}
            />
          </Show>
          <Show when={version()}>
            <button
              class="tessiven-icon-button"
              title={props.t('findObject')}
              aria-label={props.t('findObject')}
              onClick={() => setObjectsOpen(true)}
            >
              <Search />
            </button>
            <Dropdown
              align="end"
              triggerClass="tessiven-icon-button"
              triggerAriaLabel={props.t('canvasMenu')}
              trigger={<MoreHorizontal />}
              items={[
                {
                  id: 'source',
                  label: props.t('viewSource'),
                  icon: () => <FileCode class="h-4 w-4" />,
                },
                {
                  id: 'export',
                  label: props.t('export'),
                  icon: () => <Download class="h-4 w-4" />,
                },
                {
                  id: 'archive',
                  label: props.t(canvas()?.archived ? 'unarchive' : 'archive'),
                  disabled: !props.canWrite || busy(),
                  separator: true,
                },
              ]}
              onSelect={(id) => {
                if (id === 'source') setSourceOpen(true);
                else if (id === 'export') download();
                else void archive();
              }}
            />
          </Show>
        </div>
      </header>
      <Show when={error()}>
        <div role="alert" class="tessiven-error">
          {error()}
        </div>
      </Show>
      <Show when={streamError()}>
        <div class="tessiven-notice" role="status">
          <span>{props.t('connectionLost')}</span>
          <Button size="sm" variant="ghost" onClick={connect}>
            {props.t('reconnect')}
          </Button>
        </div>
      </Show>
      <Show when={canvas() && historical()}>
        <div class="tessiven-notice">
          <Clock class="h-4 w-4" />
          <span>
            {props.t(canvas()?.archived ? 'archivedNotice' : 'historyNotice')}
          </span>
          <Show when={!canvas()?.archived}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openCanvas(canvas()!.id)}
            >
              {props.t('latest')}
            </Button>
          </Show>
        </div>
      </Show>
      <div class="tessiven-body">
        <main class="tessiven-content">
          <Show
            when={!canvas()}
            fallback={
              <div class="tessiven-workspace">
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
                      onAsk={askSelection}
                      onInspect={setInstance}
                      locate={locate()}
                    />
                  )}
                </Show>
                <Show when={emptyCanvas()}>
                  <div class="tessiven-canvas-welcome">
                    <div class="tessiven-welcome-mark">
                      <TessivenIcon kind="tessiven" />
                    </div>
                    <h2>{props.t('emptyCanvasTitle')}</h2>

                    <div class="tessiven-suggestions">
                      <button onClick={() => ask(props.t('mapPrompt'))}>
                        <TessivenIcon kind="node" />
                        <span>{props.t('mapSuggestion')}</span>
                      </button>
                      <button onClick={() => ask(props.t('codePrompt'))}>
                        <FileCode />
                        <span>{props.t('codeSuggestion')}</span>
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            }
          >
            <div class="tessiven-library">
              <Show
                when={!loading()}
                fallback={
                  <div class="tessiven-library-skeleton" role="status">
                    {props.t('loading')}
                  </div>
                }
              >
                <Show
                  when={library().canvases.length}
                  fallback={
                    <div class="tessiven-empty">
                      <Search />
                      <h3>
                        {props.t(query() ? 'noMatches' : 'emptyLibraryTitle')}
                      </h3>
                      <p>{props.t(query() ? 'searchHint' : 'emptyLibrary')}</p>
                    </div>
                  }
                >
                  <div class="tessiven-library-grid">
                    <For each={library().canvases}>
                      {(item) => (
                        <TessivenLibraryCard
                          canvas={item}
                          transport={props.transport}
                          t={props.t}
                          locale={props.locale}
                          layoutEngine={thumbnailLayoutEngine}
                          onOpen={() => void openCanvas(item.id)}
                        />
                      )}
                    </For>
                  </div>
                  <Show when={library().next_cursor}>
                    <Button
                      variant="ghost"
                      onClick={() => void loadLibrary(true)}
                    >
                      {props.t('loadMore')}
                    </Button>
                  </Show>
                </Show>
              </Show>
            </div>
          </Show>
        </main>
        <Show when={flowerSessions().length > 0}>
          <TessivenFlowerPanel
            request={flowerRequest()!}
            initialComposer={emptyCanvas() && !flowerRequest()!.flower_thread_id}
            onRemoveReference={removeFlowerReference}
            visible={props.visible !== false && !!canvas()}
            t={props.t}
            renderSurface={props.renderFlower}
            onOpenConversation={props.onOpenFlower}
            onThreadBound={threadID => void bindFlowerThread(threadID)}
          />
        </Show>
      </div>
      <Dialog
        closeLabel={props.t('close')}
        open={props.visible !== false && sourceOpen()}
        onOpenChange={setSourceOpen}
        title={props.t('viewSource')}
        bodyDescription={props.t('sourceDescription')}
        class="tessiven-dialog"
        footer={
          <Button variant="outline" onClick={download}>
            <Download class="h-4 w-4" />
            {props.t('export')}
          </Button>
        }
      >
        <pre
          class="tessiven-source"
          tabIndex={0}
          aria-label={props.t('documentLabel')}
        >
          {version()?.document_yaml}
        </pre>
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
                    {date(item.created_at)} · {props.t(`source.${item.source}`)}
                  </small>
                  <p>
                    {item.source === 'example'
                      ? props.t('exampleDescription')
                      : item.source === 'created'
                        ? props.t('emptyCanvasDescription')
                        : item.summary}
                  </p>
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
        <div class="tessiven-object-search">
          <label class="tessiven-search" data-floe-input-surface>
            <Search />
            <input
              aria-label={props.t('searchObjects')}
              placeholder={props.t('searchObjects')}
              value={objectSearch()}
              onInput={(event) => setObjectSearch(event.currentTarget.value)}
            />
          </label>
          <div class="tessiven-object-results">
            <For each={objects().slice(0, 100)}>
              {(item) => (
                <button
                  class="tessiven-diff"
                  onClick={() => {
                    setLocate(item.id);
                    setObjectsOpen(false);
                  }}
                >
                  <strong>{item.name}</strong>
                  <small>{props.t(`collection.${item.kind}`)}</small>
                </button>
              )}
            </For>
          </div>
          <Show when={objects().length > 100}>
            <p>{props.t('refineSearch')}</p>
          </Show>
        </div>
      </Dialog>
      <Show when={props.visible !== false && instance()} keyed>
        {(value) => (
          <TessivenResourceDialog
            instance={value}
            version={version()!}
            historical={historical()}
            transport={props.transport}
            t={props.t}
            locale={props.locale}
            onClose={() => setInstance(undefined)}
            onOpen={props.onOpenService}
          />
        )}
      </Show>
    </section>
  );
}
