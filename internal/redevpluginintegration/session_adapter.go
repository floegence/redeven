package redevpluginintegration

import (
	"container/list"
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/manifest"
	"github.com/floegence/redevplugin/pkg/sessionctx"
)

type sessionPermissions struct {
	read    bool
	write   bool
	execute bool
	admin   bool
}

// sessionAdapter is the single authenticated-session boundary shared by the
// embeddable Host and its HTTP adapter. Identity is resolved from Redeven's
// authenticated channel and never accepted from plugin or HTTP payloads.
type sessionAdapter struct {
	resolver      *sessionResolver
	policy        policyAdapter
	authorization authorizationAdapter
	webSecurity   webSecurityGuard
}

func newSessionAdapter(resolve func(channelID string) (*session.Meta, bool), permissionPolicy *config.PermissionPolicy) (*sessionAdapter, error) {
	if resolve == nil {
		return nil, errors.New("session resolver is required")
	}
	if permissionPolicy == nil {
		return nil, errors.New("permission policy is required")
	}
	permissionPolicy = clonePermissionPolicy(permissionPolicy)
	if err := permissionPolicy.Validate(); err != nil {
		return nil, err
	}
	cache := newSessionPermissionCache()
	resolver := &sessionResolver{
		resolve:          resolve,
		permissionPolicy: permissionPolicy,
		cache:            cache,
	}
	return &sessionAdapter{
		resolver:      resolver,
		policy:        policyAdapter{sessions: cache},
		authorization: authorizationAdapter{sessions: cache},
		webSecurity: webSecurityGuard{
			resolver: resolver,
			sessions: cache,
		},
	}, nil
}

func clonePermissionPolicy(source *config.PermissionPolicy) *config.PermissionPolicy {
	if source == nil {
		return nil
	}
	cloneSet := func(value *config.PermissionSet) *config.PermissionSet {
		if value == nil {
			return nil
		}
		copy := *value
		return &copy
	}
	cloneMap := func(values map[string]*config.PermissionSet) map[string]*config.PermissionSet {
		if values == nil {
			return nil
		}
		copy := make(map[string]*config.PermissionSet, len(values))
		for key, value := range values {
			copy[key] = cloneSet(value)
		}
		return copy
	}
	return &config.PermissionPolicy{
		SchemaVersion: source.SchemaVersion,
		LocalMax:      cloneSet(source.LocalMax),
		ByUser:        cloneMap(source.ByUser),
		ByApp:         cloneMap(source.ByApp),
	}
}

func (a *sessionAdapter) EvaluateLocalPolicy(ctx context.Context, session sessionctx.Context, plugin host.PluginRef, method manifest.MethodSpec) (host.PolicyDecision, error) {
	if a == nil {
		return host.PolicyDeny, errors.New("session adapter is not configured")
	}
	return a.policy.EvaluateLocalPolicy(ctx, session, plugin, method)
}

func (a *sessionAdapter) DeveloperModeEnabled(ctx context.Context, session sessionctx.Context) (bool, error) {
	if a == nil {
		return false, errors.New("session adapter is not configured")
	}
	return a.policy.DeveloperModeEnabled(ctx, session)
}

func (a *sessionAdapter) LocalGeneratedPluginsEnabled(ctx context.Context, session sessionctx.Context) (bool, error) {
	if a == nil {
		return false, errors.New("session adapter is not configured")
	}
	return a.policy.LocalGeneratedPluginsEnabled(ctx, session)
}

func (a *sessionAdapter) Authorize(ctx context.Context, req host.AuthorizationRequest) error {
	if a == nil {
		return errors.New("session adapter is not configured")
	}
	return a.authorization.Authorize(ctx, req)
}

type resolvedSession struct {
	context     sessionctx.Context
	permissions sessionPermissions
}

type sessionPermissionCache struct {
	mu       sync.Mutex
	sessions map[string]*list.Element
	recency  *list.List
	max      int
}

type sessionPermissionCacheEntry struct {
	ownerSessionHash string
	resolved         resolvedSession
}

const maxCachedPluginSessions = 1024

func newSessionPermissionCache() *sessionPermissionCache {
	return &sessionPermissionCache{
		sessions: map[string]*list.Element{},
		recency:  list.New(),
		max:      maxCachedPluginSessions,
	}
}

func (c *sessionPermissionCache) Put(value resolvedSession) {
	if c == nil || !value.context.Valid() {
		return
	}
	c.mu.Lock()
	if existing := c.sessions[value.context.OwnerSessionHash]; existing != nil {
		existing.Value.(*sessionPermissionCacheEntry).resolved = value
		c.recency.MoveToFront(existing)
		c.mu.Unlock()
		return
	}
	element := c.recency.PushFront(&sessionPermissionCacheEntry{
		ownerSessionHash: value.context.OwnerSessionHash,
		resolved:         value,
	})
	c.sessions[value.context.OwnerSessionHash] = element
	if c.recency.Len() > c.max {
		oldest := c.recency.Back()
		entry := oldest.Value.(*sessionPermissionCacheEntry)
		delete(c.sessions, entry.ownerSessionHash)
		c.recency.Remove(oldest)
	}
	c.mu.Unlock()
}

func (c *sessionPermissionCache) Get(session sessionctx.Context) (resolvedSession, bool) {
	if c == nil || !session.Valid() {
		return resolvedSession{}, false
	}
	c.mu.Lock()
	element := c.sessions[session.OwnerSessionHash]
	if element == nil {
		c.mu.Unlock()
		return resolvedSession{}, false
	}
	entry := element.Value.(*sessionPermissionCacheEntry)
	if entry.resolved.context != session {
		c.mu.Unlock()
		return resolvedSession{}, false
	}
	c.recency.MoveToFront(element)
	resolved := entry.resolved
	c.mu.Unlock()
	return resolved, true
}

type sessionResolver struct {
	resolve          func(channelID string) (*session.Meta, bool)
	permissionPolicy *config.PermissionPolicy
	cache            *sessionPermissionCache
}

func (r *sessionResolver) ResolveSession(_ context.Context, channelID string) (sessionctx.Context, error) {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return sessionctx.Context{}, errors.New("channel_id is required")
	}
	if r == nil || r.resolve == nil || r.cache == nil {
		return sessionctx.Context{}, errors.New("session resolver is not configured")
	}
	meta, ok := r.resolve(channelID)
	if !ok || meta == nil {
		return sessionctx.Context{}, errors.New("session is not available")
	}
	resolved, err := r.resolvedSessionFromMeta(channelID, meta)
	if err != nil {
		return sessionctx.Context{}, err
	}
	if !resolved.context.Valid() {
		return sessionctx.Context{}, sessionctx.ErrSessionRequired
	}
	r.cache.Put(resolved)
	return resolved.context, nil
}

func (r *sessionResolver) ResolveRequest(ctx context.Context, req *http.Request) (sessionctx.Context, error) {
	if req == nil || routeRoleFromRequest(req) != RouteRoleEnvTrusted {
		return sessionctx.Context{}, sessionctx.ErrSessionRequired
	}
	channelID := strings.TrimSpace(req.Header.Get(sessionhop.HeaderChannelID))
	if channelID == "" {
		return sessionctx.Context{}, errors.New("authenticated channel header is required")
	}
	return r.ResolveSession(ctx, channelID)
}

func (r *sessionResolver) resolvedSessionFromMeta(expectedChannelID string, meta *session.Meta) (resolvedSession, error) {
	if r == nil || r.permissionPolicy == nil || meta == nil {
		return resolvedSession{}, sessionctx.ErrSessionRequired
	}
	expectedChannelID = strings.TrimSpace(expectedChannelID)
	channelID := strings.TrimSpace(meta.ChannelID)
	userID := strings.TrimSpace(meta.UserPublicID)
	environmentID := strings.TrimSpace(meta.EndpointID)
	if expectedChannelID == "" || channelID == "" || userID == "" || environmentID == "" ||
		channelID != expectedChannelID || channelID != meta.ChannelID || userID != meta.UserPublicID || environmentID != meta.EndpointID {
		return resolvedSession{}, sessionctx.ErrSessionRequired
	}
	cap := r.permissionPolicy.ResolveCap(userID, meta.FloeApp)
	return resolvedSession{
		context: sessionctx.Context{
			OwnerSessionHash:     hashID("session", channelID),
			OwnerUserHash:        hashID("user", userID),
			OwnerEnvHash:         hashID("env", environmentID),
			SessionChannelIDHash: hashID("channel", channelID),
		},
		permissions: sessionPermissions{
			read:    meta.CanRead && cap.Read,
			write:   meta.CanWrite && cap.Write,
			execute: meta.CanExecute && cap.Execute,
			admin:   meta.CanAdmin,
		},
	}, nil
}

type policyAdapter struct {
	sessions *sessionPermissionCache
}

func (p *policyAdapter) EvaluateLocalPolicy(_ context.Context, session sessionctx.Context, _ host.PluginRef, method manifest.MethodSpec) (host.PolicyDecision, error) {
	resolved, ok := p.sessions.Get(session)
	if !ok || !permissionAllowsEffect(resolved.permissions, method.Effect) {
		return host.PolicyDeny, nil
	}
	return host.PolicyAllow, nil
}

func (p *policyAdapter) DeveloperModeEnabled(context.Context, sessionctx.Context) (bool, error) {
	return false, nil
}

func (p *policyAdapter) LocalGeneratedPluginsEnabled(context.Context, sessionctx.Context) (bool, error) {
	return false, nil
}

func permissionAllowsEffect(perms sessionPermissions, effect manifest.MethodEffect) bool {
	switch effect {
	case manifest.MethodEffectRead:
		return perms.read
	case manifest.MethodEffectWrite:
		return perms.write
	case manifest.MethodEffectExecute:
		return perms.execute
	case manifest.MethodEffectDelete:
		return perms.write && perms.execute
	case manifest.MethodEffectAdmin:
		return perms.admin
	default:
		return false
	}
}

type authorizationAdapter struct {
	sessions *sessionPermissionCache
}

func (a *authorizationAdapter) Authorize(_ context.Context, req host.AuthorizationRequest) error {
	if !req.Session.Valid() || !req.Action.Valid() || !req.Target.Kind.Valid() || req.Target.Kind != req.Action.Resource() {
		return host.ErrActionDenied
	}
	if !authorizationTargetMatchesSession(req.Session, req.Target) {
		return host.ErrActionDenied
	}
	for _, target := range req.RelatedTargets {
		if !target.Kind.Valid() || !authorizationTargetMatchesSession(req.Session, target) {
			return host.ErrActionDenied
		}
	}
	resolved, ok := a.sessions.Get(req.Session)
	if !ok || !permissionsAllowAction(resolved.permissions, req.Action) {
		return host.ErrActionDenied
	}
	return nil
}

func authorizationTargetMatchesSession(session sessionctx.Context, target host.AuthorizationTarget) bool {
	if target.Scope == nil {
		return true
	}
	if err := target.Scope.Validate(); err != nil || target.Scope.OwnerEnvHash != session.OwnerEnvHash {
		return false
	}
	return target.Scope.Kind != sessionctx.ScopeUser || target.Scope.OwnerUserHash == session.OwnerUserHash
}

func permissionsAllowAction(perms sessionPermissions, action host.ManagementAction) bool {
	dataPlane := perms.read || perms.write || perms.execute || perms.admin
	switch action {
	case host.ManagementActionOpenSurface,
		host.ManagementActionRevokeSessionScope,
		host.ManagementActionFinalizeSessionScope,
		host.ManagementActionPrepareSurface,
		host.ManagementActionMintBridgeToken,
		host.ManagementActionDisposeSurface,
		host.ManagementActionReadSurfaceAsset,
		host.ManagementActionReadSurfaceStream,
		host.ManagementActionAcknowledgeSurfaceStream,
		host.ManagementActionListIntents,
		host.ManagementActionListPlugins,
		host.ManagementActionQueryExternalPackageCommit,
		host.ManagementActionListFeatures,
		host.ManagementActionGetCompatibility,
		host.ManagementActionListPermissionGrants,
		host.ManagementActionGetPermissionRequirements,
		host.ManagementActionGetSecurityPolicy,
		host.ManagementActionListSecurityPolicies,
		host.ManagementActionListDiagnosticEvents,
		host.ManagementActionListOperations,
		host.ManagementActionGetOperation,
		host.ManagementActionGetRuntimeHealth,
		host.ManagementActionListRetainedData,
		host.ManagementActionGetSettingsSchema,
		host.ManagementActionGetPluginSettings:
		return perms.read
	case host.ManagementActionCallPluginMethod,
		host.ManagementActionPrepareMethodConfirmation,
		host.ManagementActionRejectSurfaceConfirmation,
		host.ManagementActionInvokeIntent,
		host.ManagementActionCancelSurfaceOperation,
		host.ManagementActionCancelOperation:
		return dataPlane
	case host.ManagementActionMintConnectionGrant,
		host.ManagementActionMintNetworkHandleGrant,
		host.ManagementActionMintStorageHandleGrant:
		return perms.execute
	case host.ManagementActionDeleteRetainedData,
		host.ManagementActionBindRetainedData,
		host.ManagementActionCleanupExpiredRetainedData,
		host.ManagementActionExportPluginData,
		host.ManagementActionDeleteExportedPluginData,
		host.ManagementActionImportPluginData,
		host.ManagementActionPatchPluginSettings:
		return perms.write
	case host.ManagementActionImportLocalPackage,
		host.ManagementActionInstallReleaseRef,
		host.ManagementActionInspectExternalPackage,
		host.ManagementActionCommitExternalPackage,
		host.ManagementActionUpdateLocalPackage,
		host.ManagementActionUpdateReleaseRef,
		host.ManagementActionDowngradePlugin,
		host.ManagementActionEnablePlugin,
		host.ManagementActionDisablePlugin,
		host.ManagementActionUninstallPlugin,
		host.ManagementActionGrantPermission,
		host.ManagementActionRevokePermission,
		host.ManagementActionPutSecurityPolicy,
		host.ManagementActionDeleteSecurityPolicy,
		host.ManagementActionBindSecretRef,
		host.ManagementActionTestSecretRef,
		host.ManagementActionDeleteSecretRef,
		host.ManagementActionStartRuntime,
		host.ManagementActionStopRuntime,
		host.ManagementActionRefreshEnabledPlugins:
		return perms.admin
	default:
		return false
	}
}
