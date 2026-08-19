package gatewayservice

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	gatewayauth "github.com/floegence/redeven/internal/runtimegateway/auth"
	gatewaycatalog "github.com/floegence/redeven/internal/runtimegateway/catalog"
	gatewayenvprofiles "github.com/floegence/redeven/internal/runtimegateway/envprofiles"
	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	gatewaysecurity "github.com/floegence/redeven/internal/runtimegateway/security"
	gatewaysession "github.com/floegence/redeven/internal/runtimegateway/session"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
)

const (
	gatewayConnectArtifactTTL = 10 * time.Minute

	managedBridgeTransportHeader = "X-Redeven-Gateway-Transport"
	managedBridgeTokenHeader     = "X-Redeven-Gateway-Managed-Bridge-Token"
)

type Options struct {
	StateRoot                   string
	DesktopBridgeTransport      bool
	AllowPrivateProfileTargets  bool
	ProfileWriteEnabled         bool
	PairingCode                 string
	ManagedBridgeToken          string
	LifecycleController         gatewaylifecycle.Controller
	LifecycleArtifactVerifier   gatewaylifecycle.ArtifactVerifier
	LifecycleAuthorizer         LifecycleAuthorizer
	LifecycleCapabilityProvider LifecycleCapabilityProvider
	PrecompiledRuntimeStartup   PrecompiledRuntimeStartup
}

type LifecycleAuthorizer interface {
	AuthorizePrepare(context.Context, *http.Request, gatewayauth.VerifiedRequest, gatewayprotocol.RuntimeOperationPrepareRequest) (gatewaylifecycle.Authorization, error)
	AuthorizeAccess(context.Context, *http.Request, gatewayauth.VerifiedRequest) (gatewaylifecycle.Access, error)
	AuthorizeReconcile(context.Context, *http.Request, gatewayauth.VerifiedRequest, gatewayprotocol.RuntimeOperation, string) (gatewaylifecycle.Access, error)
	AuthorizeProviderTunnel(context.Context, gatewayauth.VerifiedRequest, gatewayprotocol.LifecycleTarget, string) error
}

type LifecycleCapabilityProvider interface {
	RuntimeManagementCapability(context.Context, string, gatewaylifecycle.Access) (gatewayprotocol.RuntimeManagementCapability, error)
}

type PrecompiledRuntimeStartup interface {
	PrecompiledRuntimeTargetID() string
	EnsurePrecompiledRuntime(context.Context) error
}

type Server struct {
	stateRoot              string
	desktopBridgeTransport bool
	profileWriteEnabled    bool
	pairingCode            string
	managedBridgeToken     string

	trust                       *gatewaytrust.Store
	auth                        *gatewayauth.Verifier
	profile                     *gatewayenvprofiles.Store
	lifecycle                   *gatewaylifecycle.Store
	lifecycleAuthorizer         LifecycleAuthorizer
	lifecycleCapabilityProvider LifecycleCapabilityProvider
	precompiledRuntimeStartup   PrecompiledRuntimeStartup
	lifecycleAvailable          bool

	profileSessionsMu sync.Mutex
	profileSessions   map[string]*profileSession
	proxyTransport    http.RoundTripper
	providerTunnelMu  sync.Mutex
	providerNonces    map[string]int64
	providerUploads   map[string]providerArtifactUpload
}

type profileSession struct {
	ID              string
	GatewayEnvID    string
	TargetBaseURL   string
	AllowedClientIP string
	AccessPath      string
	ExpiresAtUnixMS int64
	EntryURL        string
	Listener        net.Listener
	Server          *http.Server
	CookieJar       *cookiejar.Jar
}

type envelope struct {
	OK    bool        `json:"ok"`
	Data  any         `json:"data,omitempty"`
	Error *errorShape `json:"error,omitempty"`
}

type errorShape struct {
	Code           string `json:"code,omitempty"`
	Message        string `json:"message"`
	Retryable      bool   `json:"retryable,omitempty"`
	RedactedDetail string `json:"redacted_detail,omitempty"`
}

func New(options Options) (*Server, error) {
	stateRoot := strings.TrimSpace(options.StateRoot)
	if stateRoot == "" {
		stateRoot = filepath.Join(defaultStateRoot(), "gateways", "default", "state")
	}
	lifecycleStore, err := gatewaylifecycle.NewStore(gatewaylifecycle.Options{
		StateRoot:        filepath.Join(stateRoot, "runtime-lifecycle"),
		Controller:       options.LifecycleController,
		ArtifactVerifier: options.LifecycleArtifactVerifier,
	})
	if err != nil {
		return nil, err
	}
	return &Server{
		stateRoot:              stateRoot,
		desktopBridgeTransport: options.DesktopBridgeTransport,
		profileWriteEnabled:    options.ProfileWriteEnabled,
		pairingCode:            strings.TrimSpace(options.PairingCode),
		managedBridgeToken:     strings.TrimSpace(options.ManagedBridgeToken),
		trust:                  gatewaytrust.NewStore(filepath.Join(stateRoot, "gateway-trust.json")),
		profile: gatewayenvprofiles.NewStoreWithOptions(filepath.Join(stateRoot, "environments.json"), gatewayenvprofiles.StoreOptions{
			URLTargetPolicy: gatewayenvprofiles.URLTargetPolicy{
				AllowPrivateNetworkTargets: options.AllowPrivateProfileTargets,
			},
		}),
		lifecycle:                   lifecycleStore,
		lifecycleAuthorizer:         options.LifecycleAuthorizer,
		lifecycleCapabilityProvider: options.LifecycleCapabilityProvider,
		precompiledRuntimeStartup:   options.PrecompiledRuntimeStartup,
		lifecycleAvailable:          options.LifecycleController != nil && options.LifecycleArtifactVerifier != nil && options.LifecycleAuthorizer != nil,
		profileSessions:             make(map[string]*profileSession),
		providerNonces:              make(map[string]int64),
		providerUploads:             make(map[string]providerArtifactUpload),
		proxyTransport: gatewayProfileProxyTransport(gatewayenvprofiles.URLTargetPolicy{
			AllowPrivateNetworkTargets: options.AllowPrivateProfileTargets,
		}),
	}, nil
}

func defaultStateRoot() string {
	if env := strings.TrimSpace(os.Getenv("REDEVEN_STATE_ROOT")); env != "" {
		return env
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ".redeven"
	}
	return filepath.Join(home, ".redeven")
}

func (s *Server) Handler() http.Handler {
	if s == nil {
		return http.NotFoundHandler()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /gateway/v2/pairing/challenge", s.handlePairingChallenge)
	mux.HandleFunc("POST /gateway/v2/pairing/complete", s.handlePairingComplete)
	mux.HandleFunc("POST /gateway/v2/catalog", s.handleCatalog)
	mux.HandleFunc("POST /gateway/v2/runtime-management/capability", s.handleRuntimeManagementCapability)
	mux.HandleFunc("POST /gateway/v2/open-session", s.handleOpenSession)
	mux.HandleFunc("POST /gateway/v2/env-profiles/upsert", s.handleEnvProfileUpsert)
	mux.HandleFunc("POST /gateway/v2/env-profiles/delete", s.handleEnvProfileDelete)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/prepare", s.handleRuntimeOperationPrepare)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/list", s.handleRuntimeOperationList)
	mux.HandleFunc("GET /gateway/v2/runtime-operations/{operation_id}", s.handleRuntimeOperationGet)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/{operation_id}/confirm", s.handleRuntimeOperationConfirm)
	mux.HandleFunc("PUT /gateway/v2/runtime-operations/{operation_id}/artifact", s.handleRuntimeOperationArtifact)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/{operation_id}/commit", s.handleRuntimeOperationCommit)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/{operation_id}/cancel", s.handleRuntimeOperationCancel)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/{operation_id}/renew-deadline", s.handleRuntimeOperationRenewDeadline)
	mux.HandleFunc("POST /gateway/v2/runtime-operations/{operation_id}/reconcile", s.handleRuntimeOperationReconcile)
	mux.HandleFunc("GET /gateway/v2/runtime-operations/{operation_id}/events", s.handleRuntimeOperationEvents)
	return mux
}

func (s *Server) handleRuntimeOperationList(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeOperationListRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	response, err := s.lifecycle.List(r.Context(), request, s.lifecycleAccess(r, verified))
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, response)
}

func (s *Server) handleRuntimeManagementCapability(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeManagementCapabilityRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	if strings.TrimSpace(request.ProtocolVersion) != gatewayprotocol.Version || strings.TrimSpace(request.GatewayEnvID) == "" {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime management capability request is invalid.", false)
		return
	}
	if s.lifecycleCapabilityProvider == nil {
		capability := gatewayprotocol.NormalizeRuntimeManagementCapability(gatewayprotocol.RuntimeManagementCapability{
			Support:       gatewayprotocol.CapabilitySupportSupported,
			Authorization: gatewayprotocol.RuntimeManagementAuthorization{State: gatewayprotocol.AuthorizationUnknown},
			Readiness:     gatewayprotocol.ManagementReadinessUnknown,
			ReasonCode:    "runtime_management_unavailable", CheckedAtUnixMS: time.Now().UnixMilli(),
		})
		writeGatewayData(w, http.StatusOK, capability)
		return
	}
	capability, err := s.lifecycleCapabilityProvider.RuntimeManagementCapability(r.Context(), request.GatewayEnvID, s.lifecycleAccess(r, verified))
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, capability)
}

func (s *Server) Start(ctx context.Context, listen string) (*http.Server, []net.Listener, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if s.lifecycle != nil {
		if err := s.lifecycle.RecoverPending(ctx); err != nil {
			return nil, nil, fmt.Errorf("recover Runtime lifecycle operations: %w", err)
		}
	}
	if s.precompiledRuntimeStartup != nil {
		if s.lifecycle == nil {
			return nil, nil, errors.New("precompiled Runtime startup requires the lifecycle store")
		}
		targetID := s.precompiledRuntimeStartup.PrecompiledRuntimeTargetID()
		if err := s.lifecycle.AssertTargetUnlocked(targetID); err != nil {
			var lifecycleErr *gatewaylifecycle.Error
			if !errors.As(err, &lifecycleErr) || lifecycleErr.Code != gatewaylifecycle.ErrorOperationInProgress {
				return nil, nil, fmt.Errorf("check precompiled Runtime startup target: %w", err)
			}
		} else if err := s.precompiledRuntimeStartup.EnsurePrecompiledRuntime(ctx); err != nil {
			return nil, nil, fmt.Errorf("start precompiled Runtime: %w", err)
		}
	}
	addr := strings.TrimSpace(listen)
	if addr == "" {
		addr = "127.0.0.1:0"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, nil, err
	}
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	listeners := []net.Listener{ln}
	go func() {
		<-ctx.Done()
		s.closeAllProfileSessions()
		_ = srv.Close()
	}()
	go func() {
		_ = srv.Serve(ln)
		s.closeAllProfileSessions()
	}()
	go s.sweepLoop(ctx)
	return srv, listeners, nil
}

func (s *Server) trustStore() *gatewaytrust.Store {
	return s.trust
}

func (s *Server) profileStore() *gatewayenvprofiles.Store {
	return s.profile
}

func (s *Server) authVerifier() *gatewayauth.Verifier {
	if s.auth == nil {
		s.auth = gatewayauth.NewVerifier(s.trustStore())
	}
	return s.auth
}

func bindingAudience(r *http.Request) string {
	if r == nil {
		return ""
	}
	if header := strings.TrimSpace(r.Header.Get("X-Redeven-Gateway-Binding-Audience")); header != "" {
		return header
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		host = strings.TrimSpace(r.Header.Get("Host"))
	}
	if host == "" {
		return ""
	}
	return (&url.URL{Scheme: scheme, Host: host, Path: "/"}).String()
}

func (s *Server) handlePairingChallenge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req gatewayprotocol.PairingChallengeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.pairingAllowed(r, req.PairingCode) {
		writeGatewayError(w, http.StatusLocked, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway pairing requires an authorized pairing code.", false)
		return
	}
	resp, err := s.trustStore().PairingChallenge(req)
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway pairing challenge request is invalid.", false)
		return
	}
	writeGatewayData(w, http.StatusOK, resp)
}

func (s *Server) handlePairingComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req gatewayprotocol.PairingCompleteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := gatewayprotocol.ValidatePairingCompleteRequest(req); err != nil {
		writePairingCompleteRequestError(w, err)
		return
	}
	if !s.pairingAllowedForChallenge(r, req.GatewayNonce) {
		writeGatewayError(w, http.StatusLocked, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway pairing requires an authorized pairing code.", false)
		return
	}
	if req.ClientCapability == string(gatewayprotocol.GatewayCapabilityEnvProfileWrite) && !s.profileWritePairingAllowed(r) {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway profile write pairing is not available on this transport.", false)
		return
	}
	if len(req.RuntimeGrants) > 0 && !s.runtimeGrantPairingAllowed(r) {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway Runtime management pairing is not available on this transport.", false)
		return
	}
	resp, err := s.trustStore().CompletePairing(req)
	if err != nil {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway pairing completion was rejected.", false)
		return
	}
	writeGatewayData(w, http.StatusOK, resp)
}

func writePairingCompleteRequestError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, gatewayprotocol.ErrUnsupportedProtocolVersion):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "protocol_version is not supported.", false)
	case errors.Is(err, gatewayprotocol.ErrInvalidClientCapability):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "client_capability is invalid.", false)
	case errors.Is(err, gatewayprotocol.ErrInvalidRuntimeGrants):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "runtime_grants are invalid.", false)
	default:
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway pairing completion request is invalid.", false)
	}
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var req gatewayprotocol.CatalogRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	resp, err := s.catalogService(r, verified).ListEnvironments(r.Context(), req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, resp)
}

func (s *Server) handleOpenSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, _, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var req gatewayprotocol.OpenSessionRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	resp, err := s.sessionService(w, r).OpenSession(r.Context(), req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, resp)
}

func (s *Server) handleEnvProfileUpsert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var req gatewayprotocol.EnvProfileUpsertRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	if !s.profileWriteEnabled {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeCapabilityUnsupported, "Gateway environment profile writes are not enabled.", false)
		return
	}
	if !verified.ProfileWrite {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeUnauthorized, "This Gateway client is not allowed to write environment profiles.", false)
		return
	}
	if !s.isManagedDesktopBridgeRequest(r) {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway environment profile writes require the managed Desktop bridge transport.", false)
		return
	}
	env, err := s.profileStore().Upsert(r.Context(), req)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	s.revokeProfileSessions(env.GatewayEnvID)
	writeGatewayData(w, http.StatusOK, gatewayprotocol.EnvProfileUpsertResponse{
		ProtocolVersion: gatewayprotocol.Version,
		Environment:     env,
	})
}

func (s *Server) handleEnvProfileDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var req gatewayprotocol.EnvProfileDeleteRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	if !s.profileWriteEnabled {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeCapabilityUnsupported, "Gateway environment profile writes are not enabled.", false)
		return
	}
	if !verified.ProfileWrite {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeUnauthorized, "This Gateway client is not allowed to write environment profiles.", false)
		return
	}
	if !s.isManagedDesktopBridgeRequest(r) {
		writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway environment profile deletes require the managed Desktop bridge transport.", false)
		return
	}
	resp, err := s.profileStore().Delete(r.Context(), req)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	if resp.Deleted {
		s.revokeProfileSessions(resp.GatewayEnvID)
	}
	writeGatewayData(w, http.StatusOK, resp)
}

func (s *Server) handleRuntimeOperationPrepare(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeOperationPrepareRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	if strings.TrimSpace(request.AuthorizedClientKeyID) != verified.ClientKeyID {
		writeLifecycleError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "The authorized Runtime operation client does not match the signed request."})
		return
	}
	if s.lifecycleAuthorizer == nil {
		writeLifecycleError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime management permission is required."})
		return
	}
	authorization, err := s.lifecycleAuthorizer.AuthorizePrepare(r.Context(), r, verified, request)
	if err != nil {
		writeLifecycleAuthorizationError(w, err)
		return
	}
	response, err := s.lifecycle.Prepare(r.Context(), request, authorization)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, response)
}

func (s *Server) handleRuntimeOperationGet(w http.ResponseWriter, r *http.Request) {
	_, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	operation, err := s.lifecycle.Get(r.Context(), r.PathValue("operation_id"), s.lifecycleAccess(r, verified))
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationConfirm(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeOperationConfirmationRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	operation, err := s.lifecycle.Confirm(r.Context(), r.PathValue("operation_id"), verified.ClientKeyID, request)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationArtifact(w http.ResponseWriter, r *http.Request) {
	metadataHeader := strings.TrimSpace(r.Header.Get("X-Redeven-Runtime-Artifact-Metadata"))
	metadataJSON, err := base64.RawURLEncoding.DecodeString(metadataHeader)
	if err != nil || len(metadataJSON) == 0 {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime artifact metadata header is invalid.", false)
		return
	}
	var metadata gatewayprotocol.RuntimeArtifactMetadata
	if !decodeJSONBytes(w, metadataJSON, &metadata) {
		return
	}
	bodyDigest, err := gatewaysecurity.CanonicalJSONDigestFromBytes(metadataJSON)
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime artifact metadata is invalid.", false)
		return
	}
	verified, err := s.authVerifier().VerifyDigest(r.Context(), r, bodyDigest, bindingAudience(r))
	if err != nil {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Pair this Gateway before managing Runtime.", false)
		return
	}
	operation, err := s.lifecycle.StageArtifact(r.Context(), r.PathValue("operation_id"), verified.ClientKeyID, metadata, r.Body)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationCommit(w http.ResponseWriter, r *http.Request) {
	_, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	operation, err := s.lifecycle.Commit(r.Context(), r.PathValue("operation_id"), verified.ClientKeyID)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationCancel(w http.ResponseWriter, r *http.Request) {
	_, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	operation, err := s.lifecycle.Cancel(r.Context(), r.PathValue("operation_id"), s.lifecycleAccess(r, verified))
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationRenewDeadline(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeOperationRenewRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	if request.ProtocolVersion != gatewayprotocol.Version {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "protocol_version is not supported.", false)
		return
	}
	operation, err := s.lifecycle.Renew(r.Context(), r.PathValue("operation_id"), verified.ClientKeyID, request.ExpiresAtUnixMS)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationReconcile(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var request gatewayprotocol.RuntimeOperationReconcileRequest
	if !decodeJSONBytes(w, body, &request) {
		return
	}
	if strings.TrimSpace(request.ProtocolVersion) != gatewayprotocol.Version || s.lifecycleAuthorizer == nil {
		writeLifecycleError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime reconcile authorization is required."})
		return
	}
	operation, err := s.lifecycle.OperationForAuthorization(r.PathValue("operation_id"))
	if err != nil {
		// Do not reveal whether an operation exists to a caller that has not
		// successfully presented binding-scoped reconcile authorization.
		writeLifecycleAuthorizationError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime reconcile authorization is invalid."})
		return
	}
	access, err := s.lifecycleAuthorizer.AuthorizeReconcile(r.Context(), r, verified, operation, request.AuthorizationPermit)
	if err != nil {
		writeLifecycleAuthorizationError(w, err)
		return
	}
	operation, err = s.lifecycle.Reconcile(r.Context(), r.PathValue("operation_id"), access)
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}

func (s *Server) handleRuntimeOperationEvents(w http.ResponseWriter, r *http.Request) {
	_, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	response, err := s.lifecycle.Events(r.Context(), r.PathValue("operation_id"), s.lifecycleAccess(r, verified))
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, response)
}

func (s *Server) lifecycleAccess(r *http.Request, verified gatewayauth.VerifiedRequest) gatewaylifecycle.Access {
	access := gatewaylifecycle.Access{ClientKeyID: verified.ClientKeyID}
	if s == nil || s.lifecycleAuthorizer == nil {
		return access
	}
	authorized, err := s.lifecycleAuthorizer.AuthorizeAccess(r.Context(), r, verified)
	if err != nil {
		return access
	}
	access.Grants = authorized.Grants
	access.PermitJTI = authorized.PermitJTI
	return access
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	if r == nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway request is invalid.", false)
		return false
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway request body is invalid.", false)
		return false
	}
	return decodeJSONBytes(w, body, out)
}

func decodeJSONBytes(w http.ResponseWriter, body []byte, out any) bool {
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway request JSON is invalid.", false)
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway request JSON is invalid.", false)
		return false
	}
	return true
}

func (s *Server) readAuthenticatedBody(w http.ResponseWriter, r *http.Request) ([]byte, gatewayauth.VerifiedRequest, bool) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Gateway request body is invalid.", false)
		return nil, gatewayauth.VerifiedRequest{}, false
	}
	verified, err := s.authVerifier().Verify(r.Context(), r, body, bindingAudience(r))
	if err != nil {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Pair this Gateway before listing or opening environments.", false)
		return nil, gatewayauth.VerifiedRequest{}, false
	}
	return body, verified, true
}

func (s *Server) catalogService(r *http.Request, verified gatewayauth.VerifiedRequest) *gatewaycatalog.Service {
	metadata, _, err := s.trustStore().GatewayMetadata(bindingAudience(r))
	if err != nil {
		metadata = gatewayprotocol.GatewayMetadata{
			GatewayID:    "local-gateway",
			DisplayName:  "Redeven Gateway",
			Status:       gatewayprotocol.GatewayStatusError,
			Capabilities: []gatewayprotocol.GatewayCapability{},
		}
	}
	if s.profileWriteEnabled && verified.ProfileWrite && s.isManagedDesktopBridgeRequest(r) {
		metadata.Capabilities = append(metadata.Capabilities, gatewayprotocol.GatewayCapabilityEnvProfileWrite)
	}
	if s.lifecycleAvailable {
		metadata.Capabilities = append(metadata.Capabilities, gatewayprotocol.GatewayCapabilityEnvLifecycle)
	}
	includeEditableProfiles := s.profileWriteEnabled && verified.ProfileWrite && s.isManagedDesktopBridgeRequest(r)
	return gatewaycatalog.NewService(
		gatewaycatalog.WithGatewayMetadata(metadata),
		gatewaycatalog.WithEnvironmentSource(gatewaycatalog.EnvironmentSourceFunc(func(ctx context.Context) ([]gatewayprotocol.Environment, error) {
			profiles, err := s.profileStore().List(ctx)
			if err != nil {
				return nil, err
			}
			environments := make([]gatewayprotocol.Environment, 0, len(profiles))
			for _, profile := range profiles {
				var environment gatewayprotocol.Environment
				if includeEditableProfiles {
					environment = gatewayenvprofiles.EnvironmentFromProfileWithEditableRoute(profile)
				} else {
					environment = gatewayenvprofiles.EnvironmentFromProfile(profile)
				}
				environment.RuntimeManagement = s.runtimeManagementCapability(profile.AccessRoute.Kind, verified.RuntimeGrants)
				environments = append(environments, environment)
			}
			return environments, nil
		})),
	)
}

func (s *Server) runtimeManagementCapability(routeKind gatewayprotocol.EnvProfileAccessRouteKind, grants []gatewayprotocol.RuntimeGrant) *gatewayprotocol.RuntimeManagementCapability {
	support := gatewayprotocol.CapabilitySupportSupported
	reasonCode := "runtime_management_permission_required"
	if routeKind == gatewayprotocol.EnvProfileAccessRouteKindURL {
		support = gatewayprotocol.CapabilitySupportUnsupported
		reasonCode = "url_runtime_management_unsupported"
	}
	grants = normalizeRuntimeGrants(grants)
	authorization := gatewayprotocol.AuthorizationDenied
	if hasRuntimeGrant(grants, gatewayprotocol.RuntimeGrantManage) {
		authorization = gatewayprotocol.AuthorizationAllowed
	}
	readiness := gatewayprotocol.ManagementReadinessUnknown
	if support == gatewayprotocol.CapabilitySupportSupported && authorization == gatewayprotocol.AuthorizationAllowed {
		readiness = gatewayprotocol.ManagementSetupRequired
	}
	capability := gatewayprotocol.NormalizeRuntimeManagementCapability(gatewayprotocol.RuntimeManagementCapability{
		Support: support,
		Authorization: gatewayprotocol.RuntimeManagementAuthorization{
			State:  authorization,
			Grants: grants,
		},
		Readiness:       readiness,
		ReasonCode:      reasonCode,
		CheckedAtUnixMS: time.Now().UnixMilli(),
	})
	return &capability
}

func normalizeRuntimeGrants(values []gatewayprotocol.RuntimeGrant) []gatewayprotocol.RuntimeGrant {
	seen := make(map[gatewayprotocol.RuntimeGrant]struct{}, len(values))
	out := make([]gatewayprotocol.RuntimeGrant, 0, len(values))
	for _, value := range values {
		value = gatewayprotocol.RuntimeGrant(strings.TrimSpace(string(value)))
		switch value {
		case gatewayprotocol.RuntimeGrantManage, gatewayprotocol.RuntimeGrantCustomBuild, gatewayprotocol.RuntimeGrantManageBinding:
		default:
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func hasRuntimeGrant(values []gatewayprotocol.RuntimeGrant, expected gatewayprotocol.RuntimeGrant) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func (s *Server) profileWritePairingAllowed(r *http.Request) bool {
	if s == nil || !s.profileWriteEnabled {
		return false
	}
	return s.isManagedDesktopBridgeRequest(r)
}

func (s *Server) runtimeGrantPairingAllowed(r *http.Request) bool {
	return s != nil && s.isManagedDesktopBridgeRequest(r)
}

func isDesktopBridgeTransport(r *http.Request) bool {
	return r != nil && strings.EqualFold(strings.TrimSpace(r.Header.Get(managedBridgeTransportHeader)), "desktop_bridge")
}

func (s *Server) isManagedDesktopBridgeRequest(r *http.Request) bool {
	if s == nil || !s.desktopBridgeTransport || !isDesktopBridgeTransport(r) {
		return false
	}
	expected := strings.TrimSpace(s.managedBridgeToken)
	if expected == "" {
		return false
	}
	return strings.TrimSpace(r.Header.Get(managedBridgeTokenHeader)) == expected
}

func (s *Server) pairingAllowed(r *http.Request, pairingCode string) bool {
	if s == nil {
		return false
	}
	if s.isManagedDesktopBridgeRequest(r) {
		return true
	}
	return s.pairingCode != "" && strings.TrimSpace(pairingCode) == s.pairingCode
}

func (s *Server) pairingAllowedForChallenge(r *http.Request, gatewayNonce string) bool {
	if s == nil {
		return false
	}
	if s.isManagedDesktopBridgeRequest(r) {
		return true
	}
	challenge, ok := s.trustStore().PendingChallenge(gatewayNonce)
	return ok && s.pairingCode != "" && strings.TrimSpace(challenge.PairingCode) == s.pairingCode
}

func (s *Server) sessionService(_ http.ResponseWriter, r *http.Request) *gatewaysession.Service {
	return gatewaysession.NewService(gatewaysession.WithConnectArtifactIssuer(artifactIssuer{
		server:          s,
		request:         r,
		bindingAudience: bindingAudience(r),
	}))
}

type artifactIssuer struct {
	server          *Server
	request         *http.Request
	bindingAudience string
}

func (i artifactIssuer) IssueGatewayConnectArtifact(ctx context.Context, req gatewayprotocol.OpenSessionRequest) (gatewaysession.GatewayConnectArtifactIssue, error) {
	if err := ctx.Err(); err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	if req.RequestedCapability != gatewayprotocol.RequestedCapabilityEnvApp {
		return gatewaysession.GatewayConnectArtifactIssue{}, &gatewaysession.GatewayError{
			Code:    gatewaysession.ErrorCodeCapabilityUnsupported,
			Message: "Gateway environment capability is not supported.",
		}
	}
	profile, ok, err := i.server.profileStore().Get(ctx, req.GatewayEnvID)
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	if !ok {
		return gatewaysession.GatewayConnectArtifactIssue{}, &gatewaysession.GatewayError{
			Code:    gatewaysession.ErrorCodeNotFound,
			Message: "Gateway environment was not found.",
		}
	}
	if profile.AccessRoute.Kind != gatewayprotocol.EnvProfileAccessRouteKindURL {
		return gatewaysession.GatewayConnectArtifactIssue{}, &gatewaysession.GatewayError{
			Code:    gatewaysession.ErrorCodeCapabilityUnsupported,
			Message: "Gateway environment opening is not available for this profile yet.",
		}
	}
	if i.server.isManagedDesktopBridgeRequest(i.request) {
		return i.issueSignedArtifact(req, "", "gateway_profile_url")
	}
	session, err := i.server.openProfileSession(profile, i.request)
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	issue, err := i.issueSignedArtifact(req, session.EntryURL, "gateway_profile_url")
	if err != nil {
		i.server.discardProfileSession(session)
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	i.server.activateProfileSession(session, issue.ConnectArtifact.ExpiresAtUnixMS)
	return issue, nil
}

func (i artifactIssuer) issueSignedArtifact(req gatewayprotocol.OpenSessionRequest, directURL string, connectionKind string) (gatewaysession.GatewayConnectArtifactIssue, error) {
	metadata, _, err := i.server.trustStore().GatewayMetadata(i.bindingAudience)
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	privateKey, err := i.server.trustStore().GatewayPrivateKey()
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	if i.server.isManagedDesktopBridgeRequest(i.request) {
		return gatewaysession.NewSignedDesktopBridgeIssue(struct {
			GatewayID           string
			GatewayEnvID        string
			BindingAudience     string
			RequestedCapability gatewayprotocol.RequestedCapability
			ClientNonce         string
			BridgeSessionID     string
			RouteID             string
			GatewayPrivateKey   string
			TTL                 time.Duration
		}{
			GatewayID:           metadata.GatewayID,
			GatewayEnvID:        req.GatewayEnvID,
			BindingAudience:     i.bindingAudience,
			RequestedCapability: req.RequestedCapability,
			ClientNonce:         req.ClientNonce,
			BridgeSessionID:     req.BridgeSessionID,
			RouteID:             req.RouteID,
			GatewayPrivateKey:   privateKey,
			TTL:                 gatewayConnectArtifactTTL,
		})
	}
	if strings.TrimSpace(directURL) == "" {
		return gatewaysession.GatewayConnectArtifactIssue{}, errors.New("Gateway Env App entry URL is unavailable")
	}
	issue, err := gatewaysession.NewSignedLocalDirectIssue(struct {
		GatewayID           string
		GatewayEnvID        string
		BindingAudience     string
		RequestedCapability gatewayprotocol.RequestedCapability
		ClientNonce         string
		URL                 string
		GatewayPrivateKey   string
		TTL                 time.Duration
	}{
		GatewayID:           metadata.GatewayID,
		GatewayEnvID:        req.GatewayEnvID,
		BindingAudience:     i.bindingAudience,
		RequestedCapability: req.RequestedCapability,
		ClientNonce:         req.ClientNonce,
		URL:                 directURL,
		GatewayPrivateKey:   privateKey,
		TTL:                 gatewayConnectArtifactTTL,
	})
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	if issue.DiagnosticsHint != nil {
		issue.DiagnosticsHint.ConnectionKind = strings.TrimSpace(connectionKind)
	}
	return issue, nil
}

func (s *Server) openProfileSession(profile gatewayenvprofiles.EnvironmentProfile, r *http.Request) (*profileSession, error) {
	sessionID, err := randomB64u(24)
	if err != nil {
		return nil, err
	}
	accessToken, err := randomB64u(24)
	if err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(profileSessionListenHost(r), "0"))
	if err != nil {
		return nil, err
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		_ = ln.Close()
		return nil, err
	}
	session := &profileSession{
		ID:              sessionID,
		GatewayEnvID:    strings.TrimSpace(profile.GatewayEnvID),
		TargetBaseURL:   strings.TrimSpace(profile.AccessRoute.URL),
		AllowedClientIP: requestRemoteIP(r),
		AccessPath:      profileSessionAccessPath(accessToken),
		EntryURL:        profileSessionEntryURL(r, ln.Addr(), accessToken),
		Listener:        ln,
		CookieJar:       jar,
	}
	if session.GatewayEnvID == "" || session.TargetBaseURL == "" || session.AccessPath == "" || session.EntryURL == "" {
		_ = ln.Close()
		return nil, errors.New("Gateway profile session is incomplete")
	}
	session.Server = &http.Server{
		Handler:           s.profileSessionHandler(session),
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.profileSessionsMu.Lock()
	s.profileSessions[session.ID] = session
	s.profileSessionsMu.Unlock()
	go func() {
		_ = session.Server.Serve(ln)
		s.profileSessionsMu.Lock()
		if current, ok := s.profileSessions[session.ID]; ok && current == session {
			delete(s.profileSessions, session.ID)
		}
		s.profileSessionsMu.Unlock()
	}()
	return session, nil
}

func (s *Server) activateProfileSession(session *profileSession, expiresAtUnixMS int64) {
	if s == nil || session == nil {
		return
	}
	s.profileSessionsMu.Lock()
	if current, ok := s.profileSessions[session.ID]; ok && current == session {
		session.ExpiresAtUnixMS = expiresAtUnixMS
	}
	s.profileSessionsMu.Unlock()
}

func (s *Server) discardProfileSession(session *profileSession) {
	if s == nil || session == nil {
		return
	}
	s.profileSessionsMu.Lock()
	if current, ok := s.profileSessions[session.ID]; ok && current == session {
		delete(s.profileSessions, session.ID)
	}
	s.profileSessionsMu.Unlock()
	closeProfileSession(session)
}

func (s *Server) revokeProfileSessions(gatewayEnvID string) {
	cleanEnvID := strings.TrimSpace(gatewayEnvID)
	if cleanEnvID == "" {
		return
	}
	var sessions []*profileSession
	s.profileSessionsMu.Lock()
	for id, session := range s.profileSessions {
		if session == nil {
			delete(s.profileSessions, id)
			continue
		}
		if strings.TrimSpace(session.GatewayEnvID) == cleanEnvID {
			delete(s.profileSessions, id)
			sessions = append(sessions, session)
		}
	}
	s.profileSessionsMu.Unlock()
	for _, session := range sessions {
		closeProfileSession(session)
	}
}

func (s *Server) closeAllProfileSessions() {
	if s == nil {
		return
	}
	var sessions []*profileSession
	s.profileSessionsMu.Lock()
	for id, session := range s.profileSessions {
		delete(s.profileSessions, id)
		if session != nil {
			sessions = append(sessions, session)
		}
	}
	s.profileSessionsMu.Unlock()
	for _, session := range sessions {
		closeProfileSession(session)
	}
}

func closeProfileSession(session *profileSession) {
	if session == nil {
		return
	}
	if session.Server != nil {
		_ = session.Server.Close()
		return
	}
	if session.Listener != nil {
		_ = session.Listener.Close()
	}
}

func profileSessionListenHost(r *http.Request) string {
	if r != nil {
		if addr, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok && addr != nil {
			if host, _, err := net.SplitHostPort(addr.String()); err == nil {
				host = strings.Trim(strings.TrimSpace(host), "[]")
				if host != "" {
					return host
				}
			}
		}
	}
	return "127.0.0.1"
}

func profileSessionEntryURL(r *http.Request, addr net.Addr, accessToken string) string {
	host := ""
	if r != nil {
		host = requestHostName(r.Host)
	}
	if host == "" {
		if addrHost, _, err := net.SplitHostPort(addr.String()); err == nil {
			host = strings.Trim(addrHost, "[]")
		}
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	_, port, err := net.SplitHostPort(addr.String())
	if err != nil || strings.TrimSpace(port) == "" {
		return ""
	}
	return (&url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort(host, port),
		Path:   strings.TrimRight(profileSessionAccessPath(accessToken), "/") + "/",
	}).String()
}

func profileSessionAccessPath(accessToken string) string {
	token := strings.TrimSpace(accessToken)
	if token == "" {
		return ""
	}
	return "/_redeven_profile/" + token
}

func requestHostName(hostport string) string {
	hostport = strings.TrimSpace(hostport)
	if hostport == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	if strings.HasPrefix(hostport, "[") && strings.HasSuffix(hostport, "]") {
		return strings.Trim(hostport, "[]")
	}
	if strings.Contains(hostport, ":") {
		return ""
	}
	return hostport
}

func requestRemoteIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	return strings.Trim(strings.TrimSpace(host), "[]")
}

func profileSessionClientAllowed(session *profileSession, r *http.Request) bool {
	if session == nil {
		return false
	}
	allowed := strings.TrimSpace(session.AllowedClientIP)
	if allowed == "" {
		return true
	}
	return requestRemoteIP(r) == allowed
}

func profileSessionRequestAllowed(session *profileSession, r *http.Request) (string, bool) {
	if session == nil || r == nil || r.URL == nil {
		return "", false
	}
	path := strings.TrimSpace(r.URL.Path)
	if path == "" {
		path = "/"
	}
	accessPath := strings.TrimRight(session.AccessPath, "/")
	if accessPath != "" && (path == accessPath || strings.HasPrefix(path, accessPath+"/")) {
		targetPath := strings.TrimPrefix(path, accessPath)
		if targetPath == "" {
			targetPath = "/"
		}
		return targetPath, true
	}
	if !profileSessionSameOriginRequest(r) || !profileSessionRefererHasAccessPath(session, r) {
		return "", false
	}
	return path, true
}

func profileSessionSameOriginRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if fetchSite := strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")); fetchSite != "" && !strings.EqualFold(fetchSite, "same-origin") {
		return false
	}
	self := requestOrigin(r)
	if self == "" {
		return true
	}
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" && !sameOriginString(origin, self) {
		return false
	}
	if referer := strings.TrimSpace(r.Header.Get("Referer")); referer != "" && !sameOriginString(referer, self) {
		return false
	}
	return true
}

func profileSessionRefererHasAccessPath(session *profileSession, r *http.Request) bool {
	if session == nil || r == nil {
		return false
	}
	referer := strings.TrimSpace(r.Header.Get("Referer"))
	if referer == "" {
		return false
	}
	parsed, err := url.Parse(referer)
	if err != nil || parsed == nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(parsed.Path), strings.TrimRight(session.AccessPath, "/")+"/")
}

func requestOrigin(r *http.Request) string {
	if r == nil {
		return ""
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return ""
	}
	return (&url.URL{Scheme: scheme, Host: host}).String()
}

func sameOriginString(raw string, origin string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host}).String() == origin
}

func targetOrigin(target *url.URL) string {
	if target == nil {
		return ""
	}
	return (&url.URL{Scheme: target.Scheme, Host: target.Host}).String()
}

func gatewayProfileProxyTransport(policy gatewayenvprofiles.URLTargetPolicy) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	baseDialer := (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	})
	transport.DialContext = func(ctx context.Context, network string, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if !gatewayenvprofiles.URLTargetAllowed(host, policy) {
			return nil, fmt.Errorf("Gateway profile target host is not allowed")
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("Gateway profile target did not resolve")
		}
		var lastErr error
		for _, resolved := range ips {
			if !gatewayenvprofiles.URLTargetIPAllowed(resolved.IP, policy) {
				lastErr = fmt.Errorf("Gateway profile target resolved to a blocked address")
				continue
			}
			addr, ok := netip.AddrFromSlice(resolved.IP)
			if !ok {
				lastErr = fmt.Errorf("Gateway profile target resolved to an invalid address")
				continue
			}
			conn, err := baseDialer.DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("Gateway profile target is not reachable")
	}
	return transport
}

func (s *Server) profileSessionHandler(session *profileSession) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if session == nil || time.Now().UnixMilli() > session.ExpiresAtUnixMS {
			http.Error(w, "Gateway profile session is no longer available", http.StatusUnauthorized)
			return
		}
		if !profileSessionClientAllowed(session, r) {
			http.Error(w, "Gateway profile session is not available from this client", http.StatusForbidden)
			return
		}
		targetPath, ok := profileSessionRequestAllowed(session, r)
		if !ok {
			http.Error(w, "Gateway profile session is not available", http.StatusUnauthorized)
			return
		}
		target, err := url.Parse(strings.TrimSpace(session.TargetBaseURL))
		if err != nil || target == nil || target.Scheme == "" || target.Host == "" {
			http.Error(w, "Gateway profile target is unavailable", http.StatusBadGateway)
			return
		}
		origin := targetOrigin(target)
		proxy := &httputil.ReverseProxy{
			Transport: s.proxyTransport,
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.SetURL(target)
				pr.Out.Host = target.Host
				pr.Out.URL.Path = targetPath
				pr.Out.URL.RawPath = ""
				pr.Out.URL.RawQuery = pr.In.URL.RawQuery
				pr.Out.Header.Del("Cookie")
				pr.Out.Header.Del("Authorization")
				pr.Out.Header.Del("Proxy-Authorization")
				if origin != "" {
					pr.Out.Header.Set("Origin", origin)
					if strings.TrimSpace(pr.Out.Header.Get("Referer")) != "" {
						pr.Out.Header.Set("Referer", origin)
					}
				}
				if session.CookieJar != nil {
					for _, cookie := range session.CookieJar.Cookies(pr.Out.URL) {
						pr.Out.AddCookie(cookie)
					}
				}
				pr.Out.Header.Del("Forwarded")
				pr.Out.Header.Del("X-Forwarded-Host")
				pr.Out.Header.Del("X-Forwarded-Proto")
				pr.Out.Header.Del("X-Forwarded-For")
				pr.Out.Header.Del("X-Forwarded-Port")
			},
			ModifyResponse: func(resp *http.Response) error {
				if session.CookieJar != nil && resp != nil && resp.Request != nil && resp.Request.URL != nil {
					session.CookieJar.SetCookies(resp.Request.URL, resp.Cookies())
				}
				resp.Header.Del("Set-Cookie")
				resp.Header.Del("Service-Worker-Allowed")
				resp.Header.Del("Referrer-Policy")
				resp.Header.Add("Content-Security-Policy", "worker-src 'none'")
				resp.Header.Set("Referrer-Policy", "same-origin")
				resp.Header.Set("Cache-Control", "no-store")
				return nil
			},
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
				http.Error(w, "Gateway profile target is unavailable", http.StatusBadGateway)
			},
		}
		proxy.ServeHTTP(w, r)
	})
}

func writeServiceError(w http.ResponseWriter, err error) {
	var sessionErr *gatewaysession.GatewayError
	if errors.As(err, &sessionErr) {
		switch sessionErr.Code {
		case gatewaysession.ErrorCodeNotFound:
			writeGatewayError(w, http.StatusNotFound, gatewayprotocol.GatewayErrorCodeNotFound, sessionErr.Message, false)
		case gatewaysession.ErrorCodeCapabilityUnsupported:
			writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeCapabilityUnsupported, sessionErr.Message, false)
		case gatewaysession.ErrorCodeNotImplemented:
			writeGatewayError(w, http.StatusNotImplemented, gatewayprotocol.GatewayErrorCodeNotImplemented, sessionErr.Message, false)
		default:
			writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, sessionErr.Message, false)
		}
		return
	}
	if errors.Is(err, gatewayprotocol.ErrUnsupportedProtocolVersion) {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "protocol_version is not supported.", false)
		return
	}
	writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Gateway request could not be completed.", true)
}

func writeLifecycleAuthorizationError(w http.ResponseWriter, err error) {
	var lifecycleErr *gatewaylifecycle.Error
	if errors.As(err, &lifecycleErr) {
		writeLifecycleError(w, lifecycleErr)
		return
	}
	writeGatewayError(w, http.StatusForbidden, gatewayprotocol.GatewayErrorCode(gatewaylifecycle.ErrorUnauthorized), "Runtime management permission is required.", false)
}

func writeLifecycleError(w http.ResponseWriter, err error) {
	var lifecycleErr *gatewaylifecycle.Error
	if !errors.As(err, &lifecycleErr) {
		writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Runtime lifecycle request could not be completed.", true)
		return
	}
	status := http.StatusConflict
	switch lifecycleErr.Code {
	case gatewaylifecycle.ErrorInvalidRequest, gatewaylifecycle.ErrorArtifactInvalid:
		status = http.StatusBadRequest
	case gatewaylifecycle.ErrorUnauthorized, gatewaylifecycle.ErrorCustomBuildDenied:
		status = http.StatusForbidden
	case gatewaylifecycle.ErrorOperationNotFound:
		status = http.StatusNotFound
	case gatewaylifecycle.ErrorOperationExpired:
		status = http.StatusGone
	case gatewaylifecycle.ErrorUnavailable:
		status = http.StatusServiceUnavailable
	}
	writeGatewayError(w, status, gatewayprotocol.GatewayErrorCode(lifecycleErr.Code), lifecycleErr.Message, lifecycleErr.Retryable)
}

func writeProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, gatewayprotocol.ErrUnsupportedProtocolVersion):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "protocol_version is not supported.", false)
	case errors.Is(err, gatewayprotocol.ErrMissingDisplayName):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "display_name is required.", false)
	case errors.Is(err, gatewayprotocol.ErrMissingAccessRoute):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "access_route is required.", false)
	case errors.Is(err, gatewayprotocol.ErrMissingGatewayEnvID):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "gateway_env_id is required.", false)
	case errors.Is(err, gatewayprotocol.ErrMissingLifecycleOperation):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "operation is required.", false)
	case errors.Is(err, gatewayprotocol.ErrInvalidSSHSecretMode):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "ssh_secret.mode is invalid.", false)
	case errors.Is(err, gatewayprotocol.ErrSSHSecretUnsupported):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "ssh_secret is not supported.", false)
	case errors.Is(err, gatewayprotocol.ErrInvalidAccessRouteFields):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "access_route contains fields outside its kind.", false)
	case errors.Is(err, gatewayprotocol.ErrInvalidSSHAuthMode):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "access_route.auth_mode is invalid.", false)
	case errors.Is(err, gatewayprotocol.ErrSSHPasswordAuthUnsupported):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "ssh password auth is not supported.", false)
	case errors.Is(err, gatewayenvprofiles.ErrGatewayEnvIDReserved):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "gateway_env_id is reserved.", false)
	case errors.Is(err, gatewayenvprofiles.ErrGatewayEnvIDInvalid):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "gateway_env_id is invalid.", false)
	case errors.Is(err, gatewayenvprofiles.ErrURLRequired):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "url is required.", false)
	case errors.Is(err, gatewayenvprofiles.ErrURLMustBeAbsoluteHTTP):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "url must be an absolute http or https URL.", false)
	case errors.Is(err, gatewayenvprofiles.ErrURLSchemeUnsupported):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "url must use http or https.", false)
	case errors.Is(err, gatewayenvprofiles.ErrURLCredentialsUnsupported):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "url must not include embedded credentials.", false)
	case errors.Is(err, gatewayenvprofiles.ErrURLTargetUnsafe):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "url target is not allowed by this Gateway.", false)
	case errors.Is(err, gatewayenvprofiles.ErrSSHDestinationRequired):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "ssh_destination is required.", false)
	case errors.Is(err, gatewayenvprofiles.ErrSSHPortInvalid):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "ssh_port must be between 1 and 65535.", false)
	case errors.Is(err, gatewayenvprofiles.ErrContainerEngineInvalid):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "container_engine must be docker or podman.", false)
	case errors.Is(err, gatewayenvprofiles.ErrContainerIDRequired):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "container_id is required.", false)
	case errors.Is(err, gatewayenvprofiles.ErrContainerRuntimeRootRequired):
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "container_runtime_root is required.", false)
	default:
		writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Gateway environment profile request could not be completed.", true)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeGatewayData(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, envelope{OK: true, Data: data})
}

func writeGatewayError(w http.ResponseWriter, status int, code gatewayprotocol.GatewayErrorCode, message string, retryable bool) {
	writeJSON(w, status, envelope{
		OK: false,
		Error: &errorShape{
			Code:           string(code),
			Message:        strings.TrimSpace(message),
			Retryable:      retryable,
			RedactedDetail: strings.TrimSpace(message),
		},
	})
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
	if s != nil && s.lifecycle != nil {
		_ = s.lifecycle.Expire(context.Background())
	}
	now := time.Now().UnixMilli()
	var sessions []*profileSession
	s.profileSessionsMu.Lock()
	for k, v := range s.profileSessions {
		if v == nil {
			delete(s.profileSessions, k)
			continue
		}
		if v.ExpiresAtUnixMS > 0 && now > v.ExpiresAtUnixMS {
			delete(s.profileSessions, k)
			sessions = append(sessions, v)
		}
	}
	s.profileSessionsMu.Unlock()
	for _, session := range sessions {
		closeProfileSession(session)
	}
}

func randomB64u(n int) (string, error) {
	if n <= 0 {
		return "", fmt.Errorf("invalid random byte length %d", n)
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
