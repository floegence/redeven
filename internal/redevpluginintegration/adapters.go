package redevpluginintegration

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/httpadapter"
	"github.com/floegence/redevplugin/pkg/manifest"
	"github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/operation"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/stream"
	"github.com/floegence/redevplugin/pkg/websecurity"
)

const (
	csrfHeader            = "X-ReDevPlugin-CSRF"
	legacyCSRFHeader      = "X-CSRF-Token"
	defaultStoreWait      = 2 * time.Second
	defaultStorePoll      = 10 * time.Millisecond
	pluginAuditAction     = "plugin_platform_event"
	pluginDiagScope       = "plugin-platform"
	pluginDiagKind        = "redevplugin"
	redevpluginRuntimeDir = "redevplugin"
)

type pluginHTTPHandler struct {
	next     http.Handler
	resolver *sessionResolver
}

func (h pluginHTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.resolver != nil && routeRoleFromRequest(r) == RouteRoleEnvTrusted {
		if sessionCtx, err := h.resolver.ResolveRequest(r.Context(), r); err == nil {
			next := r.Clone(r.Context())
			next.Header = r.Header.Clone()
			if strings.TrimSpace(next.Header.Get(httpadapter.OwnerSessionHashHeader)) == "" {
				next.Header.Set(httpadapter.OwnerSessionHashHeader, sessionCtx.SessionChannelIDHash)
			}
			r = next
		}
	}
	h.next.ServeHTTP(w, r)
}

type sessionPermissionCache struct {
	mu       sync.RWMutex
	sessions map[string]sessionctx.Context
}

func newSessionPermissionCache() *sessionPermissionCache {
	return &sessionPermissionCache{sessions: map[string]sessionctx.Context{}}
}

func (c *sessionPermissionCache) Put(ctx sessionctx.Context) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(ctx.SessionChannelIDHash) != "" {
		c.sessions[ctx.SessionChannelIDHash] = ctx
	}
}

func (c *sessionPermissionCache) Get(sessionHash string) (sessionctx.Context, bool) {
	if c == nil {
		return sessionctx.Context{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	ctx, ok := c.sessions[strings.TrimSpace(sessionHash)]
	return ctx, ok
}

type sessionResolver struct {
	resolve    func(channelID string) (*session.Meta, bool)
	configPath string
	cache      *sessionPermissionCache
}

func (r *sessionResolver) ResolveSession(_ context.Context, channelID string) (sessionctx.Context, error) {
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return sessionctx.Context{}, errors.New("channel_id is required")
	}
	if r == nil || r.resolve == nil {
		return sessionctx.Context{}, errors.New("session resolver is not configured")
	}
	meta, ok := r.resolve(channelID)
	if !ok || meta == nil {
		return sessionctx.Context{}, errors.New("session is not available")
	}
	ctx := r.sessionContextFromMeta(meta)
	r.cache.Put(ctx)
	return ctx, nil
}

func (r *sessionResolver) ResolveRequest(ctx context.Context, req *http.Request) (sessionctx.Context, error) {
	channelID, err := channelIDFromPluginRequest(req)
	if err != nil {
		return sessionctx.Context{}, err
	}
	return r.ResolveSession(ctx, channelID)
}

func (r *sessionResolver) sessionContextFromMeta(meta *session.Meta) sessionctx.Context {
	cap := config.PermissionSet{Read: true, Write: true, Execute: true}
	if r != nil {
		cap = config.ResolvePermissionCapFromConfigPath(r.configPath, meta.UserPublicID, meta.FloeApp, cap)
	}
	return sessionctx.Context{
		SessionChannelIDHash: hashID("session", meta.ChannelID),
		OwnerUserHash:        hashID("user", meta.UserPublicID),
		OwnerEnvHash:         hashID("env", meta.EndpointID),
		CSRFGeneration:       hashID("csrf", meta.ChannelID+"|"+meta.UserPublicID+"|"+meta.EndpointID),
		Permissions: sessionctx.PermissionSet{
			Read:    meta.CanRead && cap.Read,
			Write:   meta.CanWrite && cap.Write,
			Execute: meta.CanExecute && cap.Execute,
			Admin:   meta.CanAdmin,
		},
	}
}

type policyAdapter struct {
	sessions *sessionPermissionCache
}

func (p *policyAdapter) EvaluateLocalPolicy(_ context.Context, session sessionctx.Context, _ host.PluginRef, method manifest.MethodSpec) (host.PolicyDecision, error) {
	resolved := session
	if strings.TrimSpace(resolved.SessionChannelIDHash) != "" {
		if cached, ok := p.sessions.Get(resolved.SessionChannelIDHash); ok {
			resolved = cached
		}
	}
	if permissionAllowsEffect(resolved.Permissions, method.Effect) {
		return host.PolicyAllow, nil
	}
	return host.PolicyDeny, nil
}

func (p *policyAdapter) DeveloperModeEnabled(context.Context, sessionctx.Context) (bool, error) {
	return false, nil
}

func (p *policyAdapter) LocalGeneratedPluginsEnabled(context.Context, sessionctx.Context) (bool, error) {
	return false, nil
}

func permissionAllowsEffect(perms sessionctx.PermissionSet, effect manifest.MethodEffect) bool {
	switch effect {
	case manifest.MethodEffectRead:
		return perms.Read
	case manifest.MethodEffectWrite:
		return perms.Write
	case manifest.MethodEffectExecute:
		return perms.Execute
	case manifest.MethodEffectDelete:
		return perms.Write && perms.Execute
	case manifest.MethodEffectAdmin:
		return perms.Admin
	default:
		return false
	}
}

type strictPackageTrustVerifier struct{}

func (strictPackageTrustVerifier) VerifyPackageTrust(_ context.Context, req host.PackageTrustVerificationRequest) (host.PackageTrustVerificationResult, error) {
	switch req.RequestedTrustState {
	case registry.TrustBundled, registry.TrustVerified:
		return host.PackageTrustVerificationResult{
			TrustState: registry.TrustNeedsReview,
			Metadata: map[string]string{
				"redeven.trust.reason": "published_signature_verifier_not_configured",
			},
		}, nil
	case registry.TrustUnsignedLocal, registry.TrustUntrusted, registry.TrustNeedsReview, registry.TrustBlockedSecurity:
		return host.PackageTrustVerificationResult{TrustState: req.RequestedTrustState}, nil
	case "":
		return host.PackageTrustVerificationResult{TrustState: registry.TrustUntrusted}, nil
	default:
		return host.PackageTrustVerificationResult{}, fmt.Errorf("unsupported trust_state: %q", req.RequestedTrustState)
	}
}

type runtimeArtifactResolver struct {
	stateRoot string
}

func (r *runtimeArtifactResolver) RuntimePath(_ context.Context, target host.RuntimeTarget) (string, error) {
	goos := strings.TrimSpace(target.OS)
	if goos == "" {
		goos = runtime.GOOS
	}
	goarch := strings.TrimSpace(target.Arch)
	if goarch == "" {
		goarch = runtime.GOARCH
	}
	binaryName := "redevplugin-runtime"
	if goos == "windows" {
		binaryName += ".exe"
	}
	targetDir := goos + "-" + goarch
	var candidates []string
	if strings.TrimSpace(r.stateRoot) != "" {
		candidates = append(candidates,
			filepath.Join(r.stateRoot, ".bundle", targetDir, binaryName),
			filepath.Join(r.stateRoot, redevpluginRuntimeDir, targetDir, binaryName),
		)
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, ".bundle", targetDir, binaryName),
			filepath.Join(exeDir, redevpluginRuntimeDir, targetDir, binaryName),
			filepath.Join(exeDir, binaryName),
		)
	}
	for _, candidate := range candidates {
		if usableExecutable(candidate, goos) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("released redevplugin runtime artifact not found for %s/%s", goos, goarch)
}

func usableExecutable(path string, goos string) bool {
	info, err := os.Stat(path)
	if err != nil || info == nil || info.IsDir() {
		return false
	}
	if goos == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}

type webSecurityGuard struct {
	sessions *sessionPermissionCache
}

func (g webSecurityGuard) Evaluate(r *http.Request) (websecurity.RequestContext, websecurity.OriginDecision, error) {
	ctx := websecurity.RequestContext{Role: websecurity.OriginUnknown}
	if r != nil && r.URL != nil {
		ctx.Origin = strings.TrimSpace(r.Header.Get("Origin"))
		ctx.Route = r.URL.Path
		ctx.Method = r.Method
	}
	role := routeRoleFromRequest(r)
	switch role {
	case RouteRoleEnvTrusted:
		ctx.Role = websecurity.OriginEnvTrusted
	case RouteRolePluginSandbox:
		ctx.Role = websecurity.OriginPluginSandbox
	default:
		return ctx, websecurity.OriginDeny, websecurity.ErrOriginDenied
	}

	switch {
	case isReDevPluginManagementPath(ctx.Route):
		if role == RouteRoleEnvTrusted {
			return ctx, websecurity.OriginAllow, nil
		}
	case isReDevPluginSandboxPath(ctx.Route):
		if role == RouteRolePluginSandbox {
			return ctx, websecurity.OriginAllow, nil
		}
	}
	return ctx, websecurity.OriginDeny, websecurity.ErrOriginDenied
}

func (g webSecurityGuard) ValidateCSRF(r *http.Request, sessionHash string) error {
	sessionHash = strings.TrimSpace(sessionHash)
	if sessionHash == "" {
		return websecurity.ErrCSRFRequired
	}
	token := strings.TrimSpace(r.Header.Get(csrfHeader))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get(legacyCSRFHeader))
	}
	if token == "" {
		return websecurity.ErrCSRFRequired
	}
	session, ok := g.sessions.Get(sessionHash)
	if !ok || strings.TrimSpace(session.CSRFGeneration) == "" {
		return websecurity.ErrCSRFInvalid
	}
	if subtleConstantCompare(token, session.CSRFGeneration) {
		return nil
	}
	return websecurity.ErrCSRFInvalid
}

type observabilityFanout struct {
	primary interface {
		observability.AuditSink
		observability.DiagnosticsSink
		observability.AuditLister
		observability.DiagnosticLister
	}
	audit       *auditlog.Store
	diagnostics *diagnostics.Store
}

func (o *observabilityFanout) AppendPluginAudit(ctx context.Context, event observability.AuditEvent) error {
	var out error
	if o != nil && o.primary != nil {
		out = errors.Join(out, o.primary.AppendPluginAudit(ctx, event))
	}
	if o != nil && o.audit != nil {
		o.audit.Append(auditlog.Entry{
			Action: pluginAuditAction,
			Status: "success",
			Detail: map[string]any{
				"event_type":          event.Type,
				"plugin_id":           event.PluginID,
				"plugin_instance_id":  event.PluginInstanceID,
				"surface_id":          event.SurfaceID,
				"surface_instance_id": event.SurfaceInstanceID,
				"request_id":          event.RequestID,
				"actor":               event.Actor,
				"details":             sanitizePluginDetails(event.Details),
			},
		})
	}
	return out
}

func (o *observabilityFanout) AppendPluginDiagnostic(ctx context.Context, event observability.DiagnosticEvent) error {
	var out error
	if o != nil && o.primary != nil {
		out = errors.Join(out, o.primary.AppendPluginDiagnostic(ctx, event))
	}
	if o != nil && o.diagnostics != nil {
		o.diagnostics.Append(diagnostics.Event{
			Scope:   pluginDiagScope,
			Kind:    pluginDiagKind,
			TraceID: event.RequestID,
			Message: event.Message,
			Detail: map[string]any{
				"event_type":          event.Type,
				"severity":            event.Severity,
				"plugin_id":           event.PluginID,
				"plugin_instance_id":  event.PluginInstanceID,
				"surface_id":          event.SurfaceID,
				"surface_instance_id": event.SurfaceInstanceID,
				"active_fingerprint":  event.ActiveFingerprint,
				"details":             sanitizePluginDetails(event.Details),
			},
		})
	}
	return out
}

func (o *observabilityFanout) ListPluginAudit(ctx context.Context, req observability.ListAuditRequest) ([]observability.AuditEvent, error) {
	if o == nil || o.primary == nil {
		return nil, nil
	}
	return o.primary.ListPluginAudit(ctx, req)
}

func (o *observabilityFanout) ListPluginDiagnostics(ctx context.Context, req observability.ListDiagnosticRequest) ([]observability.DiagnosticEvent, error) {
	if o == nil || o.primary == nil {
		return nil, nil
	}
	return o.primary.ListPluginDiagnostics(ctx, req)
}

type containersCapabilityAdapter struct {
	containers *containers.Adapter
	operations operation.Store
	streams    stream.Store
}

func newContainersCapabilityAdapter(adapter *containers.Adapter, operations operation.Store, streams stream.Store) *containersCapabilityAdapter {
	return &containersCapabilityAdapter{containers: adapter, operations: operations, streams: streams}
}

func (a *containersCapabilityAdapter) InvokeCapability(ctx context.Context, req capability.Invocation) (capability.Result, error) {
	if a == nil || a.containers == nil {
		return capability.Result{}, errors.New("containers capability is not configured")
	}
	method := containers.Method(strings.TrimSpace(req.TargetMethod))
	if method == "" {
		method = containers.Method(strings.TrimSpace(req.Method))
	}
	raw, err := json.Marshal(req.Arguments)
	if err != nil {
		return capability.Result{}, err
	}
	switch method {
	case containers.MethodStart, containers.MethodStop, containers.MethodRestart, containers.MethodRemove, containers.MethodImagesPull:
		operationID := generatedID("op")
		go a.runContainerOperation(operationID, method, raw)
		return capability.Result{OperationID: operationID}, nil
	case containers.MethodLogsTail:
		streamID := generatedID("stream")
		go a.runContainerLogStream(streamID, raw)
		return capability.Result{StreamID: streamID}, nil
	default:
		data, err := a.containers.CallMethod(ctx, method, raw)
		if err != nil {
			return capability.Result{}, err
		}
		return capability.Result{Data: data}, nil
	}
}

func (a *containersCapabilityAdapter) runContainerOperation(operationID string, method containers.Method, raw json.RawMessage) {
	ctx := context.Background()
	if err := a.waitOperationRegistered(ctx, operationID); err != nil {
		return
	}
	_, err := a.containers.CallOperationMethod(ctx, operationID, method, raw)
	status := operation.StatusCompleted
	reason := ""
	if err != nil {
		if errors.Is(err, context.Canceled) {
			status = operation.StatusCanceled
		} else {
			status = operation.StatusFailed
		}
		reason = err.Error()
	}
	_, _ = a.operations.Finish(context.Background(), operation.FinishRequest{
		OperationID: operationID,
		Status:      status,
		Reason:      reason,
	})
}

func (a *containersCapabilityAdapter) runContainerLogStream(streamID string, raw json.RawMessage) {
	ctx := context.Background()
	if err := a.waitStreamRegistered(ctx, streamID); err != nil {
		return
	}
	var req containers.LogsTailRequest
	if err := decodeContainerRequest(raw, &req); err != nil {
		a.closeStream(streamID, stream.StatusCanceled, err.Error())
		return
	}
	if req.Follow {
		err := a.containers.FollowLogs(ctx, req, containers.LogLineSinkFunc(func(ctx context.Context, line containers.LogLine) error {
			return a.appendLogLine(ctx, streamID, line)
		}))
		if err != nil {
			a.closeStream(streamID, stream.StatusCanceled, err.Error())
			return
		}
		a.closeStream(streamID, stream.StatusClosed, "")
		return
	}
	result, err := a.containers.TailLogs(ctx, req)
	if err != nil {
		a.closeStream(streamID, stream.StatusCanceled, err.Error())
		return
	}
	for _, line := range result.Lines {
		if err := a.appendLogLine(ctx, streamID, line); err != nil {
			a.closeStream(streamID, stream.StatusCanceled, err.Error())
			return
		}
	}
	a.closeStream(streamID, stream.StatusClosed, "")
}

func (a *containersCapabilityAdapter) appendLogLine(ctx context.Context, streamID string, line containers.LogLine) error {
	data, err := json.Marshal(line)
	if err != nil {
		return err
	}
	_, err = a.streams.Append(ctx, stream.AppendRequest{
		StreamID: streamID,
		Kind:     "container.log",
		Data:     data,
	})
	return err
}

func (a *containersCapabilityAdapter) closeStream(streamID string, status stream.Status, reason string) {
	_, _ = a.streams.Close(context.Background(), stream.CloseRequest{
		StreamID: streamID,
		Status:   status,
		Reason:   reason,
	})
}

func (a *containersCapabilityAdapter) waitOperationRegistered(ctx context.Context, operationID string) error {
	deadline := time.Now().Add(defaultStoreWait)
	for {
		if _, err := a.operations.Get(ctx, operationID); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return operation.ErrNotFound
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(defaultStorePoll):
		}
	}
}

func (a *containersCapabilityAdapter) waitStreamRegistered(ctx context.Context, streamID string) error {
	deadline := time.Now().Add(defaultStoreWait)
	for {
		if _, err := a.streams.Get(ctx, streamID); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return stream.ErrNotFound
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(defaultStorePoll):
		}
	}
}

type operationCanceler struct {
	containers *containers.Adapter
}

func (c *operationCanceler) RequestOperationCancel(ctx context.Context, req host.OperationCancelAdapterRequest) error {
	if c == nil || c.containers == nil {
		return errors.New("operation cancel adapter is not configured")
	}
	method := containers.Method(strings.TrimSpace(req.Method))
	switch method {
	case containers.MethodStart, containers.MethodStop, containers.MethodRestart, containers.MethodRemove, containers.MethodImagesPull:
		_, err := c.containers.CancelOperation(ctx, containers.ContainerOperationCancelRequest{
			OperationID: req.OperationID,
			Method:      method,
		})
		return err
	default:
		return fmt.Errorf("operation cancel route is not available for method %q", req.Method)
	}
}

func isReDevPluginManagementPath(p string) bool {
	p = strings.TrimSpace(p)
	return p == "/_redevplugin/api/plugins" || strings.HasPrefix(p, "/_redevplugin/api/plugins/")
}

func isReDevPluginSandboxPath(p string) bool {
	p = strings.TrimSpace(p)
	return p == "/_redevplugin/bootstrap" ||
		strings.HasPrefix(p, "/_redevplugin/assets/") ||
		strings.HasPrefix(p, "/_redevplugin/stream/") ||
		p == "/_redevplugin/csp-report"
}

func channelIDFromPluginRequest(r *http.Request) (string, error) {
	if r != nil {
		channelID := strings.TrimSpace(r.Header.Get(sessionhop.HeaderChannelID))
		if channelID != "" {
			return channelID, nil
		}
	}
	_, host, err := externalOriginFromPluginRequest(r)
	if err != nil {
		return "", err
	}
	hostNoPort := strings.TrimSpace(host)
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	parts := strings.Split(hostNoPort, ".")
	if len(parts) < 2 {
		return "", errors.New("missing session origin label")
	}
	chLabel := strings.ToLower(strings.TrimSpace(parts[1]))
	if !strings.HasPrefix(chLabel, "ch-") {
		return "", errors.New("missing channel label")
	}
	enc := strings.TrimSpace(strings.TrimPrefix(chLabel, "ch-"))
	if enc == "" {
		return "", errors.New("invalid channel label")
	}
	dec, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(enc))
	if err != nil {
		return "", errors.New("invalid channel label encoding")
	}
	channelID := strings.TrimSpace(string(dec))
	if channelID == "" {
		return "", errors.New("invalid channel id")
	}
	return channelID, nil
}

func externalOriginFromPluginRequest(r *http.Request) (scheme string, host string, err error) {
	if r == nil {
		return "", "", errors.New("nil request")
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u == nil {
			return "", "", errors.New("invalid origin")
		}
		scheme = strings.ToLower(strings.TrimSpace(u.Scheme))
		host = strings.ToLower(strings.TrimSpace(u.Host))
		if (scheme != "http" && scheme != "https") || host == "" {
			return "", "", errors.New("invalid origin")
		}
		return scheme, host, nil
	}
	scheme = strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	if scheme != "http" && scheme != "https" {
		return "", "", errors.New("invalid origin")
	}
	host = strings.ToLower(strings.TrimSpace(r.Host))
	if host == "" {
		host = strings.ToLower(strings.TrimSpace(r.Header.Get("Host")))
	}
	if host == "" {
		return "", "", errors.New("missing origin")
	}
	return scheme, host, nil
}

func decodeContainerRequest(raw json.RawMessage, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func sanitizePluginDetails(details map[string]any) map[string]any {
	if len(details) == 0 {
		return nil
	}
	out := make(map[string]any, len(details))
	for key, value := range details {
		clean := strings.TrimSpace(key)
		if clean == "" {
			continue
		}
		out[clean] = value
	}
	return out
}

func hashID(namespace string, value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(namespace) + ":" + strings.TrimSpace(value)))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func generatedID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		now := sha256.Sum256([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
		copy(b[:], now[:16])
	}
	return strings.TrimSpace(prefix) + "_" + hex.EncodeToString(b[:])
}

func subtleConstantCompare(a string, b string) bool {
	ab := []byte(strings.TrimSpace(a))
	bb := []byte(strings.TrimSpace(b))
	if len(ab) != len(bb) {
		return false
	}
	var diff byte
	for i := range ab {
		diff |= ab[i] ^ bb[i]
	}
	return diff == 0
}
