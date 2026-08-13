package localui

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/flowersec/flowersec-go/v2/controlplane"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
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

	DesktopManaged         bool
	DesktopOwnerID         string
	EffectiveRunMode       string
	RemoteEnabled          bool
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvPublicID            string

	// AppServer is the Env App local API and proxy handler mounted under /_redeven_proxy/*.
	AppServer *appserver.Server

	// Agent serves direct sessions (RPC/streams) after a successful E2EE handshake.
	Agent *agent.Agent

	// ConfigPath is the absolute path to the runtime config file.
	// It is used to compute the local permission cap and to render Settings consistently.
	ConfigPath string
	StateRoot  string

	RuntimeControlSocketPath string

	// Version is the runtime build version (used by /api/local/agent/version/latest).
	Version string

	// Diagnostics stores structured debug-only request timing events.
	Diagnostics *diagnostics.Store

	// AccessGate protects the local browser entry when password mode is enabled.
	AccessGate *accessgate.Gate
}

type Server struct {
	log *slog.Logger

	bind                   BindSpec
	configPath             string
	stateRoot              string
	stateDir               string
	runtimeControlSockPath string
	version                string
	desktopManaged         bool
	desktopOwnerID         string
	effectiveRunMode       string
	remoteEnabled          bool
	controlplaneBaseURL    string
	controlplaneProviderID string
	envPublicID            string
	localPermissionCap     *config.PermissionSet

	appServer *appserver.Server
	a         *agent.Agent
	diag      *diagnostics.Store

	accessGate *accessgate.Gate
	exposure   runtimemanagement.LocalUIExposure

	latestVersionResolver latestVersionResolver

	// Lock order is pendingMu -> directMu when both admission and active state
	// must change atomically. authMu is never held with either lock.
	pendingMu           sync.Mutex
	pending             map[string]pendingDirect
	directMu            sync.Mutex
	directClosing       bool
	pluginAccess        map[string]*pluginAccessSession
	activePluginSession map[string]activePluginSessionBinding

	authorityMu        sync.RWMutex
	networkAuthorities map[string]struct{}
	displayURLs        []string
	resolveAccessHosts func(BindSpec) ([]netip.Addr, error)

	listeners []net.Listener
	srv       *http.Server

	desktopBridgeListener net.Listener
	desktopBridgeServer   *http.Server
	localUIBridgeURL      string

	runtimeControl *runtimeControlServer
	runtimeStatus  *runtimemanagement.Server
	acceptor       *flowersec.Acceptor
	authMu         sync.Mutex
	authRecords    map[string]controlplane.AuthorizationRecord
	authChannels   map[string]string
	handlerCleanup map[string]func()
}

type pendingDirect struct {
	pluginCredentialHash      [sha256.Size]byte
	accessSessionID           string
	initExpireAtUnixS         int64
	meta                      session.Meta
	traceID                   string
	connectArtifactIssuedAtMs int64
}

type pluginAccessState uint8

const (
	pluginAccessActive pluginAccessState = iota + 1
	pluginAccessClosing
	pluginAccessClosed
)

type pluginAccessSession struct {
	state     pluginAccessState
	expiresAt time.Time
	pending   map[string]struct{}
}

type activePluginSessionBinding struct {
	accessSessionID string
	session         flowersec.Session
}

type localAccessSessionContextKey struct{}

type localAccessSessionContext struct {
	accessSessionID string
	expiresAt       time.Time
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/cs/", s.handleCodeSpace)
	mux.HandleFunc("/pf/", s.handlePortForward)
	// Browsers may request these root-level assets regardless of the actual SPA base path.
	// Keep them available to avoid noisy 404s in Local UI mode.
	mux.HandleFunc("/favicon.ico", s.handleFavicon)
	mux.HandleFunc("/logo.png", s.handleLogo)
	mux.HandleFunc("/api/local/access/status", s.handleAccessStatus)
	mux.HandleFunc("/api/local/runtime/health", s.handleRuntimeHealth)
	mux.HandleFunc("/api/local/access/unlock", s.handleAccessUnlock)
	mux.HandleFunc("/api/local/access/logout", s.handleAccessLogout)
	mux.HandleFunc("/api/local/runtime", s.handleRuntime)
	mux.HandleFunc("/api/local/direct/connect_artifact", s.handleConnectArtifact)
	mux.HandleFunc("/api/local/environment", s.handleEnvironment)
	mux.HandleFunc("/api/local/agent/version/latest", s.handleLatestVersion)
	mux.HandleFunc(flowersec.WebSocketDirectPath, s.handleDirectWS)
	// Keep the runtime-owned Local UI bridge route alongside the public
	// Flowersec carrier path; both enforce the same origin and admission checks.
	mux.HandleFunc("/_redeven_direct/ws", s.handleDirectWS)
	mux.HandleFunc("/_redevplugin/api/plugins", s.handlePluginPlatform)
	mux.HandleFunc("/_redevplugin/api/plugins/", s.handlePluginPlatform)
	// Reuse the existing app server for Env App UI and management APIs.
	mux.HandleFunc("/_redeven_proxy/", s.handleEnvAppProxy)
	var handler http.Handler = mux
	if s.diag != nil {
		handler = s.withDiagnostics(handler)
	}
	return withLocalUISecurityHeaders(handler)
}

func (s *Server) HandlerForDesktopBridge() http.Handler {
	if s == nil {
		return http.NotFoundHandler()
	}
	next := s.handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r == nil {
			http.Error(w, "invalid Local UI request", http.StatusBadRequest)
			return
		}
		if _, err := canonicalLoopbackAuthority(r.Host); err != nil {
			http.Error(w, "invalid Local UI bridge authority", http.StatusMisdirectedRequest)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, localUIBodyLimit)
		}
		next.ServeHTTP(w, withTrustedLocalUIBridge(r))
	})
}

func (s *Server) LocalUIBridgeURLForDesktop() string {
	if s == nil {
		return ""
	}
	return s.localUIBridgeURL
}

func newLocalUIHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      30 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    localUIMaxHeaderBytes,
	}
}

func New(opts Options) (*Server, error) {
	if opts.Agent == nil {
		return nil, errors.New("missing Agent")
	}
	if opts.AppServer == nil {
		return nil, errors.New("missing AppServer")
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
	exposure := runtimemanagement.NewLocalUIExposure(bind.IsNetworkExposure(), opts.AccessGate != nil && opts.AccessGate.Enabled())
	if err := exposure.Validate(); err != nil {
		return nil, err
	}
	return &Server{
		log:                    logger,
		bind:                   bind,
		configPath:             configPath,
		stateRoot:              strings.TrimSpace(opts.StateRoot),
		stateDir:               filepath.Dir(configPath),
		runtimeControlSockPath: strings.TrimSpace(opts.RuntimeControlSocketPath),
		version:                strings.TrimSpace(opts.Version),
		desktopManaged:         opts.DesktopManaged,
		desktopOwnerID:         strings.TrimSpace(opts.DesktopOwnerID),
		effectiveRunMode:       strings.TrimSpace(opts.EffectiveRunMode),
		remoteEnabled:          opts.RemoteEnabled,
		controlplaneBaseURL:    strings.TrimSpace(opts.ControlplaneBaseURL),
		controlplaneProviderID: strings.TrimSpace(opts.ControlplaneProviderID),
		envPublicID:            strings.TrimSpace(opts.EnvPublicID),
		localPermissionCap:     &localPermissionCap,
		appServer:              opts.AppServer,
		a:                      opts.Agent,
		diag:                   opts.Diagnostics,
		accessGate:             opts.AccessGate,
		exposure:               exposure,
		pending:                make(map[string]pendingDirect),
		pluginAccess:           make(map[string]*pluginAccessSession),
		activePluginSession:    make(map[string]activePluginSessionBinding),
		authRecords:            make(map[string]controlplane.AuthorizationRecord),
		authChannels:           make(map[string]string),
		handlerCleanup:         make(map[string]func()),
		networkAuthorities:     make(map[string]struct{}),
		resolveAccessHosts:     resolveNetworkAccessHosts,
	}, nil
}

func (s *Server) configureAcceptor() error {
	if s == nil {
		return errors.New("missing Local UI server")
	}
	s.authorityMu.RLock()
	origins := make([]string, 0, len(s.networkAuthorities)*2)
	for authority := range s.networkAuthorities {
		origins = append(origins, "http://"+authority, "https://"+authority)
	}
	s.authorityMu.RUnlock()
	if len(origins) == 0 {
		return errors.New("missing Local UI origins")
	}
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{
		AllowedOrigins:    origins,
		MaxInboundStreams: 32,
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			key := request.LookupKey()
			s.authMu.Lock()
			record, ok := s.authRecords[key]
			channelID := s.authChannels[key]
			if ok {
				delete(s.authRecords, key)
			}
			s.authMu.Unlock()
			if !ok || strings.TrimSpace(channelID) == "" {
				return controlplane.RejectRuntime("permission_denied", false)
			}
			return controlplane.AuthorizeRuntime(request, record, channelID)
		},
		ResolveHandlers: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (*flowersec.SessionHandlers, error) {
			s.authMu.Lock()
			channelID := s.authChannels[request.LookupKey()]
			s.authMu.Unlock()
			pending, ok := s.resolvePending(channelID)
			if !ok {
				return nil, errors.New("local session authorization is unavailable")
			}
			handlers, cleanup, err := s.a.NewLocalSessionHandlers(&pending.meta)
			if err != nil {
				if s.log != nil {
					s.log.Error("create local handlers failed", "error", err)
				}
				return nil, err
			}
			s.authMu.Lock()
			if s.handlerCleanup == nil {
				s.handlerCleanup = make(map[string]func())
			}
			s.handlerCleanup[channelID] = cleanup
			s.authMu.Unlock()
			return handlers, nil
		},
		OnSession: func(ctx context.Context, current flowersec.Session, endpointID string) error {
			// Direct artifacts use their channel ID as the accepted endpoint ID.
			// Flowersec owns the carrier lifecycle; Redeven records only the
			// public session needed to revoke product access on logout or expiry.
			channelID := strings.TrimSpace(endpointID)
			pending, ok := s.activateAcceptedSession(channelID, current)
			if !ok {
				s.releaseAcceptedSession(channelID)
				if s.log != nil {
					s.log.Warn("reject accepted local Flowersec session", "endpoint_id", channelID)
				}
				return errors.New("local session metadata is unavailable")
			}
			metaCopy := pending.meta
			err := s.a.ServeLocalDirectSession(ctx, current, &metaCopy, agent.LocalDirectSessionOptions{
				AccessUnlocked:            s.accessEnabled(),
				TraceID:                   pending.traceID,
				ConnectArtifactIssuedAtMs: pending.connectArtifactIssuedAtMs,
				PluginCredentialHash:      pending.pluginCredentialHash,
				HasPluginCredential:       true,
				AccessSessionID:           pending.accessSessionID,
				HandlersServedByAcceptor:  true,
			})
			if err != nil && s.log != nil {
				s.log.Warn("local Flowersec session ended with an error", "channel_id", channelID, "error", err)
			}
			return err
		},
		Release: func(_ context.Context, channelID string) {
			s.releaseAcceptedSession(channelID)
		},
	})
	if err != nil {
		return err
	}
	s.acceptor = acceptor
	return nil
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
	if err := s.configureNetworkAuthorities(listeners); err != nil {
		for _, listener := range listeners {
			_ = listener.Close()
		}
		return err
	}
	if err := s.configureAcceptor(); err != nil {
		for _, listener := range listeners {
			_ = listener.Close()
		}
		return err
	}
	for _, errText := range errs {
		s.log.Warn("local ui listener unavailable", "bind", s.bind.ListenLabel(), "error", errText)
	}

	srv := newLocalUIHTTPServer(s.networkHandler())
	s.srv = srv
	s.listeners = listeners
	if err := s.startDesktopBridgeListener(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge listener: %w", err)
	}

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

	if s.desktopManaged && strings.TrimSpace(s.desktopOwnerID) != "" {
		runtimeControl, err := newRuntimeControlServer(s.a, s.appServer, s.desktopOwnerID, s.log, nil)
		if err != nil {
			_ = s.Close()
			return fmt.Errorf("init runtime-control: %w", err)
		}
		if err := runtimeControl.Start(ctx); err != nil {
			_ = s.Close()
			return fmt.Errorf("start runtime-control: %w", err)
		}
		s.runtimeControl = runtimeControl
	}

	if err := s.startRuntimeStatusServer(ctx); err != nil {
		_ = s.Close()
		return fmt.Errorf("start runtime management socket: %w", err)
	}

	s.log.Info("local ui listening", "bind", s.ListenLabel())
	return nil
}

func (s *Server) StartOnListeners(ctx context.Context, listeners []net.Listener, runtimeControlListener net.Listener) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if s.srv != nil {
		return nil
	}
	if len(listeners) == 0 {
		return errors.New("missing Local UI listeners")
	}
	if err := s.configureNetworkAuthorities(listeners); err != nil {
		return err
	}
	if err := s.configureAcceptor(); err != nil {
		return err
	}

	srv := newLocalUIHTTPServer(s.networkHandler())
	s.srv = srv
	s.listeners = append([]net.Listener(nil), listeners...)
	if err := s.startDesktopBridgeListener(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge listener: %w", err)
	}

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

	if s.desktopManaged && strings.TrimSpace(s.desktopOwnerID) != "" {
		runtimeControl, err := newRuntimeControlServer(s.a, s.appServer, s.desktopOwnerID, s.log, nil)
		if err != nil {
			_ = s.Close()
			return fmt.Errorf("init runtime-control: %w", err)
		}
		if runtimeControlListener != nil {
			if err := runtimeControl.StartOnListener(ctx, runtimeControlListener); err != nil {
				_ = s.Close()
				return fmt.Errorf("start runtime-control: %w", err)
			}
		} else if err := runtimeControl.Start(ctx); err != nil {
			_ = s.Close()
			return fmt.Errorf("start runtime-control: %w", err)
		}
		s.runtimeControl = runtimeControl
	}

	if err := s.startRuntimeStatusServer(ctx); err != nil {
		_ = s.Close()
		return fmt.Errorf("start runtime management socket: %w", err)
	}

	s.log.Info("local ui listening", "bind", s.ListenLabel())
	return nil
}

func (s *Server) startDesktopBridgeListener() error {
	if s == nil || s.desktopBridgeListener != nil {
		return nil
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok || addr == nil || addr.Port <= 0 || !addr.IP.IsLoopback() {
		_ = listener.Close()
		return errors.New("trusted Local UI bridge listener must use loopback TCP")
	}
	server := newLocalUIHTTPServer(s.HandlerForDesktopBridge())
	s.desktopBridgeListener = listener
	s.desktopBridgeServer = server
	s.localUIBridgeURL = formatHTTPURL(addr.IP.String(), addr.Port)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Error("trusted Local UI bridge server stopped", "error", err)
		}
	}()
	return nil
}

func (s *Server) startRuntimeStatusServer(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if s.runtimeStatus != nil || strings.TrimSpace(s.runtimeControlSockPath) == "" {
		return nil
	}
	statusServer, err := runtimemanagement.NewServer(s.runtimeControlSockPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return s.RuntimeAttachStatus(), nil
	})
	if err != nil {
		return err
	}
	if err := statusServer.Start(ctx); err != nil {
		return err
	}
	s.runtimeStatus = statusServer
	return nil
}

func runtimeControlEndpoint(srv *runtimeControlServer) *runtimemanagement.RuntimeControlEndpoint {
	if srv == nil {
		return nil
	}
	return srv.Endpoint()
}

func (s *Server) RuntimeControlEndpointForDesktopBridge() *runtimemanagement.RuntimeControlEndpoint {
	if s == nil {
		return nil
	}
	return runtimeControlEndpoint(s.runtimeControl)
}

func (s *Server) RuntimeAttachStatus() runtimemanagement.RuntimeAttachStatus {
	if s == nil {
		return runtimemanagement.RuntimeAttachStatus{State: runtimemanagement.AttachStateNotRunning}
	}
	runtimeService := s.runtimeServiceSnapshot()
	return runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateReady,
		Identity: runtimemanagement.RuntimeInstanceIdentity{
			InstanceID:      s.a.InstanceID(),
			StateRoot:       s.stateRoot,
			StateDir:        s.stateDir,
			PID:             os.Getpid(),
			StartedAtUnixMS: s.a.ProcessStartedAtUnixMS(),
			RuntimeVersion:  s.a.Version(),
			RuntimeCommit:   s.a.Commit(),
			BinaryPath:      s.a.BinaryPath(),
			DesktopManaged:  s.desktopManaged,
			DesktopOwnerID:  s.desktopOwnerID,
		},
		Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
			LocalUIURL:       firstNonEmptyString(s.DisplayURLs()),
			LocalUIURLs:      s.DisplayURLs(),
			LocalUIBridgeURL: s.localUIBridgeURL,
			RuntimeControl:   runtimeControlEndpoint(s.runtimeControl),
			PasswordRequired: s.accessEnabled(),
			Exposure:         s.LocalUIExposure(),
		},
		RuntimeService: runtimeService,
		Diagnostics: runtimemanagement.RuntimeAttachDiagnostics{
			ControlSocketPath: s.runtimeControlSockPath,
		},
	}
}

func (s *Server) RuntimeServiceSnapshotForDesktopBridge() runtimeservice.Snapshot {
	if s == nil {
		return runtimeservice.UnknownSnapshot()
	}
	return s.runtimeServiceSnapshot()
}

func (s *Server) Close() error {
	if s == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, directSession := range s.beginDirectShutdown() {
		_ = directSession.Close()
	}
	if s.srv != nil {
		_ = s.srv.Shutdown(ctx)
	}
	if s.desktopBridgeServer != nil {
		_ = s.desktopBridgeServer.Shutdown(ctx)
	}
	if s.runtimeControl != nil {
		_ = s.runtimeControl.Close()
	}
	if s.runtimeStatus != nil {
		_ = s.runtimeStatus.Close()
	}
	for _, ln := range s.listeners {
		_ = ln.Close()
	}
	if s.desktopBridgeListener != nil {
		_ = s.desktopBridgeListener.Close()
	}
	s.srv = nil
	s.listeners = nil
	s.desktopBridgeServer = nil
	s.desktopBridgeListener = nil
	s.localUIBridgeURL = ""
	s.runtimeControl = nil
	s.runtimeStatus = nil
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
	s.authorityMu.RLock()
	resolved := append([]string(nil), s.displayURLs...)
	s.authorityMu.RUnlock()
	if len(resolved) > 0 {
		return resolved
	}
	return s.bind.DisplayURLsForPort(s.Port())
}

type apiResp struct {
	OK    bool      `json:"ok"`
	Error *apiError `json:"error,omitempty"`
	Data  any       `json:"data,omitempty"`
}

type apiError struct {
	Code           string `json:"code,omitempty"`
	Message        string `json:"message"`
	Retryable      bool   `json:"retryable,omitempty"`
	RedactedDetail string `json:"redacted_detail,omitempty"`
	RetryAfterMs   int64  `json:"retry_after_ms,omitempty"`
}

type accessStatusResp struct {
	PasswordRequired bool                              `json:"password_required"`
	Unlocked         bool                              `json:"unlocked"`
	Exposure         runtimemanagement.LocalUIExposure `json:"exposure"`
	URLs             []string                          `json:"urls"`
}

type runtimeHealthResp struct {
	Status           string                            `json:"status"`
	LocalUIURL       string                            `json:"local_ui_url,omitempty"`
	LocalUIURLs      []string                          `json:"local_ui_urls,omitempty"`
	PasswordRequired bool                              `json:"password_required"`
	Exposure         runtimemanagement.LocalUIExposure `json:"exposure"`
	DesktopManaged   bool                              `json:"desktop_managed,omitempty"`
	DesktopOwnerID   string                            `json:"desktop_owner_id,omitempty"`
	StartedAtUnixMS  int64                             `json:"started_at_unix_ms,omitempty"`
	RuntimeService   runtimeservice.Snapshot           `json:"runtime_service"`
}

type accessUnlockReq struct {
	Password string `json:"password"`
}

func (s *Server) accessEnabled() bool {
	return s != nil && s.accessGate != nil && s.accessGate.Enabled()
}

func (s *Server) LocalUIExposure() runtimemanagement.LocalUIExposure {
	if s == nil {
		return runtimemanagement.NewLocalUIExposure(false, false)
	}
	if err := s.exposure.Validate(); err == nil {
		return s.exposure
	}
	return runtimemanagement.NewLocalUIExposure(s.bind.IsNetworkExposure(), s.accessEnabled())
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

func unlockAttemptSubject(r *http.Request) string {
	if r == nil {
		return ""
	}
	// Use the direct peer address for throttling. Trusting forwarded headers here
	// would let untrusted clients rotate the subject and sidestep the cooldown.
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && strings.TrimSpace(host) != "" {
		return strings.TrimSpace(host)
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func writeUnlockError(w http.ResponseWriter, err error) {
	if w == nil || err == nil {
		return
	}
	retryAfter := accessgate.RetryAfter(err)
	if retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.FormatInt(int64((retryAfter+time.Second-1)/time.Second), 10))
		writeJSON(w, http.StatusTooManyRequests, apiResp{
			OK: false,
			Error: &apiError{
				Code:         "ACCESS_PASSWORD_RETRY_LATER",
				Message:      fmt.Sprintf("Too many incorrect password attempts. Retry in %s.", retryAfter.Round(time.Second)),
				RetryAfterMs: retryAfter.Milliseconds(),
			},
		})
		return
	}
	writeJSON(w, http.StatusUnauthorized, apiResp{
		OK: false,
		Error: &apiError{
			Code:    "ACCESS_PASSWORD_INVALID",
			Message: err.Error(),
		},
	})
}

func (s *Server) hasLocalAccess(r *http.Request) bool {
	if !s.accessEnabled() {
		return true
	}
	token := s.localAccessToken(r)
	if token != "" && s.accessGate.IsLocalSessionValid(token) {
		return true
	}
	return s.accessGate.CanResumeMeta(s.localAccessResumeToken(r), localAccessResumeMeta())
}

func (s *Server) ensureLocalAccessHTTPResponse(w http.ResponseWriter, r *http.Request) bool {
	if !s.accessEnabled() {
		return true
	}
	if s == nil || w == nil || r == nil {
		return false
	}

	if token := s.localAccessToken(r); token != "" && s.accessGate.IsLocalSessionValid(token) {
		return true
	}

	resumeToken := s.localAccessResumeToken(r)
	if resumeToken == "" {
		return false
	}

	result, err := s.accessGate.MintLocalSessionFromResumeToken(resumeToken, localAccessResumeMeta())
	if err != nil || result == nil || strings.TrimSpace(result.SessionToken) == "" || result.SessionExpiresAtUnix <= 0 {
		return false
	}

	s.setLocalAccessCookie(w, r, result.SessionToken, result.SessionExpiresAtUnix)
	*r = *r.WithContext(context.WithValue(r.Context(), localAccessSessionContextKey{}, localAccessSessionContext{
		accessSessionID: strings.TrimSpace(result.AccessSessionID),
		expiresAt:       time.UnixMilli(result.SessionExpiresAtUnix),
	}))
	return true
}

func (s *Server) activeLocalAccessSession(r *http.Request) (string, time.Time, bool) {
	if s == nil {
		return "", time.Time{}, false
	}
	if !s.accessEnabled() {
		return "", time.Time{}, true
	}
	if resumed, ok := r.Context().Value(localAccessSessionContextKey{}).(localAccessSessionContext); ok && strings.TrimSpace(resumed.accessSessionID) != "" && !resumed.expiresAt.IsZero() {
		return strings.TrimSpace(resumed.accessSessionID), resumed.expiresAt, true
	}
	token := s.localAccessToken(r)
	accessSessionID, expiresAt, ok := s.accessGate.ResolveLocalSession(token)
	if !ok {
		return "", time.Time{}, false
	}
	return accessSessionID, expiresAt, true
}

func (s *Server) setLocalAccessCookie(w http.ResponseWriter, r *http.Request, token string, expiresAtUnixMs int64) {
	if w == nil || token == "" {
		return
	}
	expiresAt := time.UnixMilli(expiresAtUnixMs)
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   r != nil && r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
}

func (s *Server) clearLocalAccessCookie(w http.ResponseWriter, r *http.Request) {
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     accessgate.LocalSessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   r != nil && r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func (s *Server) requireLocalAccessAPI(w http.ResponseWriter, r *http.Request) bool {
	if s.ensureLocalAccessHTTPResponse(w, r) {
		return true
	}
	writeJSON(w, http.StatusLocked, apiResp{OK: false, Error: &apiError{Message: "access password required"}})
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

func (s *Server) handleEnvAppProxy(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.appServer == nil {
		http.NotFound(w, r)
		return
	}
	if s.accessEnabled() && !s.isPublicEnvAppRequest(r) {
		if !s.ensureLocalAccessHTTPResponse(w, r) {
			http.Error(w, "access password required", http.StatusLocked)
			return
		}
	}
	s.appServer.ServeHTTP(w, appserver.WithLocalUIEnvRoute(r))
}

func (s *Server) handlePluginPlatform(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.appServer == nil || !s.appServer.PluginPlatformEnabled() {
		http.NotFound(w, r)
		return
	}
	if s.accessEnabled() && !s.ensureLocalAccessHTTPResponse(w, r) {
		http.Error(w, "access password required", http.StatusLocked)
		return
	}
	credential := strings.TrimSpace(r.Header.Get(sessionhop.HeaderPluginSessionCredential))
	channelID, ok := s.a.ResolvePluginSessionCredential(credential)
	if !ok || !s.pluginAccessAllowsRequest(r, channelID) {
		http.Error(w, "plugin session unavailable", http.StatusForbidden)
		return
	}
	next := r.Clone(r.Context())
	next.Header = r.Header.Clone()
	next.Header.Del(sessionhop.HeaderPluginSessionCredential)
	next.Header.Del(sessionhop.HeaderChannelID)
	s.appServer.ServeHTTP(w, appserver.WithLocalUIPluginRoute(next, channelID))
	if _, stillActive := s.a.ResolvePluginSessionCredential(credential); !stillActive {
		s.removeActivePluginSessionBinding(channelID)
	}
}

func (s *Server) handleCodeSpace(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.appServer == nil {
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
	if s.accessEnabled() {
		if !s.ensureLocalAccessHTTPResponse(w, r) {
			http.Error(w, "access password required", http.StatusLocked)
			return
		}
	}
	s.appServer.ServeHTTP(w, appserver.WithLocalUICodeSpaceRoute(r, codeSpaceID))
}

func (s *Server) handlePortForward(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if s.appServer == nil {
		http.NotFound(w, r)
		return
	}
	forwardID, basePath, ok := localPortForwardRoute(r.URL.Path)
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
	if s.accessEnabled() {
		if !s.ensureLocalAccessHTTPResponse(w, r) {
			http.Error(w, "access password required", http.StatusLocked)
			return
		}
	}
	s.appServer.ServeHTTP(w, appserver.WithLocalUIPortForwardRoute(r, forwardID))
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

func localPortForwardRoute(path string) (forwardID string, basePath string, ok bool) {
	p := strings.TrimSpace(path)
	if !strings.HasPrefix(p, "/pf/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(p, "/pf/")
	if rest == "" {
		return "", "", false
	}
	forwardID, _, _ = strings.Cut(rest, "/")
	forwardID = strings.TrimSpace(forwardID)
	if !portforward.IsValidForwardID(forwardID) {
		return "", "", false
	}
	return forwardID, "/pf/" + forwardID, true
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
		Exposure:         s.LocalUIExposure(),
		URLs:             s.DisplayURLs(),
	}})
}

func (s *Server) handleRuntimeHealth(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	displayURLs := s.DisplayURLs()
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: runtimeHealthResp{
		Status:           "online",
		LocalUIURL:       firstNonEmptyString(displayURLs),
		LocalUIURLs:      displayURLs,
		PasswordRequired: s.accessEnabled(),
		Exposure:         s.LocalUIExposure(),
		DesktopManaged:   s.desktopManaged,
		DesktopOwnerID:   s.desktopOwnerID,
		StartedAtUnixMS:  s.a.ProcessStartedAtUnixMS(),
		RuntimeService:   s.runtimeServiceSnapshot(),
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
	r.Body = http.MaxBytesReader(w, r.Body, localUIJSONBodyLimit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req accessUnlockReq
	if err := dec.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, apiResp{OK: false, Error: &apiError{Message: "request body too large"}})
			return
		}
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Message: "invalid json"}})
		return
	}
	result, err := s.accessGate.MintLocalSessionWithSubject(req.Password, unlockAttemptSubject(r))
	if err != nil {
		writeUnlockError(w, err)
		return
	}
	s.setLocalAccessCookie(w, r, result.SessionToken, result.SessionExpiresAtUnix)
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
			if accessSessionID, ok := s.accessGate.TakeLocalSession(token); ok {
				s.closePluginAccessSession(accessSessionID)
			}
		}
		if resumeToken := s.localAccessResumeToken(r); resumeToken != "" {
			if accessSessionID, ok := s.accessGate.TakeAccessSessionByResumeToken(resumeToken); ok {
				s.closePluginAccessSession(accessSessionID)
			}
		}
	}
	s.clearLocalAccessCookie(w, r)
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
	// The Env App ships its own favicon under the embedded app-server base path.
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
	// Keep the root-level logo URL stable so UI code doesn't need to special-case Local UI mode.
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
		return "env_app_proxy_entry"
	default:
		return "other"
	}
}

type runtimeResp struct {
	Mode             string                  `json:"mode"`
	EnvPublicID      string                  `json:"env_public_id"`
	DirectWSURL      string                  `json:"direct_ws_url"`
	DesktopManaged   bool                    `json:"desktop_managed,omitempty"`
	DesktopOwnerID   string                  `json:"desktop_owner_id,omitempty"`
	EffectiveRunMode string                  `json:"effective_run_mode,omitempty"`
	RemoteEnabled    bool                    `json:"remote_enabled,omitempty"`
	RuntimeService   runtimeservice.Snapshot `json:"runtime_service"`
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
		DesktopOwnerID:   s.desktopOwnerID,
		EffectiveRunMode: s.resolvedEffectiveRunMode(),
		RemoteEnabled:    s.remoteEnabled,
		RuntimeService:   s.runtimeServiceSnapshot(),
	})
}

func (s *Server) runtimeServiceSnapshot() runtimeservice.Snapshot {
	if s == nil {
		return runtimeservice.UnknownSnapshot()
	}
	snapshot := runtimeservice.UnknownSnapshot()
	if s.a != nil {
		snapshot = s.a.RuntimeServiceSnapshot()
	}
	snapshot = runtimeservice.NormalizeSnapshotForEndpoint(snapshot, s.desktopManaged, s.resolvedEffectiveRunMode(), s.remoteEnabled)
	if snapshot.OpenReadiness.State == runtimeservice.OpenReadinessOpenable && (s.appServer == nil || !s.appServer.EnvAppShellReady()) {
		snapshot.OpenReadiness = runtimeservice.EnvAppShellUnavailableReadiness()
		return runtimeservice.NormalizeSnapshot(snapshot)
	}
	return snapshot
}

func (s *Server) directWSURLFromRequest(r *http.Request) (string, error) {
	if r == nil {
		return "", errors.New("nil request")
	}
	host, err := s.directEndpointAuthority(r)
	if err != nil {
		return "", errors.New("invalid Local UI authority")
	}
	scheme := "ws"
	if r.TLS != nil {
		scheme = "wss"
	}
	return (&url.URL{Scheme: scheme, Host: host, Path: flowersec.WebSocketDirectPath}).String(), nil
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

type connectArtifactEnvelope struct {
	ConnectArtifact         json.RawMessage `json:"connect_artifact"`
	ChannelID               string          `json:"channel_id"`
	PluginSessionCredential string          `json:"plugin_session_credential"`
}

func (s *Server) mintPending(meta session.Meta, wsURL string, traceID, accessSessionID string, accessExpiresAt time.Time) (json.RawMessage, string, string, error) {
	if s == nil {
		return nil, "", "", errors.New("server not ready")
	}
	channelID, err := randomB64u(24)
	if err != nil {
		return nil, "", "", err
	}
	pluginCredential, err := randomB64u(32)
	if err != nil {
		return nil, "", "", err
	}
	pluginCredentialHash := sha256.Sum256([]byte(pluginCredential))
	// Flowersec control-plane artifacts are limited to a five-minute lifetime;
	// keep the local admission window below that limit so issuance remains valid.
	now := time.Now()
	expiresAt := now.Add(4 * time.Minute)

	meta.ChannelID = channelID
	accessSessionID = strings.TrimSpace(accessSessionID)
	if accessSessionID == "" {
		accessSessionID = "direct:" + channelID
	}

	s.pendingMu.Lock()
	s.directMu.Lock()
	if s.directClosing {
		s.directMu.Unlock()
		s.pendingMu.Unlock()
		return nil, "", "", errors.New("plugin session admission is closed")
	}
	if s.pending == nil {
		s.pending = make(map[string]pendingDirect)
	}
	if s.pluginAccess == nil {
		s.pluginAccess = make(map[string]*pluginAccessSession)
	}
	if s.activePluginSession == nil {
		s.activePluginSession = make(map[string]activePluginSessionBinding)
	}
	access := s.pluginAccess[accessSessionID]
	if access == nil {
		access = &pluginAccessSession{
			state:     pluginAccessActive,
			expiresAt: accessExpiresAt,
			pending:   make(map[string]struct{}),
		}
		s.pluginAccess[accessSessionID] = access
	}
	if access.state != pluginAccessActive || (!access.expiresAt.IsZero() && !time.Now().Before(access.expiresAt)) {
		s.directMu.Unlock()
		s.pendingMu.Unlock()
		return nil, "", "", errors.New("local access session is unavailable")
	}
	if !accessExpiresAt.IsZero() && (access.expiresAt.IsZero() || accessExpiresAt.After(access.expiresAt)) {
		access.expiresAt = accessExpiresAt
	}
	s.pending[channelID] = pendingDirect{
		pluginCredentialHash:      pluginCredentialHash,
		accessSessionID:           accessSessionID,
		initExpireAtUnixS:         expiresAt.Unix(),
		meta:                      meta,
		traceID:                   strings.TrimSpace(traceID),
		connectArtifactIssuedAtMs: now.UnixMilli(),
	}
	access.pending[channelID] = struct{}{}
	s.directMu.Unlock()
	s.pendingMu.Unlock()

	endpoints, err := controlplane.NewEndpointSet(strings.TrimSpace(wsURL))
	if err != nil {
		s.releaseAcceptedSession(channelID)
		return nil, "", "", err
	}
	endpointURL, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil || endpointURL == nil || strings.TrimSpace(endpointURL.Host) == "" {
		s.releaseAcceptedSession(channelID)
		return nil, "", "", errors.New("invalid direct endpoint authority")
	}
	metadata := controlplane.ArtifactMetadata{}
	if trace := strings.TrimSpace(traceID); trace != "" {
		metadata.CorrelationTags = map[string]string{"trace_id": trace}
	}
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{
		Session: controlplane.SessionOptions{
			ChannelID:         channelID,
			ExpiresAt:         expiresAt,
			IdleTimeout:       2 * time.Minute,
			MaxInboundStreams: 32,
		},
		Endpoints:         endpoints,
		RendezvousGroupID: "local-ui-" + channelID,
		ListenerAudience:  "redeven-local-ui",
		UpstreamAddress:   endpointURL.Host,
		Metadata:          metadata,
	})
	if err != nil {
		s.releaseAcceptedSession(channelID)
		return nil, "", "", err
	}
	s.authMu.Lock()
	if s.authRecords == nil {
		s.authRecords = make(map[string]controlplane.AuthorizationRecord)
	}
	if s.authChannels == nil {
		s.authChannels = make(map[string]string)
	}
	s.authRecords[issued.LookupKey()] = issued.AuthorizationRecord()
	s.authChannels[issued.LookupKey()] = channelID
	s.authMu.Unlock()
	return json.RawMessage(issued.ArtifactJSON()), pluginCredential, channelID, nil
}

func (s *Server) handleConnectArtifact(w http.ResponseWriter, r *http.Request) {
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
	if r.TLS == nil && !s.bind.IsLoopbackOnly() && !isTrustedLocalUIBridge(r) {
		http.Error(w, "Flowersec direct sessions require a secure or loopback Local UI endpoint", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, localUIJSONBodyLimit)
	// Only accept empty body to keep the endpoint stable; reject unknown inputs.
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&struct{}{}); err != nil && err != io.EOF {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
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
	accessSessionID, accessExpiresAt, ok := s.activeLocalAccessSession(r)
	if !ok {
		http.Error(w, "local access session unavailable", http.StatusLocked)
		return
	}
	artifact, pluginCredential, channelID, err := s.mintPending(meta, wsURL, traceID, accessSessionID, accessExpiresAt)
	if err != nil {
		if s.log != nil {
			s.log.Error("failed to mint connect artifact", "error", err)
		}
		http.Error(w, "failed to mint connect artifact", http.StatusInternalServerError)
		return
	}
	if len(artifact) == 0 {
		http.Error(w, "failed to mint connect artifact", http.StatusInternalServerError)
		return
	}

	if s.diag != nil {
		s.diag.Append(diagnostics.Event{
			Scope:   diagnostics.ScopeDirectSession,
			Kind:    "connect_artifact_issued",
			TraceID: traceID,
			Message: "issued direct connect artifact",
			Detail: map[string]any{
				"channel_id":    channelID,
				"floe_app":      meta.FloeApp,
				"code_space_id": meta.CodeSpaceID,
			},
		})
	}

	writeJSON(w, http.StatusOK, connectArtifactEnvelope{
		ConnectArtifact:         artifact,
		ChannelID:               channelID,
		PluginSessionCredential: pluginCredential,
	})
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
	SourceReleaseTag   string `json:"source_release_tag,omitempty"`
	ManifestETag       string `json:"manifest_etag,omitempty"`
	Source             string `json:"source,omitempty"`
	Stale              bool   `json:"stale,omitempty"`
	FetchedAtMs        int64  `json:"fetched_at_ms,omitempty"`
	CacheTTLMS         int64  `json:"cache_ttl_ms,omitempty"`
	Message            string `json:"message,omitempty"`
	DesktopManaged     bool   `json:"desktop_managed,omitempty"`
	EffectiveRunMode   string `json:"effective_run_mode,omitempty"`
	RemoteEnabled      bool   `json:"remote_enabled,omitempty"`
}

func (s *Server) resolvedLatestVersionResolver() latestVersionResolver {
	if s != nil && s.latestVersionResolver != nil {
		return s.latestVersionResolver
	}
	return defaultLatestVersionResolver
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

	resp := latestVersionResp{
		CurrentVersion:   v,
		UpgradePolicy:    "manual",
		Message:          localLatestVersionUnavailableMessage,
		DesktopManaged:   s.desktopManaged,
		EffectiveRunMode: s.resolvedEffectiveRunMode(),
		RemoteEnabled:    s.remoteEnabled,
	}
	if s.desktopManaged {
		resp.UpgradePolicy = "desktop_release"
		resp.Message = localLatestVersionDesktopManagedMessage
	}

	loadResult, err := s.resolvedLatestVersionResolver().Load(r.Context())
	if err == nil {
		resp.LatestVersion = loadResult.snapshot.latest
		resp.RecommendedVersion = loadResult.snapshot.recommended
		resp.ReleasePageURL = loadResult.snapshot.releasePageURL
		resp.SourceReleaseTag = loadResult.snapshot.sourceReleaseTag
		resp.ManifestETag = loadResult.snapshot.etag
		resp.Source = loadResult.source
		resp.Stale = loadResult.stale
		resp.FetchedAtMs = loadResult.snapshot.fetchedAt.UnixMilli()
		resp.CacheTTLMS = int64(loadResult.snapshot.ttl / time.Millisecond)
		if !s.desktopManaged {
			resp.UpgradePolicy = "self_upgrade"
			resp.Message = strings.TrimSpace(loadResult.message)
		}
	}

	writeJSON(w, http.StatusOK, resp)
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

func (s *Server) resolvePending(channelID string) (pendingDirect, bool) {
	if s == nil {
		return pendingDirect{}, false
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return pendingDirect{}, false
	}
	now := time.Now().Unix()

	s.pendingMu.Lock()
	p, ok := s.pending[id]
	if !ok {
		s.pendingMu.Unlock()
		return pendingDirect{}, false
	}
	if p.initExpireAtUnixS <= 0 || now > p.initExpireAtUnixS {
		delete(s.pending, id)
		s.pendingMu.Unlock()
		s.removePendingAccessBinding(p.accessSessionID, id)
		s.releaseAcceptedSessionAuthorization(id)
		return pendingDirect{}, false
	}
	s.pendingMu.Unlock()
	return p, true
}

func (s *Server) releaseAcceptedSessionAuthorization(channelID string) {
	if s == nil {
		return
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return
	}
	s.authMu.Lock()
	for key, current := range s.authChannels {
		if current == id {
			delete(s.authChannels, key)
			delete(s.authRecords, key)
		}
	}
	cleanup := s.handlerCleanup[id]
	delete(s.handlerCleanup, id)
	s.authMu.Unlock()
	if cleanup != nil {
		cleanup()
	}
}

func (s *Server) releaseAcceptedSession(channelID string) {
	if s == nil {
		return
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return
	}
	s.releaseAcceptedSessionAuthorization(id)
	var accessSessionID string
	s.pendingMu.Lock()
	s.directMu.Lock()
	if pending, ok := s.pending[id]; ok {
		delete(s.pending, id)
		accessSessionID = pending.accessSessionID
		if access := s.pluginAccess[pending.accessSessionID]; access != nil {
			delete(access.pending, id)
		}
	}
	if binding, ok := s.activePluginSession[id]; ok {
		delete(s.activePluginSession, id)
		accessSessionID = binding.accessSessionID
	}
	if accessSessionID != "" {
		s.removePluginAccessIfUnusedLocked(accessSessionID)
	}
	s.directMu.Unlock()
	s.pendingMu.Unlock()
}

func (s *Server) handleDirectWS(w http.ResponseWriter, r *http.Request) {
	if s == nil || w == nil || r == nil {
		return
	}
	// The one-shot Flowersec artifact is the admission credential for this
	// websocket. Local password state is enforced when the artifact was minted;
	// requiring a second HTTP cookie here would prevent native connectors from
	// establishing the session because ConnectorOptions intentionally carries no
	// product-specific headers or cookies.
	if !s.sameOriginWSRequest(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if s.acceptor == nil {
		http.Error(w, "session acceptor unavailable", http.StatusServiceUnavailable)
		return
	}
	acceptorRequest, ok := s.requestForAcceptor(r)
	if !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	s.acceptor.Handler().ServeHTTP(w, acceptorRequest)
}

func (s *Server) requestForAcceptor(r *http.Request) (*http.Request, bool) {
	if r == nil || s == nil {
		return nil, false
	}
	if !isTrustedLocalUIBridge(r) {
		return r, true
	}
	if _, err := canonicalLoopbackAuthority(r.Host); err != nil || !strictSameOriginWSRequest(r, true) {
		return nil, false
	}
	s.authorityMu.RLock()
	authorities := make([]string, 0, len(s.networkAuthorities))
	for authority := range s.networkAuthorities {
		authorities = append(authorities, authority)
	}
	s.authorityMu.RUnlock()
	if len(authorities) == 0 {
		return nil, false
	}
	sort.Strings(authorities)
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	mapped := r.Clone(r.Context())
	mapped.Header = r.Header.Clone()
	mapped.Header.Set("Origin", scheme+"://"+authorities[0])
	return mapped, true
}

func (s *Server) activateAcceptedSession(channelID string, current flowersec.Session) (pendingDirect, bool) {
	if s == nil || current == nil {
		return pendingDirect{}, false
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return pendingDirect{}, false
	}
	now := time.Now()
	s.pendingMu.Lock()
	s.directMu.Lock()
	defer s.directMu.Unlock()
	defer s.pendingMu.Unlock()
	pending, ok := s.pending[id]
	if !ok {
		return pendingDirect{}, false
	}
	access := s.pluginAccess[pending.accessSessionID]
	if pending.initExpireAtUnixS <= 0 || now.Unix() > pending.initExpireAtUnixS || s.directClosing ||
		access == nil || access.state != pluginAccessActive || (!access.expiresAt.IsZero() && !now.Before(access.expiresAt)) {
		delete(s.pending, id)
		if access != nil {
			delete(access.pending, id)
			s.removePluginAccessIfUnusedLocked(pending.accessSessionID)
		}
		return pendingDirect{}, false
	}
	if _, exists := s.activePluginSession[id]; exists {
		return pendingDirect{}, false
	}
	delete(s.pending, id)
	delete(access.pending, id)
	s.activePluginSession[id] = activePluginSessionBinding{
		accessSessionID: pending.accessSessionID,
		session:         current,
	}
	return pending, true
}

func (s *Server) beginDirectShutdown() []flowersec.Session {
	if s == nil {
		return nil
	}
	s.directMu.Lock()
	s.directClosing = true
	sessions := make([]flowersec.Session, 0, len(s.activePluginSession))
	accessSessionIDs := make([]string, 0, len(s.pluginAccess))
	for accessSessionID, access := range s.pluginAccess {
		if access == nil {
			continue
		}
		accessSessionIDs = append(accessSessionIDs, accessSessionID)
		access.state = pluginAccessClosing
	}
	for _, binding := range s.activePluginSession {
		if binding.session != nil {
			sessions = append(sessions, binding.session)
		}
	}
	s.pluginAccess = make(map[string]*pluginAccessSession)
	s.activePluginSession = make(map[string]activePluginSessionBinding)
	s.directMu.Unlock()

	s.pendingMu.Lock()
	s.pending = make(map[string]pendingDirect)
	s.pendingMu.Unlock()

	s.authMu.Lock()
	cleanups := make([]func(), 0, len(s.handlerCleanup))
	for _, cleanup := range s.handlerCleanup {
		if cleanup != nil {
			cleanups = append(cleanups, cleanup)
		}
	}
	s.authRecords = make(map[string]controlplane.AuthorizationRecord)
	s.authChannels = make(map[string]string)
	s.handlerCleanup = make(map[string]func())
	s.authMu.Unlock()

	if s.a != nil {
		for _, accessSessionID := range accessSessionIDs {
			s.a.EndPluginAccessSession(accessSessionID)
		}
	}
	for _, cleanup := range cleanups {
		cleanup()
	}
	return sessions
}

func (s *Server) removePendingAccessBinding(accessSessionID, channelID string) {
	if s == nil {
		return
	}
	s.directMu.Lock()
	defer s.directMu.Unlock()
	access := s.pluginAccess[strings.TrimSpace(accessSessionID)]
	if access == nil {
		return
	}
	delete(access.pending, strings.TrimSpace(channelID))
	s.removePluginAccessIfUnusedLocked(accessSessionID)
}

func (s *Server) removeActivePluginSessionBinding(channelID string) {
	if s == nil {
		return
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	s.directMu.Lock()
	binding, ok := s.activePluginSession[channelID]
	if ok {
		delete(s.activePluginSession, channelID)
		s.removePluginAccessIfUnusedLocked(binding.accessSessionID)
	}
	s.directMu.Unlock()
}

func (s *Server) pluginAccessHasActiveLocked(accessSessionID string) bool {
	accessSessionID = strings.TrimSpace(accessSessionID)
	for _, binding := range s.activePluginSession {
		if binding.accessSessionID == accessSessionID {
			return true
		}
	}
	return false
}

func (s *Server) removePluginAccessIfUnusedLocked(accessSessionID string) {
	accessSessionID = strings.TrimSpace(accessSessionID)
	access := s.pluginAccess[accessSessionID]
	if access == nil || len(access.pending) != 0 || s.pluginAccessHasActiveLocked(accessSessionID) {
		return
	}
	access.state = pluginAccessClosed
	delete(s.pluginAccess, accessSessionID)
}

func (s *Server) pluginAccessAllowsRequest(r *http.Request, channelID string) bool {
	if s == nil {
		return false
	}
	requestAccessSessionID, _, ok := s.activeLocalAccessSession(r)
	if !ok {
		return false
	}
	id := strings.TrimSpace(channelID)
	s.directMu.Lock()
	defer s.directMu.Unlock()
	binding, exists := s.activePluginSession[id]
	if !exists {
		return false
	}
	access := s.pluginAccess[binding.accessSessionID]
	if access == nil || access.state != pluginAccessActive || (!access.expiresAt.IsZero() && !time.Now().Before(access.expiresAt)) {
		return false
	}
	return requestAccessSessionID == "" || requestAccessSessionID == binding.accessSessionID
}

func (s *Server) closePluginAccessSession(accessSessionID string) {
	if s == nil {
		return
	}
	accessSessionID = strings.TrimSpace(accessSessionID)
	if accessSessionID == "" {
		return
	}
	s.directMu.Lock()
	access := s.pluginAccess[accessSessionID]
	if access == nil || access.state == pluginAccessClosed {
		s.directMu.Unlock()
		return
	}
	access.state = pluginAccessClosing
	pending := make([]string, 0, len(access.pending))
	for channelID := range access.pending {
		pending = append(pending, channelID)
	}
	sessions := make([]flowersec.Session, 0)
	for channelID, binding := range s.activePluginSession {
		if binding.accessSessionID != accessSessionID {
			continue
		}
		if binding.session != nil {
			sessions = append(sessions, binding.session)
		}
		delete(s.activePluginSession, channelID)
	}
	s.directMu.Unlock()
	if s.a != nil {
		s.a.EndPluginAccessSession(accessSessionID)
	}

	s.pendingMu.Lock()
	for _, channelID := range pending {
		if current, ok := s.pending[channelID]; ok && current.accessSessionID == accessSessionID {
			delete(s.pending, channelID)
		}
	}
	s.pendingMu.Unlock()

	s.directMu.Lock()
	if current := s.pluginAccess[accessSessionID]; current != nil {
		for _, channelID := range pending {
			delete(current.pending, channelID)
		}
		s.removePluginAccessIfUnusedLocked(accessSessionID)
	}
	s.directMu.Unlock()
	for _, current := range sessions {
		_ = current.Close()
	}
}

func sameOriginWSRequest(r *http.Request) bool {
	return strictSameOriginWSRequest(r, true)
}

func (s *Server) sameOriginWSRequest(r *http.Request) bool {
	if s == nil || r == nil || !s.isTrustedOrAllowedAuthority(r) {
		return false
	}
	if strictSameOriginWSRequest(r, true) {
		return true
	}
	if r.TLS != nil || isTrustedLocalUIBridge(r) || !s.bind.localhost {
		return false
	}
	requestAuthority, err := canonicalLocalUIAuthority(r.Host)
	if err != nil || !s.isAllowedNetworkAuthority(requestAuthority) {
		return false
	}
	listenerAuthority, err := localLoopbackAuthorityFromRequest(r)
	if err != nil || listenerAuthority != requestAuthority {
		return false
	}
	originAuthority, ok := requestOriginAuthority(r, true)
	if !ok || !s.isAllowedNetworkAuthority(originAuthority) {
		return false
	}
	originHost, originPort, err := net.SplitHostPort(originAuthority)
	if err != nil || !strings.EqualFold(originHost, "localhost") {
		return false
	}
	_, requestPort, err := net.SplitHostPort(requestAuthority)
	return err == nil && originPort == requestPort
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
	s.sweepExpiredAt(time.Now())
}

func (s *Server) sweepExpiredAt(now time.Time) {
	if s == nil {
		return
	}
	nowUnix := now.Unix()

	expiredChannels := make([]string, 0)
	s.pendingMu.Lock()
	for k, v := range s.pending {
		if v.initExpireAtUnixS > 0 && nowUnix > v.initExpireAtUnixS {
			delete(s.pending, k)
			s.removePendingAccessBinding(v.accessSessionID, k)
			expiredChannels = append(expiredChannels, k)
		}
	}
	s.pendingMu.Unlock()
	for _, channelID := range expiredChannels {
		s.releaseAcceptedSessionAuthorization(channelID)
	}

	if s.accessGate != nil {
		for _, expired := range s.accessGate.TakeExpiredLocalSessions(now) {
			s.closePluginAccessSession(expired.AccessSessionID)
		}
	}
}
