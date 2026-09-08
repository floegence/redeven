package localui

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
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
	"strconv"
	"strings"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
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

	localAccessResumeHeader       = "X-Redeven-Access-Resume"
	localAccessResumeQuery        = "redeven_access_resume"
	localDesktopBridgeTokenHeader = "X-Redeven-Desktop-Bridge-Token"

	localNamespacePublicID = "ns_local"
	localUserPublicID      = "user_local"
	localUserEmail         = "local@redeven"

	defaultPluginSessionReadyTimeout = 15 * time.Second
)

type Options struct {
	Logger *slog.Logger
	Bind   BindSpec

	DisableSelfUpgrade     bool
	DesktopPrivateAccess   bool
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

	// deviceCA is supplied only by package tests. Production startup always
	// loads and validates the explicitly generated serving identity from StateDir.
	deviceCA *deviceCA
}

type Server struct {
	nativeAccess sync.Map // *nativeCodeAccess -> access-session cancellation
	log          *slog.Logger

	bind                   BindSpec
	configPath             string
	stateRoot              string
	stateDir               string
	runtimeControlSockPath string
	version                string
	selfUpgradeDisabled    bool
	desktopPrivateAccess   bool
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
	pendingMu                 sync.Mutex
	pending                   map[string]pendingDirect
	directMu                  sync.Mutex
	directClosing             bool
	pluginAccess              map[string]*pluginAccessSession
	activePluginSession       map[string]activePluginSessionBinding
	pluginSessionReadyTimeout time.Duration

	authorityMu        sync.RWMutex
	networkAuthorities map[string]struct{}
	displayURLs        []string
	resolveAccessHosts func(BindSpec) ([]netip.Addr, error)

	listeners []net.Listener
	srv       *http.Server
	deviceCA  *deviceCA
	tlsConfig *tls.Config

	directListeners        []net.Listener
	directServers          []*flowersec.WebSocketHTTPServer
	directAuthorities      map[string]string
	resolveDirectAuthority func(string) (string, error)

	desktopBridgeListener  net.Listener
	desktopBridgeServer    *http.Server
	desktopBridgeDirect    http.Handler
	localUIBridgeURL       string
	localUIBridgeToken     string
	desktopBrowserHandoffs desktopBrowserHandoffStore

	runtimeControl *runtimeControlServer
	runtimeStatus  *runtimemanagement.Server
	acceptor       *flowersec.Acceptor
	authMu         sync.Mutex
	handlerCleanup map[string]func()
	authStore      *localAuthorizationStore
}

type pendingDirect struct {
	pluginCredentialHash      [sha256.Size]byte
	accessSessionID           string
	initExpireAtUnixS         int64
	meta                      session.Meta
	traceID                   string
	connectArtifactIssuedAtMs int64
	// settled is shared with the eventual active binding so readiness requests
	// can wait while Flowersec is still promoting this pending channel.
	settled chan struct{}
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
	credentialHash  [sha256.Size]byte
	state           pluginSessionBindingState
	settled         chan struct{}
}

type pluginSessionBindingState uint8

const (
	pluginSessionBindingInitializing pluginSessionBindingState = iota + 1
	pluginSessionBindingReady
	pluginSessionBindingClosed
)

type localAccessSessionContextKey struct{}

type localAccessSessionContext struct {
	accessSessionID string
	expiresAt       time.Time
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/cs/", s.handleCodeSpace)
	mux.HandleFunc("/api/local/codespaces/", s.handleNativeCodeSpace)
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
	mux.HandleFunc("/api/local/direct/artifact/spend", s.handleArtifactSpend)
	mux.HandleFunc("/api/local/plugin/session/ready", s.handlePluginSessionReady)
	mux.HandleFunc("/api/local/environment", s.handleEnvironment)
	mux.HandleFunc("/api/local/agent/version/latest", s.handleLatestVersion)
	mux.HandleFunc("/_redevplugin/api/plugins", s.handlePluginPlatform)
	mux.HandleFunc("/_redevplugin/api/plugins/", s.handlePluginPlatform)
	// Reuse the existing app server for Env App UI and management APIs.
	mux.HandleFunc("/_redeven_proxy/", s.handleEnvAppProxy)
	var handler http.Handler = mux
	if s.diag != nil {
		handler = s.withDiagnostics(handler)
	}
	secured := withLocalUISecurityHeaders(handler)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Native editor responses own their CSP and embedding policy. The listener,
		// resource permission, generation, and AccessGate checks still apply.
		if strings.HasPrefix(r.URL.Path, "/api/local/codespaces/") {
			handler.ServeHTTP(w, r)
			return
		}
		secured.ServeHTTP(w, r)
	})
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
		forwardID, portForwardOrigin := desktopBridgePortForwardAuthority(r.Host)
		bridgeAuthority := ""
		if !portForwardOrigin {
			var err error
			bridgeAuthority, err = canonicalLoopbackAuthority(r.Host)
			if err != nil {
				http.Error(w, "invalid Local UI bridge authority", http.StatusMisdirectedRequest)
				return
			}
		} else {
			var ok bool
			bridgeAuthority, ok = canonicalDesktopBridgePortForwardAuthority(r.Host, forwardID)
			if !ok {
				http.Error(w, "invalid Local UI bridge authority", http.StatusMisdirectedRequest)
				return
			}
			if s.redeemDesktopBrowserHandoff(w, r, bridgeAuthority, forwardID) {
				return
			}
		}
		expectedToken := strings.TrimSpace(s.localUIBridgeToken)
		presentedToken := strings.TrimSpace(r.Header.Get(localDesktopBridgeTokenHeader))
		bridgeAuthorized := expectedToken != "" && len(presentedToken) == len(expectedToken) && subtle.ConstantTimeCompare([]byte(presentedToken), []byte(expectedToken)) == 1
		browserAuthorized := portForwardOrigin && s.desktopBrowserHandoffs.authorize(bridgeAuthority, forwardID, r.Cookies())
		if !bridgeAuthorized && !browserAuthorized {
			http.Error(w, "Local UI bridge authorization required", http.StatusUnauthorized)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, localUIBodyLimit)
		}
		trustedRequest := withTrustedLocalUIBridge(r)
		trustedRequest.Header.Del(localDesktopBridgeTokenHeader)
		if portForwardOrigin {
			if s.appServer == nil {
				http.NotFound(w, trustedRequest)
				return
			}
			appserver.StripLocalUIPortForwardBrowserSessionCookie(trustedRequest)
			s.appServer.ServeHTTP(w, appserver.WithLocalUIPortForwardOrigin(trustedRequest, forwardID))
			return
		}
		if r.URL.Path == desktopBrowserHandoffMintPath {
			s.handleDesktopBrowserHandoffMint(w, trustedRequest, bridgeAuthority)
			return
		}
		if r.URL.Path == flowersec.WebSocketDirectPath {
			if s.desktopBridgeDirect == nil {
				http.Error(w, "Flowersec private bridge is unavailable", http.StatusServiceUnavailable)
				return
			}
			s.desktopBridgeDirect.ServeHTTP(w, trustedRequest)
			return
		}
		next.ServeHTTP(w, trustedRequest)
	})
}

func desktopBridgePortForwardAuthority(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.ContainsAny(value, "@/?#%") {
		return "", false
	}
	host, portRaw, err := net.SplitHostPort(value)
	if err != nil || portRaw == "" {
		return "", false
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil || port <= 0 || port > 65535 || portRaw != strconv.Itoa(port) {
		return "", false
	}
	host = strings.ToLower(strings.TrimSpace(host))
	const prefix = "pf-"
	const suffix = ".localhost"
	if !strings.HasPrefix(host, prefix) || !strings.HasSuffix(host, suffix) {
		return "", false
	}
	forwardID := strings.TrimSuffix(strings.TrimPrefix(host, prefix), suffix)
	if !portforward.IsValidForwardID(forwardID) {
		return "", false
	}
	return forwardID, true
}

func canonicalDesktopBridgePortForwardAuthority(raw, forwardID string) (string, bool) {
	value := strings.TrimSpace(raw)
	host, portRaw, err := net.SplitHostPort(value)
	if err != nil || portRaw == "" {
		return "", false
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil || port <= 0 || port > 65535 || portRaw != strconv.Itoa(port) {
		return "", false
	}
	expectedHost := "pf-" + strings.ToLower(strings.TrimSpace(forwardID)) + ".localhost"
	if !strings.EqualFold(strings.TrimSpace(host), expectedHost) {
		return "", false
	}
	return net.JoinHostPort(expectedHost, strconv.Itoa(port)), true
}

func (s *Server) LocalUIBridgeURLForDesktop() string {
	if s == nil {
		return ""
	}
	return s.localUIBridgeURL
}

func (s *Server) LocalUIBridgeTokenForDesktop() string {
	if s == nil {
		return ""
	}
	return s.localUIBridgeToken
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
	stateRoot := strings.TrimSpace(opts.StateRoot)
	if stateRoot == "" {
		stateRoot = filepath.Dir(configPath)
	}
	authStore, err := openLocalAuthorizationStore(filepath.Join(stateRoot, localAuthorizationDatabaseFile))
	if err != nil {
		return nil, fmt.Errorf("open Local UI authorization store: %w", err)
	}
	return &Server{
		log:                       logger,
		bind:                      bind,
		configPath:                configPath,
		stateRoot:                 stateRoot,
		stateDir:                  filepath.Dir(configPath),
		runtimeControlSockPath:    strings.TrimSpace(opts.RuntimeControlSocketPath),
		version:                   strings.TrimSpace(opts.Version),
		selfUpgradeDisabled:       opts.DisableSelfUpgrade,
		desktopPrivateAccess:      opts.DesktopPrivateAccess,
		effectiveRunMode:          strings.TrimSpace(opts.EffectiveRunMode),
		remoteEnabled:             opts.RemoteEnabled,
		controlplaneBaseURL:       strings.TrimSpace(opts.ControlplaneBaseURL),
		controlplaneProviderID:    strings.TrimSpace(opts.ControlplaneProviderID),
		envPublicID:               strings.TrimSpace(opts.EnvPublicID),
		localPermissionCap:        &localPermissionCap,
		appServer:                 opts.AppServer,
		a:                         opts.Agent,
		diag:                      opts.Diagnostics,
		accessGate:                opts.AccessGate,
		exposure:                  exposure,
		pending:                   make(map[string]pendingDirect),
		pluginAccess:              make(map[string]*pluginAccessSession),
		activePluginSession:       make(map[string]activePluginSessionBinding),
		pluginSessionReadyTimeout: defaultPluginSessionReadyTimeout,
		handlerCleanup:            make(map[string]func()),
		authStore:                 authStore,
		networkAuthorities:        make(map[string]struct{}),
		resolveAccessHosts:        resolveNetworkAccessHosts,
		deviceCA:                  opts.deviceCA,
		directAuthorities:         make(map[string]string),
	}, nil
}

func (s *Server) ensureAuthorizationStore() error {
	if s == nil {
		return errors.New("missing Local UI server")
	}
	if s.authStore != nil {
		return s.authStore.ensureOpen()
	}
	root := strings.TrimSpace(s.stateRoot)
	if root == "" {
		root = filepath.Dir(strings.TrimSpace(s.configPath))
	}
	if root == "" || root == "." {
		return errors.New("missing Local UI state root")
	}
	store, err := openLocalAuthorizationStore(filepath.Join(root, localAuthorizationDatabaseFile))
	if err != nil {
		return fmt.Errorf("open Local UI authorization store: %w", err)
	}
	s.authStore = store
	return nil
}

func (s *Server) configureAcceptor() error {
	if s == nil {
		return errors.New("missing Local UI server")
	}
	if err := s.ensureAuthorizationStore(); err != nil {
		return err
	}
	s.authorityMu.RLock()
	origins := make([]string, 0, len(s.networkAuthorities))
	for authority := range s.networkAuthorities {
		origins = append(origins, "https://"+authority)
	}
	s.authorityMu.RUnlock()
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{
		AllowedOrigins:    origins,
		MaxInboundStreams: 32,
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			reserved, err := s.authStore.reserve(request)
			if err != nil {
				return controlplane.RejectRuntime("permission_denied", false)
			}
			response, err := controlplane.AuthorizeRuntime(request, reserved.Record, reserved.LeaseID)
			if err != nil {
				_ = s.authStore.burn(reserved.LookupKey, reserved.LeaseID)
				return controlplane.RejectRuntime("permission_denied", false)
			}
			if err := s.authStore.markLeased(reserved.LookupKey, reserved.LeaseID); err != nil {
				_ = s.authStore.burn(reserved.LookupKey, reserved.LeaseID)
				return controlplane.RejectRuntime("permission_denied", false)
			}
			return response, nil
		},
		ResolveHandlers: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (*flowersec.SessionHandlers, error) {
			lookupKey := request.LookupKey()
			pending, channelID, ok := s.authStore.bindingByLookup(lookupKey)
			if !ok {
				return nil, errors.New("local session authorization is unavailable")
			}
			handlers, cleanup, err := s.a.NewLocalSessionHandlers(&pending.meta)
			if err != nil {
				if cleanupErr := s.authStore.burnLeased(lookupKey); cleanupErr != nil && s.log != nil {
					s.log.Error("terminate local authorization after handler failure", "error", cleanupErr)
				}
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
			if err := s.authStore.markActivated(channelID); err != nil {
				s.recordPluginSessionDiagnostic("activation_rejected", channelID, "authorization activation failed", nil)
				s.releaseAcceptedSessionAuthorization(channelID)
				if s.log != nil {
					s.log.Warn("reject local Flowersec session activation", "endpoint_id", channelID, "error", err)
				}
				return errors.New("local session activation is unavailable")
			}
			pending, ok := s.activateAcceptedSession(channelID, current)
			if !ok {
				s.recordPluginSessionDiagnostic("activation_rejected", channelID, "accepted session metadata unavailable", nil)
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
				OnPluginSessionReady: func() {
					s.markAcceptedPluginSessionReady(channelID, pending.accessSessionID, pending.pluginCredentialHash)
				},
			})
			if err != nil {
				s.recordPluginSessionDiagnostic("session_ended", channelID, "local direct session ended", nil)
				if s.log != nil {
					s.log.Warn("local Flowersec session ended with an error", "channel_id", channelID, "error", err)
				}
			}
			return err
		},
		Release: func(_ context.Context, leaseID string) {
			if s.authStore == nil {
				return
			}
			artifactChannelID, err := s.authStore.releaseLease(leaseID)
			if err != nil {
				if s.log != nil {
					s.log.Error("release local Flowersec authorization lease", "error", err)
				}
				return
			}
			if artifactChannelID == "" {
				if s.log != nil {
					s.log.Warn("ignore unknown local Flowersec authorization lease")
				}
				return
			}
			s.releaseAcceptedSession(artifactChannelID)
		},
	})
	if err != nil {
		return err
	}
	s.acceptor = acceptor
	return nil
}

func (s *Server) configureDesktopBridgeDirectHandler() error {
	if s == nil || s.acceptor == nil {
		return errors.New("flowersec acceptor is not configured")
	}
	handler, err := s.acceptor.PrivateLoopbackHandler(flowersec.PrivateLoopbackHandlerOptions{
		AuthorizeRequest: isTrustedLocalUIBridge,
	})
	if err != nil {
		return fmt.Errorf("configure Flowersec private loopback handler: %w", err)
	}
	s.desktopBridgeDirect = handler
	return nil
}

func (s *Server) privateDesktopMode() bool {
	return s != nil && s.desktopPrivateAccess
}

func (s *Server) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if s.srv != nil || s.desktopBridgeServer != nil {
		return nil
	}
	if err := s.ensureAuthorizationStore(); err != nil {
		return err
	}

	if err := s.prepareDesktopBridgeListener(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge listener: %w", err)
	}

	var listeners []net.Listener
	var srv *http.Server
	if !s.privateDesktopMode() {
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
			_ = s.Close()
			return fmt.Errorf("listen %s failed: %s", s.bind.ListenLabel(), strings.Join(errs, "; "))
		}
		if err := s.prepareSecureNetwork(listeners); err != nil {
			_ = s.Close()
			return err
		}
		for _, errText := range errs {
			s.log.Warn("local ui listener unavailable", "bind", s.bind.ListenLabel(), "error", errText)
		}
		srv = newLocalUIHTTPServer(s.networkHandler())
		s.srv = srv
		s.listeners = listeners
	}
	if err := s.configureAcceptor(); err != nil {
		_ = s.Close()
		return err
	}
	if err := s.configureDesktopBridgeDirectHandler(); err != nil {
		_ = s.Close()
		return err
	}
	if err := s.startDesktopBridgeServer(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge server: %w", err)
	}
	if !s.privateDesktopMode() {
		if err := s.createDirectServers(); err != nil {
			_ = s.Close()
			return err
		}
		s.serveSecureNetwork(srv, listeners)
	}

	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()

	go s.sweepLoop(ctx)

	runtimeControl, err := newRuntimeControlServer(s.a, s.appServer, s.log, nil)
	if err != nil {
		_ = s.Close()
		return fmt.Errorf("init runtime-control: %w", err)
	}
	if err := runtimeControl.Start(ctx); err != nil {
		_ = s.Close()
		return fmt.Errorf("start runtime-control: %w", err)
	}
	s.runtimeControl = runtimeControl

	if err := s.startRuntimeStatusServer(ctx); err != nil {
		_ = s.Close()
		return fmt.Errorf("start runtime management socket: %w", err)
	}

	s.log.Info("local ui listening", "bind", s.ListenLabel(), "desktop_bridge", s.localUIBridgeURL)
	return nil
}

func (s *Server) StartOnListeners(ctx context.Context, listeners []net.Listener, runtimeControlListener net.Listener) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if s.srv != nil || s.desktopBridgeServer != nil {
		return nil
	}
	if err := s.ensureAuthorizationStore(); err != nil {
		return err
	}
	if len(listeners) == 0 {
		return errors.New("missing Local UI listeners")
	}
	if err := s.prepareSecureNetwork(listeners); err != nil {
		return err
	}

	srv := newLocalUIHTTPServer(s.networkHandler())
	s.srv = srv
	s.listeners = append([]net.Listener(nil), listeners...)
	if err := s.prepareDesktopBridgeListener(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge listener: %w", err)
	}
	if err := s.configureAcceptor(); err != nil {
		_ = s.Close()
		return err
	}
	if err := s.configureDesktopBridgeDirectHandler(); err != nil {
		_ = s.Close()
		return err
	}
	if err := s.startDesktopBridgeServer(); err != nil {
		_ = s.Close()
		return fmt.Errorf("start trusted Local UI bridge server: %w", err)
	}
	if err := s.createDirectServers(); err != nil {
		_ = s.Close()
		return err
	}

	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()
	go s.sweepLoop(ctx)

	s.serveSecureNetwork(srv, listeners)

	runtimeControl, err := newRuntimeControlServer(s.a, s.appServer, s.log, nil)
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

	if err := s.startRuntimeStatusServer(ctx); err != nil {
		_ = s.Close()
		return fmt.Errorf("start runtime management socket: %w", err)
	}

	s.log.Info("local ui listening", "bind", s.ListenLabel())
	return nil
}

func (s *Server) prepareDesktopBridgeListener() error {
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
	bridgeToken, err := randomB64u(32)
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("generate trusted Local UI bridge authorization: %w", err)
	}
	s.localUIBridgeToken = bridgeToken
	s.desktopBridgeListener = listener
	s.localUIBridgeURL = formatHTTPURL(addr.IP.String(), addr.Port)
	return nil
}

func (s *Server) startDesktopBridgeServer() error {
	if s == nil || s.desktopBridgeServer != nil {
		return nil
	}
	if s.desktopBridgeListener == nil || s.desktopBridgeDirect == nil {
		return errors.New("trusted Local UI bridge is not configured")
	}
	server := newLocalUIHTTPServer(s.HandlerForDesktopBridge())
	s.desktopBridgeServer = server
	listener := s.desktopBridgeListener
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
		},
		Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
			LocalUIURL:         firstNonEmptyString(s.DisplayURLs()),
			LocalUIURLs:        s.DisplayURLs(),
			LocalUIBridgeURL:   s.localUIBridgeURL,
			LocalUIBridgeToken: s.localUIBridgeToken,
			RuntimeControl:     runtimeControlEndpoint(s.runtimeControl),
			PasswordRequired:   s.accessEnabled(),
			Exposure:           s.LocalUIExposure(),
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
	s.closeNativeCodeAccess("")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, directSession := range s.beginDirectShutdown() {
		_ = directSession.Close()
	}
	if s.srv != nil {
		_ = s.srv.Shutdown(ctx)
	}
	for _, directServer := range s.directServers {
		if directServer != nil {
			_ = directServer.Shutdown(ctx)
		}
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
	for _, ln := range s.directListeners {
		_ = ln.Close()
	}
	if s.desktopBridgeListener != nil {
		_ = s.desktopBridgeListener.Close()
	}
	s.srv = nil
	s.listeners = nil
	s.directServers = nil
	s.directListeners = nil
	s.directAuthorities = make(map[string]string)
	s.tlsConfig = nil
	s.desktopBridgeServer = nil
	s.desktopBridgeListener = nil
	s.desktopBridgeDirect = nil
	s.localUIBridgeURL = ""
	s.localUIBridgeToken = ""
	s.desktopBrowserHandoffs.reset()
	s.runtimeControl = nil
	s.runtimeStatus = nil
	if s.authStore != nil {
		_ = s.authStore.close()
		s.authStore = nil
	}
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
	if s.privateDesktopMode() {
		return ""
	}
	return s.bind.ListenLabelForPort(s.Port())
}

func (s *Server) DisplayURLs() []string {
	if s == nil || s.privateDesktopMode() {
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
	writeJSON(w, http.StatusLocked, apiResp{OK: false, Error: &apiError{
		Code:    "ACCESS_PASSWORD_REQUIRED",
		Message: "access password required",
	}})
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

type pluginSessionReadyRequest struct {
	ChannelID string `json:"channel_id"`
}

func (s *Server) handlePluginSessionReady(w http.ResponseWriter, r *http.Request) {
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
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request pluginSessionReadyRequest
	if err := decoder.Decode(&request); err != nil {
		writePluginSessionReadyError(w, http.StatusBadRequest, "INVALID_PLUGIN_SESSION_READY_REQUEST", "Invalid plugin session readiness request.")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writePluginSessionReadyError(w, http.StatusBadRequest, "INVALID_PLUGIN_SESSION_READY_REQUEST", "Invalid plugin session readiness request.")
		return
	}
	credential := strings.TrimSpace(r.Header.Get(sessionhop.HeaderPluginSessionCredential))
	accessSessionID, _, ok := s.activeLocalAccessSession(r)
	if !ok {
		writePluginSessionReadyError(w, http.StatusForbidden, "LOCAL_PLUGIN_SESSION_UNAVAILABLE", "Plugin session is unavailable.")
		return
	}
	state, settled := s.pluginSessionReadiness(request.ChannelID, credential, accessSessionID)
	switch state {
	case pluginSessionBindingReady:
		w.WriteHeader(http.StatusNoContent)
		return
	case pluginSessionBindingInitializing:
		// Continue below without holding the session-state lock.
	default:
		s.recordPluginSessionDiagnostic("readiness_rejected", request.ChannelID, "plugin session readiness binding unavailable", map[string]any{
			"state": pluginSessionBindingStateName(state),
		})
		writePluginSessionReadyError(w, http.StatusForbidden, "LOCAL_PLUGIN_SESSION_UNAVAILABLE", "Plugin session is unavailable.")
		return
	}

	timeout := s.pluginSessionReadyTimeout
	if timeout <= 0 {
		timeout = defaultPluginSessionReadyTimeout
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-r.Context().Done():
		return
	case <-timer.C:
		writePluginSessionReadyError(w, http.StatusServiceUnavailable, "LOCAL_PLUGIN_SESSION_STARTING", "Plugin session is still starting.")
		return
	case <-settled:
	}

	state, _ = s.pluginSessionReadiness(request.ChannelID, credential, accessSessionID)
	if state == pluginSessionBindingReady {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writePluginSessionReadyError(w, http.StatusGone, "LOCAL_PLUGIN_SESSION_CLOSED", "Plugin session closed before it became ready.")
}

func (s *Server) recordPluginSessionDiagnostic(kind, channelID, message string, detail map[string]any) {
	if s == nil || s.diag == nil {
		return
	}
	if detail == nil {
		detail = make(map[string]any)
	}
	detail["channel_id"] = strings.TrimSpace(channelID)
	s.diag.Append(diagnostics.Event{
		Scope:   diagnostics.ScopeDirectSession,
		Kind:    kind,
		Message: message,
		Detail:  detail,
	})
}

func pluginSessionBindingStateName(state pluginSessionBindingState) string {
	switch state {
	case pluginSessionBindingInitializing:
		return "initializing"
	case pluginSessionBindingReady:
		return "ready"
	case pluginSessionBindingClosed:
		return "closed"
	default:
		return "unknown"
	}
}

func writePluginSessionReadyError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, apiResp{OK: false, Error: &apiError{
		Code:      code,
		Message:   message,
		Retryable: status == http.StatusServiceUnavailable,
	}})
}

func (s *Server) pluginSessionReadiness(channelID, credential, requestAccessSessionID string) (pluginSessionBindingState, <-chan struct{}) {
	if s == nil {
		return pluginSessionBindingClosed, nil
	}
	channelID = strings.TrimSpace(channelID)
	credential = strings.TrimSpace(credential)
	requestAccessSessionID = strings.TrimSpace(requestAccessSessionID)
	if channelID == "" || credential == "" {
		return pluginSessionBindingClosed, nil
	}
	candidate := sha256.Sum256([]byte(credential))
	// Flowersec may complete the browser-side connect promise before its
	// acceptor callback promotes the pending channel into activePluginSession.
	// Inspect both maps under the established pending -> direct lock order so
	// readiness can wait through that short promotion window.
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	s.directMu.Lock()
	defer s.directMu.Unlock()
	binding, active := s.activePluginSession[channelID]
	accessSessionID := ""
	var settled <-chan struct{}
	if active {
		if subtle.ConstantTimeCompare(candidate[:], binding.credentialHash[:]) != 1 {
			return pluginSessionBindingClosed, nil
		}
		accessSessionID = binding.accessSessionID
		settled = binding.settled
	} else {
		pending, pendingOK := s.pending[channelID]
		if !pendingOK || subtle.ConstantTimeCompare(candidate[:], pending.pluginCredentialHash[:]) != 1 {
			return pluginSessionBindingClosed, nil
		}
		accessSessionID = pending.accessSessionID
		settled = pending.settled
	}
	access := s.pluginAccess[accessSessionID]
	if access == nil || access.state != pluginAccessActive ||
		(!access.expiresAt.IsZero() && !time.Now().Before(access.expiresAt)) ||
		(requestAccessSessionID != "" && requestAccessSessionID != accessSessionID) {
		return pluginSessionBindingClosed, nil
	}
	if active {
		return binding.state, settled
	}
	return pluginSessionBindingInitializing, settled
}

func (s *Server) markAcceptedPluginSessionReady(
	channelID string,
	accessSessionID string,
	credentialHash [sha256.Size]byte,
) {
	if s == nil {
		return
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	s.directMu.Lock()
	binding, ok := s.activePluginSession[channelID]
	if ok && binding.state == pluginSessionBindingInitializing && binding.settled != nil &&
		binding.accessSessionID == strings.TrimSpace(accessSessionID) &&
		subtle.ConstantTimeCompare(binding.credentialHash[:], credentialHash[:]) == 1 {
		binding.state = pluginSessionBindingReady
		close(binding.settled)
		s.activePluginSession[channelID] = binding
	}
	s.directMu.Unlock()
}

func (s *Server) closeActivePluginSessionBindingLocked(channelID string) (activePluginSessionBinding, bool) {
	channelID = strings.TrimSpace(channelID)
	binding, ok := s.activePluginSession[channelID]
	if !ok {
		return activePluginSessionBinding{}, false
	}
	if binding.state == pluginSessionBindingInitializing && binding.settled != nil {
		binding.state = pluginSessionBindingClosed
		close(binding.settled)
	}
	delete(s.activePluginSession, channelID)
	return binding, true
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
	case strings.HasPrefix(path, "/_redeven_proxy/"):
		return "env_app_proxy_entry"
	default:
		return "other"
	}
}

type runtimeResp struct {
	Mode             string                  `json:"mode"`
	EnvPublicID      string                  `json:"env_public_id"`
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
	writeJSON(w, http.StatusOK, runtimeResp{
		Mode:             "local",
		EnvPublicID:      LocalEnvPublicID,
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
	snapshot = runtimeservice.NormalizeSnapshotForEndpoint(snapshot, s.resolvedEffectiveRunMode(), s.remoteEnabled)
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
	requestAuthority, err := canonicalLocalUIAuthority(r.Host)
	if err != nil {
		return "", errors.New("invalid Local UI authority")
	}
	s.authorityMu.RLock()
	directAuthority := s.directAuthorities[requestAuthority]
	s.authorityMu.RUnlock()
	if directAuthority == "" && s.resolveDirectAuthority != nil {
		directAuthority, err = s.resolveDirectAuthority(requestAuthority)
		if err != nil {
			return "", errors.New("flowersec WSS endpoint is unavailable")
		}
	}
	if directAuthority == "" {
		return "", errors.New("flowersec WSS endpoint is unavailable")
	}
	return (&url.URL{Scheme: "wss", Host: directAuthority, Path: flowersec.WebSocketDirectPath}).String(), nil
}

func privateLoopbackWSURLFromRequest(r *http.Request) (string, error) {
	if r == nil || !isTrustedLocalUIBridge(r) {
		return "", errors.New("private Local UI bridge authorization required")
	}
	authority, err := canonicalLoopbackAuthority(r.Host)
	if err != nil {
		return "", errors.New("invalid private Local UI bridge authority")
	}
	return (&url.URL{Scheme: "ws", Host: authority, Path: flowersec.WebSocketDirectPath}).String(), nil
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
	Version                     int             `json:"v"`
	ConnectArtifact             json.RawMessage `json:"-"`
	CriticalScopeProjectionJSON string          `json:"critical_scope_projection_json"`
	SpendScope                  localSpendScope `json:"spend_scope"`
	ChannelID                   string          `json:"channel_id"`
	PluginSessionCredential     string          `json:"plugin_session_credential"`
}

type localSpendScope struct {
	Version              int             `json:"v"`
	Receipt              string          `json:"receipt"`
	ArtifactDigestB64u   string          `json:"artifact_digest_b64u"`
	ProjectionDigestB64u string          `json:"projection_digest_b64u"`
	LauncherOrigin       string          `json:"launcher_origin"`
	RuntimeOrigin        string          `json:"runtime_origin"`
	AppOrigin            string          `json:"app_origin"`
	Consumer             string          `json:"consumer"`
	TargetBinding        json.RawMessage `json:"target_binding"`
	ExpiresAt            string          `json:"expires_at"`
}

func (envelope connectArtifactEnvelope) MarshalJSON() ([]byte, error) {
	type wire struct {
		Version                     int             `json:"v"`
		ConnectArtifact             string          `json:"connect_artifact"`
		CriticalScopeProjectionJSON string          `json:"critical_scope_projection_json"`
		SpendScope                  localSpendScope `json:"spend_scope"`
		ChannelID                   string          `json:"channel_id"`
		PluginSessionCredential     string          `json:"plugin_session_credential"`
	}
	return json.Marshal(wire{
		Version: envelope.Version, ConnectArtifact: string(envelope.ConnectArtifact),
		CriticalScopeProjectionJSON: envelope.CriticalScopeProjectionJSON,
		SpendScope:                  envelope.SpendScope, ChannelID: envelope.ChannelID,
		PluginSessionCredential: envelope.PluginSessionCredential,
	})
}

func (envelope *connectArtifactEnvelope) UnmarshalJSON(data []byte) error {
	if envelope == nil {
		return errors.New("nil connect artifact envelope")
	}
	type wire struct {
		Version                     int             `json:"v"`
		ConnectArtifact             json.RawMessage `json:"connect_artifact"`
		CriticalScopeProjectionJSON string          `json:"critical_scope_projection_json"`
		SpendScope                  localSpendScope `json:"spend_scope"`
		ChannelID                   string          `json:"channel_id"`
		PluginSessionCredential     string          `json:"plugin_session_credential"`
	}
	var decoded wire
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	artifact := decoded.ConnectArtifact
	if len(artifact) > 0 && artifact[0] == '"' {
		var text string
		if err := json.Unmarshal(artifact, &text); err != nil {
			return err
		}
		artifact = json.RawMessage(text)
	}
	*envelope = connectArtifactEnvelope{
		Version: decoded.Version, ConnectArtifact: artifact,
		CriticalScopeProjectionJSON: decoded.CriticalScopeProjectionJSON,
		SpendScope:                  decoded.SpendScope, ChannelID: decoded.ChannelID,
		PluginSessionCredential: decoded.PluginSessionCredential,
	}
	return nil
}

type localIssuedPending struct {
	Artifact         json.RawMessage
	PluginCredential string
	ChannelID        string
	ProjectionJSON   string
	Receipt          string
	SpendOrigin      string
	ExpiresAt        time.Time
}

func (s *Server) mintPending(meta session.Meta, wsURL, spendOrigin, traceID, accessSessionID string, accessExpiresAt time.Time, privateLoopback bool) (localIssuedPending, error) {
	if s == nil {
		return localIssuedPending{}, errors.New("server not ready")
	}
	if err := s.ensureAuthorizationStore(); err != nil {
		return localIssuedPending{}, err
	}
	channelID, err := randomB64u(24)
	if err != nil {
		return localIssuedPending{}, err
	}
	pluginCredential, err := randomB64u(32)
	if err != nil {
		return localIssuedPending{}, err
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
	pending := pendingDirect{
		pluginCredentialHash:      pluginCredentialHash,
		accessSessionID:           accessSessionID,
		initExpireAtUnixS:         expiresAt.Unix(),
		meta:                      meta,
		traceID:                   strings.TrimSpace(traceID),
		connectArtifactIssuedAtMs: now.UnixMilli(),
		settled:                   make(chan struct{}),
	}

	// Admission state is checked before issuance, then checked again before the
	// post-commit cache is published. The cache never authorizes a request.
	s.pendingMu.Lock()
	s.directMu.Lock()
	if s.directClosing {
		s.directMu.Unlock()
		s.pendingMu.Unlock()
		return localIssuedPending{}, errors.New("plugin session admission is closed")
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
		return localIssuedPending{}, errors.New("local access session is unavailable")
	}
	if !accessExpiresAt.IsZero() && (access.expiresAt.IsZero() || accessExpiresAt.After(access.expiresAt)) {
		access.expiresAt = accessExpiresAt
	}
	s.directMu.Unlock()
	s.pendingMu.Unlock()

	endpointURL, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil || endpointURL == nil || strings.TrimSpace(endpointURL.Host) == "" {
		return localIssuedPending{}, errors.New("invalid direct endpoint authority")
	}
	metadata := controlplane.ArtifactMetadata{Scopes: []controlplane.Scope{{
		Name: "proxy.runtime", Version: 2, Critical: true, Payload: json.RawMessage(localProxyRuntimePayloadJSON()),
	}}}
	if trace := strings.TrimSpace(traceID); trace != "" {
		metadata.CorrelationTags = map[string]string{"trace_id": trace}
	}
	sessionOptions := controlplane.SessionOptions{
		ChannelID:         channelID,
		ExpiresAt:         expiresAt,
		IdleTimeout:       2 * time.Minute,
		MaxInboundStreams: 32,
	}
	var artifact json.RawMessage
	var authorizationRecord controlplane.AuthorizationRecord
	if privateLoopback {
		issued, issueErr := controlplane.NewIssuer().IssuePrivateLoopbackDirect(controlplane.PrivateLoopbackIssueOptions{
			Session:           sessionOptions,
			Endpoint:          strings.TrimSpace(wsURL),
			RendezvousGroupID: "local-ui-" + channelID,
			ListenerAudience:  "redeven-local-ui",
			UpstreamAddress:   endpointURL.Host,
			Metadata:          metadata,
		})
		if issueErr != nil {
			return localIssuedPending{}, issueErr
		}
		artifact = json.RawMessage(issued.ArtifactJSON())
		authorizationRecord = issued.AuthorizationRecord()
	} else {
		endpoints, endpointsErr := controlplane.NewEndpointSet(controlplane.EndpointConfig{
			ID: "websocket", URL: strings.TrimSpace(wsURL), TLS: controlplane.CAPolicy(),
		})
		if endpointsErr != nil {
			return localIssuedPending{}, endpointsErr
		}
		issued, issueErr := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{
			Session:           sessionOptions,
			Endpoints:         endpoints,
			RendezvousGroupID: "local-ui-" + channelID,
			ListenerAudience:  "redeven-local-ui",
			UpstreamAddress:   endpointURL.Host,
			Metadata:          metadata,
		})
		if issueErr != nil {
			return localIssuedPending{}, issueErr
		}
		artifact = json.RawMessage(issued.ArtifactJSON())
		authorizationRecord = issued.AuthorizationRecord()
	}
	projection := localProjectionJSON()
	receipt, err := s.authStore.issue(
		authorizationRecord, pending, channelID, accessSessionID, expiresAt,
		digestB64u(artifact), digestB64u([]byte(projection)), spendOrigin, localTargetBindingJSON(),
	)
	if err != nil {
		return localIssuedPending{}, err
	}

	s.pendingMu.Lock()
	s.directMu.Lock()
	access = s.pluginAccess[accessSessionID]
	if s.directClosing || access == nil || access.state != pluginAccessActive || (!access.expiresAt.IsZero() && !time.Now().Before(access.expiresAt)) {
		s.directMu.Unlock()
		s.pendingMu.Unlock()
		_ = s.authStore.releaseChannel(channelID)
		return localIssuedPending{}, errors.New("local access session closed during artifact issuance")
	}
	if s.pending == nil {
		s.pending = make(map[string]pendingDirect)
	}
	s.pending[channelID] = pending
	access.pending[channelID] = struct{}{}
	s.directMu.Unlock()
	s.pendingMu.Unlock()

	return localIssuedPending{Artifact: artifact, PluginCredential: pluginCredential, ChannelID: channelID, ProjectionJSON: projection, Receipt: receipt, SpendOrigin: spendOrigin, ExpiresAt: expiresAt}, nil
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

	privateLoopback := isTrustedLocalUIBridge(r)
	wsURL, err := s.directWSURLFromRequest(r)
	if privateLoopback {
		wsURL, err = privateLoopbackWSURLFromRequest(r)
	}
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	spendOrigin, err := s.localSpendOriginFromRequest(r)
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
	acquisition, err := s.mintPending(meta, wsURL, spendOrigin, traceID, accessSessionID, accessExpiresAt, privateLoopback)
	if err != nil {
		if s.log != nil {
			s.log.Error("failed to mint connect artifact", "error", err)
		}
		status := http.StatusInternalServerError
		if errors.Is(err, errLocalAuthorizationCapacity) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, "failed to mint connect artifact", status)
		return
	}
	if len(acquisition.Artifact) == 0 {
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
				"channel_id":    acquisition.ChannelID,
				"floe_app":      meta.FloeApp,
				"code_space_id": meta.CodeSpaceID,
			},
		})
	}

	writeJSON(w, http.StatusOK, connectArtifactEnvelope{
		Version:                     1,
		ConnectArtifact:             acquisition.Artifact,
		CriticalScopeProjectionJSON: acquisition.ProjectionJSON,
		SpendScope: localSpendScope{
			Version: 1, Receipt: acquisition.Receipt,
			ArtifactDigestB64u:   digestB64u(acquisition.Artifact),
			ProjectionDigestB64u: digestB64u([]byte(acquisition.ProjectionJSON)),
			LauncherOrigin:       acquisition.SpendOrigin, RuntimeOrigin: acquisition.SpendOrigin, AppOrigin: acquisition.SpendOrigin,
			Consumer: "trusted", TargetBinding: json.RawMessage(localTargetBindingJSON()),
			ExpiresAt: acquisition.ExpiresAt.UTC().Format(time.RFC3339Nano),
		},
		ChannelID:               acquisition.ChannelID,
		PluginSessionCredential: acquisition.PluginCredential,
	})
}

func (s *Server) localSpendOriginFromRequest(r *http.Request) (string, error) {
	if s == nil || r == nil || !s.isTrustedOrAllowedAuthority(r) {
		return "", errors.New("invalid Local UI authority")
	}
	authority, err := canonicalLocalUIAuthority(r.Host)
	if err != nil {
		return "", errors.New("invalid Local UI authority")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return (&url.URL{Scheme: scheme, Host: authority}).String(), nil
}

func (s *Server) handleArtifactSpend(w http.ResponseWriter, r *http.Request) {
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
	if err := s.ensureAuthorizationStore(); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: &apiError{Code: "LOCAL_AUTHORITY_UNAVAILABLE", Message: "Local artifact authority is unavailable."}})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, localUIJSONBodyLimit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request localSpendRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Code: "INVALID_SPEND_REQUEST", Message: "Invalid artifact spend request."}})
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: &apiError{Code: "INVALID_SPEND_REQUEST", Message: "Invalid artifact spend request."}})
		return
	}
	if err := s.authStore.spend(request); err != nil {
		var spendErr *localSpendError
		if !errors.As(err, &spendErr) {
			spendErr = &localSpendError{Status: http.StatusServiceUnavailable, Code: "local_authority_unavailable"}
		}
		writeJSON(w, spendErr.Status, apiResp{OK: false, Error: &apiError{Code: strings.ToUpper(spendErr.Code), Message: "Artifact spend could not be committed."}})
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
		EffectiveRunMode: s.resolvedEffectiveRunMode(),
		RemoteEnabled:    s.remoteEnabled,
	}
	if s.selfUpgradeDisabled {
		resp.UpgradePolicy = "desktop_release"
		resp.Message = localLatestVersionSupervisorManagedMessage
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
		if !s.selfUpgradeDisabled {
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

func (s *Server) releaseAcceptedSessionAuthorization(channelID string) {
	if s == nil {
		return
	}
	id := strings.TrimSpace(channelID)
	if id == "" {
		return
	}
	if s.authStore != nil {
		_ = s.authStore.releaseChannel(id)
	}
	s.clearAuthorizationCache([]string{id})
}

// clearAuthorizationCache removes only the short-lived handler projections.
// Durable authorization state is transitioned by the authority store before
// this cache is cleared.
func (s *Server) clearAuthorizationCache(channelIDs []string) {
	if s == nil || len(channelIDs) == 0 {
		return
	}
	wanted := make(map[string]struct{}, len(channelIDs))
	for _, channelID := range channelIDs {
		if id := strings.TrimSpace(channelID); id != "" {
			wanted[id] = struct{}{}
		}
	}
	if len(wanted) == 0 {
		return
	}
	s.authMu.Lock()
	cleanups := make([]func(), 0)
	for channelID, cleanup := range s.handlerCleanup {
		if _, ok := wanted[channelID]; !ok {
			continue
		}
		delete(s.handlerCleanup, channelID)
		if cleanup != nil {
			cleanups = append(cleanups, cleanup)
		}
	}
	s.authMu.Unlock()
	for _, cleanup := range cleanups {
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
		if pending.settled != nil {
			close(pending.settled)
		}
		accessSessionID = pending.accessSessionID
		if access := s.pluginAccess[pending.accessSessionID]; access != nil {
			delete(access.pending, id)
		}
	}
	if binding, ok := s.activePluginSession[id]; ok {
		binding, _ = s.closeActivePluginSessionBindingLocked(id)
		accessSessionID = binding.accessSessionID
	}
	if accessSessionID != "" {
		s.removePluginAccessIfUnusedLocked(accessSessionID)
	}
	s.directMu.Unlock()
	s.pendingMu.Unlock()
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
		if pending.settled != nil {
			close(pending.settled)
		}
		if access != nil {
			delete(access.pending, id)
			s.removePluginAccessIfUnusedLocked(pending.accessSessionID)
		}
		return pendingDirect{}, false
	}
	if _, exists := s.activePluginSession[id]; exists {
		delete(s.pending, id)
		delete(access.pending, id)
		if pending.settled != nil {
			close(pending.settled)
		}
		return pendingDirect{}, false
	}
	delete(s.pending, id)
	delete(access.pending, id)
	s.activePluginSession[id] = activePluginSessionBinding{
		accessSessionID: pending.accessSessionID,
		session:         current,
		credentialHash:  pending.pluginCredentialHash,
		state:           pluginSessionBindingInitializing,
		settled:         pending.settled,
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
	for channelID, binding := range s.activePluginSession {
		if binding.session != nil {
			sessions = append(sessions, binding.session)
		}
		s.closeActivePluginSessionBindingLocked(channelID)
	}
	s.pluginAccess = make(map[string]*pluginAccessSession)
	s.activePluginSession = make(map[string]activePluginSessionBinding)
	s.directMu.Unlock()

	s.pendingMu.Lock()
	for _, pending := range s.pending {
		if pending.settled != nil {
			close(pending.settled)
		}
	}
	s.pending = make(map[string]pendingDirect)
	s.pendingMu.Unlock()

	s.authMu.Lock()
	cleanups := make([]func(), 0, len(s.handlerCleanup))
	for _, cleanup := range s.handlerCleanup {
		if cleanup != nil {
			cleanups = append(cleanups, cleanup)
		}
	}
	s.handlerCleanup = make(map[string]func())
	s.authMu.Unlock()

	if s.a != nil {
		for _, accessSessionID := range accessSessionIDs {
			if s.authStore != nil {
				_ = s.authStore.revokeAccessSession(accessSessionID)
			}
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
	binding, ok := s.closeActivePluginSessionBindingLocked(channelID)
	if ok {
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
	if !exists || binding.state != pluginSessionBindingReady {
		return false
	}
	access := s.pluginAccess[binding.accessSessionID]
	if access == nil || access.state != pluginAccessActive || (!access.expiresAt.IsZero() && !time.Now().Before(access.expiresAt)) {
		return false
	}
	return requestAccessSessionID == "" || requestAccessSessionID == binding.accessSessionID
}

func (s *Server) closePluginAccessSession(accessSessionID string) {
	if s == nil || strings.TrimSpace(accessSessionID) == "" {
		return
	}
	s.closeNativeCodeAccess(accessSessionID)
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
	channels := append([]string(nil), pending...)
	for channelID, binding := range s.activePluginSession {
		if binding.accessSessionID != accessSessionID {
			continue
		}
		if binding.session != nil {
			sessions = append(sessions, binding.session)
		}
		channels = append(channels, channelID)
		s.closeActivePluginSessionBindingLocked(channelID)
	}
	s.directMu.Unlock()
	if s.a != nil {
		if s.authStore != nil {
			_ = s.authStore.revokeAccessSession(accessSessionID)
		}
		s.a.EndPluginAccessSession(accessSessionID)
	}
	s.clearAuthorizationCache(channels)

	s.pendingMu.Lock()
	for _, channelID := range pending {
		if current, ok := s.pending[channelID]; ok && current.accessSessionID == accessSessionID {
			delete(s.pending, channelID)
			if current.settled != nil {
				close(current.settled)
			}
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
	if s.authStore != nil {
		if err := s.authStore.maintain(now); err != nil && s.log != nil {
			s.log.Error("maintain Local UI authorization store", "error", err)
		}
	}
	nowUnix := now.Unix()

	expiredChannels := make([]string, 0)
	s.pendingMu.Lock()
	for k, v := range s.pending {
		if v.initExpireAtUnixS > 0 && nowUnix > v.initExpireAtUnixS {
			delete(s.pending, k)
			if v.settled != nil {
				close(v.settled)
			}
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
