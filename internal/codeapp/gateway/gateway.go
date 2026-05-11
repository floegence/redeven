package gateway

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/codeapp/codeserver"
	"github.com/floegence/redeven/internal/codexbridge"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/notes"
	"github.com/floegence/redeven/internal/pathutil"
	"github.com/floegence/redeven/internal/portforward"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/settings"
	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/threadreadstate"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

type Options struct {
	Logger                  *slog.Logger
	ListenAddr              string
	DistFS                  fs.FS
	Backend                 Backend
	PortForward             PortForwardBackend
	AI                      *ai.Service
	Notes                   *notes.Service
	WorkbenchLayout         *workbenchlayout.Service
	Terminal                *terminal.Manager
	Codex                   CodexBackend
	Audit                   *auditlog.Store
	Diagnostics             *diagnostics.Store
	ResolveSessionMeta      func(channelID string) (*session.Meta, bool)
	ResolveSessionTunnelURL func(channelID string) (string, bool)
	// ConfigPath is the absolute path to the runtime config file.
	// It is used to read and persist settings updates initiated from the Env App UI.
	ConfigPath string
	// SecretsStore holds user-managed secrets (such as AI provider API keys).
	// If nil, the gateway will derive a default secrets path from ConfigPath.
	SecretsStore *settings.SecretsStore
	// ThreadReadStateStore persists per-user per-surface thread read watermarks.
	ThreadReadStateStore *threadreadstate.Store
	// AgentHomeDir is the canonical absolute path to the agent home directory,
	// used as the filesystem scope root for the file-serving endpoint.
	AgentHomeDir string
}

type Backend interface {
	ListSpaces(ctx context.Context) ([]SpaceStatus, error)
	CreateSpace(ctx context.Context, req CreateSpaceRequest) (*SpaceStatus, error)
	UpdateSpace(ctx context.Context, codeSpaceID string, req UpdateSpaceRequest) (*SpaceStatus, error)
	DeleteSpace(ctx context.Context, codeSpaceID string) error
	StartSpace(ctx context.Context, codeSpaceID string) (*SpaceStatus, error)
	StopSpace(ctx context.Context, codeSpaceID string) error
	ResolveCodeServerPort(ctx context.Context, codeSpaceID string) (int, error)
	CodeRuntimeStatus(ctx context.Context) (CodeRuntimeStatus, error)
	InstallCodeRuntime(ctx context.Context) (CodeRuntimeStatus, error)
	SelectCodeRuntimeVersion(ctx context.Context, version string) (CodeRuntimeStatus, error)
	RemoveCodeRuntimeVersion(ctx context.Context, version string) (CodeRuntimeStatus, error)
	CancelCodeRuntimeOperation(ctx context.Context) (CodeRuntimeStatus, error)
}

type PortForwardBackend interface {
	ListForwards(ctx context.Context) ([]pfregistry.Forward, error)
	GetForward(ctx context.Context, forwardID string) (*pfregistry.Forward, error)
	CreateForward(ctx context.Context, req portforward.CreateForwardRequest) (*pfregistry.Forward, error)
	UpdateForward(ctx context.Context, forwardID string, req portforward.UpdateForwardRequest) (*pfregistry.Forward, error)
	DeleteForward(ctx context.Context, forwardID string) error
	TouchLastOpened(ctx context.Context, forwardID string) (*pfregistry.Forward, error)
}

type CodexBackend interface {
	Status(ctx context.Context) codexbridge.Status
	ReadCapabilities(ctx context.Context, cwd string) (*codexbridge.Capabilities, error)
	ListThreads(ctx context.Context, req codexbridge.ListThreadsRequest) ([]codexbridge.Thread, error)
	ReadThread(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error)
	StartThread(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.ThreadDetail, error)
	StartTurn(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error)
	SteerTurn(ctx context.Context, req codexbridge.SteerTurnRequest) (*codexbridge.Turn, error)
	ArchiveThread(ctx context.Context, threadID string) error
	UnarchiveThread(ctx context.Context, threadID string) error
	ForkThread(ctx context.Context, req codexbridge.ForkThreadRequest) (*codexbridge.ThreadDetail, error)
	InterruptTurn(ctx context.Context, req codexbridge.InterruptTurnRequest) error
	StartReview(ctx context.Context, req codexbridge.StartReviewRequest) (*codexbridge.ThreadDetail, error)
	SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error)
	RespondToRequest(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error
}

const codexEventBatchWindow = 16 * time.Millisecond

type SpaceStatus struct {
	CodeSpaceID        string `json:"code_space_id"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	WorkspacePath      string `json:"workspace_path"`
	CodePort           int    `json:"code_port"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64  `json:"last_opened_at_unix_ms"`

	Running bool `json:"running"`
	PID     int  `json:"pid"`
}

type CreateSpaceRequest struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type UpdateSpaceRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type CodeRuntimeStatus = codeserver.RuntimeStatus

type CodeRuntimeVersionRequest struct {
	Version string `json:"version"`
}

type Gateway struct {
	log *slog.Logger

	backend Backend
	pf      PortForwardBackend
	ai      *ai.Service
	notes   *notes.Service
	layouts *workbenchlayout.Service
	term    *terminal.Manager
	codex   CodexBackend
	audit   *auditlog.Store
	diag    *diagnostics.Store

	resolveSessionMeta      func(channelID string) (*session.Meta, bool)
	resolveSessionTunnelURL func(channelID string) (string, bool)

	configPath         string
	stateDir           string
	localPermissionCap *config.PermissionSet
	configMu           sync.Mutex
	secrets            *settings.SecretsStore
	threadReadState    *threadreadstate.Store

	agentHomeDir string

	distFS fs.FS

	ln   net.Listener
	srv  *http.Server
	addr string
}

var (
	envAppShellRootPattern     = regexp.MustCompile(`(?i)<div\b[^>]*\bid\s*=\s*["']root["'][^>]*>`)
	envAppShellAssetRefPattern = regexp.MustCompile(`(?i)\b(?:src|href)\s*=\s*["']/_redeven_proxy/env/assets/([^"']+)["']`)
)

type localUIRouteKind int

const (
	localUIRouteNone localUIRouteKind = iota
	localUIRouteEnv
	localUIRouteCodeSpace
	localUIRoutePortForward
)

type localUIRoute struct {
	kind        localUIRouteKind
	codeSpaceID string
	forwardID   string
}

type localUIRouteContextKey struct{}

func WithLocalUIEnvRoute(r *http.Request) *http.Request {
	return withLocalUIRoute(r, localUIRoute{kind: localUIRouteEnv})
}

func WithLocalUICodeSpaceRoute(r *http.Request, codeSpaceID string) *http.Request {
	return withLocalUIRoute(r, localUIRoute{
		kind:        localUIRouteCodeSpace,
		codeSpaceID: strings.TrimSpace(codeSpaceID),
	})
}

func WithLocalUIPortForwardRoute(r *http.Request, forwardID string) *http.Request {
	return withLocalUIRoute(r, localUIRoute{
		kind:      localUIRoutePortForward,
		forwardID: strings.TrimSpace(forwardID),
	})
}

func withLocalUIRoute(r *http.Request, route localUIRoute) *http.Request {
	if r == nil {
		return nil
	}
	return r.WithContext(context.WithValue(r.Context(), localUIRouteContextKey{}, route))
}

func localUIRouteFromRequest(r *http.Request) (localUIRoute, bool) {
	if r == nil {
		return localUIRoute{}, false
	}
	route, ok := r.Context().Value(localUIRouteContextKey{}).(localUIRoute)
	if !ok || route.kind == localUIRouteNone {
		return localUIRoute{}, false
	}
	return route, true
}

func New(opts Options) (*Gateway, error) {
	if opts.Backend == nil {
		return nil, errors.New("missing Backend")
	}
	if opts.DistFS == nil {
		return nil, errors.New("missing DistFS")
	}
	if strings.TrimSpace(opts.ConfigPath) == "" {
		return nil, errors.New("missing ConfigPath")
	}
	if opts.ResolveSessionMeta == nil {
		return nil, errors.New("missing ResolveSessionMeta")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	addr := strings.TrimSpace(opts.ListenAddr)
	if addr == "" {
		addr = "127.0.0.1:0"
	}

	secrets := opts.SecretsStore
	if secrets == nil {
		// Keep user-managed secrets in the same state dir as config.json.
		dir := filepath.Dir(strings.TrimSpace(opts.ConfigPath))
		secrets = settings.NewSecretsStore(filepath.Join(dir, "secrets.json"))
	}

	stateDir := filepath.Dir(strings.TrimSpace(opts.ConfigPath))
	localPermissionCap := config.ResolvePermissionCapFromConfigPath(
		strings.TrimSpace(opts.ConfigPath),
		localUserPublicID,
		localFloeAppAgent,
		config.PermissionSet{Read: true, Write: false, Execute: true},
	)
	return &Gateway{
		log:                     logger,
		agentHomeDir:            opts.AgentHomeDir,
		backend:                 opts.Backend,
		pf:                      opts.PortForward,
		ai:                      opts.AI,
		notes:                   opts.Notes,
		layouts:                 opts.WorkbenchLayout,
		term:                    opts.Terminal,
		codex:                   opts.Codex,
		audit:                   opts.Audit,
		diag:                    opts.Diagnostics,
		resolveSessionMeta:      opts.ResolveSessionMeta,
		resolveSessionTunnelURL: opts.ResolveSessionTunnelURL,
		configPath:              strings.TrimSpace(opts.ConfigPath),
		stateDir:                stateDir,
		localPermissionCap:      &localPermissionCap,
		secrets:                 secrets,
		threadReadState:         opts.ThreadReadStateStore,
		distFS:                  opts.DistFS,
		addr:                    addr,
	}, nil
}

func (g *Gateway) Start(ctx context.Context) error {
	if g == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if g.ln != nil {
		return nil
	}

	ln, err := net.Listen("tcp", g.addr)
	if err != nil {
		return err
	}
	g.ln = ln

	g.srv = &http.Server{
		Handler:           http.HandlerFunc(g.serveHTTP),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		_ = g.Close()
	}()

	go func() {
		if err := g.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			g.log.Warn("codeapp gateway stopped", "error", err)
		}
	}()

	g.log.Info("codeapp gateway listening", "addr", g.ln.Addr().String())
	return nil
}

func (g *Gateway) Close() error {
	if g == nil {
		return nil
	}
	if g.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = g.srv.Shutdown(ctx)
	}
	if g.ln != nil {
		_ = g.ln.Close()
	}
	g.ln = nil
	return nil
}

func (g *Gateway) URL() string {
	if g == nil || g.ln == nil {
		return ""
	}
	return "http://" + g.ln.Addr().String()
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.serveHTTP(w, r)
}

// EnvAppShellReadinessError validates that the embedded Env App shell can be
// opened by Desktop before the runtime advertises open-readiness.
func (g *Gateway) EnvAppShellReadinessError() error {
	if g == nil {
		return errors.New("gateway not ready")
	}
	return validateEnvAppShellFS(g.distFS)
}

// EnvAppShellReady reports whether the embedded Env App shell is complete.
func (g *Gateway) EnvAppShellReady() bool {
	return g.EnvAppShellReadinessError() == nil
}

func (g *Gateway) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	p := r.URL.Path

	localRoute, localUI := localUIRouteFromRequest(r)
	originRole := originRoleFromRequest(r)
	if localUI {
		switch localRoute.kind {
		case localUIRouteEnv:
			originRole = originRoleEnv
		case localUIRouteCodeSpace:
			originRole = originRoleCodeSpace
		case localUIRoutePortForward:
			originRole = originRolePortForward
		default:
			originRole = originRoleUnknown
		}
	}

	// No caching: UI + inject are agent-versioned and delivered over E2EE.
	w.Header().Set("Cache-Control", "no-store")

	if strings.HasPrefix(p, "/_redeven_proxy/api/") {
		// Hardening: only allow management APIs from the Env App trusted launcher origin
		// (env-<env_id>.<region>.<base-sandbox-domain>).
		// Do not expose them to codespace origins (code-server is untrusted).
		if originRole != originRoleEnv {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		g.handleAPIWithDiagnostics(w, r, localUI)
		return
	}
	if strings.HasPrefix(p, "/_redeven_proxy/") {
		// Hardening: keep UI surfaces separated by origin.
		// - env-<env_id>.<region>.<base-sandbox-domain> serves Env App UI only
		// - cs-<id>.<region>.<base-sandbox-domain> serves inject.js only (no Env App UI)
		switch {
		case strings.HasPrefix(p, "/_redeven_proxy/env"):
			if originRole != originRoleEnv {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
		case p == "/_redeven_proxy/inject.js":
			// inject.js must be accessible from codespace origins, but allowing it from
			// other sandbox origins is harmless and can help debugging.
		default:
			// Unknown dist path: do not serve anything else by default.
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		switch {
		case strings.HasPrefix(p, "/_redeven_proxy/env"):
			g.serveEnvAppDist(w, r)
		case p == "/_redeven_proxy/inject.js":
			g.serveDistFile(w, r, "inject.js")
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
		return
	}

	// UX: ensure code-server always opens the codespace's bound workspace directory.
	//
	// code-server decides the initial workspace based on ?folder/?workspace (first),
	// last-opened state, or CLI args. It does not know about the agent registry.
	// Redirecting here makes the "codespace workspace_path is strongly bound" rule
	// deterministic for all entry paths (open/refresh/bookmark).
	switch originRole {
	case originRoleCodeSpace:
		if localUI {
			if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
				return
			}
		}
		if g.maybeRedirectCodespaceRootToWorkspace(w, r) {
			return
		}
		g.handleCodeServerProxy(w, r)
		return
	case originRolePortForward:
		g.handlePortForwardProxy(w, r)
		return
	default:
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
}

func (g *Gateway) serveEnvAppDist(w http.ResponseWriter, r *http.Request) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	if !isDistRequestMethod(r.Method) {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p := strings.TrimSpace(r.URL.Path)
	if p == "/_redeven_proxy/env" {
		target := "/_redeven_proxy/env/"
		if rawQuery := strings.TrimSpace(r.URL.RawQuery); rawQuery != "" {
			target += "?" + rawQuery
		}
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}
	if p == "/_redeven_proxy/env/" || p == "/_redeven_proxy/env/index.html" {
		g.serveDistFile(w, r, "env/index.html")
		return
	}
	if !strings.HasPrefix(p, "/_redeven_proxy/env/") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	distPath := strings.TrimPrefix(p, "/_redeven_proxy/")
	if info, err := fs.Stat(g.distFS, distPath); err == nil {
		if info.IsDir() {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		g.serveDistFile(w, r, distPath)
		return
	}
	if shouldServeEnvAppShellForMissingPath(r, distPath) {
		g.serveDistFile(w, r, "env/index.html")
		return
	}
	http.Error(w, "not found", http.StatusNotFound)
}

func shouldServeEnvAppShellForMissingPath(r *http.Request, distPath string) bool {
	if r == nil {
		return false
	}
	if !isDistRequestMethod(r.Method) {
		return false
	}
	cleanPath := cleanDistPath(distPath)
	if cleanPath == "" || cleanPath == "env/assets" || strings.HasPrefix(cleanPath, "env/assets/") {
		return false
	}
	base := path.Base(cleanPath)
	if strings.Contains(base, ".") {
		return false
	}
	accept := strings.TrimSpace(r.Header.Get("Accept"))
	return accept == "" || strings.Contains(accept, "text/html") || strings.Contains(accept, "*/*")
}

func (g *Gateway) serveDistFile(w http.ResponseWriter, r *http.Request, distPath string) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	if !isDistRequestMethod(r.Method) {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cleanPath := cleanDistPath(distPath)
	if cleanPath == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	info, err := fs.Stat(g.distFS, cleanPath)
	if err != nil || info.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	data, err := fs.ReadFile(g.distFS, cleanPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	http.ServeContent(w, r, path.Base(cleanPath), info.ModTime(), bytes.NewReader(data))
}

func cleanDistPath(raw string) string {
	cleanPath := strings.TrimPrefix(path.Clean("/"+strings.TrimSpace(raw)), "/")
	if cleanPath == "." || cleanPath == "" || !fs.ValidPath(cleanPath) {
		return ""
	}
	return cleanPath
}

func isDistRequestMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead
}

func validateEnvAppShellFS(distFS fs.FS) error {
	if distFS == nil {
		return errors.New("missing dist filesystem")
	}
	info, err := fs.Stat(distFS, "env/index.html")
	if err != nil {
		return fmt.Errorf("missing Env App shell: %w", err)
	}
	if info.IsDir() {
		return errors.New("Env App shell points to a directory")
	}
	data, err := fs.ReadFile(distFS, "env/index.html")
	if err != nil {
		return fmt.Errorf("read Env App shell: %w", err)
	}
	if !envAppShellRootPattern.Match(data) {
		return errors.New("Env App shell is missing its root mount")
	}
	matches := envAppShellAssetRefPattern.FindAllSubmatch(data, -1)
	if len(matches) == 0 {
		return errors.New("Env App shell is missing bundled asset references")
	}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		assetPath := cleanDistPath("env/assets/" + string(match[1]))
		if assetPath == "" || !strings.HasPrefix(assetPath, "env/assets/") {
			return fmt.Errorf("Env App shell references an invalid asset path: %q", string(match[1]))
		}
		assetInfo, err := fs.Stat(distFS, assetPath)
		if err != nil {
			return fmt.Errorf("Env App shell references a missing asset %q: %w", assetPath, err)
		}
		if assetInfo.IsDir() {
			return fmt.Errorf("Env App shell asset %q points to a directory", assetPath)
		}
	}
	return nil
}

type apiResp struct {
	OK        bool        `json:"ok"`
	Error     string      `json:"error,omitempty"`
	ErrorCode string      `json:"error_code,omitempty"`
	Data      interface{} `json:"data,omitempty"`
}

type settingsView struct {
	ConfigPath string `json:"config_path"`

	Connection settingsConnectionView `json:"connection"`
	Runtime    settingsRuntimeView    `json:"runtime"`
	Logging    settingsLoggingView    `json:"logging"`
	Codespaces settingsCodespacesView `json:"codespaces"`

	PermissionPolicy *config.PermissionPolicy `json:"permission_policy"`
	AI               *config.AIConfig         `json:"ai"`
	AISecrets        *settingsAISecretsView   `json:"ai_secrets,omitempty"`
}

type settingsAIUpdateView struct {
	ApplyScope     string `json:"apply_scope"`
	ActiveRunCount int    `json:"active_run_count"`
}

type settingsUpdateView struct {
	Settings settingsView          `json:"settings"`
	AIUpdate *settingsAIUpdateView `json:"ai_update,omitempty"`
}

type settingsAISecretsView struct {
	ProviderAPIKeySet map[string]bool `json:"provider_api_key_set"`
}

type settingsConnectionView struct {
	ControlplaneBaseURL string             `json:"controlplane_base_url"`
	EnvironmentID       string             `json:"environment_id"`
	AgentInstanceID     string             `json:"agent_instance_id"`
	Direct              settingsDirectView `json:"direct"`
}

type settingsDirectView struct {
	WsURL                    string `json:"ws_url"`
	ChannelID                string `json:"channel_id"`
	ChannelInitExpireAtUnixS int64  `json:"channel_init_expire_at_unix_s"`
	DefaultSuite             uint16 `json:"default_suite"`
	E2eePskSet               bool   `json:"e2ee_psk_set"`
}

type settingsRuntimeView struct {
	AgentHomeDir string `json:"agent_home_dir"`
	Shell        string `json:"shell"`
}

type settingsLoggingView struct {
	LogFormat string `json:"log_format"`
	LogLevel  string `json:"log_level"`
}

type settingsCodespacesView struct {
	CodeServerPortMin int `json:"code_server_port_min"`
	CodeServerPortMax int `json:"code_server_port_max"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (g *Gateway) handleAPIWithDiagnostics(w http.ResponseWriter, r *http.Request, localUI bool) {
	if g != nil && g.diag != nil {
		w.Header().Set(diagnostics.EnabledHeader, strconv.FormatBool(g.diag.Enabled()))
	}
	if g == nil || g.diag == nil || !g.diag.Enabled() || shouldSkipDiagnosticsPath(r) {
		g.handleAPI(w, r)
		return
	}
	traceID := diagnostics.TraceIDFromContext(r.Context())
	if traceID == "" {
		traceID = strings.TrimSpace(r.Header.Get(diagnostics.TraceHeader))
	}
	if traceID == "" {
		traceID = diagnostics.NewTraceID()
	}
	if traceID != "" {
		r = r.WithContext(diagnostics.WithTraceID(r.Context(), traceID))
		w.Header().Set(diagnostics.TraceHeader, traceID)
	}
	startedAt := time.Now()
	rw := diagnostics.NewStatusWriter(w)
	g.handleAPI(rw, r)
	g.diag.Append(diagnostics.Event{
		Scope:      diagnostics.ScopeGatewayAPI,
		Kind:       "request",
		TraceID:    traceID,
		Method:     r.Method,
		Path:       strings.TrimSpace(r.URL.Path),
		StatusCode: rw.StatusCode(),
		DurationMs: time.Since(startedAt).Milliseconds(),
		Detail: map[string]any{
			"local_ui": localUI,
		},
	})
}

func shouldSkipDiagnosticsPath(r *http.Request) bool {
	if r == nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/_redeven_proxy/api/debug/diagnostics")
}

func writeAISkillError(w http.ResponseWriter, fallbackStatus int, err error) {
	status := fallbackStatus
	code := ""
	if se, ok := ai.AsSkillError(err); ok {
		status = se.HTTPStatus()
		code = se.Code()
	}
	writeJSON(w, status, apiResp{OK: false, Error: err.Error(), ErrorCode: code})
}

func writeCodexError(w http.ResponseWriter, err error) {
	var status int
	errorCode := ""
	switch {
	case err == nil:
		status = http.StatusOK
	case errors.Is(err, codexbridge.ErrUnavailable):
		status = http.StatusServiceUnavailable
	case errors.Is(err, codexbridge.ErrThreadNotFound), errors.Is(err, codexbridge.ErrRequestNotFound):
		status = http.StatusNotFound
	case errors.Is(err, codexbridge.ErrInvalidResponse):
		status = http.StatusBadRequest
	default:
		status = http.StatusBadRequest
	}
	errorCode = codexbridge.CodexErrorCode(err)
	writeJSON(w, status, apiResp{OK: false, Error: err.Error(), ErrorCode: errorCode})
}

type diagnosticsView struct {
	Enabled      bool                      `json:"enabled"`
	StateDir     string                    `json:"state_dir,omitempty"`
	RecentEvents []diagnostics.Event       `json:"recent_events"`
	SlowSummary  []diagnostics.SummaryItem `json:"slow_summary"`
	Stats        diagnostics.Stats         `json:"stats"`
}

type diagnosticsExportView struct {
	Enabled       bool                 `json:"enabled"`
	StateDir      string               `json:"state_dir,omitempty"`
	ExportedAt    string               `json:"exported_at"`
	Snapshot      diagnostics.Snapshot `json:"snapshot"`
	AgentEvents   []diagnostics.Event  `json:"agent_events"`
	DesktopEvents []diagnostics.Event  `json:"desktop_events"`
}

type diagnosticsStreamEvent struct {
	Key   string            `json:"key"`
	Event diagnostics.Event `json:"event"`
}

var diagnosticsStreamPollInterval = 750 * time.Millisecond

func parseDiagnosticsLimit(r *http.Request, key string, defaultValue int, maxValue int) int {
	if defaultValue <= 0 {
		defaultValue = 100
	}
	if maxValue <= 0 {
		maxValue = defaultValue
	}
	if r == nil {
		return defaultValue
	}
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return defaultValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func (g *Gateway) loadDiagnosticsSource(source string, limit int) ([]diagnostics.Event, error) {
	if g == nil || strings.TrimSpace(g.stateDir) == "" {
		return nil, nil
	}
	return diagnostics.ListSource(g.stateDir, source, limit)
}

func (g *Gateway) loadDiagnosticsRecentEvents(sourceLimit int) ([]diagnostics.Event, error) {
	agentEvents, err := g.loadDiagnosticsSource(diagnostics.SourceAgent, sourceLimit)
	if err != nil {
		return nil, err
	}
	desktopEvents, err := g.loadDiagnosticsSource(diagnostics.SourceDesktop, sourceLimit)
	if err != nil {
		return nil, err
	}
	return diagnostics.MergeEvents(sourceLimit, agentEvents, desktopEvents), nil
}

func writeDiagnosticsSSEEvent(w io.Writer, ev diagnosticsStreamEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(w, "event: diagnostics_event\n"); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "data: "); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	_, err = io.WriteString(w, "\n\n")
	return err
}

func (g *Gateway) buildDiagnosticsView(recentLimit int, sourceLimit int, summaryLimit int) (diagnosticsView, error) {
	view := diagnosticsView{Enabled: g != nil && g.diag != nil && g.diag.Enabled(), StateDir: strings.TrimSpace(g.stateDir)}
	if !view.Enabled {
		return view, nil
	}
	agentEvents, err := g.loadDiagnosticsSource(diagnostics.SourceAgent, sourceLimit)
	if err != nil {
		return diagnosticsView{}, err
	}
	desktopEvents, err := g.loadDiagnosticsSource(diagnostics.SourceDesktop, sourceLimit)
	if err != nil {
		return diagnosticsView{}, err
	}
	snapshot := diagnostics.BuildSnapshot(recentLimit, summaryLimit, agentEvents, desktopEvents)
	view.RecentEvents = snapshot.RecentEvents
	view.SlowSummary = snapshot.SlowSummary
	view.Stats = snapshot.Stats
	return view, nil
}

func (g *Gateway) buildDiagnosticsExportView(sourceLimit int, summaryLimit int) (diagnosticsExportView, error) {
	view := diagnosticsExportView{
		Enabled:    g != nil && g.diag != nil && g.diag.Enabled(),
		StateDir:   strings.TrimSpace(g.stateDir),
		ExportedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if !view.Enabled {
		view.Snapshot = diagnostics.BuildSnapshot(sourceLimit, summaryLimit)
		return view, nil
	}
	agentEvents, err := g.loadDiagnosticsSource(diagnostics.SourceAgent, sourceLimit)
	if err != nil {
		return diagnosticsExportView{}, err
	}
	desktopEvents, err := g.loadDiagnosticsSource(diagnostics.SourceDesktop, sourceLimit)
	if err != nil {
		return diagnosticsExportView{}, err
	}
	view.AgentEvents = agentEvents
	view.DesktopEvents = desktopEvents
	view.Snapshot = diagnostics.BuildSnapshot(sourceLimit, summaryLimit, agentEvents, desktopEvents)
	return view, nil
}

func (g *Gateway) handleCodexEventStream(w http.ResponseWriter, r *http.Request, threadID string) {
	if g == nil || g.codex == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "codex service not ready"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming not supported"})
		return
	}
	afterSeq := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_seq")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid after_seq"})
			return
		}
		afterSeq = value
	}
	snapshot, ch, err := g.codex.SubscribeThreadEvents(r.Context(), threadID, afterSeq)
	if err != nil {
		writeCodexError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	if err := flushCodexSSEEvents(w, flusher, snapshot); err != nil {
		return
	}

	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()
	var (
		pendingEvents []codexbridge.Event
		batchTimer    *time.Timer
		batchTimerCh  <-chan time.Time
	)
	stopBatchTimer := func() {
		if batchTimer == nil {
			return
		}
		if !batchTimer.Stop() {
			select {
			case <-batchTimer.C:
			default:
			}
		}
		batchTimer = nil
		batchTimerCh = nil
	}
	flushPending := func() bool {
		if len(pendingEvents) == 0 {
			stopBatchTimer()
			return true
		}
		events := pendingEvents
		pendingEvents = nil
		stopBatchTimer()
		return flushCodexSSEEvents(w, flusher, events) == nil
	}
	for {
		select {
		case <-r.Context().Done():
			flushPending()
			return
		case <-keepAlive.C:
			if !flushPending() {
				return
			}
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-batchTimerCh:
			if !flushPending() {
				return
			}
		case ev, ok := <-ch:
			if !ok {
				flushPending()
				return
			}
			pendingEvents = append(pendingEvents, ev)
			if batchTimer == nil {
				batchTimer = time.NewTimer(codexEventBatchWindow)
				batchTimerCh = batchTimer.C
			}
		}
	}
}

func flushCodexSSEEvents(w io.Writer, flusher http.Flusher, events []codexbridge.Event) error {
	compacted := compactCodexEvents(events)
	if len(compacted) == 0 {
		return nil
	}
	for _, ev := range compacted {
		if err := writeCodexSSEEvent(w, ev); err != nil {
			return err
		}
	}
	flusher.Flush()
	return nil
}

func compactCodexEvents(events []codexbridge.Event) []codexbridge.Event {
	if len(events) <= 1 {
		return append([]codexbridge.Event(nil), events...)
	}
	compacted := make([]codexbridge.Event, 0, len(events))
	for _, event := range events {
		if len(compacted) == 0 {
			compacted = append(compacted, event)
			continue
		}
		lastIndex := len(compacted) - 1
		if !canCompactCodexEvent(compacted[lastIndex], event) {
			compacted = append(compacted, event)
			continue
		}
		compacted[lastIndex].Seq = event.Seq
		compacted[lastIndex].Stream = event.Stream
		compacted[lastIndex].Transport = event.Transport
		compacted[lastIndex].Delta += event.Delta
	}
	return compacted
}

func canCompactCodexEvent(left codexbridge.Event, right codexbridge.Event) bool {
	if left.Transport != nil || right.Transport != nil {
		return false
	}
	if left.Type != right.Type {
		return false
	}
	switch left.Type {
	case "agent_message_delta", "command_output_delta", "file_change_delta", "plan_delta":
		return sameCodexEventTarget(left, right)
	case "reasoning_delta":
		return sameCodexEventTarget(left, right) && sameOptionalInt64(left.ContentIndex, right.ContentIndex)
	case "reasoning_summary_delta":
		return sameCodexEventTarget(left, right) && sameOptionalInt64(left.SummaryIndex, right.SummaryIndex)
	default:
		return false
	}
}

func sameCodexEventTarget(left codexbridge.Event, right codexbridge.Event) bool {
	return left.ThreadID == right.ThreadID && left.TurnID == right.TurnID && left.ItemID == right.ItemID
}

func sameOptionalInt64(left *int64, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func writeCodexSSEEvent(w io.Writer, ev codexbridge.Event) error {
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(w, "event: codex_event\n"); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "data: "); err != nil {
		return err
	}
	if _, err := w.Write(b); err != nil {
		return err
	}
	_, err = io.WriteString(w, "\n\n")
	return err
}

func toSettingsView(cfg *config.Config, configPath string, secrets *settings.SecretsStore) settingsView {
	var direct settingsDirectView
	if cfg != nil && cfg.Direct != nil {
		direct = settingsDirectView{
			WsURL:                    strings.TrimSpace(cfg.Direct.WsUrl),
			ChannelID:                strings.TrimSpace(cfg.Direct.ChannelId),
			ChannelInitExpireAtUnixS: cfg.Direct.ChannelInitExpireAtUnixS,
			DefaultSuite:             uint16(cfg.Direct.DefaultSuite),
			E2eePskSet:               strings.TrimSpace(cfg.Direct.E2eePskB64u) != "",
		}
	}

	var out settingsView
	out.ConfigPath = strings.TrimSpace(configPath)
	if cfg != nil {
		out.Connection = settingsConnectionView{
			ControlplaneBaseURL: strings.TrimSpace(cfg.ControlplaneBaseURL),
			EnvironmentID:       strings.TrimSpace(cfg.EnvironmentID),
			AgentInstanceID:     strings.TrimSpace(cfg.AgentInstanceID),
			Direct:              direct,
		}
		out.Runtime = settingsRuntimeView{
			AgentHomeDir: strings.TrimSpace(cfg.AgentHomeDir),
			Shell:        strings.TrimSpace(cfg.Shell),
		}
		out.Logging = settingsLoggingView{
			LogFormat: strings.TrimSpace(cfg.LogFormat),
			LogLevel:  strings.TrimSpace(cfg.LogLevel),
		}
		out.Codespaces = settingsCodespacesView{
			CodeServerPortMin: cfg.CodeServerPortMin,
			CodeServerPortMax: cfg.CodeServerPortMax,
		}
		out.PermissionPolicy = cfg.PermissionPolicy
		out.AI = cfg.AI

		if secrets != nil && cfg.AI != nil && len(cfg.AI.Providers) > 0 {
			ids := make([]string, 0, len(cfg.AI.Providers))
			for i := range cfg.AI.Providers {
				id := strings.TrimSpace(cfg.AI.Providers[i].ID)
				if id == "" {
					continue
				}
				ids = append(ids, id)
			}
			if len(ids) > 0 {
				if set, err := secrets.GetAIProviderAPIKeySet(ids); err == nil {
					out.AISecrets = &settingsAISecretsView{ProviderAPIKeySet: set}
				}
			}
		}
	}
	return out
}

func (g *Gateway) loadConfigLocked() (*config.Config, error) {
	if g == nil {
		return nil, errors.New("gateway not ready")
	}
	path := strings.TrimSpace(g.configPath)
	if path == "" {
		return nil, errors.New("missing config path")
	}
	g.configMu.Lock()
	defer g.configMu.Unlock()
	return config.Load(path)
}

func (g *Gateway) updateConfigLocked(mut func(cfg *config.Config) error) (*config.Config, error) {
	if g == nil {
		return nil, errors.New("gateway not ready")
	}
	path := strings.TrimSpace(g.configPath)
	if path == "" {
		return nil, errors.New("missing config path")
	}
	g.configMu.Lock()
	defer g.configMu.Unlock()

	cfg, err := config.Load(path)
	if err != nil {
		return nil, err
	}
	if mut != nil {
		if err := mut(cfg); err != nil {
			return nil, err
		}
	}
	if err := config.Save(path, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

type requiredPermission int

const (
	requiredPermissionRead requiredPermission = iota
	requiredPermissionWrite
	requiredPermissionExecute
	requiredPermissionAdmin
	requiredPermissionFull
)

func (g *Gateway) requirePermission(w http.ResponseWriter, r *http.Request, perm requiredPermission) (*session.Meta, bool) {
	if g == nil || w == nil || r == nil {
		return nil, false
	}

	// Local UI mode: inject a fixed local session_meta so the Env App gateway APIs can work
	// without the env-/ch- origin labels used in Standard Mode.
	if _, ok := localUIRouteFromRequest(r); ok {
		meta := g.localSessionMeta()
		if meta == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "gateway not ready"})
			return nil, false
		}
		switch perm {
		case requiredPermissionRead:
			if !meta.CanRead {
				writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "read permission denied"})
				return nil, false
			}
		case requiredPermissionWrite:
			if !meta.CanWrite {
				writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "write permission denied"})
				return nil, false
			}
		case requiredPermissionExecute:
			if !meta.CanExecute {
				writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "execute permission denied"})
				return nil, false
			}
		case requiredPermissionAdmin:
			if !meta.CanAdmin {
				writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "admin permission denied"})
				return nil, false
			}
		case requiredPermissionFull:
			if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
				writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "read/write/execute permission denied"})
				return nil, false
			}
		default:
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "permission denied"})
			return nil, false
		}
		return meta, true
	}

	if g.resolveSessionMeta == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "gateway not ready"})
		return nil, false
	}

	channelID, err := channelIDFromRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session origin"})
		return nil, false
	}

	meta, ok := g.resolveSessionMeta(channelID)
	if !ok || meta == nil {
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "permission denied"})
		return nil, false
	}

	switch perm {
	case requiredPermissionRead:
		if !meta.CanRead {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "read permission denied"})
			return nil, false
		}
	case requiredPermissionWrite:
		if !meta.CanWrite {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "write permission denied"})
			return nil, false
		}
	case requiredPermissionExecute:
		if !meta.CanExecute {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "execute permission denied"})
			return nil, false
		}
	case requiredPermissionAdmin:
		if !meta.CanAdmin {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "admin permission denied"})
			return nil, false
		}
	case requiredPermissionFull:
		if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "read/write/execute permission denied"})
			return nil, false
		}
	default:
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "permission denied"})
		return nil, false
	}

	return meta, true
}

const (
	localEnvPublicID       = "env_local"
	localNamespacePublicID = "ns_local"
	localUserPublicID      = "user_local"
	localUserEmail         = "local@redeven"
	localFloeAppAgent      = "com.floegence.redeven.agent"
)

func (g *Gateway) localSessionMeta() *session.Meta {
	// Local UI permissions follow the current process snapshot and only change after
	// an explicit agent restart, matching the rest of the runtime.
	cap := config.PermissionSet{Read: true, Write: false, Execute: true}
	if g != nil && g.localPermissionCap != nil {
		cap = *g.localPermissionCap
	}

	return &session.Meta{
		ChannelID:         "local-ui",
		EndpointID:        localEnvPublicID,
		FloeApp:           localFloeAppAgent,
		CodeSpaceID:       "env-ui",
		SessionKind:       "envapp_rpc",
		UserPublicID:      localUserPublicID,
		UserEmail:         localUserEmail,
		NamespacePublicID: localNamespacePublicID,
		CanRead:           cap.Read,
		CanWrite:          cap.Write,
		CanExecute:        cap.Execute,
		CanAdmin:          true,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
	}
}

func sanitizeAuditError(err error) string {
	if err == nil {
		return ""
	}
	s := strings.TrimSpace(err.Error())
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 240 {
		s = s[:240] + "..."
	}
	return s
}

func truncateString(s string, max int) string {
	if max <= 0 {
		return ""
	}
	v := strings.TrimSpace(s)
	if len(v) <= max {
		return v
	}
	return v[:max] + "..."
}

func auditURLHost(raw string) (scheme string, host string) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return "", ""
	}
	return strings.TrimSpace(u.Scheme), strings.TrimSpace(u.Host)
}

func (g *Gateway) appendAudit(meta *session.Meta, action string, status string, detail map[string]any, err error) {
	if g == nil || g.audit == nil || meta == nil {
		return
	}
	a := strings.TrimSpace(action)
	if a == "" {
		return
	}
	st := strings.TrimSpace(status)
	if st == "" {
		st = "success"
	}

	tunnelURL := ""
	if g.resolveSessionTunnelURL != nil {
		if v, ok := g.resolveSessionTunnelURL(strings.TrimSpace(meta.ChannelID)); ok {
			tunnelURL = strings.TrimSpace(v)
		}
	}

	g.audit.Append(auditlog.Entry{
		Action:    a,
		Status:    st,
		Error:     sanitizeAuditError(err),
		ChannelID: strings.TrimSpace(meta.ChannelID),

		EnvPublicID:       strings.TrimSpace(meta.EndpointID),
		NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),

		UserPublicID: strings.TrimSpace(meta.UserPublicID),
		UserEmail:    strings.TrimSpace(meta.UserEmail),

		FloeApp:     strings.TrimSpace(meta.FloeApp),
		SessionKind: strings.TrimSpace(meta.SessionKind),
		CodeSpaceID: strings.TrimSpace(meta.CodeSpaceID),
		TunnelURL:   tunnelURL,
		CanRead:     meta.CanRead,
		CanWrite:    meta.CanWrite,
		CanExecute:  meta.CanExecute,
		CanAdmin:    meta.CanAdmin,
		Detail:      detail,
	})
}

// handleFSServeFile serves a project file identified by the "path" query parameter.
// Security: reuses pathutil.ResolveExistingScopedPath to prevent traversal and symlink escape.
func (g *Gateway) handleFSServeFile(w http.ResponseWriter, r *http.Request) {
	userPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if userPath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}

	resolvedPath, err := pathutil.ResolveExistingScopedPath(userPath, g.agentHomeDir)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	ext := strings.ToLower(filepath.Ext(resolvedPath))
	ct := mime.TypeByExtension(ext)
	if !isRenderableMime(ct) {
		http.Error(w, "unsupported file type", http.StatusUnsupportedMediaType)
		return
	}

	f, err := os.Open(resolvedPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if st.IsDir() {
		http.Error(w, "not a file", http.StatusBadRequest)
		return
	}
	if st.Size() > 50<<20 { // 50 MB
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}

	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeContent(w, r, filepath.Base(resolvedPath), st.ModTime(), f)
}

// isRenderableMime returns true for web-browser-renderable content types.
func isRenderableMime(ct string) bool {
	if ct == "" {
		return false
	}
	switch {
	case strings.HasPrefix(ct, "image/"):
		return true
	case strings.HasPrefix(ct, "video/"):
		return true
	case strings.HasPrefix(ct, "audio/"):
		return true
	case strings.HasPrefix(ct, "font/"):
		return true
	case ct == "text/css", ct == "text/javascript", ct == "application/javascript":
		return true
	case strings.HasPrefix(ct, "text/"):
		return true
	case ct == "application/pdf":
		return true
	case strings.HasPrefix(ct, "application/xml"):
		return true
	case strings.HasPrefix(ct, "application/json"):
		return true
	case strings.HasSuffix(ct, "+xml"):
		return true
	default:
		return false
	}
}

func (g *Gateway) handleAPI(w http.ResponseWriter, r *http.Request) {
	if g.handleWorkbenchLayoutAPI(w, r) {
		return
	}
	if g.handleNotesAPI(w, r) {
		return
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/fs/file":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		g.handleFSServeFile(w, r)
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/audit/logs":
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return
		}
		if g.audit == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "audit log not configured"})
			return
		}
		limit := 200
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		entries, err := g.audit.List(limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to read audit log"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"entries": entries}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/debug/diagnostics":
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return
		}
		view, err := g.buildDiagnosticsView(
			parseDiagnosticsLimit(r, "limit", 60, 200),
			parseDiagnosticsLimit(r, "source_limit", 300, 1000),
			parseDiagnosticsLimit(r, "summary_limit", 12, 40),
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to load diagnostics"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/debug/diagnostics/export":
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return
		}
		view, err := g.buildDiagnosticsExportView(
			parseDiagnosticsLimit(r, "limit", 500, 2000),
			parseDiagnosticsLimit(r, "summary_limit", 20, 50),
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to export diagnostics"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/debug/diagnostics/stream":
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming not supported"})
			return
		}
		limit := parseDiagnosticsLimit(r, "limit", 200, 400)
		baseline, err := g.loadDiagnosticsRecentEvents(limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to load diagnostics stream baseline"})
			return
		}
		seen := make(map[string]struct{}, len(baseline))
		order := make([]string, 0, len(baseline))
		for _, event := range baseline {
			key := diagnostics.EventKey(event)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			order = append(order, key)
		}
		trimSeen := func() {
			for len(order) > limit*4 {
				delete(seen, order[0])
				order = order[1:]
			}
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")

		keepAlive := time.NewTicker(20 * time.Second)
		poll := time.NewTicker(diagnosticsStreamPollInterval)
		defer keepAlive.Stop()
		defer poll.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-keepAlive.C:
				if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
					return
				}
				flusher.Flush()
			case <-poll.C:
				events, err := g.loadDiagnosticsRecentEvents(limit)
				if err != nil {
					continue
				}
				for i := len(events) - 1; i >= 0; i-- {
					event := events[i]
					key := diagnostics.EventKey(event)
					if _, ok := seen[key]; ok {
						continue
					}
					if err := writeDiagnosticsSSEEvent(w, diagnosticsStreamEvent{Key: key, Event: event}); err != nil {
						return
					}
					flusher.Flush()
					seen[key] = struct{}{}
					order = append(order, key)
					trimSeen()
				}
			}
		}

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/settings":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		cfg, err := g.loadConfigLocked()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: toSettingsView(cfg, g.configPath, g.secrets)})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/settings":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		type settingsUpdateReq struct {
			AgentHomeDir *string `json:"agent_home_dir,omitempty"`
			Shell        *string `json:"shell,omitempty"`

			LogFormat *string `json:"log_format,omitempty"`
			LogLevel  *string `json:"log_level,omitempty"`

			CodeServerPortMin *int `json:"code_server_port_min,omitempty"`
			CodeServerPortMax *int `json:"code_server_port_max,omitempty"`

			PermissionPolicy json.RawMessage `json:"permission_policy,omitempty"`
			AI               json.RawMessage `json:"ai,omitempty"`
			Codex            json.RawMessage `json:"codex,omitempty"`
		}

		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body settingsUpdateReq
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if len(body.Codex) > 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{
				OK:    false,
				Error: "Codex is host-managed and cannot be configured from Runtime Settings. Install and configure `codex` on the host instead.",
			})
			return
		}

		if body.AgentHomeDir == nil && body.Shell == nil &&
			body.LogFormat == nil && body.LogLevel == nil &&
			body.CodeServerPortMin == nil && body.CodeServerPortMax == nil &&
			len(body.PermissionPolicy) == 0 && len(body.AI) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
			return
		}

		var nextPolicy *config.PermissionPolicy
		if len(body.PermissionPolicy) > 0 {
			raw := bytes.TrimSpace(body.PermissionPolicy)
			if !bytes.Equal(raw, []byte("null")) {
				var p config.PermissionPolicy
				ppDec := json.NewDecoder(bytes.NewReader(raw))
				ppDec.DisallowUnknownFields()
				if err := ppDec.Decode(&p); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid permission_policy json"})
					return
				}
				if err := ppDec.Decode(&struct{}{}); err != io.EOF {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid permission_policy json"})
					return
				}
				if err := p.Validate(); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: fmt.Sprintf("invalid permission_policy: %s", err.Error())})
					return
				}
				nextPolicy = &p
			}
		}

		var nextAI *config.AIConfig
		if len(body.AI) > 0 {
			raw := bytes.TrimSpace(body.AI)
			if !bytes.Equal(raw, []byte("null")) {
				var cfg config.AIConfig
				aiDec := json.NewDecoder(bytes.NewReader(raw))
				aiDec.DisallowUnknownFields()
				if err := aiDec.Decode(&cfg); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid ai json"})
					return
				}
				if err := aiDec.Decode(&struct{}{}); err != io.EOF {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid ai json"})
					return
				}
				cfg.NormalizeCurrentModelID()
				if err := cfg.Validate(); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: fmt.Sprintf("invalid ai: %s", err.Error())})
					return
				}
				nextAI = &cfg
			}
		}

		auditDetail := map[string]any{}
		if body.AgentHomeDir != nil {
			auditDetail["agent_home_dir"] = strings.TrimSpace(*body.AgentHomeDir)
		}
		if body.Shell != nil {
			auditDetail["shell"] = strings.TrimSpace(*body.Shell)
		}
		if body.LogFormat != nil {
			auditDetail["log_format"] = strings.TrimSpace(*body.LogFormat)
		}
		if body.LogLevel != nil {
			auditDetail["log_level"] = strings.TrimSpace(*body.LogLevel)
		}
		if body.CodeServerPortMin != nil {
			auditDetail["code_server_port_min"] = *body.CodeServerPortMin
		}
		if body.CodeServerPortMax != nil {
			auditDetail["code_server_port_max"] = *body.CodeServerPortMax
		}
		if len(body.PermissionPolicy) > 0 {
			auditDetail["permission_policy_updated"] = true
		}
		if len(body.AI) > 0 {
			// Do NOT log any AI config details (may include secrets).
			auditDetail["ai_updated"] = true
		}
		endpointID := strings.TrimSpace(meta.EndpointID)
		aiUpdate := (*settingsAIUpdateView)(nil)
		if len(body.AI) > 0 && g.ai != nil {
			activeRunCount := g.ai.ActiveRunCount(endpointID)
			aiUpdate = &settingsAIUpdateView{
				ApplyScope:     "future_runs",
				ActiveRunCount: activeRunCount,
			}
			auditDetail["ai_apply_scope"] = aiUpdate.ApplyScope
			auditDetail["ai_active_run_count"] = activeRunCount
		}

		var updated *config.Config
		persist := func() error {
			cfg, err := g.updateConfigLocked(func(c *config.Config) error {
				if body.AgentHomeDir != nil {
					raw := strings.TrimSpace(*body.AgentHomeDir)
					if raw != "" {
						if _, err := pathutil.CanonicalizeExistingDirAbs(raw); err != nil {
							return err
						}
					}
					c.AgentHomeDir = raw
				}
				if body.Shell != nil {
					c.Shell = strings.TrimSpace(*body.Shell)
				}
				if body.LogFormat != nil {
					c.LogFormat = strings.TrimSpace(*body.LogFormat)
				}
				if body.LogLevel != nil {
					c.LogLevel = strings.TrimSpace(*body.LogLevel)
				}
				if body.CodeServerPortMin != nil {
					c.CodeServerPortMin = *body.CodeServerPortMin
				}
				if body.CodeServerPortMax != nil {
					c.CodeServerPortMax = *body.CodeServerPortMax
				}
				if len(body.PermissionPolicy) > 0 {
					c.PermissionPolicy = nextPolicy
				}
				if len(body.AI) > 0 {
					c.AI = nextAI
				}
				return nil
			})
			if err != nil {
				return err
			}
			updated = cfg
			return nil
		}

		var err error
		if len(body.AI) > 0 {
			if g.ai == nil {
				g.appendAudit(meta, "settings_update", "failure", auditDetail, errors.New("ai service not ready"))
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			err = g.ai.UpdateConfig(nextAI, persist)
		} else {
			err = persist()
		}
		if err != nil {
			g.appendAudit(meta, "settings_update", "failure", auditDetail, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}

		g.appendAudit(meta, "settings_update", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{
			OK: true,
			Data: settingsUpdateView{
				Settings: toSettingsView(updated, g.configPath, g.secrets),
				AIUpdate: aiUpdate,
			},
		})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/codex/status":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		if g.codex == nil {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: codexbridge.Status{AgentHomeDir: ""}})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: g.codex.Status(r.Context())})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/code-runtime/status":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		status, err := g.backend.CodeRuntimeStatus(r.Context())
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/code-runtime/install":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		status, err := g.backend.InstallCodeRuntime(r.Context())
		if err != nil {
			g.appendAudit(meta, "code_runtime_install", "failure", nil, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		g.appendAudit(meta, "code_runtime_install", "success", map[string]any{
			"operation_state": string(status.Operation.State),
			"operation":       string(status.Operation.Action),
			"source":          status.ActiveRuntime.Source,
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/code-runtime/select":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		var body CodeRuntimeVersionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid request body"})
			return
		}
		status, err := g.backend.SelectCodeRuntimeVersion(r.Context(), body.Version)
		if err != nil {
			g.appendAudit(meta, "code_runtime_select", "failure", map[string]any{"version": strings.TrimSpace(body.Version)}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		g.appendAudit(meta, "code_runtime_select", "success", map[string]any{
			"version":                strings.TrimSpace(body.Version),
			"managed_runtime_source": status.ManagedRuntimeSource,
			"source":                 status.ActiveRuntime.Source,
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/code-runtime/remove-version":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		var body CodeRuntimeVersionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid request body"})
			return
		}
		status, err := g.backend.RemoveCodeRuntimeVersion(r.Context(), body.Version)
		if err != nil {
			g.appendAudit(meta, "code_runtime_remove_version", "failure", map[string]any{"version": strings.TrimSpace(body.Version)}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		g.appendAudit(meta, "code_runtime_remove_version", "success", map[string]any{
			"version":         strings.TrimSpace(body.Version),
			"operation_state": string(status.Operation.State),
			"operation":       string(status.Operation.Action),
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/code-runtime/cancel":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		status, err := g.backend.CancelCodeRuntimeOperation(r.Context())
		if err != nil {
			g.appendAudit(meta, "code_runtime_cancel", "failure", nil, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		g.appendAudit(meta, "code_runtime_cancel", "success", map[string]any{
			"operation_state": string(status.Operation.State),
			"operation":       string(status.Operation.Action),
			"source":          status.ActiveRuntime.Source,
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/codex/capabilities":
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return
		}
		if g.codex == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "codex service not ready"})
			return
		}
		capabilities, err := g.codex.ReadCapabilities(r.Context(), strings.TrimSpace(r.URL.Query().Get("cwd")))
		if err != nil {
			writeCodexError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: capabilities})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/codex/threads":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.codex == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "codex service not ready"})
			return
		}
		limit := 100
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		var archived *bool
		if raw := strings.TrimSpace(r.URL.Query().Get("archived")); raw != "" {
			v, err := strconv.ParseBool(raw)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid archived filter"})
				return
			}
			archived = &v
		}
		threads, err := g.codex.ListThreads(r.Context(), codexbridge.ListThreadsRequest{
			Limit:    limit,
			Archived: archived,
		})
		if err != nil {
			writeCodexError(w, err)
			return
		}
		view, err := g.buildCodexThreadListView(r.Context(), meta, threads)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"threads": view}})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/codex/threads":
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return
		}
		if g.codex == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "codex service not ready"})
			return
		}
		type reqBody struct {
			CWD               string `json:"cwd"`
			Model             string `json:"model"`
			ApprovalPolicy    string `json:"approval_policy"`
			SandboxMode       string `json:"sandbox_mode"`
			ApprovalsReviewer string `json:"approvals_reviewer"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		detail, err := g.codex.StartThread(r.Context(), codexbridge.StartThreadRequest{
			CWD:               strings.TrimSpace(body.CWD),
			Model:             strings.TrimSpace(body.Model),
			ApprovalPolicy:    strings.TrimSpace(body.ApprovalPolicy),
			SandboxMode:       strings.TrimSpace(body.SandboxMode),
			ApprovalsReviewer: strings.TrimSpace(body.ApprovalsReviewer),
		})
		if err != nil {
			writeCodexError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: detail})
		return

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/codex/threads/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return
		}
		if g.codex == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "codex service not ready"})
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/codex/threads/")
		parts := strings.Split(rest, "/")
		if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		threadID, err := url.PathUnescape(parts[0])
		if err != nil || strings.TrimSpace(threadID) == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		if len(parts) == 1 {
			if r.Method != http.MethodGet {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
				return
			}
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			detail, err := g.codex.ReadThread(r.Context(), threadID)
			if err != nil {
				writeCodexError(w, err)
				return
			}
			view, err := g.buildCodexThreadDetailView(r.Context(), meta, detail)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
			return
		}
		switch {
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "read":
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body codexMarkThreadReadRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			resp, err := g.markCodexThreadRead(r.Context(), meta, threadID, body)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: resp})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "archive":
			if err := g.codex.ArchiveThread(r.Context(), threadID); err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "unarchive":
			if err := g.codex.UnarchiveThread(r.Context(), threadID); err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "fork":
			type reqBody struct {
				Model             string `json:"model"`
				ApprovalPolicy    string `json:"approval_policy"`
				SandboxMode       string `json:"sandbox_mode"`
				ApprovalsReviewer string `json:"approvals_reviewer"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			detail, err := g.codex.ForkThread(r.Context(), codexbridge.ForkThreadRequest{
				ThreadID:          threadID,
				Model:             strings.TrimSpace(body.Model),
				ApprovalPolicy:    strings.TrimSpace(body.ApprovalPolicy),
				SandboxMode:       strings.TrimSpace(body.SandboxMode),
				ApprovalsReviewer: strings.TrimSpace(body.ApprovalsReviewer),
			})
			if err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: detail})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "interrupt":
			type reqBody struct {
				TurnID string `json:"turn_id"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := g.codex.InterruptTurn(r.Context(), codexbridge.InterruptTurnRequest{
				ThreadID: threadID,
				TurnID:   strings.TrimSpace(body.TurnID),
			}); err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "review":
			type reqBody struct {
				Target string `json:"target"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			detail, err := g.codex.StartReview(r.Context(), codexbridge.StartReviewRequest{
				ThreadID: threadID,
				Target:   strings.TrimSpace(body.Target),
			})
			if err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: detail})
			return
		case len(parts) == 2 && r.Method == http.MethodPost && parts[1] == "turns":
			type reqBody struct {
				InputText         string                       `json:"input_text"`
				Inputs            []codexbridge.UserInputEntry `json:"inputs"`
				CWD               string                       `json:"cwd"`
				Model             string                       `json:"model"`
				Effort            string                       `json:"effort"`
				ApprovalPolicy    string                       `json:"approval_policy"`
				SandboxMode       string                       `json:"sandbox_mode"`
				ApprovalsReviewer string                       `json:"approvals_reviewer"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			turn, err := g.codex.StartTurn(r.Context(), codexbridge.StartTurnRequest{
				ThreadID:          threadID,
				InputText:         strings.TrimSpace(body.InputText),
				Inputs:            body.Inputs,
				CWD:               strings.TrimSpace(body.CWD),
				Model:             strings.TrimSpace(body.Model),
				Effort:            strings.TrimSpace(body.Effort),
				ApprovalPolicy:    strings.TrimSpace(body.ApprovalPolicy),
				SandboxMode:       strings.TrimSpace(body.SandboxMode),
				ApprovalsReviewer: strings.TrimSpace(body.ApprovalsReviewer),
			})
			if err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"turn": turn}})
			return
		case len(parts) == 3 && r.Method == http.MethodPost && parts[1] == "turns" && parts[2] == "steer":
			type reqBody struct {
				ExpectedTurnID string                       `json:"expected_turn_id"`
				Inputs         []codexbridge.UserInputEntry `json:"inputs"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			turn, err := g.codex.SteerTurn(r.Context(), codexbridge.SteerTurnRequest{
				ThreadID:       threadID,
				ExpectedTurnID: strings.TrimSpace(body.ExpectedTurnID),
				Inputs:         body.Inputs,
			})
			if err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"turn": turn}})
			return
		case len(parts) == 2 && r.Method == http.MethodGet && parts[1] == "events":
			g.handleCodexEventStream(w, r, threadID)
			return
		case len(parts) == 4 && r.Method == http.MethodPost && parts[1] == "requests" && parts[3] == "response":
			requestID, err := url.PathUnescape(parts[2])
			if err != nil || strings.TrimSpace(requestID) == "" {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
				return
			}
			type reqBody struct {
				Type     string              `json:"type"`
				Decision string              `json:"decision"`
				Answers  map[string][]string `json:"answers"`
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body reqBody
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := g.codex.RespondToRequest(r.Context(), threadID, requestID, codexbridge.PendingRequestResponse{
				Type:     strings.TrimSpace(body.Type),
				Decision: strings.TrimSpace(body.Decision),
				Answers:  body.Answers,
			}); err != nil {
				writeCodexError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		default:
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/provider_keys/status":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		type reqBody struct {
			ProviderIDs []string `json:"provider_ids"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		set, err := g.secrets.GetAIProviderAPIKeySet(body.ProviderIDs)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load ai provider key status"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/ai/provider_keys":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		type patch struct {
			ProviderID string  `json:"provider_id"`
			APIKey     *string `json:"api_key"`
		}
		type reqBody struct {
			Patches []patch `json:"patches"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if len(body.Patches) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing patches"})
			return
		}

		converted := make([]settings.AIProviderAPIKeyPatch, 0, len(body.Patches))
		touched := make([]string, 0, len(body.Patches))
		for i := range body.Patches {
			p := body.Patches[i]
			id := strings.TrimSpace(p.ProviderID)
			if id == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid provider_id"})
				return
			}
			var key *string
			if p.APIKey != nil {
				v := strings.TrimSpace(*p.APIKey)
				key = &v
			}
			converted = append(converted, settings.AIProviderAPIKeyPatch{ProviderID: id, APIKey: key})
			touched = append(touched, id)
		}

		if err := g.secrets.ApplyAIProviderAPIKeyPatches(converted); err != nil {
			g.appendAudit(meta, "ai_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}

		set, err := g.secrets.GetAIProviderAPIKeySet(touched)
		if err != nil {
			g.appendAudit(meta, "ai_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load ai provider key status"})
			return
		}

		g.appendAudit(meta, "ai_provider_key_update", "success", map[string]any{"providers": touched}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/web_search_provider_keys/status":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		type reqBody struct {
			ProviderIDs []string `json:"provider_ids"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		set, err := g.secrets.GetWebSearchProviderAPIKeySet(body.ProviderIDs)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load web search provider key status"})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/ai/web_search_provider_keys":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		type patch struct {
			ProviderID string  `json:"provider_id"`
			APIKey     *string `json:"api_key"`
		}
		type reqBody struct {
			Patches []patch `json:"patches"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body reqBody
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if len(body.Patches) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing patches"})
			return
		}

		converted := make([]settings.WebSearchProviderAPIKeyPatch, 0, len(body.Patches))
		touched := make([]string, 0, len(body.Patches))
		for i := range body.Patches {
			p := body.Patches[i]
			id := strings.TrimSpace(p.ProviderID)
			if id == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid provider_id"})
				return
			}
			var key *string
			if p.APIKey != nil {
				v := strings.TrimSpace(*p.APIKey)
				key = &v
			}
			converted = append(converted, settings.WebSearchProviderAPIKeyPatch{ProviderID: id, APIKey: key})
			touched = append(touched, id)
		}

		if err := g.secrets.ApplyWebSearchProviderAPIKeyPatches(converted); err != nil {
			g.appendAudit(meta, "web_search_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}

		set, err := g.secrets.GetWebSearchProviderAPIKeySet(touched)
		if err != nil {
			g.appendAudit(meta, "web_search_provider_key_update", "failure", map[string]any{"providers": touched}, err)
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "failed to load web search provider key status"})
			return
		}

		g.appendAudit(meta, "web_search_provider_key_update", "success", map[string]any{"providers": touched}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"provider_api_key_set": set}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/skills":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		catalog, err := g.ai.ListSkillsCatalog()
		if err != nil {
			g.appendAudit(meta, "ai_skills_list", "failure", nil, err)
			writeAISkillError(w, http.StatusServiceUnavailable, err)
			return
		}
		g.appendAudit(meta, "ai_skills_list", "success", map[string]any{"catalog_version": catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/skills/reload":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		catalog, err := g.ai.ReloadSkillsCatalog()
		if err != nil {
			g.appendAudit(meta, "ai_skills_reload", "failure", nil, err)
			writeAISkillError(w, http.StatusServiceUnavailable, err)
			return
		}
		g.appendAudit(meta, "ai_skills_reload", "success", map[string]any{"catalog_version": catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/ai/skills/toggles":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		var body struct {
			Patches []ai.SkillTogglePatch `json:"patches"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if len(body.Patches) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing patches"})
			return
		}
		catalog, err := g.ai.PatchSkillToggles(body.Patches)
		if err != nil {
			g.appendAudit(meta, "ai_skills_toggle_update", "failure", map[string]any{"patches": len(body.Patches)}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_toggle_update", "success", map[string]any{"patches": len(body.Patches), "catalog_version": catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/skills":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		var body struct {
			Scope       string `json:"scope"`
			Name        string `json:"name"`
			Description string `json:"description"`
			Body        string `json:"body,omitempty"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		catalog, err := g.ai.CreateSkill(body.Scope, body.Name, body.Description, body.Body)
		if err != nil {
			g.appendAudit(meta, "ai_skills_create", "failure", map[string]any{"scope": strings.TrimSpace(body.Scope), "name": strings.TrimSpace(body.Name)}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_create", "success", map[string]any{"scope": strings.TrimSpace(body.Scope), "name": strings.TrimSpace(body.Name), "catalog_version": catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		return

	case r.Method == http.MethodDelete && r.URL.Path == "/_redeven_proxy/api/ai/skills":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		var body struct {
			Scope string `json:"scope"`
			Name  string `json:"name"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		catalog, err := g.ai.DeleteSkill(body.Scope, body.Name)
		if err != nil {
			g.appendAudit(meta, "ai_skills_delete", "failure", map[string]any{"scope": strings.TrimSpace(body.Scope), "name": strings.TrimSpace(body.Name)}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_delete", "success", map[string]any{"scope": strings.TrimSpace(body.Scope), "name": strings.TrimSpace(body.Name), "catalog_version": catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/skills/import/github/catalog":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		query := r.URL.Query()
		req := ai.SkillGitHubCatalogRequest{
			Repo:        strings.TrimSpace(query.Get("repo")),
			Ref:         strings.TrimSpace(query.Get("ref")),
			BasePath:    strings.TrimSpace(query.Get("base_path")),
			ForceReload: strings.EqualFold(strings.TrimSpace(query.Get("force_reload")), "true"),
		}
		out, err := g.ai.ListGitHubSkillCatalog(req)
		if err != nil {
			g.appendAudit(meta, "ai_skills_github_catalog_list", "failure", map[string]any{"repo": req.Repo, "ref": req.Ref, "base_path": req.BasePath}, err)
			writeAISkillError(w, http.StatusServiceUnavailable, err)
			return
		}
		g.appendAudit(meta, "ai_skills_github_catalog_list", "success", map[string]any{"repo": out.Source.Repo, "ref": out.Source.Ref, "base_path": out.Source.BasePath, "skills": len(out.Skills)}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/skills/import/github/validate":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body ai.SkillGitHubImportRequest
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		out, err := g.ai.ValidateGitHubSkillImport(body)
		if err != nil {
			g.appendAudit(meta, "ai_skills_github_validate", "failure", map[string]any{"scope": strings.TrimSpace(body.Scope), "repo": strings.TrimSpace(body.Repo), "ref": strings.TrimSpace(body.Ref), "paths": len(body.Paths), "url": strings.TrimSpace(body.URL) != ""}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_github_validate", "success", map[string]any{"scope": strings.TrimSpace(body.Scope), "repo": strings.TrimSpace(body.Repo), "ref": strings.TrimSpace(body.Ref), "resolved": len(out.Resolved)}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/skills/import/github":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body ai.SkillGitHubImportRequest
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		out, err := g.ai.ImportGitHubSkills(body)
		if err != nil {
			g.appendAudit(meta, "ai_skills_github_import", "failure", map[string]any{"scope": strings.TrimSpace(body.Scope), "repo": strings.TrimSpace(body.Repo), "ref": strings.TrimSpace(body.Ref), "paths": len(body.Paths), "url": strings.TrimSpace(body.URL) != ""}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_github_import", "success", map[string]any{"scope": strings.TrimSpace(body.Scope), "repo": strings.TrimSpace(body.Repo), "ref": strings.TrimSpace(body.Ref), "imports": len(out.Imports), "catalog_version": out.Catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/skills/sources":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		out, err := g.ai.ListSkillSources()
		if err != nil {
			g.appendAudit(meta, "ai_skills_sources_list", "failure", nil, err)
			writeAISkillError(w, http.StatusServiceUnavailable, err)
			return
		}
		g.appendAudit(meta, "ai_skills_sources_list", "success", map[string]any{"items": len(out.Items)}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/skills/reinstall":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body struct {
			Paths     []string `json:"paths"`
			Overwrite bool     `json:"overwrite,omitempty"`
		}
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		out, err := g.ai.ReinstallSkills(body.Paths, body.Overwrite)
		if err != nil {
			g.appendAudit(meta, "ai_skills_reinstall", "failure", map[string]any{"paths": len(body.Paths), "overwrite": body.Overwrite}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_reinstall", "success", map[string]any{"paths": len(body.Paths), "reinstalled": len(out.Reinstalled), "catalog_version": out.Catalog.CatalogVersion}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/skills/browse/tree":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		query := r.URL.Query()
		skillPath := strings.TrimSpace(query.Get("skill_path"))
		dir := strings.TrimSpace(query.Get("dir"))
		out, err := g.ai.BrowseSkillTree(skillPath, dir)
		if err != nil {
			g.appendAudit(meta, "ai_skills_browse_tree", "failure", map[string]any{"skill_path": skillPath, "dir": dir}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_browse_tree", "success", map[string]any{"skill_path": skillPath, "dir": out.Dir, "entries": len(out.Entries)}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/skills/browse/file":
		meta, ok := g.requirePermission(w, r, requiredPermissionRead)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		query := r.URL.Query()
		skillPath := strings.TrimSpace(query.Get("skill_path"))
		filePath := strings.TrimSpace(query.Get("file"))
		encoding := strings.TrimSpace(query.Get("encoding"))
		maxBytes := 0
		if raw := strings.TrimSpace(query.Get("max_bytes")); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n <= 0 {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid max_bytes"})
				return
			}
			maxBytes = n
		}
		out, err := g.ai.BrowseSkillFile(skillPath, filePath, encoding, maxBytes)
		if err != nil {
			g.appendAudit(meta, "ai_skills_browse_file", "failure", map[string]any{"skill_path": skillPath, "file": filePath, "encoding": encoding}, err)
			writeAISkillError(w, http.StatusBadRequest, err)
			return
		}
		g.appendAudit(meta, "ai_skills_browse_file", "success", map[string]any{"skill_path": skillPath, "file": out.File, "encoding": out.Encoding, "truncated": out.Truncated}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/models":
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		models, err := g.ai.ListModels()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: models})
		return

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/ai/current_model":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}

		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body struct {
			ModelID string `json:"model_id"`
		}
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		modelID := strings.TrimSpace(body.ModelID)
		if modelID == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing model_id"})
			return
		}

		persist := func(next *config.AIConfig) error {
			_, err := g.updateConfigLocked(func(c *config.Config) error {
				if c.AI == nil {
					return errors.New("ai not configured")
				}
				c.AI = next
				return nil
			})
			return err
		}

		if err := g.ai.SetCurrentModelID(modelID, persist); err != nil {
			g.appendAudit(meta, "ai_current_model_update", "failure", map[string]any{"model_id": modelID}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		models, err := g.ai.ListModels()
		if err != nil {
			g.appendAudit(meta, "ai_current_model_update", "failure", map[string]any{"model_id": modelID}, err)
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
			return
		}
		g.appendAudit(meta, "ai_current_model_update", "success", map[string]any{"model_id": modelID}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: models})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/validate_working_dir":
		_, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body struct {
			WorkingDir string `json:"working_dir"`
		}
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		cleaned, err := g.ai.ValidateWorkingDir(body.WorkingDir)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"working_dir": cleaned}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/threads":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}

		limit := 50
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

		out, err := g.ai.ListThreads(r.Context(), meta, limit, cursor)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		view, err := g.buildAIListThreadsView(r.Context(), meta, out)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/threads":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var body ai.CreateThreadRequest
		if err := dec.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}

		th, err := g.ai.CreateThread(r.Context(), meta, body.Title, body.ModelID, body.ExecutionMode, body.WorkingDir)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		view, err := g.buildAIThreadEnvelope(r.Context(), meta, th)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/threads/"):
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/threads/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		threadID := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}

		if threadID == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		switch {
		case action == "" && r.Method == http.MethodGet:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			th, err := g.ai.GetThread(r.Context(), meta, threadID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			if th == nil {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
				return
			}
			view, err := g.buildAIThreadEnvelope(r.Context(), meta, th)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
			return

		case action == "" && r.Method == http.MethodPatch:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.PatchThreadRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}

			if body.Title == nil && body.ModelID == nil && body.ExecutionMode == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			if body.Title != nil {
				if err := g.ai.RenameThread(r.Context(), meta, threadID, *body.Title); err != nil {
					status := http.StatusBadRequest
					if errors.Is(err, sql.ErrNoRows) {
						status = http.StatusNotFound
					}
					writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
					return
				}
			}
			if body.ModelID != nil {
				if err := g.ai.SetThreadModel(r.Context(), meta, threadID, *body.ModelID); err != nil {
					status := http.StatusBadRequest
					if errors.Is(err, sql.ErrNoRows) {
						status = http.StatusNotFound
					} else if errors.Is(err, ai.ErrModelSwitchRequiresExplicitRestart) || errors.Is(err, ai.ErrModelLockViolation) {
						status = http.StatusConflict
					}
					writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
					return
				}
			}
			if body.ExecutionMode != nil {
				if err := g.ai.SetThreadExecutionMode(r.Context(), meta, threadID, *body.ExecutionMode); err != nil {
					status := http.StatusBadRequest
					if errors.Is(err, sql.ErrNoRows) {
						status = http.StatusNotFound
					}
					writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
					return
				}
			}
			th, err := g.ai.GetThread(r.Context(), meta, threadID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			if th == nil {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
				return
			}
			view, err := g.buildAIThreadEnvelope(r.Context(), meta, th)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
			return

		case action == "read" && r.Method == http.MethodPost:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body aiMarkThreadReadRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			resp, err := g.markAIThreadRead(r.Context(), meta, threadID, body)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: resp})
			return

		case action == "cancel" && r.Method == http.MethodPost:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			if err := g.ai.CancelThread(meta, threadID); err != nil {
				g.appendAudit(meta, "ai_thread_cancel", "failure", map[string]any{"thread_id": threadID}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_thread_cancel", "success", map[string]any{"thread_id": threadID}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "" && r.Method == http.MethodDelete:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			force := false
			if raw := strings.TrimSpace(r.URL.Query().Get("force")); raw != "" {
				if raw == "1" || strings.EqualFold(raw, "true") {
					force = true
				}
			}
			if err := g.deleteFlowerThreadWithReadStateCleanup(r.Context(), meta, threadID, func() error {
				return g.ai.DeleteThread(r.Context(), meta, threadID, force)
			}); err != nil {
				status := http.StatusBadRequest
				var cleanupErr flowerThreadDeleteCleanupError
				if errors.As(err, &cleanupErr) {
					status = http.StatusInternalServerError
				} else if errors.Is(err, ai.ErrThreadBusy) {
					status = http.StatusConflict
				} else if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				g.appendAudit(meta, "ai_thread_delete", "failure", map[string]any{"thread_id": threadID}, err)
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_thread_delete", "success", map[string]any{"thread_id": threadID}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "todos" && r.Method == http.MethodGet:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			out, err := g.ai.GetThreadTodos(r.Context(), meta, threadID)
			if err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"todos": out}})
			return

		case action == "followups" && r.Method == http.MethodGet && len(parts) == 2:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			out, err := g.ai.ListFollowups(r.Context(), meta, threadID, 100)
			if err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
			return

		case action == "followups" && r.Method == http.MethodPatch && len(parts) == 3 && strings.TrimSpace(parts[2]) == "order":
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.ReorderFollowupsRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := g.ai.ReorderFollowups(r.Context(), meta, threadID, body); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, ai.ErrFollowupsRevisionChanged) {
					status = http.StatusConflict
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "followups" && r.Method == http.MethodPatch && len(parts) == 3:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			followupID := strings.TrimSpace(parts[2])
			if followupID == "" {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.PatchFollowupRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if body.Text == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			if err := g.ai.UpdateFollowup(r.Context(), meta, threadID, followupID, body); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "followups" && r.Method == http.MethodDelete && len(parts) == 3:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			followupID := strings.TrimSpace(parts[2])
			if followupID == "" {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
				return
			}
			if err := g.ai.DeleteFollowup(r.Context(), meta, threadID, followupID); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return

		case action == "messages" && r.Method == http.MethodGet:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}

			limit := 200
			if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
				if v, err := strconv.Atoi(raw); err == nil {
					limit = v
				}
			}
			var beforeID int64
			if raw := strings.TrimSpace(r.URL.Query().Get("before_id")); raw != "" {
				if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
					beforeID = v
				}
			}

			out, err := g.ai.ListThreadMessages(r.Context(), meta, threadID, limit, beforeID)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
			return

		case action == "messages" && r.Method == http.MethodPost:
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if g.ai == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai service not ready"})
				return
			}
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			var body ai.AppendThreadMessageRequest
			if err := dec.Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := dec.Decode(&struct{}{}); err != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if err := g.ai.AppendThreadMessage(r.Context(), meta, threadID, body.Role, body.Text, body.Format); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/runs":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID := strings.TrimSpace(meta.ChannelID)
		if channelID == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session"})
			return
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var req ai.RunStartRequest
		if err := dec.Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		if err := dec.Decode(&struct{}{}); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}

		if strings.TrimSpace(req.ThreadID) == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing thread_id"})
			return
		}
		if g.ai.HasActiveThreadForEndpoint(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(req.ThreadID)) {
			writeJSON(w, http.StatusConflict, apiResp{OK: false, Error: "thread already active"})
			return
		}
		th, err := g.ai.GetThread(r.Context(), meta, strings.TrimSpace(req.ThreadID))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if th == nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "thread not found"})
			return
		}

		if strings.TrimSpace(req.Model) == "" {
			if m := strings.TrimSpace(th.ModelID); m != "" {
				req.Model = m
			} else {
				models, err := g.ai.ListModels()
				if err != nil {
					writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: err.Error()})
					return
				}
				req.Model = models.CurrentModel
			}
		}

		runID, err := ai.NewRunID()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to allocate run id"})
			return
		}

		// Stream response (NDJSON).
		w.Header().Set("X-Redeven-AI-Run-ID", runID)
		w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
		w.WriteHeader(http.StatusOK)

		// Block until the run completes (or the client disconnects).
		startedAt := time.Now()
		runErr := g.ai.StartRun(r.Context(), meta, runID, req, w)
		auditDetail := map[string]any{
			"run_id":      runID,
			"thread_id":   strings.TrimSpace(req.ThreadID),
			"model":       strings.TrimSpace(req.Model),
			"duration_ms": time.Since(startedAt).Milliseconds(),
		}
		if runErr != nil {
			g.log.Warn("ai run failed", "channel_id", channelID, "run_id", runID, "error", runErr)
			g.appendAudit(meta, "ai_run", "failure", auditDetail, runErr)
			return
		}
		g.appendAudit(meta, "ai_run", "success", auditDetail, nil)
		return

	case (r.Method == http.MethodPost || r.Method == http.MethodGet) && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/runs/"):
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		channelID := strings.TrimSpace(meta.ChannelID)
		if channelID == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session"})
			return
		}

		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/runs/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		runID := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}
		if runID == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		if r.Method == http.MethodGet && len(parts) == 4 && action == "tools" && strings.TrimSpace(parts[3]) == "output" {
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			metaOnly := false
			switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("meta_only"))) {
			case "1", "true", "yes", "y", "on":
				metaOnly = true
			}
			toolID := strings.TrimSpace(parts[2])
			if toolID == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing tool_id"})
				return
			}
			out, err := g.ai.GetTerminalToolOutput(r.Context(), meta, runID, toolID)
			if err != nil {
				g.appendAudit(meta, "ai_terminal_output", "failure", map[string]any{
					"run_id":  runID,
					"tool_id": toolID,
				}, err)
				status := http.StatusBadRequest
				if errors.Is(err, sql.ErrNoRows) {
					status = http.StatusNotFound
				}
				writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
				return
			}
			if metaOnly {
				// Default terminal view only needs status/metadata; output is fetched lazily when expanded.
				out.Stdout = ""
				out.Stderr = ""
				out.RawResult = ""
			}
			g.appendAudit(meta, "ai_terminal_output", "success", map[string]any{
				"run_id":      runID,
				"tool_id":     toolID,
				"status":      strings.TrimSpace(out.Status),
				"stdout_size": len(out.Stdout),
				"stderr_size": len(out.Stderr),
			}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
			return
		}

		if r.Method == http.MethodPost && action == "cancel" {
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if err := g.ai.CancelRun(meta, runID); err != nil {
				g.appendAudit(meta, "ai_run_cancel", "failure", map[string]any{"run_id": runID}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_run_cancel", "success", map[string]any{"run_id": runID}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		if r.Method == http.MethodGet && action == "events" {
			limit := 300
			if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
				if v, err := strconv.Atoi(raw); err == nil && v > 0 {
					limit = v
				}
			}
			cursor := int64(0)
			if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
				v, err := strconv.ParseInt(raw, 10, 64)
				if err != nil || v < 0 {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid cursor"})
					return
				}
				cursor = v
			}
			category := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("category")))
			out, err := g.ai.ListRunEventsWithQuery(r.Context(), meta, runID, ai.ListRunEventsQuery{
				Cursor:   cursor,
				Limit:    limit,
				Category: category,
			})
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
			return
		}

		if r.Method == http.MethodPost && action == "tool_approvals" {
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			var body ai.ToolApprovalRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if strings.TrimSpace(body.ToolID) == "" {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing tool_id"})
				return
			}
			if err := g.ai.ApproveTool(meta, runID, body.ToolID, body.Approved); err != nil {
				g.appendAudit(meta, "ai_tool_approval", "failure", map[string]any{
					"run_id":   runID,
					"tool_id":  strings.TrimSpace(body.ToolID),
					"approved": body.Approved,
				}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "ai_tool_approval", "success", map[string]any{
				"run_id":   runID,
				"tool_id":  strings.TrimSpace(body.ToolID),
				"approved": body.Approved,
			}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/ai/uploads":
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		// 10 MiB upload cap (aligned with ChatInput defaults).
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid multipart form"})
			return
		}
		f, fh, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing file"})
			return
		}
		defer f.Close()

		name := ""
		mimeType := ""
		if fh != nil {
			name = fh.Filename
			mimeType = fh.Header.Get("Content-Type")
		}

		out, err := g.ai.SaveUpload(r.Context(), strings.TrimSpace(meta.EndpointID), f, name, mimeType, 10<<20)
		if err != nil {
			g.appendAudit(meta, "ai_upload", "failure", map[string]any{
				"name":      strings.TrimSpace(name),
				"mime_type": strings.TrimSpace(mimeType),
			}, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		uploadID := ""
		if out != nil {
			u := strings.TrimSpace(out.URL)
			if u != "" {
				u = strings.TrimSuffix(u, "/")
				if i := strings.LastIndex(u, "/"); i >= 0 {
					uploadID = strings.TrimSpace(u[i+1:])
				}
			}
		}
		g.appendAudit(meta, "ai_upload", "success", map[string]any{
			"upload_id": uploadID,
			"name":      strings.TrimSpace(out.Name),
			"mime_type": strings.TrimSpace(out.MimeType),
			"size":      out.Size,
		}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: out})
		return

	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/ai/uploads/"):
		meta, ok := g.requirePermission(w, r, requiredPermissionFull)
		if !ok {
			return
		}
		if g.ai == nil || !g.ai.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "ai not configured"})
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/uploads/")
		rest = strings.TrimPrefix(rest, "/")
		uploadID := strings.TrimSpace(rest)
		if uploadID == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		info, filePath, err := g.ai.OpenUpload(r.Context(), strings.TrimSpace(meta.EndpointID), uploadID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: err.Error()})
			return
		}

		f, err := os.Open(filePath)
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		w.Header().Set("Content-Type", strings.TrimSpace(info.MimeType))
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", info.Name))
		http.ServeContent(w, r, info.Name, st.ModTime(), f)
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/spaces":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return
		}
		spaces, err := g.backend.ListSpaces(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"spaces": spaces}})
		return

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/forwards":
		if _, ok := g.requirePermission(w, r, requiredPermissionExecute); !ok {
			return
		}
		if g.pf == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
			return
		}
		forwards, err := g.pf.ListForwards(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
			return
		}
		views := make([]portForwardView, 0, len(forwards))
		for _, f := range forwards {
			views = append(views, portForwardView{
				ForwardID:          f.ForwardID,
				TargetURL:          f.TargetURL,
				Name:               f.Name,
				Description:        f.Description,
				HealthPath:         f.HealthPath,
				InsecureSkipVerify: f.InsecureSkipVerify,
				CreatedAtUnixMs:    f.CreatedAtUnixMs,
				UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
				LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
				Health:             portForwardHealth{Status: "unknown"},
			})
		}

		// Best-effort health probing (bounded concurrency + tight timeout).
		sem := make(chan struct{}, 8)
		var wg sync.WaitGroup
		for i := range views {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
				case <-r.Context().Done():
					return
				}
				defer func() { <-sem }()
				views[i].Health = probePortForwardHealth(r.Context(), views[i].TargetURL)
			}(i)
		}
		wg.Wait()

		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"forwards": views}})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/forwards":
		meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
		if !ok {
			return
		}
		if g.pf == nil {
			g.appendAudit(meta, "port_forward_create", "failure", nil, errors.New("portforward not ready"))
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
			return
		}
		var req portforward.CreateForwardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		scheme, host := auditURLHost(req.Target)
		auditDetail := map[string]any{
			"target_scheme":        scheme,
			"target_host":          host,
			"name":                 truncateString(req.Name, 80),
			"insecure_skip_verify": req.InsecureSkipVerify,
		}
		f, err := g.pf.CreateForward(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "port_forward_create", "failure", auditDetail, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if f == nil {
			g.appendAudit(meta, "port_forward_create", "failure", auditDetail, errors.New("failed to create forward"))
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "failed to create forward"})
			return
		}
		auditDetail["forward_id"] = f.ForwardID
		view := portForwardView{
			ForwardID:          f.ForwardID,
			TargetURL:          f.TargetURL,
			Name:               f.Name,
			Description:        f.Description,
			HealthPath:         f.HealthPath,
			InsecureSkipVerify: f.InsecureSkipVerify,
			CreatedAtUnixMs:    f.CreatedAtUnixMs,
			UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
			LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
			Health:             probePortForwardHealth(r.Context(), f.TargetURL),
		}
		g.appendAudit(meta, "port_forward_create", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/spaces":
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return
		}
		var req CreateSpaceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return
		}
		auditDetail := map[string]any{
			"path":        truncateString(req.Path, 160),
			"name":        truncateString(req.Name, 80),
			"description": truncateString(req.Description, 160),
		}
		s, err := g.backend.CreateSpace(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "codespace_create", "failure", auditDetail, err)
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
			return
		}
		if s != nil {
			auditDetail["code_space_id"] = s.CodeSpaceID
			auditDetail["workspace_path"] = truncateString(s.WorkspacePath, 160)
		}
		g.appendAudit(meta, "codespace_create", "success", auditDetail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
		return

	default:
		if strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/forwards/") {
			meta, ok := g.requirePermission(w, r, requiredPermissionExecute)
			if !ok {
				return
			}
			if g.pf == nil {
				writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "portforward not ready"})
				return
			}

			// /_redeven_proxy/api/forwards/<id>[/action]
			rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/forwards/")
			rest = strings.TrimPrefix(rest, "/")
			if rest == "" {
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
				return
			}
			parts := strings.Split(rest, "/")
			id := strings.TrimSpace(parts[0])
			action := ""
			if len(parts) > 1 {
				action = strings.TrimSpace(parts[1])
			}

			if r.Method == http.MethodDelete && action == "" {
				if err := g.pf.DeleteForward(r.Context(), id); err != nil {
					g.appendAudit(meta, "port_forward_delete", "failure", map[string]any{"forward_id": id}, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				g.appendAudit(meta, "port_forward_delete", "success", map[string]any{"forward_id": id}, nil)
				writeJSON(w, http.StatusOK, apiResp{OK: true})
				return
			}

			if r.Method == http.MethodPatch && action == "" {
				var req portforward.UpdateForwardRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
					return
				}
				if req.Target == nil && req.Name == nil && req.Description == nil && req.HealthPath == nil && req.InsecureSkipVerify == nil {
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
					return
				}
				auditDetail := map[string]any{"forward_id": id}
				if req.Target != nil {
					scheme, host := auditURLHost(*req.Target)
					auditDetail["target_scheme"] = scheme
					auditDetail["target_host"] = host
				}
				if req.Name != nil {
					auditDetail["name"] = truncateString(*req.Name, 80)
				}
				if req.InsecureSkipVerify != nil {
					auditDetail["insecure_skip_verify"] = *req.InsecureSkipVerify
				}
				f, err := g.pf.UpdateForward(r.Context(), id, req)
				if err != nil {
					g.appendAudit(meta, "port_forward_update", "failure", auditDetail, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				if f == nil {
					g.appendAudit(meta, "port_forward_update", "failure", auditDetail, errors.New("not found"))
					writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
					return
				}
				view := portForwardView{
					ForwardID:          f.ForwardID,
					TargetURL:          f.TargetURL,
					Name:               f.Name,
					Description:        f.Description,
					HealthPath:         f.HealthPath,
					InsecureSkipVerify: f.InsecureSkipVerify,
					CreatedAtUnixMs:    f.CreatedAtUnixMs,
					UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
					LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
					Health:             probePortForwardHealth(r.Context(), f.TargetURL),
				}
				g.appendAudit(meta, "port_forward_update", "success", auditDetail, nil)
				writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
				return
			}

			if r.Method == http.MethodPost && action == "touch" {
				f, err := g.pf.TouchLastOpened(r.Context(), id)
				if err != nil {
					g.appendAudit(meta, "port_forward_open", "failure", map[string]any{"forward_id": id}, err)
					writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
					return
				}
				if f == nil {
					g.appendAudit(meta, "port_forward_open", "failure", map[string]any{"forward_id": id}, errors.New("not found"))
					writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
					return
				}
				scheme, host := auditURLHost(f.TargetURL)
				g.appendAudit(meta, "port_forward_open", "success", map[string]any{
					"forward_id":    f.ForwardID,
					"target_scheme": scheme,
					"target_host":   host,
				}, nil)
				view := portForwardView{
					ForwardID:          f.ForwardID,
					TargetURL:          f.TargetURL,
					Name:               f.Name,
					Description:        f.Description,
					HealthPath:         f.HealthPath,
					InsecureSkipVerify: f.InsecureSkipVerify,
					CreatedAtUnixMs:    f.CreatedAtUnixMs,
					UpdatedAtUnixMs:    f.UpdatedAtUnixMs,
					LastOpenedAtUnixMs: f.LastOpenedAtUnixMs,
					Health:             probePortForwardHealth(r.Context(), f.TargetURL),
				}
				writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
				return
			}

			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		if !strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/spaces/") {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}

		// /_redeven_proxy/api/spaces/<id>[/action]
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/spaces/")
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return
		}
		parts := strings.Split(rest, "/")
		id := strings.TrimSpace(parts[0])
		action := ""
		if len(parts) > 1 {
			action = strings.TrimSpace(parts[1])
		}

		if r.Method == http.MethodDelete && action == "" {
			meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
			if !ok {
				return
			}
			if err := g.backend.DeleteSpace(r.Context(), id); err != nil {
				g.appendAudit(meta, "codespace_delete", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_delete", "success", map[string]any{"code_space_id": id}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}
		if r.Method == http.MethodPatch && action == "" {
			meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
			if !ok {
				return
			}
			var req UpdateSpaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return
			}
			if req.Name == nil && req.Description == nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing fields"})
				return
			}
			auditDetail := map[string]any{"code_space_id": id}
			if req.Name != nil {
				auditDetail["name"] = truncateString(*req.Name, 80)
			}
			if req.Description != nil {
				auditDetail["description"] = truncateString(*req.Description, 160)
			}
			s, err := g.backend.UpdateSpace(r.Context(), id, req)
			if err != nil {
				g.appendAudit(meta, "codespace_update", "failure", auditDetail, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_update", "success", auditDetail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "start" {
			// code-server is a "full environment" capability; require read+write+execute.
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			s, err := g.backend.StartSpace(r.Context(), id)
			if err != nil {
				g.appendAudit(meta, "codespace_start", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			auditDetail := map[string]any{"code_space_id": id}
			if s != nil {
				auditDetail["code_port"] = s.CodePort
			}
			g.appendAudit(meta, "codespace_start", "success", auditDetail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: s})
			return
		}
		if r.Method == http.MethodPost && action == "stop" {
			meta, ok := g.requirePermission(w, r, requiredPermissionFull)
			if !ok {
				return
			}
			if err := g.backend.StopSpace(r.Context(), id); err != nil {
				g.appendAudit(meta, "codespace_stop", "failure", map[string]any{"code_space_id": id}, err)
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
				return
			}
			g.appendAudit(meta, "codespace_stop", "success", map[string]any{"code_space_id": id}, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return
		}

		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return
	}
}

func (g *Gateway) handleCodeServerProxy(w http.ResponseWriter, r *http.Request) {
	// VS Code Web uses `vsda` (WASM) for signing during the remote connection handshake.
	//
	// In Redeven, code-server is an external dependency and some distributions do not ship
	// the `vsda` web artifacts under /static/node_modules/vsda/..., which results in 404s
	// and delays during startup/reconnect loops.
	//
	// To keep codespace UX deterministic, we serve a minimal, compatible shim here.
	// Security note: this does not provide real signing; it matches the current behavior
	// when vsda is missing (the client falls back to no-op signing).
	if maybeServeVSDAWebShim(w, r) {
		return
	}

	extScheme, extHost, err := externalOriginFromRequest(r)
	if err != nil {
		http.Error(w, "missing external origin", http.StatusBadRequest)
		return
	}
	codeSpaceID, ok := codeSpaceIDFromRequest(r)
	if !ok {
		http.Error(w, "not a codespace origin", http.StatusNotFound)
		return
	}
	localPrefix := localCodeSpaceBasePath(r)

	port, err := g.backend.ResolveCodeServerPort(r.Context(), codeSpaceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)}
	origin := fmt.Sprintf("%s://%s", extScheme, extHost)

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			if localPrefix != "" {
				pr.Out.URL.Path = stripCodeSpaceProxyPrefix(pr.In.URL.Path, localPrefix)
				if pr.In.URL.RawPath != "" {
					pr.Out.URL.RawPath = stripCodeSpaceProxyPrefix(pr.In.URL.RawPath, localPrefix)
				} else {
					pr.Out.URL.RawPath = ""
				}
				pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			}
			// code-server enforces host == origin.
			pr.Out.Host = extHost
			pr.Out.Header.Set("Origin", origin)
			// Hardening: ensure code-server getHost() is not polluted by forwarded headers.
			// (code-server prefers Forwarded/X-Forwarded-Host over Host)
			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Port")
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r)
}

func codeSpaceIDFromRequest(r *http.Request) (string, bool) {
	if route, ok := localUIRouteFromRequest(r); ok && route.kind == localUIRouteCodeSpace {
		id := strings.TrimSpace(route.codeSpaceID)
		if id == "" {
			return "", false
		}
		return id, true
	}
	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return "", false
	}
	return codeSpaceIDFromExternalHost(host)
}

func localCodeSpaceBasePath(r *http.Request) string {
	route, ok := localUIRouteFromRequest(r)
	if !ok || route.kind != localUIRouteCodeSpace {
		return ""
	}
	codeSpaceID := strings.TrimSpace(route.codeSpaceID)
	if codeSpaceID == "" {
		return ""
	}
	return "/cs/" + codeSpaceID
}

func portForwardIDFromRequest(r *http.Request) (string, bool) {
	if route, ok := localUIRouteFromRequest(r); ok && route.kind == localUIRoutePortForward {
		id := strings.TrimSpace(route.forwardID)
		if id == "" {
			return "", false
		}
		return id, true
	}
	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return "", false
	}
	return forwardIDFromExternalHost(host)
}

func localPortForwardBasePath(r *http.Request) string {
	route, ok := localUIRouteFromRequest(r)
	if !ok || route.kind != localUIRoutePortForward {
		return ""
	}
	forwardID := strings.TrimSpace(route.forwardID)
	if forwardID == "" {
		return ""
	}
	return "/pf/" + forwardID
}

func codespaceRequestRootPath(r *http.Request) string {
	if base := localCodeSpaceBasePath(r); base != "" {
		return base + "/"
	}
	return "/"
}

func stripCodeSpaceProxyPrefix(path string, prefix string) string {
	p := strings.TrimSpace(path)
	if p == "" {
		return "/"
	}
	if prefix == "" {
		return p
	}
	out := strings.TrimPrefix(p, prefix)
	if out == "" {
		return "/"
	}
	if !strings.HasPrefix(out, "/") {
		out = "/" + out
	}
	return out
}

const (
	vsdaWebJSSuffix   = "/static/node_modules/vsda/rust/web/vsda.js"
	vsdaWebWasmSuffix = "/static/node_modules/vsda/rust/web/vsda_bg.wasm"
)

var (
	vsdaWebShimJS = []byte(`(function () {
  // Minimal shim for VS Code web SignService.
  //
  // It implements:
  // - globalThis.vsda_web (what VS Code checks for)
  // - a best-effort AMD define() call to avoid loader warnings
  //
  // Security note: this does not provide real signing; it matches the no-op behavior
  // when vsda is unavailable.
  if (typeof globalThis === "undefined") return;

  function Validator() {}
  Validator.prototype.free = function () {};
  Validator.prototype.createNewMessage = function (original) { return String(original ?? ""); };
  Validator.prototype.validate = function () { return "ok"; };

  const impl = {
    default: async function () {},
    sign: function (salted_message) { return String(salted_message ?? ""); },
    validator: Validator
  };

  // VS Code checks this global directly (see signService.ts).
  if (typeof globalThis.vsda_web === "undefined") {
    globalThis.vsda_web = impl;
  }

  // VS Code's AMD loader expects a define() call; provide one to avoid warnings.
  try {
    const d = globalThis.define;
    if (typeof d === "function" && d.amd) {
      d([], function () { return impl; });
    }
  } catch {
    // ignore
  }
})();`)

	// The shim does not use the WASM bytes, but VS Code still fetches them.
	// Keep it non-empty so response.arrayBuffer() is stable across environments.
	vsdaWebShimWasm = []byte{
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	}
)

func maybeServeVSDAWebShim(w http.ResponseWriter, r *http.Request) bool {
	if w == nil || r == nil || r.URL == nil {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}

	p := r.URL.Path
	switch {
	case strings.HasSuffix(p, vsdaWebJSSuffix):
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return true
		}
		_, _ = w.Write(vsdaWebShimJS)
		return true
	case strings.HasSuffix(p, vsdaWebWasmSuffix):
		w.Header().Set("Content-Type", "application/wasm")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return true
		}
		_, _ = w.Write(vsdaWebShimWasm)
		return true
	default:
		return false
	}
}

type portForwardHealth struct {
	Status              string `json:"status"` // healthy|unreachable|unknown
	LastCheckedAtUnixMs int64  `json:"last_checked_at_unix_ms"`
	LatencyMs           int64  `json:"latency_ms"`
	LastError           string `json:"last_error"`
}

type portForwardView struct {
	ForwardID          string `json:"forward_id"`
	TargetURL          string `json:"target_url"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	HealthPath         string `json:"health_path"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`

	CreatedAtUnixMs    int64 `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64 `json:"updated_at_unix_ms"`
	LastOpenedAtUnixMs int64 `json:"last_opened_at_unix_ms"`

	Health portForwardHealth `json:"health"`
}

func probePortForwardHealth(ctx context.Context, targetURL string) portForwardHealth {
	out := portForwardHealth{
		Status:              "unknown",
		LastCheckedAtUnixMs: time.Now().UnixMilli(),
		LatencyMs:           0,
		LastError:           "",
	}
	u, err := portforward.ParseTargetURL(strings.TrimSpace(targetURL))
	if err != nil || u == nil {
		out.LastError = truncateErr(err)
		return out
	}
	host := strings.TrimSpace(u.Host)
	if host == "" {
		out.LastError = "missing target host"
		return out
	}

	probeCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
	defer cancel()

	start := time.Now()
	conn, err := (&net.Dialer{Timeout: 800 * time.Millisecond}).DialContext(probeCtx, "tcp", host)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		out.Status = "unreachable"
		out.LatencyMs = latency
		out.LastError = truncateErr(err)
		return out
	}
	_ = conn.Close()

	out.Status = "healthy"
	out.LatencyMs = latency
	return out
}

func truncateErr(err error) string {
	if err == nil {
		return ""
	}
	s := strings.TrimSpace(err.Error())
	const max = 200
	if len(s) <= max {
		return s
	}
	return strings.TrimSpace(s[:max]) + "..."
}

func (g *Gateway) handlePortForwardProxy(w http.ResponseWriter, r *http.Request) {
	if g == nil || r == nil {
		http.Error(w, "gateway not ready", http.StatusServiceUnavailable)
		return
	}
	if g.pf == nil {
		http.Error(w, "portforward not configured", http.StatusServiceUnavailable)
		return
	}

	extScheme, extHost, err := externalOriginFromRequest(r)
	if err != nil {
		http.Error(w, "missing external origin", http.StatusBadRequest)
		return
	}
	forwardID, ok := portForwardIDFromRequest(r)
	if !ok {
		http.Error(w, "not a port forward origin", http.StatusNotFound)
		return
	}
	localPrefix := localPortForwardBasePath(r)

	fw, err := g.pf.GetForward(r.Context(), forwardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if fw == nil {
		http.Error(w, "port forward not found", http.StatusNotFound)
		return
	}

	targetURL, err := portforward.ParseTargetURL(strings.TrimSpace(fw.TargetURL))
	if err != nil {
		http.Error(w, "invalid port forward target", http.StatusInternalServerError)
		return
	}

	targetBase := &url.URL{Scheme: targetURL.Scheme, Host: targetURL.Host}
	targetOrigin := fmt.Sprintf("%s://%s", targetURL.Scheme, targetURL.Host)

	extOrigin := fmt.Sprintf("%s://%s", extScheme, extHost)
	extWsScheme := "ws"
	if extScheme == "https" {
		extWsScheme = "wss"
	}
	extWsOrigin := fmt.Sprintf("%s://%s", extWsScheme, extHost)
	extHTTPBase := extOrigin + localPrefix
	extWSBase := extWsOrigin + localPrefix

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     false,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: fw.InsecureSkipVerify,
		},
		// Disable HTTP/2 to keep WebSocket upgrade behavior predictable.
		TLSNextProto: make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}

	proxy := &httputil.ReverseProxy{
		Transport: transport,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(targetBase)
			if localPrefix != "" {
				pr.Out.URL.Path = stripCodeSpaceProxyPrefix(pr.In.URL.Path, localPrefix)
				if pr.In.URL.RawPath != "" {
					pr.Out.URL.RawPath = stripCodeSpaceProxyPrefix(pr.In.URL.RawPath, localPrefix)
				} else {
					pr.Out.URL.RawPath = ""
				}
				pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			}

			// Compatibility-first: make the upstream believe it is serving its own origin.
			pr.Out.Host = targetURL.Host
			pr.Out.Header.Set("Origin", targetOrigin)
			if strings.TrimSpace(pr.Out.Header.Get("Referer")) != "" {
				pr.Out.Header.Set("Referer", targetOrigin)
			}

			// Let the Go transport manage gzip so ModifyResponse can safely rewrite HTML.
			pr.Out.Header.Del("Accept-Encoding")

			// Hardening: ensure upstream getHost() is not polluted by forwarded headers.
			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Port")
		},
		ModifyResponse: func(resp *http.Response) error {
			if resp == nil {
				return nil
			}

			// Compatibility-first for embedded iframe + injected script.
			resp.Header.Del("Content-Security-Policy")
			resp.Header.Del("Content-Security-Policy-Report-Only")
			resp.Header.Del("X-Frame-Options")

			// Rewrite Location back to the sandbox origin when redirecting to the target itself.
			if loc := strings.TrimSpace(resp.Header.Get("Location")); loc != "" {
				resp.Header.Set("Location", rewriteLocationToProxy(loc, targetURL, localPrefix))
			}

			// Strip Domain from Set-Cookie so cookies bind to pf-* host.
			if sc := resp.Header.Values("Set-Cookie"); len(sc) > 0 {
				resp.Header.Del("Set-Cookie")
				for _, v := range sc {
					resp.Header.Add("Set-Cookie", stripCookieDomain(v))
				}
			}

			ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
			if !strings.Contains(ct, "text/html") {
				return nil
			}

			// Best-effort HTML rewrite for absolute URLs that point back to the target origin.
			const maxHTMLBytes = 2 << 20 // 2 MiB
			b, err := io.ReadAll(io.LimitReader(resp.Body, maxHTMLBytes+1))
			if err != nil {
				return err
			}
			_ = resp.Body.Close()

			// Too large: keep the original body (but it is already decompressed).
			if len(b) > maxHTMLBytes {
				resp.Body = io.NopCloser(bytes.NewReader(b))
				resp.ContentLength = int64(len(b))
				resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(b)))
				return nil
			}

			rewritten := rewriteHTMLOrigins(string(b), targetURL, extHTTPBase, extWSBase)
			resp.Body = io.NopCloser(strings.NewReader(rewritten))
			resp.ContentLength = int64(len(rewritten))
			resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
			// Body was modified; validators are no longer reliable.
			resp.Header.Del("ETag")
			resp.Header.Del("Last-Modified")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}

	proxy.ServeHTTP(w, r)
}

func rewriteLocationToProxy(location string, target *url.URL, proxyBasePath string) string {
	loc := strings.TrimSpace(location)
	if loc == "" || target == nil {
		return location
	}
	u, err := url.Parse(loc)
	if err != nil || u == nil {
		return location
	}
	if strings.TrimSpace(u.Host) == "" {
		if strings.TrimSpace(proxyBasePath) != "" && strings.HasPrefix(loc, "/") {
			path := u.EscapedPath()
			if strings.TrimSpace(path) == "" {
				path = "/"
			}
			if strings.TrimSpace(u.RawQuery) != "" {
				path += "?" + u.RawQuery
			}
			if strings.TrimSpace(u.Fragment) != "" {
				path += "#" + u.Fragment
			}
			return joinProxyBasePath(proxyBasePath, path)
		}
		return location
	}

	targetHost := strings.ToLower(strings.TrimSpace(target.Hostname()))
	targetPort := strings.TrimSpace(target.Port())
	if targetPort == "" {
		targetPort = defaultPortForScheme(strings.ToLower(strings.TrimSpace(target.Scheme)))
	}

	locHost := strings.ToLower(strings.TrimSpace(u.Hostname()))
	locPort := strings.TrimSpace(u.Port())
	if locPort == "" {
		scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
		if scheme == "" {
			scheme = strings.ToLower(strings.TrimSpace(target.Scheme))
		}
		locPort = defaultPortForScheme(scheme)
	}

	if locHost != targetHost || (targetPort != "" && locPort != "" && locPort != targetPort) {
		return location
	}

	// Redirect within the target itself: rewrite back to the visible proxy path.
	// Remote pf-* origins stay root-relative; local /pf/<id> routes keep their prefix.
	path := u.EscapedPath()
	if strings.TrimSpace(path) == "" {
		path = "/"
	}
	if strings.TrimSpace(u.RawQuery) != "" {
		path += "?" + u.RawQuery
	}
	if strings.TrimSpace(u.Fragment) != "" {
		path += "#" + u.Fragment
	}
	return joinProxyBasePath(proxyBasePath, path)
}

func defaultPortForScheme(scheme string) string {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https", "wss":
		return "443"
	case "http", "ws":
		return "80"
	default:
		return ""
	}
}

func stripCookieDomain(v string) string {
	raw := strings.TrimSpace(v)
	if raw == "" {
		return v
	}
	parts := strings.Split(raw, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if strings.HasPrefix(strings.ToLower(t), "domain=") {
			continue
		}
		out = append(out, t)
	}
	return strings.Join(out, "; ")
}

func rewriteHTMLOrigins(html string, target *url.URL, externalHTTPBase string, externalWSBase string) string {
	if html == "" || target == nil {
		return html
	}

	extHTTPBase := strings.TrimSpace(externalHTTPBase)
	extProtocolRelativeBase := ""
	if extHTTPBase != "" {
		if u, err := url.Parse(extHTTPBase); err == nil && u != nil {
			extProtocolRelativeBase = "//" + strings.TrimSpace(u.Host) + strings.TrimRight(strings.TrimSpace(u.EscapedPath()), "/")
		}
	}
	extWSBase := strings.TrimSpace(externalWSBase)

	targetHostPort := strings.TrimSpace(target.Host)
	targetHostname := strings.TrimSpace(target.Hostname())
	targetPort := strings.TrimSpace(target.Port())

	hosts := []string{targetHostPort}
	// Also rewrite the no-port variant when the target uses the default port for its scheme.
	if targetHostname != "" && targetPort != "" && targetPort == defaultPortForScheme(target.Scheme) {
		hosts = append(hosts, targetHostname)
	}

	out := html
	for _, h := range hosts {
		if h == "" {
			continue
		}
		out = strings.ReplaceAll(out, "http://"+h, extHTTPBase)
		out = strings.ReplaceAll(out, "https://"+h, extHTTPBase)
		out = strings.ReplaceAll(out, "ws://"+h, extWSBase)
		out = strings.ReplaceAll(out, "wss://"+h, extWSBase)
		if extProtocolRelativeBase != "" {
			out = strings.ReplaceAll(out, "//"+h, extProtocolRelativeBase)
		}
	}
	return out
}

func joinProxyBasePath(basePath string, targetPath string) string {
	base := strings.TrimRight("/"+strings.Trim(strings.TrimSpace(basePath), "/"), "/")
	if base == "" || base == "/" {
		base = ""
	}
	p := strings.TrimSpace(targetPath)
	if p == "" {
		p = "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	if base == "" {
		return p
	}
	if p == "/" {
		return base + "/"
	}
	return base + p
}

func (g *Gateway) maybeRedirectCodespaceRootToWorkspace(w http.ResponseWriter, r *http.Request) bool {
	if g == nil || r == nil || g.backend == nil || r.URL == nil {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	rootPath := codespaceRequestRootPath(r)
	if rootPath == "" || r.URL.Path != rootPath {
		return false
	}

	q := r.URL.Query()
	if strings.TrimSpace(q.Get("folder")) != "" || strings.TrimSpace(q.Get("workspace")) != "" {
		return false
	}

	codeSpaceID, ok := codeSpaceIDFromRequest(r)
	if !ok {
		return false
	}

	spaces, err := g.backend.ListSpaces(r.Context())
	if err != nil {
		return false
	}
	var workspacePath string
	for _, sp := range spaces {
		if sp.CodeSpaceID != codeSpaceID {
			continue
		}
		workspacePath = strings.TrimSpace(sp.WorkspacePath)
		break
	}
	if workspacePath == "" {
		return false
	}

	q.Set("folder", workspacePath)
	q.Del("workspace")

	u := &url.URL{Path: rootPath, RawQuery: q.Encode()}
	http.Redirect(w, r, u.String(), http.StatusFound)
	return true
}

func externalOriginFromRequest(r *http.Request) (scheme string, host string, err error) {
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

func channelIDFromRequest(r *http.Request) (string, error) {
	if r != nil {
		channelID := strings.TrimSpace(r.Header.Get(sessionhop.HeaderChannelID))
		if channelID != "" {
			return channelID, nil
		}
	}

	_, host, err := externalOriginFromRequest(r)
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

	// Env App sessions inject a second label: "ch-<base32(channel_id)>"
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

func codeSpaceIDFromExternalHost(host string) (string, bool) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", false
	}
	// Remove port if present (domain names only).
	hostNoPort := host
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	firstLabel := strings.Split(hostNoPort, ".")[0]
	firstLabel = strings.ToLower(strings.TrimSpace(firstLabel))
	if !strings.HasPrefix(firstLabel, "cs-") {
		return "", false
	}
	id := strings.TrimPrefix(firstLabel, "cs-")
	id = strings.TrimSpace(id)
	if id == "" {
		return "", false
	}
	return id, true
}

func forwardIDFromExternalHost(host string) (string, bool) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", false
	}
	// Remove port if present (domain names only).
	hostNoPort := host
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	firstLabel := strings.Split(hostNoPort, ".")[0]
	firstLabel = strings.ToLower(strings.TrimSpace(firstLabel))
	if !strings.HasPrefix(firstLabel, "pf-") {
		return "", false
	}
	id := strings.TrimPrefix(firstLabel, "pf-")
	id = strings.TrimSpace(id)
	if id == "" {
		return "", false
	}
	return id, true
}

type originRole int

const (
	originRoleUnknown originRole = iota
	originRoleEnv
	originRoleCodeSpace
	originRolePortForward
)

func originRoleFromRequest(r *http.Request) originRole {
	_, host, err := externalOriginFromRequest(r)
	if err != nil {
		return originRoleUnknown
	}

	hostNoPort := strings.TrimSpace(host)
	if i := strings.IndexByte(hostNoPort, ':'); i >= 0 {
		hostNoPort = hostNoPort[:i]
	}
	first := strings.ToLower(strings.TrimSpace(strings.Split(hostNoPort, ".")[0]))
	switch {
	case strings.HasPrefix(first, "env-"):
		return originRoleEnv
	case strings.HasPrefix(first, "cs-"):
		return originRoleCodeSpace
	case strings.HasPrefix(first, "pf-"):
		return originRolePortForward
	default:
		return originRoleUnknown
	}
}
