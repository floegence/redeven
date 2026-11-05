package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/authoring"
	"github.com/floegence/redevplugin/v3/pkg/authorproject"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/mutation"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
	"github.com/floegence/redevplugin/v3/pkg/websecurity"
)

var errAuthorPermission = errors.New("plugin author permission denied")

const authorPrefix = "/_redevplugin/api/plugins/author/workspaces/"

type authorEnvironment struct {
	environment *authoring.Environment
	sessions    *sessionAdapter
	owner       authoring.Owner
}
type authorBackend struct {
	privateRoot  string
	mu           sync.Mutex
	store        *authoring.WorkspaceStore
	router       *authoring.SurfaceRouter
	environments map[string]authorEnvironment
	sessions     *sessionAdapter
	options      Options
	host         *host.Host
	platform     http.Handler
	drafts       *plugincreation.Service
}

func newAuthorBackend(ctx context.Context, root string, opts Options, sessions *sessionAdapter, h *host.Host, platform, web http.Handler) (*authorBackend, error) {
	authorRoot := filepath.Join(root, "author-workspaces")
	store, err := authoring.OpenWorkspaceStore(ctx, authorRoot)
	if err != nil {
		return nil, err
	}
	router, err := authoring.NewSurfaceRouter(trustedWebSurfaceOrigin, web)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	return &authorBackend{privateRoot: authorRoot, store: store, router: router, environments: map[string]authorEnvironment{}, sessions: sessions, options: opts, host: h, platform: platform, drafts: opts.PluginCreation}, nil
}
func (a *authorBackend) context(ctx context.Context, meta *session.Meta) (context.Context, authoring.Owner, error) {
	if meta == nil {
		return ctx, authoring.Owner{}, sessionctx.ErrSessionRequired
	}
	resolved, err := a.sessions.resolver.ResolveSession(ctx, meta.ChannelID)
	if err != nil {
		return ctx, authoring.Owner{}, err
	}
	expected, err := canonicalPluginSessionContextFromMeta(meta.ChannelID, meta)
	if err != nil || resolved.OwnerUserHash != expected.OwnerUserHash || resolved.OwnerEnvHash != expected.OwnerEnvHash || resolved.OwnerSessionHash != expected.OwnerSessionHash || resolved.SessionChannelIDHash != expected.SessionChannelIDHash {
		return ctx, authoring.Owner{}, sessionctx.ErrSessionRequired
	}
	permissions, ok := a.sessions.resolver.cache.Get(resolved)
	if !ok || !permissions.permissions.read {
		return ctx, authoring.Owner{}, errAuthorPermission
	}
	ctx = sessionctx.WithContext(ctx, resolved)
	owner, err := authoring.OwnerFromContext(ctx)
	return ctx, owner, err
}
func (a *authorBackend) requireMutation(ctx context.Context, admin bool) error {
	s, ok := sessionctx.FromContext(ctx)
	if !ok {
		return errAuthorPermission
	}
	resolved, ok := a.sessions.resolver.cache.Get(s)
	if !ok || !resolved.permissions.read || !resolved.permissions.write || !resolved.permissions.execute || (admin && !resolved.permissions.admin) {
		return errAuthorPermission
	}
	return nil
}
func (a *authorBackend) CreateWorkspace(ctx context.Context, meta *session.Meta, request string) (string, error) {
	ctx, o, err := a.context(ctx, meta)
	if err != nil {
		return "", err
	}
	if err = a.requireMutation(ctx, false); err != nil {
		return "", err
	}
	w, err := a.store.Create(ctx, o, request)
	return w.ID, err
}
func (a *authorBackend) SourceScope(ctx context.Context, meta *session.Meta, id string) (plugincreation.SourceScope, error) {
	ctx, o, err := a.context(ctx, meta)
	if err != nil {
		return plugincreation.SourceScope{}, err
	}
	w, err := a.store.Get(ctx, o, id)
	if err != nil {
		return plugincreation.SourceScope{}, err
	}
	return plugincreation.SourceScope{PrivateRoot: a.privateRoot, Directory: w.SourceDirectory}, nil
}
func (a *authorBackend) RemoveWorkspace(ctx context.Context, meta *session.Meta, id string) error {
	ctx, o, err := a.context(ctx, meta)
	if err != nil {
		return err
	}
	if err = a.requireMutation(ctx, false); err != nil {
		return err
	}
	productOwner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		return err
	}
	draft, err := a.drafts.Store.ForWorkspace(ctx, productOwner, id)
	if err != nil {
		return err
	}
	if draft.InstallRequestID != "" {
		operation, failure := a.host.GetInspectedInstall(ctx, draft.InstallRequestID)
		if failure != nil && !errors.Is(failure, host.ErrInspectedInstallNotFound) {
			return failure
		}
		if failure == nil && operation.MutationOutcome == mutation.OutcomeUnknown {
			return plugincreation.ErrConflict
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if e, ok := a.environments[id]; ok {
		if e.owner != o {
			return authoring.ErrWorkspaceNotFound
		}
		if err = e.environment.Close(); err != nil {
			return err
		}
		delete(a.environments, id)
	}
	return a.store.Remove(ctx, o, id)
}
func (a *authorBackend) AuthorOperation(ctx context.Context, meta *session.Meta, id, operation string, args map[string]any) (any, error) {
	ctx, o, err := a.context(ctx, meta)
	if err != nil {
		return nil, err
	}
	if operation != "status" {
		if err = a.requireMutation(ctx, false); err != nil {
			return nil, err
		}
	}
	switch operation {
	case "status":
		w, err := a.store.Get(ctx, o, id)
		if err != nil {
			return nil, err
		}
		artifacts, err := a.store.ListArtifacts(ctx, o, id)
		if err != nil {
			return nil, err
		}
		report, err := a.store.BuildReport(ctx, o, id)
		return map[string]any{"workspace": w, "artifacts": artifacts, "build": report}, err
	case "initialize":
		pluginID, _ := args["plugin_id"].(string)
		name, _ := args["display_name"].(string)
		template, _ := args["template"].(string)
		return a.store.Initialize(ctx, o, id, pluginID, name, template)
	case "build":
		artifact, failure := a.store.Build(ctx, o, id, authorproject.PipelineOptions{Generate: true, Test: true})
		report, reportError := a.store.BuildReport(ctx, o, id)
		if reportError != nil {
			return nil, errors.Join(failure, reportError)
		}
		if report == nil {
			return nil, failure
		}
		return map[string]any{"artifact": artifact, "build": report}, nil
	case "capture":
		return a.store.Capture(ctx, o, id)
	default:
		return nil, plugincreation.ErrInvalid
	}
}
func (a *authorBackend) environment(ctx context.Context, o authoring.Owner, id string, meta *session.Meta) (*authoring.Environment, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if existing, ok := a.environments[id]; ok {
		if existing.owner != o {
			return nil, authoring.ErrWorkspaceNotFound
		}
		if _, err := existing.sessions.resolver.ResolveSession(ctx, meta.ChannelID); err != nil {
			return nil, err
		}
		return existing.environment, nil
	}
	var sessions *sessionAdapter
	env, err := a.store.OpenEnvironment(ctx, o, id, authoring.EnvironmentOptions{Router: a.router, Guard: a.sessions, Configure: func(ctx context.Context, root string) (host.Config, func() error, error) {
		config, resolved, cleanup, err := buildHostAdapters(ctx, root, a.options, false)
		if err != nil {
			return config, nil, err
		}
		sessions = resolved
		config.Core.Policy = authorPreviewPolicy{resolved}
		if _, err = resolved.resolver.ResolveSession(ctx, meta.ChannelID); err != nil {
			return config, cleanup, err
		}
		return config, cleanup, nil
	}})
	if err != nil {
		return nil, err
	}
	a.environments[id] = authorEnvironment{env, sessions, o}
	return env, nil
}
func (a *authorBackend) Close() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out error
	for id, e := range a.environments {
		out = errors.Join(out, e.environment.Close())
		delete(a.environments, id)
	}
	return errors.Join(out, a.store.Close())
}
func (a *authorBackend) closeSession(ctx context.Context, s sessionctx.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out error
	for _, e := range a.environments {
		if e.owner.User == s.OwnerUserHash && e.owner.Environment == s.OwnerEnvHash {
			out = errors.Join(out, e.environment.CloseSession(ctx, s))
		}
	}
	return out
}

func authorJSON(w http.ResponseWriter, data any, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, host.ErrInspectedInstallNotFound) || errors.Is(err, plugincreation.ErrNotFound) || errors.Is(err, authoring.ErrWorkspaceNotFound) || errors.Is(err, authoring.ErrArtifactNotFound) {
			status = 404
		}
		if errors.Is(err, errAuthorPermission) {
			status = http.StatusForbidden
		}
		if errors.Is(err, plugincreation.ErrInvalid) {
			status = 400
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]string{"code": authorErrorCode(err), "message": err.Error(), "mutation_outcome": string(mutation.ForError(err))}})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}
func authorErrorCode(err error) string {
	if errors.Is(err, host.ErrInspectedInstallNotFound) {
		return "execution_not_found"
	}
	switch {
	case errors.Is(err, errAuthorPermission), errors.Is(err, sessionctx.ErrSessionRequired):
		return "plugin_author_permission_denied"
	case errors.Is(err, plugincreation.ErrConflict), errors.Is(err, authoring.ErrWorkspaceConflict):
		return "plugin_author_conflict"
	case errors.Is(err, plugincreation.ErrDeleting):
		return "plugin_author_deleting"
	case errors.Is(err, plugincreation.ErrNotFound), errors.Is(err, authoring.ErrWorkspaceNotFound), errors.Is(err, authoring.ErrArtifactNotFound):
		return "plugin_author_not_found"
	default:
		return "plugin_author_request_failed"
	}
}
func decodeAuthorRequest(r *http.Request, out any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 16385))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return plugincreation.ErrInvalid
	}
	return nil
}
func rewriteAuthorRequest(r *http.Request, path string, body any) (*http.Request, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	clone := r.Clone(r.Context())
	u := *r.URL
	u.Path = path
	u.RawPath = ""
	u.RawQuery = ""
	clone.URL = &u
	clone.Method = http.MethodPost
	clone.Body = io.NopCloser(bytes.NewReader(raw))
	clone.ContentLength = int64(len(raw))
	clone.Header = clone.Header.Clone()
	clone.Header.Set("Content-Type", "application/json")
	return clone, nil
}
func (a *authorBackend) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, authorPrefix) {
		a.platform.ServeHTTP(w, r)
		return
	}
	s, err := a.sessions.Authenticate(r)
	if err != nil {
		http.Error(w, "session required", 401)
		return
	}
	if err = a.sessions.ValidateOrigin(r, s, websecurity.OriginPolicyTrustedHost); err != nil {
		http.Error(w, "origin denied", 403)
		return
	}
	csrf := websecurity.CSRFPolicyRequired
	if r.Method == http.MethodGet {
		csrf = websecurity.CSRFPolicyNotRequired
	}
	if err = a.sessions.ValidateCSRF(r, s, csrf); err != nil {
		http.Error(w, "csrf rejected", 403)
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, authorPrefix), "/", 2)
	if len(parts) != 2 || (r.URL.RawQuery != "" && !strings.HasPrefix(parts[1], "platform/")) {
		authorJSON(w, nil, plugincreation.ErrInvalid)
		return
	}
	id, operation := parts[0], parts[1]
	meta, ok := a.options.ResolveSessionMeta(r.Header.Get(sessionhop.HeaderChannelID))
	if !ok || meta == nil {
		http.Error(w, "session required", 401)
		return
	}
	owner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		authorJSON(w, nil, err)
		return
	}
	d, err := a.drafts.Store.ForWorkspace(r.Context(), owner, id)
	if err != nil {
		authorJSON(w, nil, err)
		return
	}
	ctx, o, err := a.context(r.Context(), meta)
	if err != nil {
		authorJSON(w, nil, err)
		return
	}
	r = r.WithContext(ctx)
	unlock, err := a.drafts.LockDraft(ctx, meta, d.ID)
	if err != nil {
		authorJSON(w, nil, err)
		return
	}
	defer unlock()
	d, err = a.drafts.Store.Get(ctx, owner, d.ID)
	if err != nil || d.Lifecycle != "active" {
		if err == nil {
			err = plugincreation.ErrDeleting
		}
		authorJSON(w, nil, err)
		return
	}
	// A live Surface keeps the canonical SDK path and platform authorization. The
	// product route selects only the isolated Host belonging to this exact draft.
	if strings.HasPrefix(operation, "platform/") {
		if d.Lifecycle != "active" {
			authorJSON(w, nil, plugincreation.ErrDeleting)
			return
		}
		canonical := "/" + strings.TrimPrefix(operation, "platform/")
		if !isReDevPluginManagementPath(canonical) {
			authorJSON(w, nil, plugincreation.ErrInvalid)
			return
		}
		env, err := a.environment(ctx, o, id, meta)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		clone := r.Clone(ctx)
		u := *r.URL
		u.Path = canonical
		u.RawPath = ""
		clone.URL = &u
		unlock()
		env.Handler().ServeHTTP(w, clone)
		return
	}
	if operation == "status" && r.Method == http.MethodGet {
		if d.Lifecycle != "active" {
			authorJSON(w, nil, plugincreation.ErrDeleting)
			return
		}

		artifacts, err := a.store.ListArtifacts(ctx, o, id)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		report, err := a.store.BuildReport(ctx, o, id)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		var preview authoring.PreviewState
		if len(artifacts) > 0 {
			env, failure := a.environment(ctx, o, id, meta)
			if failure != nil {
				authorJSON(w, nil, failure)
				return
			}
			preview = env.Snapshot()
		}
		authorJSON(w, map[string]any{"artifacts": artifacts, "preview": preview, "build": report}, nil)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err = a.requireMutation(ctx, operation == "inspect" || operation == "install"); err != nil {
		authorJSON(w, nil, err)
		return
	}
	switch operation {
	case "apply", "inspect":
		var request struct {
			ArtifactID string `json:"artifact_id"`
		}
		if err = decodeAuthorRequest(r, &request); err != nil {
			authorJSON(w, nil, err)
			return
		}
		env, err := a.environment(ctx, o, id, meta)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		if operation == "apply" {
			err = env.Apply(ctx, request.ArtifactID)
			if err != nil {
				authorJSON(w, nil, err)
				return
			}
			artifacts, err := a.store.ListArtifacts(ctx, o, id)
			if err != nil {
				authorJSON(w, nil, err)
				return
			}
			report, err := a.store.BuildReport(ctx, o, id)
			authorJSON(w, map[string]any{"artifacts": artifacts, "preview": env.Snapshot(), "build": report}, err)
			return
		}
		if env.Snapshot().ArtifactID != request.ArtifactID {
			authorJSON(w, nil, plugincreation.ErrConflict)
			return
		}
		intent := host.ExternalPackageIntent{Action: "install"}
		if d.InstallRequestID != "" {
			previous, failure := a.host.GetInspectedInstall(ctx, d.InstallRequestID)
			if failure != nil && !errors.Is(failure, host.ErrInspectedInstallNotFound) {
				authorJSON(w, nil, failure)
				return
			}
			if failure == nil {
				if previous.MutationOutcome == mutation.OutcomeUnknown {
					authorJSON(w, nil, plugincreation.ErrConflict)
					return
				}
				if previous.MutationOutcome == mutation.OutcomeCommitted {
					d, failure = a.drafts.Store.RecordInstalled(ctx, owner, d.ID, previous.RequestID, previous.Execution.PluginInstanceID)
					if failure != nil {
						authorJSON(w, nil, failure)
						return
					}
				}
			}
		}
		if d.InstalledPluginID != "" {
			records, failure := a.host.ListPlugins(ctx)
			if failure != nil {
				authorJSON(w, nil, failure)
				return
			}
			for _, record := range records {
				if record.PluginInstanceID == d.InstalledPluginID {
					intent = host.ExternalPackageIntent{Action: "update", PluginInstanceID: record.PluginInstanceID, ExpectedManagementRevision: record.ManagementRevision}
					break
				}
			}
		}
		result, err := a.store.InspectArtifact(ctx, o, id, request.ArtifactID, a.host, intent)
		authorJSON(w, result, err)
	case "install":
		var request struct {
			ArtifactID   string `json:"artifact_id"`
			InspectionID string `json:"inspection_id"`
			RequestID    string `json:"request_id"`
			Revision     int64  `json:"revision"`
		}
		if err = decodeAuthorRequest(r, &request); err != nil {
			authorJSON(w, nil, err)
			return
		}
		if request.RequestID != d.InstallRequestID && d.InstallRequestID != "" {
			previous, failure := a.host.GetInspectedInstall(ctx, d.InstallRequestID)
			// A failed query is not evidence of absence. Keep the original
			// request until the platform proves completion or no commit.
			if failure != nil && !errors.Is(failure, host.ErrInspectedInstallNotFound) {
				authorJSON(w, nil, failure)
				return
			}
			if failure == nil && previous.MutationOutcome != mutation.OutcomeCommitted && previous.MutationOutcome != mutation.OutcomeNotCommitted {
				authorJSON(w, nil, plugincreation.ErrConflict)
				return
			}
		}
		if request.RequestID != d.InstallRequestID {
			env, failure := a.environment(ctx, o, id, meta)
			if failure != nil {
				authorJSON(w, nil, failure)
				return
			}
			if env.Snapshot().ArtifactID != request.ArtifactID {
				authorJSON(w, nil, plugincreation.ErrConflict)
				return
			}
		}
		d, err = a.drafts.Store.BindInstall(ctx, owner, d.ID, request.Revision, request.RequestID, request.ArtifactID, request.InspectionID)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		artifact, _, err := a.store.ReadArtifact(ctx, o, id, request.ArtifactID)
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		forwarded, err := rewriteAuthorRequest(r, "/_redevplugin/api/plugins/external-packages/install-operations", host.StartInspectedInstallRequest{RequestID: request.RequestID, InspectionID: request.InspectionID, ExpectedPackageSHA256: artifact.PackageSHA256})
		if err != nil {
			authorJSON(w, nil, err)
			return
		}
		a.platform.ServeHTTP(w, forwarded)
	case "installation":
		var request struct {
			RequestID string `json:"request_id"`
		}
		if err = decodeAuthorRequest(r, &request); err != nil {
			authorJSON(w, nil, err)
			return
		}
		if request.RequestID == "" || request.RequestID != d.InstallRequestID {
			authorJSON(w, nil, plugincreation.ErrNotFound)
			return
		}
		result, err := a.host.GetInspectedInstall(ctx, request.RequestID)
		if err == nil && result.MutationOutcome == mutation.OutcomeCommitted {
			_, err = a.drafts.Store.RecordInstalled(ctx, owner, d.ID, request.RequestID, result.Execution.PluginInstanceID)
		}
		authorJSON(w, result, err)
	default:
		authorJSON(w, nil, plugincreation.ErrInvalid)
	}
}

// Developer code runs in its isolated author Host. Formal installation retains
// ordinary external-package review and explicit permission boundaries.
type authorPreviewPolicy struct{ *sessionAdapter }

func (p authorPreviewPolicy) DeveloperModeEnabled(_ context.Context, s sessionctx.Context) (bool, error) {
	v, ok := p.resolver.cache.Get(s)
	return ok && v.permissions.read && v.permissions.write && v.permissions.execute, nil
}
func (p authorPreviewPolicy) LocalGeneratedPluginsEnabled(ctx context.Context, s sessionctx.Context) (bool, error) {
	return p.DeveloperModeEnabled(ctx, s)
}
