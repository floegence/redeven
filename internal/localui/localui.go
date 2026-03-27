package localui

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
	"github.com/floegence/flowersec/flowersec-go/realtime/ws"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/agent"
	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/diagnostics"
	localuiruntime "github.com/floegence/redeven-agent/internal/localui/runtime"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// LocalEnvPublicID is the fixed env_public_id used for Local UI mode.
	LocalEnvPublicID = "env_local"

	localAccessResumeHeader = "X-Redeven-Access-Resume"
	localAccessResumeQuery  = "redeven_access_resume"

	localNamespacePublicID = "ns_local"
	localUserPublicID      = "user_local"
	localUserEmail         = "local@redeven"
)

type Options struct {
	Logger *slog.Logger
	Bind   BindSpec

	DesktopManaged   bool
	EffectiveRunMode string
	RemoteEnabled    bool

	// Gateway is the Env App gateway handler mounted under /_redeven_proxy/*.
	Gateway *gateway.Gateway

	// Agent serves direct sessions (RPC/streams) after a successful E2EE handshake.
	Agent *agent.Agent

	// ConfigPath is the absolute path to the agent config file.
	// It is used to compute the local permission cap and to render Settings consistently.
	ConfigPath string

	// Version is the agent build version (used by /api/local/agent/version/latest).
	Version string

	// Diagnostics stores structured debug-only request timing events.
	Diagnostics *diagnostics.Store

	// AccessGate protects the local browser entry when password mode is enabled.
	AccessGate *accessgate.Gate
}

type Server struct {
	log *slog.Logger

	bind               BindSpec
	configPath         string
	stateDir           string
	runtimeStatePath   string
	version            string
	desktopManaged     bool
	effectiveRunMode   string
	remoteEnabled      bool
	localPermissionCap *config.PermissionSet

	gw   *gateway.Gateway
	a    *agent.Agent
	diag *diagnostics.Store

	accessGate *accessgate.Gate

	pendingMu sync.Mutex
	pending   map[string]pendingDirect

	listeners []net.Listener
	srv       *http.Server
}

type pendingDirect struct {
	psk                   [32]byte
	initExpireAtUnixS     int64
	meta                  session.Meta
	traceID               string
	connectInfoIssuedAtMs int64
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/cs/", s.handleCodeSpace)
	// Browsers may request these root-level assets regardless of the actual SPA base path.
	// Keep them available to avoid noisy 404s in Local UI mode.
	mux.HandleFunc("/favicon.ico", s.handleFavicon)
	mux.HandleFunc("/logo.png", s.handleLogo)
	mux.HandleFunc("/api/local/access/status", s.handleAccessStatus)
	mux.HandleFunc("/api/local/access/unlock", s.handleAccessUnlock)
	mux.HandleFunc("/api/local/access/logout", s.handleAccessLogout)
	mux.HandleFunc("/api/local/runtime", s.handleRuntime)
	mux.HandleFunc("/api/local/direct/connect_info", s.handleConnectInfo)
	mux.HandleFunc("/api/local/environment", s.handleEnvironment)
	mux.HandleFunc("/api/local/agent/version/latest", s.handleLatestVersion)
	mux.HandleFunc("/_redeven_direct/ws", s.handleDirectWS)
	// Reuse the existing gateway for Env App UI + management APIs.
	mux.HandleFunc("/_redeven_proxy/", s.handleGateway)
	if s.diag == nil {
		return mux
	}
	return s.withDiagnostics(mux)
}

func New(opts Options) (*Server, error) {
	if opts.Agent == nil {
		return nil, errors.New("missing Agent")
	}
	if opts.Gateway == nil {
		return nil, errors.New("missing Gateway")
	}
	if strings.TrimSpace(opts.ConfigPath) == "" {
		return nil, errors.New("missing ConfigPath")
	}
	bind := opts.Bind
	if bind.Host() == "" && bind.Port() == 0 {
		var err error
		bind, err = ParseBind(DefaultBind)
		if err != nil {
			return nil, err
		}
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	configPath := strings.TrimSpace(opts.ConfigPath)
	localPermissionCap := config.ResolvePermissionCapFromConfigPath(
		configPath,
		localUserPublicID,
		agent.FloeAppRedevenAgent,
		config.PermissionSet{Read: true, Write: false, Execute: true},
	)
	return &Server{
		log:                logger,
		bind:               bind,
		configPath:         configPath,
		stateDir:           filepath.Dir(configPath),
		runtimeStatePath:   localuiruntime.RuntimeStatePath(configPath),
		version:            strings.TrimSpace(opts.Version),
		desktopManaged:     opts.DesktopManaged,
		effectiveRunMode:   strings.TrimSpace(opts.EffectiveRunMode),
		remoteEnabled:      opts.RemoteEnabled,
		localPermissionCap: &localPermissionCap,
		gw:                 opts.Gateway,
		a:                  opts.Agent,
		diag:               opts.Diagnostics,
		accessGate:         opts.AccessGate,
		pending:            make(map[string]pendingDirect),
	}, nil
}

func (s *Server) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if s.srv != nil {
		return nil
	}

	var listeners []net.Listener
	var errs []string
	for _, addr := range s.bind.ListenAddrs() {
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", addr, err))
			continue
		}
		listeners = append(listeners, ln)
	}
	if len(listeners) == 0 {
		return fmt.Errorf("listen %s failed: %s", s.bind.ListenLabel(), strings.Join(errs, "; "))
	}
	for _, errText := range errs {
		s.log.Warn("local ui listener unavailable", "bind", s.bind.ListenLabel(), "error", errText)
	}

	srv := &http.Server{
		Handler:           s.handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.srv = srv
	s.listeners = listeners

	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()

	go s.sweepLoop(ctx)

	for _, ln := range listeners {
		ln := ln
		go func() {
			if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.log.Error("local ui server stopped", "addr", ln.Addr().String(), "error", err)
			}
		}()
	}

	if err := localuiruntime.WriteState(s.runtimeStatePath, localuiruntime.State{
		LocalUIURL:         firstNonEmptyString(s.DisplayURLs()),
		LocalUIURLs:        s.DisplayURLs(),
		EffectiveRunMode:   s.effectiveRunMode,
		RemoteEnabled:      s.remoteEnabled,
		DesktopManaged:     s.desktopManaged,
		StateDir:           s.stateDir,
		DiagnosticsEnabled: s.diag != nil && s.diag.Enabled(),
		PID:                os.Getpid(),
	}); err != nil {
		_ = s.Close()
		return fmt.Errorf("write local runtime state: %w", err)
	}

	s.log.Info("local ui listening", "bind", s.ListenLabel())
	return nil
}

func (s *Server) Close() error {
	if s == nil {
		return nil
	}
	if s.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(ctx)
	}
	for _, ln := range s.listeners {
		_ = ln.Close()
	}
	if err := localuiruntime.RemoveState(s.runtimeStatePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.log.Warn("failed to remove local runtime state", "path", s.runtimeStatePath, "error", err)
	}
	s.srv = nil
	s.listeners = nil
	return nil
}

func (s *Server) Port() int {
	if s == nil {
		return 0
	}
	for _, ln := range s.listeners {
		if ln == nil {
			continue
		}
		if addr, ok := ln.Addr().(*net.TCPAddr); ok && addr.Port > 0 {
			return addr.Port
		}
	}
	return s.bind.Port()
}

func (s *Server) ListenLabel() string {
	if s == nil {
		return ""
	}
	return s.bind.ListenLabelForPort(s.Port())
}

func (s *Server) DisplayURLs() []string {
	if s == nil {
		return nil
	}
	return s.bind.DisplayURLsForPort(s.Port())
}

type apiResp struct {
	OK    bool      `json:"ok"`
	Error *apiError `json:"error,omitempty"`
	Data  any       `json:"data,omitempty"`
}

type apiError struct {
	Message string `json:"message"`
}

type accessStatusResp struct {
	PasswordRequired bool `json:"password_required"`
	Unlocked         bool `json:"unlocked"`
}

type accessUnlockReq struct {
	Password string `json:"password"`
}

func (s *Server) accessEnabled() bool {
	return s != nil && s.accessGate != nil && s.accessGate.Enabled()
}

func localAccessResumeMeta() session.Meta {
	return session.Meta{
		EndpointID:        LocalEnvPublicID,
		FloeApp:           agent.FloeAppRedevenAgent,
		CodeSpaceID:       "env-ui",
		SessionKind:       "envapp_rpc",
		UserPublicID:      localUserPublicID,
		UserEmail:         localUserEmail,
		NamespacePublicID: localNamespacePublicID,
	}
}

func (s *Server) localAccessToken(r *http.Request) string {
	if s == nil || r == nil {
		return ""
	}
	c, err := r.Cookie(accessgate.LocalSessionCookieName)
	if err != nil || c == nil {
		return ""
	}
	return strings.TrimSpace(c.Value)
}

func (s *Server) localAccessResumeToken(r *http.Request) string {
	if s == nil || r == nil {
		return ""
	}
	if token := strings.TrimSpace(r.Header.Get(localAccessResumeHeader)); token != "" {
		return token
	}
	return strings.TrimSpace(r.URL.Query().Get(localAccessResumeQuery))
}

func (s *Server) hasLocalAccess(r *http.Request) bool {
	if !s.accessEnabled() {
		return true
	}
	token := s.localAccessToken(r)
	if token == "" {
		return s.accessGate.CanResumeMeta(s.localAccessResumeToken(r), localAccessResumeMeta())
	}
	return s.accessGate.IsLocalSessionValid(token)
}

func (s *Server) setLocalAccessCookie(w http.ResponseWriter, token string, expiresAtUnixMs int64) {
	if w == nil || token == "" {
		return
	}
	expiresAt := time.UnixMilli(expiresAtUnixMs)
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
}

func (s *Server) clearLocalAccessCookie(w http.ResponseWriter) {
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func (s *Server) requireLocalAccessAPI(w http.ResponseWriter, r *http.Request) bool {
	if s.hasLocalAccess(r) {
		return true
	}
	writeJSON(w, http.StatusLocked, apiResp{OK: false, Error: &apiError{Message: "access password required"}})
	return false
}

func (s *Server) requireLocalAccessHTTP(w http.ResponseWriter, r *http.Request) bool {
	if s.hasLocalAccess(r) {
		return true
	}
	http.Error(w, "access password required", http.StatusLocked)
	return false
}

func (s *Server) isPublicEnvAppRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	p := strings.TrimSpace(r.URL.Path)
	return p == "/_redeven_proxy/env" || p == "/_redeven_proxy/env/" || strings.HasPrefix(p, "/_redeven_proxy/env/")
}

func (s *Server) handleGateway(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.gw == nil {
		http.NotFound(w, r)
		return
	}
	if s.accessEnabled() && !s.hasLocalAccess(r) && !s.isPublicEnvAppRequest(r) {
		http.Error(w, "access password required", http.StatusLocked)
		return
	}
	s.gw.ServeHTTP(w, gateway.WithLocalUIEnvRoute(r))
}

func (s *Server) handleCodeSpace(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.gw == nil {
		http.NotFound(w, r)
		return
	}
	codeSpaceID, basePath, ok := localCodeSpaceRoute(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == basePath {
		target := basePath + "/"
		if rawQuery := strings.TrimSpace(r.URL.RawQuery); rawQuery != "" {
			target += "?" + rawQuery
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	if s.accessEnabled() && !s.hasLocalAccess(r) {
		http.Error(w, "access password required", http.StatusLocked)
		return
	}
	s.gw.ServeHTTP(w, gateway.WithLocalUICodeSpaceRoute(r, codeSpaceID))
}

func localCodeSpaceRoute(path string) (codeSpaceID string, basePath string, ok bool) {
	p := strings.TrimSpace(path)
	if !strings.HasPrefix(p, "/cs/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(p, "/cs/")
	if rest == "" {
		return "", "", false
	}
	codeSpaceID, _, _ = strings.Cut(rest, "/")
	codeSpaceID = strings.TrimSpace(codeSpaceID)
	if codeSpaceID == "" {
		return "", "", false
	}
	return codeSpaceID, "/cs/" + codeSpaceID, true
}

func (s *Server) handleAccessStatus(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: accessStatusResp{
		PasswordRequired: s.accessEnabled(),
		Unlocked:         s.hasLocalAccess(r),
	}})
}

func (s *Server) handleAccessUnlock(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.accessEnabled() {
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"unlocked": true}})
		return
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req accessUnlockReq
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	result, err := s.accessGate.MintLocalSession(req.Password)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResp{OK: false, Error: &apiError{Message: err.Error()}})
		return
	}
	s.setLocalAccessCookie(w, result.SessionToken, result.SessionExpiresAtUnix)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
}

func (s *Server) handleAccessLogout(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.accessEnabled() {
		if token := s.localAccessToken(r); token != "" {
			s.accessGate.RevokeLocalSession(token)
		}
		if resumeToken := s.localAccessResumeToken(r); resumeToken != "" {
			s.accessGate.RevokeResumeToken(resumeToken)
		}
	}
	s.clearLocalAccessCookie(w)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"ok": true}})
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.Redirect(w, r, "/_redeven_proxy/env/", http.StatusFound)
}

func (s *Server) handleFavicon(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The Env App ships its own favicon under the embedded gateway base path.
	http.Redirect(w, r, "/_redeven_proxy/env/favicon.svg", http.StatusFound)
}

func (s *Server) handleLogo(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Keep the legacy root-level logo URL working so UI code doesn't need to special-case Local UI mode.
	http.Redirect(w, r, "/_redeven_proxy/env/logo.png", http.StatusFound)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) withDiagnostics(next http.Handler) http.Handler {
	if s == nil || s.diag == nil || next == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(diagnostics.EnabledHeader, strconv.FormatBool(s.diag.Enabled()))
		if r == nil {
			next.ServeHTTP(w, r)
			return
		}
		path := strings.TrimSpace(r.URL.Path)
		if !s.diag.Enabled() || !shouldTraceLocalUIPath(path) || shouldSkipLocalUIDiagnosticsPath(path) {
			next.ServeHTTP(w, r)
			return
		}
		traceID := localUITraceID(r)
		if traceID == "" {
			traceID = diagnostics.NewTraceID()
		}
		if traceID != "" {
			r = r.WithContext(diagnostics.WithTraceID(r.Context(), traceID))
			w.Header().Set(diagnostics.TraceHeader, traceID)
		}
		startedAt := time.Now()
		rw := diagnostics.NewStatusWriter(w)
		next.ServeHTTP(rw, r)
		s.diag.Append(diagnostics.Event{
			Scope:      diagnostics.ScopeLocalUIHTTP,
			Kind:       "request",
			TraceID:    traceID,
			Method:     r.Method,
			Path:       path,
			StatusCode: rw.StatusCode(),
			DurationMs: time.Since(startedAt).Milliseconds(),
			Detail: map[string]any{
				"route_kind": localUIDiagnosticsRouteKind(path),
			},
		})
	})
}

func localUITraceID(r *http.Request) string {
	if r == nil {
		return ""
	}
	if traceID := diagnostics.TraceIDFromContext(r.Context()); traceID != "" {
		return traceID
	}
	return strings.TrimSpace(r.Header.Get(diagnostics.TraceHeader))
}

func shouldTraceLocalUIPath(path string) bool {
	path = strings.TrimSpace(path)
	switch {
	case strings.HasPrefix(path, "/api/local/"):
		return true
	case path == "/_redeven_direct/ws":
		return true
	case strings.HasPrefix(path, "/_redeven_proxy/"):
		return true
	default:
		return false
	}
}

func shouldSkipLocalUIDiagnosticsPath(path string) bool {
	path = strings.TrimSpace(path)
	return strings.HasPrefix(path, "/_redeven_proxy/api/debug/diagnostics")
}

func localUIDiagnosticsRouteKind(path string) string {
	path = strings.TrimSpace(path)
	switch {
	case strings.HasPrefix(path, "/api/local/"):
		return "local_api"
	case path == "/_redeven_direct/ws":
		return "direct_ws"
	case strings.HasPrefix(path, "/_redeven_proxy/"):
		return "gateway_entry"
	default:
		return "other"
	}
}

type runtimeResp struct {
	Mode             string `json:"mode"`
	EnvPublicID      string `json:"env_public_id"`
	DirectWSURL      string `json:"direct_ws_url"`
	DesktopManaged   bool   `json:"desktop_managed,omitempty"`
	EffectiveRunMode string `json:"effective_run_mode,omitempty"`
	RemoteEnabled    bool   `json:"remote_enabled,omitempty"`
}

func (s *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	wsURL, _ := s.directWSURLFromRequest(r)
	writeJSON(w, http.StatusOK, runtimeResp{
		Mode:             "local",
		EnvPublicID:      LocalEnvPublicID,
		DirectWSURL:      wsURL,
		DesktopManaged:   s.desktopManaged,
		EffectiveRunMode: s.resolvedEffectiveRunMode(),
		RemoteEnabled:    s.remoteEnabled,
	})
}

func (s *Server) directWSURLFromRequest(r *http.Request) (string, error) {
	if r == nil {
		return "", errors.New("nil request")
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return "", errors.New("missing host")
	}
	scheme := "ws"
	if r.TLS != nil {
		scheme = "wss"
	}
	return (&url.URL{Scheme: scheme, Host: host, Path: "/_redeven_direct/ws"}).String(), nil
}

func randomB64u(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid length")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Server) mintPending(meta session.Meta, wsURL string, traceID string) (*directv1.DirectConnectInfo, error) {
	if s == nil {
		return nil, errors.New("server not ready")
	}
	channelID, err := randomB64u(24)
	if err != nil {
		return nil, err
	}
	var psk [32]byte
	if _, err := rand.Read(psk[:]); err != nil {
		return nil, err
	}

	// Keep the init window reasonably short; the UI can always mint a fresh connect_info.
	now := time.Now()
	initExp := now.Add(10 * time.Minute).Unix()

	meta.ChannelID = channelID

	s.pendingMu.Lock()
	s.pending[channelID] = pendingDirect{
		psk:                   psk,
		initExpireAtUnixS:     initExp,
		meta:                  meta,
		traceID:               strings.TrimSpace(traceID),
		connectInfoIssuedAtMs: now.UnixMilli(),
	}
	s.pendingMu.Unlock()

	return &directv1.DirectConnectInfo{
		WsUrl:                    strings.TrimSpace(wsURL),
		ChannelId:                channelID,
		E2eePskB64u:              base64.RawURLEncoding.EncodeToString(psk[:]),
		ChannelInitExpireAtUnixS: initExp,
		DefaultSuite:             directv1.Suite_X25519_HKDF_SHA256_AES_256_GCM,
	}, nil
}

func (s *Server) handleConnectInfo(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Only accept empty body to keep the endpoint stable; reject unknown inputs.
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&struct{}{}); err != nil && err != io.EOF {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	wsURL, err := s.directWSURLFromRequest(r)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	cap := s.resolveLocalCap()
	meta := localAccessResumeMeta()
	meta.ChannelID = ""
	meta.CanRead = cap.Read
	meta.CanWrite = cap.Write
	meta.CanExecute = cap.Execute
	meta.CanAdmin = true
	meta.CreatedAtUnixMs = time.Now().UnixMilli()

	traceID := localUITraceID(r)
	info, err := s.mintPending(meta, wsURL, traceID)
	if err != nil {
		http.Error(w, "failed to mint connect info", http.StatusInternalServerError)
		return
	}

	if s.diag != nil {
		s.diag.Append(diagnostics.Event{
			Scope:   diagnostics.ScopeDirectSession,
			Kind:    "connect_info_issued",
			TraceID: traceID,
			Message: "issued direct connect info",
			Detail: map[string]any{
				"channel_id":    info.ChannelId,
				"floe_app":      meta.FloeApp,
				"code_space_id": meta.CodeSpaceID,
			},
		})
	}

	writeJSON(w, http.StatusOK, info)
}

type environmentResp struct {
	PublicID          string `json:"public_id"`
	Name              string `json:"name"`
	Description       string `json:"description,omitempty"`
	NamespacePublicID string `json:"namespace_public_id"`
	Status            string `json:"status"`
	LifecycleStatus   string `json:"lifecycle_status"`
	Agent             *struct {
		OS       string `json:"os,omitempty"`
		Arch     string `json:"arch,omitempty"`
		Hostname string `json:"hostname,omitempty"`
		LastSeen string `json:"last_seen,omitempty"`
	} `json:"agent,omitempty"`
	Permissions *struct {
		CanRead    bool `json:"can_read"`
		CanWrite   bool `json:"can_write"`
		CanExecute bool `json:"can_execute"`
		CanAdmin   bool `json:"can_admin"`
		IsOwner    bool `json:"is_owner"`
	} `json:"permissions,omitempty"`
}

func (s *Server) handleEnvironment(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cap := s.resolveLocalCap()

	host, _ := os.Hostname()
	now := time.Now().UTC().Format(time.RFC3339)

	writeJSON(w, http.StatusOK, environmentResp{
		PublicID:          LocalEnvPublicID,
		Name:              "Local Environment",
		NamespacePublicID: localNamespacePublicID,
		Status:            "online",
		LifecycleStatus:   "running",
		Agent: &struct {
			OS       string `json:"os,omitempty"`
			Arch     string `json:"arch,omitempty"`
			Hostname string `json:"hostname,omitempty"`
			LastSeen string `json:"last_seen,omitempty"`
		}{
			OS:       runtime.GOOS,
			Arch:     runtime.GOARCH,
			Hostname: strings.TrimSpace(host),
			LastSeen: now,
		},
		Permissions: &struct {
			CanRead    bool `json:"can_read"`
			CanWrite   bool `json:"can_write"`
			CanExecute bool `json:"can_execute"`
			CanAdmin   bool `json:"can_admin"`
			IsOwner    bool `json:"is_owner"`
		}{
			CanRead:    cap.Read,
			CanWrite:   cap.Write,
			CanExecute: cap.Execute,
			CanAdmin:   true,
			IsOwner:    true,
		},
	})
}

type latestVersionResp struct {
	CurrentVersion     string `json:"current_version"`
	LatestVersion      string `json:"latest_version,omitempty"`
	RecommendedVersion string `json:"recommended_version,omitempty"`
	UpgradePolicy      string `json:"upgrade_policy"`
	ReleasePageURL     string `json:"release_page_url,omitempty"`
	Message            string `json:"message,omitempty"`
	DesktopManaged     bool   `json:"desktop_managed,omitempty"`
	EffectiveRunMode   string `json:"effective_run_mode,omitempty"`
	RemoteEnabled      bool   `json:"remote_enabled,omitempty"`
}

func (s *Server) handleLatestVersion(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	v := strings.TrimSpace(s.version)
	if v == "" {
		v = "unknown"
	}
	message := "Offline: latest version check is unavailable in local mode."
	upgradePolicy := "manual"
	if s.desktopManaged {
		message = "Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade."
		upgradePolicy = "desktop_release"
	}
	writeJSON(w, http.StatusOK, latestVersionResp{
		CurrentVersion:   v,
		UpgradePolicy:    upgradePolicy,
		Message:          message,
		DesktopManaged:   s.desktopManaged,
		EffectiveRunMode: s.resolvedEffectiveRunMode(),
		RemoteEnabled:    s.remoteEnabled,
	})
}

func (s *Server) resolvedEffectiveRunMode() string {
	if s == nil {
		return ""
	}
	mode := strings.TrimSpace(s.effectiveRunMode)
	if mode != "" {
		return mode
	}
	if s.remoteEnabled {
		return "hybrid"
	}
	return "local"
}

func (s *Server) resolveLocalCap() config.PermissionSet {
	if s == nil || s.localPermissionCap == nil {
		return config.PermissionSet{Read: true, Write: false, Execute: true}
	}
	return *s.localPermissionCap
}

func (s *Server) consumePending(channelID string) (pendingDirect, bool) {
	if s == nil {
		return pendingDirect{}, false
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return pendingDirect{}, false
	}
	now := time.Now().Unix()

	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()

	p, ok := s.pending[id]
	if !ok {
		return pendingDirect{}, false
	}
	delete(s.pending, id)
	if p.initExpireAtUnixS <= 0 || now > p.initExpireAtUnixS {
		return pendingDirect{}, false
	}
	return p, true
}

func (s *Server) handleDirectWS(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	traceID := localUITraceID(r)
	if !s.requireLocalAccessHTTP(w, r) {
		return
	}
	if !sameOriginWSRequest(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	startedAt := time.Now()
	c, err := ws.Upgrade(w, r, ws.UpgraderOptions{CheckOrigin: sameOriginWSRequest})
	if err != nil {
		s.log.Warn("local direct ws upgrade failed", "error", err)
		if s.diag != nil {
			s.diag.Append(diagnostics.Event{Scope: diagnostics.ScopeDirectSession, Kind: "upgrade_failed", TraceID: traceID, DurationMs: time.Since(startedAt).Milliseconds(), Message: err.Error()})
		}
		return
	}
	defer c.Close()

	var resolved pendingDirect
	var resolvedOK bool
	var ch string
	sess, err := endpoint.AcceptDirectWSResolved(r.Context(), c.Underlying(), endpoint.AcceptDirectResolverOptions{
		ClockSkew: 60 * time.Second,
		Resolve: func(_ctx context.Context, init endpoint.DirectHandshakeInit) (endpoint.DirectHandshakeSecrets, error) {
			ch = strings.TrimSpace(init.ChannelID)
			p, ok := s.consumePending(ch)
			if !ok {
				return endpoint.DirectHandshakeSecrets{}, errors.New("unknown or expired channel")
			}
			resolved = p
			resolvedOK = true
			return endpoint.DirectHandshakeSecrets{
				PSK:               resolved.psk[:],
				InitExpireAtUnixS: resolved.initExpireAtUnixS,
			}, nil
		},
	})
	if err != nil {
		s.log.Warn("local direct ws handshake failed", "channel_id", ch, "error", err)
		if s.diag != nil {
			failureTraceID := strings.TrimSpace(traceID)
			if resolved.traceID != "" {
				failureTraceID = strings.TrimSpace(resolved.traceID)
			}
			s.diag.Append(diagnostics.Event{
				Scope:      diagnostics.ScopeDirectSession,
				Kind:       "handshake_failed",
				TraceID:    failureTraceID,
				DurationMs: time.Since(startedAt).Milliseconds(),
				Message:    err.Error(),
				Detail: map[string]any{
					"channel_id": strings.TrimSpace(ch),
				},
			})
		}
		return
	}
	defer sess.Close()

	if !resolvedOK {
		s.log.Warn("local direct session missing resolved meta", "channel_id", ch)
		return
	}

	metaCopy := resolved.meta
	if strings.TrimSpace(metaCopy.ChannelID) == "" {
		metaCopy.ChannelID = strings.TrimSpace(ch)
	}

	if err := s.a.ServeLocalDirectSession(r.Context(), sess, &metaCopy, agent.LocalDirectSessionOptions{
		// The Local UI already enforced access-gate authorization for this HTTP request,
		// so the direct channel can start in the unlocked state.
		AccessUnlocked:        s.accessEnabled(),
		TraceID:               firstNonEmptyString([]string{resolved.traceID, traceID}),
		ConnectInfoIssuedAtMs: resolved.connectInfoIssuedAtMs,
	}); err != nil && r.Context().Err() == nil {
		s.log.Warn("local direct session exited", "channel_id", metaCopy.ChannelID, "error", err)
	}
}

func sameOriginWSRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	originRaw := strings.TrimSpace(r.Header.Get("Origin"))
	if originRaw == "" {
		return false
	}
	originURL, err := url.Parse(originRaw)
	if err != nil || originURL == nil {
		return false
	}
	expectedScheme := "http"
	if r.TLS != nil {
		expectedScheme = "https"
	}
	expectedHost := strings.ToLower(strings.TrimSpace(r.Host))
	if expectedHost == "" {
		expectedHost = strings.ToLower(strings.TrimSpace(r.Header.Get("Host")))
	}
	if expectedHost == "" {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(originURL.Scheme), expectedScheme) &&
		strings.EqualFold(strings.TrimSpace(originURL.Host), expectedHost)
}

func firstNonEmptyString(values []string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func (s *Server) sweepLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.sweepExpired()
		}
	}
}

func (s *Server) sweepExpired() {
	if s == nil {
		return
	}
	now := time.Now().Unix()

	s.pendingMu.Lock()
	for k, v := range s.pending {
		if v.initExpireAtUnixS > 0 && now > v.initExpireAtUnixS {
			delete(s.pending, k)
		}
	}
	s.pendingMu.Unlock()
}
