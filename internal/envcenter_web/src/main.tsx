import { createWebCenterHost, webCenterEntry, webCenterOperation } from './adapter';
import { Modal } from './Modal';
import { BindingDescriptor } from './BindingDescriptor';
import { createCatalogLoader } from './catalogLoader';
import qrcode from 'qrcode-generator';
import './style.css';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { GatewayEnvironmentList } from '../../../desktop/src/envcenter/GatewayEnvironmentList';
import { filterEnvironmentFacts, classifyEnvironmentFailure, environmentRecovery, selectEnvironmentSnapshot } from '../../../desktop/src/envcenter/core';
import { createEnvironmentOpenController, createEnvironmentOperationObserver, createEnvironmentHandoffGuard } from '../../../desktop/src/envcenter/controller';
import type { EnvironmentEntry, ListTranslationKey, OpenProgress } from '../../../desktop/src/envcenter/contracts';
import { api, actionDigest, digest, type AuditEvent, type Catalog, type Device, type Directory, type Member, type Operation, type Route, type Setup, type Source, type Status } from './api';
import { dictionaries, locales, resolveLocale, type Key } from './i18n';

function App() {
  const [locale, setLocale] = createSignal(resolveLocale(localStorage.getItem('redeven-center-language') ?? navigator.language));
  const t = (key: Key) => dictionaries[locale()][key];
  createEffect(() => { document.documentElement.lang = locale(); localStorage.setItem('redeven-center-language', locale()); });
  const [status, setStatus] = createSignal<Status>();
  const [error, setError] = createSignal('');
  const errorMessage = () => t(('recover_' + environmentRecovery(classifyEnvironmentFailure(error()))) as Key);
  const [busy, setBusy] = createSignal(false);
  const [password, setPassword] = createSignal('');
  const [code, setCode] = createSignal('');
  const [recovery, setRecovery] = createSignal(false);
  const [challenge, setChallenge] = createSignal('');
  const [bootstrap, setBootstrap] = createSignal('');
  const [setup, setSetup] = createSignal<Setup>();
  const [saved, setSaved] = createSignal(false);
  const [replacement, setReplacement] = createSignal(false);
  const [directory, setDirectory] = createSignal<Directory>({ revision: 0, sources: [], routes: [], bookmarks: [] });
  const [catalogs, setCatalogs] = createSignal<Record<string, Catalog>>({});
  const [sourceErrors, setSourceErrors] = createSignal<Record<string, string>>({});
  const catalogLoader = createCatalogLoader(
    (id, signal) => api<Catalog>('catalog?source=' + encodeURIComponent(id), undefined, signal),
    (id, value) => { setCatalogs(current => ({ ...current, [id]: value })); setSourceErrors(current => ({ ...current, [id]: '' })); },
    (id, error) => setSourceErrors(current => ({ ...current, [id]: error instanceof Error ? error.message : 'GATEWAY_UNREACHABLE' })),
  );
  const [query, setQuery] = createSignal(sessionStorage.getItem('center-query') ?? '');
  const [sourceFilter, setSourceFilter] = createSignal(sessionStorage.getItem('center-source') ?? '');
  const [favorites, setFavorites] = createSignal(sessionStorage.getItem('center-favorites') === 'true');
  createEffect(() => { sessionStorage.setItem('center-query', query()); sessionStorage.setItem('center-source', sourceFilter()); sessionStorage.setItem('center-favorites', String(favorites())); });
  const [audit, setAudit] = createSignal<AuditEvent[]>([]);
  const [removeSource, setRemoveSource] = createSignal<Source>();
  const [now, setNow] = createSignal(Date.now());
  const [page, setPage] = createSignal<'environments' | 'security' | 'devices'>('environments');
  const [devices, setDevices] = createSignal<Device[]>([]);
  const [progress, setProgress] = createSignal<OpenProgress[]>([]);
  const [operations, setOperations] = createSignal<Record<string, Operation>>({});
  const tabs = new Map<string, Window | null>();
  const handoffs = new Map<string, ReturnType<typeof createEnvironmentHandoffGuard>>();
  const [rotateTarget, setRotateTarget] = createSignal<Route>();
  const [bindingRevision, setBindingRevision] = createSignal('');
  const [binding, setBinding] = createSignal('');
  const [showBookmark, setShowBookmark] = createSignal(false);
  const [bookmarkName, setBookmarkName] = createSignal('');
  const [bookmarkURL, setBookmarkURL] = createSignal('');
  const [showAdd, setShowAdd] = createSignal(false);
  const [name, setName] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [accessCode, setAccessCode] = createSignal('');
  const [pair, setPair] = createSignal<{ operation: string; fingerprint: string; gateway_id: string; url: string }>();
  const [routeTarget, setRouteTarget] = createSignal<{ source: Source; member: Member }>();
  const [routeOrigin, setRouteOrigin] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [reauth, setReauth] = createSignal<{ action: string; commit: (grant: string) => Promise<void> }>();
  let loadRevision = 0;
  let statusRevision = 0;
  let stopped = false;
  onCleanup(() => { stopped = true; loadRevision++; catalogLoader.cancel(); handoffs.forEach(handoff => handoff.requestCancel()); });
  async function work(task: () => Promise<unknown>) { if (busy()) return; setBusy(true); setError(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : 'CENTER_REQUEST_FAILED'); } finally { setBusy(false); } }
  async function refreshStatus(directory = true) {
    const revision = ++statusRevision;
    const result = await api<Status>('status');
    if (stopped || revision !== statusRevision) return;
    const previous = status();
    setStatus(result);
    if (result.authenticated && directory) await loadDirectory();
    // Anonymous polling is also used while scanning the QR code or entering
    // the second factor. Clear those forms only when authority actually changes.
    if (!result.authenticated && previous && (previous.authenticated
      || previous.security.configured !== result.security.configured
      || previous.security.recovery_pending !== result.security.recovery_pending)) {
      loadRevision++;
      catalogLoader.cancel();
      handoffs.forEach(handoff => handoff.requestCancel());
      setPassword(''); setCode(''); setChallenge(''); setAccessCode(''); setNewPassword('');
      setPair(undefined); setSetup(undefined); setReplacement(false); setSaved(false);
      setProgress([]); setOperations({}); setDevices([]); setAudit([]);
      tabs.forEach(tab => tab?.close()); tabs.clear();
      setDirectory({ revision: 0, sources: [], routes: [], bookmarks: [] });
      setCatalogs({}); setSourceErrors({}); setReauth(undefined);
      setShowAdd(false); setShowBookmark(false); setRemoveSource(undefined);
      setRotateTarget(undefined); setRouteTarget(undefined); setBinding('');
    }
  }
  onMount(() => { void work(() => refreshStatus()); const wake = () => { if (document.visibilityState === 'visible') void refreshStatus(false).catch(() => {}); }; const timer = window.setInterval(() => { setNow(Date.now()); wake(); }, 30_000); document.addEventListener('visibilitychange', wake); onCleanup(() => { clearInterval(timer); document.removeEventListener('visibilitychange', wake); }); });
  async function loadDirectory() {
    const revision = ++loadRevision;
    catalogLoader.cancel();
    const next = await api<Directory>('directory');
    if (stopped || revision !== loadRevision) return;
    setDirectory(current => selectEnvironmentSnapshot(current, next, value => ({ generation: 0, revision: value.revision })));
    void catalogLoader.load(next.sources.map(source => source.id));
  }
  async function authenticate() {
    const authorization = reauth();
    const result = await api<{ challenge?: string; grant?: string; device?: Device }>('authenticate', {
      ...(challenge() ? { challenge: challenge(), ...(recovery() ? { recovery_code: code() } : { code: code() }) } : { password: password() }),
      ...(authorization ? { action: authorization.action } : {}),
    });
    setPassword(''); setCode('');
    if (result.challenge) { setChallenge(result.challenge); return; }
    setChallenge('');
    if (authorization && result.grant) { setReauth(undefined); await authorization.commit(result.grant); }
    else await refreshStatus();
  }
  function authorize(action: string, commit: (grant: string) => Promise<void>) { setPassword(''); setCode(''); setChallenge(''); setRecovery(false); setReauth({ action, commit }); }
  async function startSetup() { const result = await api<Setup>('setup/start', { bootstrap: bootstrap(), password: password() }); setSetup(result); setPassword(''); setBootstrap(''); }
  async function verifySetup() { const result = await api<Setup>('setup/verify', { operation: setup()!.operation, code: code(), replacement: replacement() }); setSetup(current => ({ ...current!, ...result })); setCode(''); }
  async function commitSetup() { await api('setup/commit', { operation: setup()!.operation, saved: saved(), replacement: replacement() }); setSetup(undefined); setSaved(false); setReplacement(false); setChallenge(''); await refreshStatus(); }
  const entries = createMemo(() => directory().routes.map(route => {
    const member = catalogs()[route.source_id]?.members.find(member => member.member_id === route.member_id && member.runtime_public_id === route.runtime_id);
    return webCenterEntry(route, member, sourceErrors()[route.source_id] ?? '');
  }));
  const visible = createMemo(() => filterEnvironmentFacts(entries(), query(), e => [e.label, e.gateway_member?.metadata.hostname, e.route.origin].join('\n'),
    e => (!sourceFilter() || e.gateway_id === sourceFilter()) && (!favorites() || e.route.favorite)));
  const listI18n = { t: (key: ListTranslationKey) => t(({ 'gatewayMembers.connected': 'connected', 'gatewayMembers.offline': 'offline', 'gatewayAccess.checkingAccess': 'checking', 'environmentAction.open': 'open' } as const)[key]) };
  const openController = createEnvironmentOpenController(createWebCenterHost(async target => {
      const route = directory().routes.find(route => route.id === target.environment_id && route.source_id === target.gateway_id && route.member_id === target.gateway_env_id);
      if (!route) throw new Error('CENTER_INVALID_TARGET');
      const tab = tabs.get(route.id);
      const handoff = createEnvironmentHandoffGuard();
      handoffs.set(route.id, handoff);
      setProgress(current => [...current, { action: 'open_gateway_environment', gateway_id: target.gateway_id, environment_id: target.environment_id, status: 'running' }]);
      try {
        let next = await api<Operation>('open', { route: route.id, request: crypto.randomUUID() });
        const observe = createEnvironmentOperationObserver(next.id);
        const requestID = next.request_id;
        const apply = (value: Operation) => {
          if (value.route_id !== route.id || value.request_id !== requestID) throw new Error('CENTER_INVALID_TARGET');
          const state = observe(webCenterOperation(value));
          if (state?.sequence !== value.sequence) return false;
          setOperations(current => ({ ...current, [route.id]: value }));
          return true;
        };
        apply(next);
        while (next.status === 'connecting' && !stopped) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const observed = await api<Operation>('operations?id=' + encodeURIComponent(next.id));
          if (apply(observed)) next = observed;
        }
        if (stopped || next.status !== 'ready' || !next.destination) throw new Error(next.error ?? 'CENTER_OPERATION_CANCELED');
        const destination = new URL(next.destination);
        if (destination.origin !== route.origin || destination.pathname !== '/__center/start') throw new Error('CENTER_INVALID_TARGET');
        if (!status()?.authenticated || !handoff.claim()) throw new Error('CENTER_OPERATION_CANCELED');
        if (tab) tab.location.replace(destination.href); else window.location.assign(destination.href);
        return true;
      } catch (error) { tab?.close(); throw error; }
      finally { if (handoffs.get(route.id) === handoff) handoffs.delete(route.id); setProgress(current => current.filter(item => item.environment_id !== route.id)); setOperations(current => { const next = { ...current }; delete next[route.id]; return next; }); }
  }));
  function cancelOpen(operation: Operation) {
    if (!handoffs.get(operation.route_id)?.requestCancel()) return;
    tabs.get(operation.route_id)?.close();
    // Cancellation belongs to this open intent, not the unrelated form lock.
    void api<Operation>('operations/cancel', { id: operation.id }).then(canceled => {
      setOperations(current => current[operation.route_id]?.id === canceled.id
        ? { ...current, [operation.route_id]: canceled } : current);
    }).catch(error => {
      setError(error instanceof Error ? error.message : 'CENTER_REQUEST_FAILED');
    });
  }
  async function open(entry: EnvironmentEntry) {
    if (tabs.has(entry.id)) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    tabs.set(entry.id, tab);
    setError('');
    try { await openController.open(entry); }
    catch (error) { tab?.close(); setError(error instanceof Error ? error.message : 'CENTER_REQUEST_FAILED'); }
    finally { tabs.delete(entry.id); }
  }
  async function beginGateway() {
    const input = { url: address().trim(), name: name().trim(), code_hash: await digest(accessCode()) };
    authorize(await actionDigest('gateway:add', input), async grant => { const result = await api<{ operation: string; fingerprint: string; gateway_id: string; url: string }>('gateways/begin', { url: input.url, name: input.name, access_code: accessCode(), grant }); setPair(result); setAccessCode(''); });
  }
  async function addRoute() {
    const target = routeTarget()!;
    const input = { source_id: target.source.id, member_id: target.member.member_id, runtime_id: target.member.runtime_public_id, origin: routeOrigin().trim(), label: target.member.display_name, expected_revision: directory().revision };
    authorize(await actionDigest('route:add', input), async grant => { const result = await api<{ binding: unknown }>('routes/add', { input, grant }); setBinding(JSON.stringify(result.binding, null, 2)); setRouteTarget(undefined); await loadDirectory(); });
  }
  async function showDevices() { setPage('devices'); await work(async () => setDevices(await api<Device[]>('devices'))); }
  let lastActivity = 0;
  const activity = (event: Event) => { if (!event.isTrusted || document.visibilityState !== 'visible' || !status()?.authenticated || Date.now() - lastActivity < 30_000) return; lastActivity = Date.now(); void api<Device>('activity', {}).then(device => setStatus(current => current ? { ...current, device } : current)).catch(() => void refreshStatus()); };
  onMount(() => { document.addEventListener('pointerdown', activity, { passive: true }); document.addEventListener('keydown', activity); });
  onCleanup(() => { document.removeEventListener('pointerdown', activity); document.removeEventListener('keydown', activity); });
  function Field(props: { label: string; value: string; set: (value: string) => void; type?: string; autocomplete?: string; help?: string; id?: string }) {
    return <label class="center-field"><span>{props.label}</span><input aria-label={props.label} id={props.id} type={props.type ?? 'text'} value={props.value} onInput={event => props.set(event.currentTarget.value)} autocomplete={props.autocomplete} required /><Show when={props.help}><small>{props.help}</small></Show></label>;
  }
  function AuthForm() { return <form onSubmit={event => { event.preventDefault(); void work(authenticate); }}>
    <Show when={!challenge()} fallback={<><Field label={t(recovery() ? 'recovery' : 'code')} value={code()} set={setCode} autocomplete="one-time-code" id="auth-code" /><button type="button" class="link" onClick={() => { setRecovery(!recovery()); setCode(''); }}>{t(recovery() ? 'authenticator' : 'recovery')}</button></>}>
      <Field label={t('password')} value={password()} set={setPassword} type="password" autocomplete="current-password" id="entry-password" />
    </Show><button class="primary" disabled={busy()}>{busy() ? t('checking') : t(challenge() ? 'verify' : 'signIn')}</button>
  </form>; }
  const qr = createMemo(() => { const uri = setup()?.uri; if (!uri) return ''; const value = qrcode(0, 'M'); value.addData(uri); value.make(); return value.createDataURL(4, 8); });
  function SetupForm() { return <section class="center-card setup"><p class="eyebrow">{t('setup')} · {setup()?.recovery_codes ? '3 / 3' : setup() ? '2 / 3' : '1 / 3'}</p><h1>{t(setup()?.recovery_codes ? 'saveCodes' : setup() ? 'authenticator' : 'setup')}</h1>
    <Show when={setup()} fallback={<form onSubmit={event => { event.preventDefault(); void work(startSetup); }}><p>{t('setupHelp')}</p><Field label={t('setupToken')} value={bootstrap()} set={setBootstrap} type="password" autocomplete="off" id="setup-token" /><Field label={t('password')} value={password()} set={setPassword} type="password" autocomplete="new-password" help={t('passwordHelp')} id="setup-password" /><button class="primary" disabled={busy()}>{t('continue')}</button></form>}>
      <Show when={setup()?.recovery_codes} fallback={<form onSubmit={event => { event.preventDefault(); void work(verifySetup); }}><p>{t('factorHelp')}</p><Show when={qr()}><img class="factor-qr" src={qr()} alt={t('authenticator')} /></Show><code class="secret" data-testid="totp-secret">{setup()?.secret}</code><button type="button" class="link" onClick={() => void work(async () => navigator.clipboard.writeText(setup()?.secret ?? ''))}>{t('copy')}</button><Field label={t('code')} value={code()} set={setCode} autocomplete="one-time-code" id="setup-code" /><button class="primary" disabled={busy()}>{t('verify')}</button></form>}>
        <p>{t('recoveryHelp')}</p><pre class="secret" data-testid="recovery-codes">{setup()?.recovery_codes?.join('\n')}</pre><button class="link" onClick={() => void work(async () => navigator.clipboard.writeText(setup()?.recovery_codes?.join('\n') ?? ''))}>{t('copy')}</button><label class="check"><input type="checkbox" checked={saved()} onChange={e => setSaved(e.currentTarget.checked)} />{t('savedCodes')}</label><button class="primary" disabled={!saved() || busy()} onClick={() => void work(commitSetup)}>{t('continue')}</button>
      </Show>
    </Show>
    <Show when={setup()}><button class="link" disabled={busy()} onClick={() => void work(async () => { await api('setup/cancel', { operation: setup()!.operation, replacement: replacement() }); setSetup(undefined); setSaved(false); setCode(''); setReplacement(false); await refreshStatus(); })}>{t('cancel')}</button></Show>
  </section>; }
  return <div class="center-shell"><header><a class="brand" href="/">✳ <span>Redeven <strong>Env Center</strong></span></a><select aria-label={t('language')} value={locale()} onChange={e => setLocale(resolveLocale(e.currentTarget.value))}><For each={locales}>{locale => <option value={locale}>{locale}</option>}</For></select><Show when={status()?.authenticated}><button onClick={() => void work(async () => { await api('devices/revoke', {}); await refreshStatus(); })}>{t('signOut')}</button></Show></header>
    <Show when={error()}><div class="center-error" role="alert"><strong>{t('error')}</strong><span>{errorMessage()}</span><code>{error()}</code><button onClick={() => setError('')} aria-label={t('cancel')}>×</button></div></Show>
    <Show when={status()} fallback={<main class="center-loading" aria-live="polite">{t('loading')}</main>}>
      <Show when={status()?.security.configured && !status()?.security.recovery_pending && !replacement()} fallback={<main class="center-auth"><SetupForm /></main>}>
        <Show when={status()?.authenticated} fallback={<main class="center-auth"><section class="center-card"><p class="eyebrow">{status()?.origin}</p><h1>{t('signIn')}</h1><AuthForm /><p class="help">{t('recoveryHost')}</p></section></main>}>
          <Show when={status()?.authenticated && (status()?.device.expires_at ?? 0) - now() < 5 * 60_000}><div class="session-warning" role="status">{t('expiring')}<button onClick={() => void work(async () => { const device = await api<Device>('activity', {}); setStatus(current => current ? { ...current, device } : current); })}>{t('continueSession')}</button></div></Show><div class="center-workspace"><nav aria-label="Redeven"><For each={['environments', 'security', 'devices'] as const}>{item => <button aria-current={page() === item ? 'page' : undefined} onClick={() => item === 'devices' ? void showDevices() : void work(async () => { setPage(item); if (item === 'security') setAudit(await api<AuditEvent[]>('audit')); })}>{t(item)}</button>}</For><small>{t('server')}<br />{status()?.origin}</small></nav><main>
            <Show when={page() === 'environments'}><div class="page-heading"><div><p class="eyebrow">Redeven Env Center</p><h1>{t('environments')}</h1></div><div class="security-actions"><button onClick={() => setShowBookmark(true)}>{t('bookmarkAdd')}</button><button class="primary" onClick={() => { setShowAdd(true); setPair(undefined); }}>{t('addGateway')}</button></div></div>
              <div class="toolbar"><input aria-label={t('search')} placeholder={t('search')} value={query()} onInput={e => setQuery(e.currentTarget.value)} /><select aria-label={t('source')} value={sourceFilter()} onChange={e => setSourceFilter(e.currentTarget.value)}><option value="">{t('allSources')}</option><For each={directory().sources}>{source => <option value={source.id}>{source.name}</option>}</For></select><label class="check"><input type="checkbox" checked={favorites()} onChange={e => setFavorites(e.currentTarget.checked)} />{t('favorites')}</label><button disabled={busy()} onClick={() => void work(loadDirectory)}>{t('refresh')}</button></div>
              <Show when={directory().sources.length > 0} fallback={<section class="center-card empty"><span class="empty-mark">⌘</span><h2>{t('environments')}</h2><p>{t('empty')}</p><button class="primary" onClick={() => setShowAdd(true)}>{t('addGateway')}</button></section>}>
                <For each={directory().sources.filter(source => !sourceFilter() || sourceFilter() === source.id)}>{source => <section class="center-card source"><div class="section-heading"><h2>{source.name || source.url}</h2><span>{source.url}</span><button onClick={() => setRemoveSource(source)}>{t("remove")}</button></div><Show when={sourceErrors()[source.id]}><p role="status" class="source-error">{sourceErrors()[source.id]}</p></Show>
                  <GatewayEnvironmentList i18n={listI18n} environments={visible().filter(entry => entry.gateway_id === source.id)} progress={progress()} disabled={false} open={entry => void open(entry)} details={entry => <div class="route-tools"><small>{entry.route.origin}</small><button aria-pressed={entry.route.favorite} onClick={() => void work(async () => { await api('routes/favorite', { id: entry.id, value: !entry.route.favorite, revision: directory().revision }); await loadDirectory(); })}>{entry.route.favorite ? '★' : '☆'} {t('favorites')}</button><button onClick={() => void work(async () => setBinding(JSON.stringify(await api('binding?route=' + encodeURIComponent(entry.id)), null, 2)))}>{t('bind')}</button><button onClick={() => { setRotateTarget(entry.route); setBindingRevision(''); }}>{t('rotateBinding')}</button></div>} />
                  <For each={filterEnvironmentFacts(catalogs()[source.id]?.members ?? [], query(), member => [member.display_name, member.metadata.hostname, member.runtime_public_id].join(' '), member => !favorites() && member.state === 'active' && !directory().routes.some(route => route.source_id === source.id && route.member_id === member.member_id))}>{member => <div class="unbound"><div><strong>{member.display_name}</strong><small>{member.metadata.hostname} · {t('bindingPending')}</small></div><button onClick={() => { setRouteTarget({ source, member }); setRouteOrigin(''); }}>{t('bind')}</button></div>}</For>
                </section>}</For><Show when={visible().length === 0 && directory().routes.length > 0}><p>{t('noMatches')}</p></Show>
              </Show>
              <Show when={directory().bookmarks.length}><section class="center-card"><h2>{t('bookmarks')}</h2><p>{t('bookmarkHelp')}</p><For each={directory().bookmarks.filter(bookmark => (!query() || (bookmark.name + bookmark.url).toLocaleLowerCase().includes(query().toLocaleLowerCase())))}>{bookmark => <div class="unbound"><div><strong>{bookmark.name}</strong><small>{bookmark.url}</small></div><a class="direct-link" href={bookmark.url} target="_blank" rel="noopener noreferrer">{t('open')}</a><button onClick={() => void work(async () => { await api('bookmarks/remove', { id: bookmark.id, revision: directory().revision }); await loadDirectory(); })}>{t('remove')}</button></div>}</For></section></Show>
              <Show when={Object.values(operations()).some(operation => operation.status === 'connecting')}><div class="operation"><For each={Object.values(operations()).filter(operation => operation.status === 'connecting')}>{operation => <div role="status">{directory().routes.find(route => route.id === operation.route_id)?.label} · {t('checking')}<button onClick={() => cancelOpen(operation)}>{t('cancel')}</button></div>}</For></div></Show>
            </Show>
            <Show when={page() === 'security'}><h1>{t('security')}</h1><section class="center-card"><h2>{status()?.origin}</h2><form onSubmit={e => { e.preventDefault(); void work(async () => { const next = newPassword(); authorize('password:' + await digest(next), async grant => { await api('password', { grant, password: next }); setNewPassword(''); await refreshStatus(); }); }); }}><Field label={t('newPassword')} value={newPassword()} set={setNewPassword} type="password" autocomplete="new-password" help={t('passwordHelp')} /><button>{t('changePassword')}</button></form><div class="security-actions"><button onClick={() => authorize('factor:replace', async grant => { setSetup(await api<Setup>('factor/replace', { grant })); setSaved(false); setReplacement(true); })}>{t('replaceFactor')}</button><button onClick={() => authorize('recovery:rotate', async grant => { setSetup(await api<Setup>('recovery/rotate', { grant })); setSaved(false); setReplacement(true); })}>{t('rotateRecovery')}</button></div></section><section class="center-card"><h2>{t('audit')}</h2><div class="audit-table"><table><thead><tr><th>{t('time')}</th><th>{t('action')}</th><th>{t('result')}</th></tr></thead><tbody><For each={[...audit()].reverse()}>{event => <tr><td>{new Date(event.time).toLocaleString(locale())}</td><td><code>{event.action}</code></td><td><code>{event.result}</code></td></tr>}</For></tbody></table></div></section></Show>
            <Show when={page() === 'devices'}><div class="page-heading"><h1>{t('devices')}</h1><button onClick={() => void work(async () => { await api('devices/revoke', { all: true }); await refreshStatus(); })}>{t('revokeAll')}</button></div><For each={devices()}>{device => <section class="center-card device"><div><strong>{device.current ? t('currentDevice') : device.label}</strong><small>{t('activity')}: {new Date(device.last_activity_at).toLocaleString(locale())}</small></div><button onClick={() => void work(async () => { await api('devices/revoke', { id: device.id }); if (device.current) await refreshStatus(); else setDevices(await api<Device[]>('devices')); })}>{t('revoke')}</button></section>}</For></Show>
          </main></div>
        </Show>
      </Show>
    </Show>
    <Show when={rotateTarget()}><Modal error={error()} errorLabel={errorMessage()} titleID="rotate-title" onClose={() => setRotateTarget(undefined)}><h2 id="rotate-title">{t('rotateBinding')}</h2><p>{rotateTarget()?.label}</p><p>{t('rotateBindingHelp')}</p><form onSubmit={event => { event.preventDefault(); void work(async () => { const input = { id: rotateTarget()!.id, expected_revision: directory().revision, binding_revision: Number(bindingRevision()) }; if (!Number.isSafeInteger(input.binding_revision) || input.binding_revision < 1) throw new Error('CENTER_INVALID_TARGET'); authorize(await actionDigest('route:rotate', input), async grant => { const result = await api('routes/rotate', { input, grant }); setRotateTarget(undefined); setBinding(JSON.stringify(result, null, 2)); await loadDirectory(); }); }); }}><Field label={t('bindingRevision')} value={bindingRevision()} set={setBindingRevision} type="number" /><button class="primary" disabled={busy()}>{t('continue')}</button></form><button class="link" onClick={() => setRotateTarget(undefined)}>{t('cancel')}</button></Modal></Show>
    <Show when={removeSource()}><Modal error={error()} errorLabel={errorMessage()} titleID="remove-title" onClose={() => setRemoveSource(undefined)}><h2 id="remove-title">{t('remove')}</h2><p>{removeSource()?.name}</p><p>{t('removeHelp')}</p><button class="primary" disabled={busy()} onClick={() => void work(async () => { const source = removeSource()!; const revision = directory().revision; authorize(await actionDigest('source:remove', { ID: source.id, Revision: revision }), async grant => { await api('sources/remove', { grant, id: source.id, revision }); setRemoveSource(undefined); setSourceFilter(''); await loadDirectory(); }); })}>{t('confirm')}</button><button class="link" onClick={() => setRemoveSource(undefined)}>{t('cancel')}</button></Modal></Show>
    <Show when={showBookmark()}><Modal error={error()} errorLabel={errorMessage()} titleID="bookmark-title" onClose={() => setShowBookmark(false)}><h2 id="bookmark-title">{t('bookmarkAdd')}</h2><p>{t('bookmarkHelp')}</p><form onSubmit={e => { e.preventDefault(); void work(async () => { const input = { name: bookmarkName().trim(), url: bookmarkURL().trim(), expected_revision: directory().revision }; authorize(await actionDigest('bookmark:add', input), async grant => { await api('bookmarks/add', { input, grant }); setShowBookmark(false); setBookmarkName(''); setBookmarkURL(''); await loadDirectory(); }); }); }}><Field label={t('name')} value={bookmarkName()} set={setBookmarkName} /><Field label={t('bookmarkURL')} value={bookmarkURL()} set={setBookmarkURL} type="url" /><button class="primary" disabled={busy()}>{t('continue')}</button></form><button class="link" onClick={() => setShowBookmark(false)}>{t('cancel')}</button></Modal></Show>
    <Show when={showAdd()}><Modal error={error()} errorLabel={errorMessage()} titleID="gateway-title" onClose={() => { setShowAdd(false); setAccessCode(''); }}><h2 id="gateway-title">{t('addGateway')}</h2><Show when={pair()} fallback={<form onSubmit={e => { e.preventDefault(); void work(beginGateway); }}><Field label={t('name')} value={name()} set={setName} /><Field label={t('address')} value={address()} set={setAddress} type="url" /><Field label={t('accessCode')} value={accessCode()} set={setAccessCode} type="password" autocomplete="off" /><button class="primary" disabled={busy()}>{t('continue')}</button></form>}><p>{t('trustHelp')}</p><p>{pair()?.url}</p><p>{t('fingerprint')}</p><code class="secret">{pair()?.fingerprint}</code><button class="primary" disabled={busy()} onClick={() => void work(async () => { await api('gateways/complete', { operation: pair()!.operation, fingerprint: pair()!.fingerprint, revision: directory().revision }); setShowAdd(false); setPair(undefined); setName(''); setAddress(''); await loadDirectory(); })}>{t('confirm')}</button></Show><button class="link" onClick={() => { setShowAdd(false); setAccessCode(''); }}>{t('cancel')}</button></Modal></Show>
    <Show when={routeTarget()}><Modal error={error()} errorLabel={errorMessage()} titleID="route-title" onClose={() => setRouteTarget(undefined)}><h2 id="route-title">{t('bind')}</h2><p>{routeTarget()?.member.display_name}</p><form onSubmit={e => { e.preventDefault(); void work(addRoute); }}><Field label={t('origin')} value={routeOrigin()} set={setRouteOrigin} type="url" /><button class="primary" disabled={busy()}>{t('continue')}</button></form><button class="link" onClick={() => setRouteTarget(undefined)}>{t('cancel')}</button></Modal></Show>
    <Show when={binding()}><Modal error={error()} errorLabel={errorMessage()} titleID="binding-title" onClose={() => setBinding('')}><h2 id="binding-title">{t('bind')}</h2><p>{t('bindingHelp')}</p><BindingDescriptor value={binding()} t={t} /><button class="primary" onClick={() => setBinding('')}>{t('continue')}</button></Modal></Show>
    <Show when={reauth()}><Modal error={error()} errorLabel={errorMessage()} titleID="reauth-title" onClose={() => { setReauth(undefined); setPassword(''); setCode(''); setChallenge(''); }}><h2 id="reauth-title">{t('reauth')}</h2><AuthForm /><button class="link" onClick={() => { setReauth(undefined); setPassword(''); setCode(''); setChallenge(''); }}>{t('cancel')}</button></Modal></Show>

  </div>;
}
render(() => <App />, document.getElementById('root')!);
