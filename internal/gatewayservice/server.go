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
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	gatewaysession "github.com/floegence/redeven/internal/runtimegateway/session"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
)

const (
	envSessionCookieName = "redeven_gateway_env_session"
	envProxySessionTTL   = 12 * time.Hour

	managedBridgeTransportHeader = "X-Redeven-Gateway-Transport"
	managedBridgeTokenHeader     = "X-Redeven-Gateway-Managed-Bridge-Token"
)

type Options struct {
	StateRoot                  string
	DesktopBridgeTransport     bool
	AllowPrivateProfileTargets bool
	ProfileWriteEnabled        bool
	PairingCode                string
	ManagedBridgeToken         string
}

type Server struct {
	stateRoot              string
	desktopBridgeTransport bool
	profileWriteEnabled    bool
	pairingCode            string
	managedBridgeToken     string

	trust   *gatewaytrust.Store
	auth    *gatewayauth.Verifier
	profile *gatewayenvprofiles.Store

	profileSessionsMu sync.Mutex
	profileSessions   map[string]profileSession
	proxyTransport    http.RoundTripper
}

type profileSession struct {
	GatewayEnvID    string
	TargetBaseURL   string
	ExpiresAtUnixMS int64
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
		profileSessions: make(map[string]profileSession),
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
	mux.HandleFunc("/gateway/v1/pairing/challenge", s.handlePairingChallenge)
	mux.HandleFunc("/gateway/v1/pairing/complete", s.handlePairingComplete)
	mux.HandleFunc("/gateway/v1/catalog", s.handleCatalog)
	mux.HandleFunc("/gateway/v1/open-session", s.handleOpenSession)
	mux.HandleFunc("/gateway/v1/env-profiles/upsert", s.handleEnvProfileUpsert)
	mux.HandleFunc("/gateway/v1/env-profiles/delete", s.handleEnvProfileDelete)
	mux.HandleFunc("/gateway/v1/env-lifecycle", s.handleEnvLifecycle)
	return s.withProfileProxy(mux)
}

func (s *Server) Start(ctx context.Context, listen string) (*http.Server, []net.Listener, error) {
	if ctx == nil {
		ctx = context.Background()
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
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	go func() {
		_ = srv.Serve(ln)
	}()
	go s.sweepLoop(ctx)
	return srv, []net.Listener{ln}, nil
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
	if !s.pairingAllowedForChallenge(r, req.GatewayNonce) {
		writeGatewayError(w, http.StatusLocked, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway pairing requires an authorized pairing code.", false)
		return
	}
	if req.ClientCapability == string(gatewayprotocol.GatewayCapabilityEnvProfileWrite) && !s.profileWritePairingAllowed(r) {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway profile write pairing is not available on this transport.", false)
		return
	}
	resp, err := s.trustStore().CompletePairing(req)
	if err != nil {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Gateway pairing completion was rejected.", false)
		return
	}
	writeGatewayData(w, http.StatusOK, resp)
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

func (s *Server) handleEnvLifecycle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, _, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	var req gatewayprotocol.EnvLifecycleRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	if err := gatewayprotocol.ValidateEnvLifecycleRequest(req); err != nil {
		writeProfileError(w, err)
		return
	}
	req = gatewayprotocol.NormalizeEnvLifecycleRequest(req)
	writeGatewayData(w, http.StatusOK, gatewayprotocol.EnvLifecycleResponse{
		ProtocolVersion: gatewayprotocol.Version,
		GatewayEnvID:    req.GatewayEnvID,
		Operation:       req.Operation,
		State:           gatewayprotocol.EnvLifecycleStateUnsupported,
		Message:         "Gateway environment lifecycle is not supported for this profile.",
	})
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
				if includeEditableProfiles {
					environments = append(environments, gatewayenvprofiles.EnvironmentFromProfileWithEditableRoute(profile))
				} else {
					environments = append(environments, gatewayenvprofiles.EnvironmentFromProfile(profile))
				}
			}
			return environments, nil
		})),
	)
}

func (s *Server) profileWritePairingAllowed(r *http.Request) bool {
	if s == nil || !s.profileWriteEnabled {
		return false
	}
	return s.isManagedDesktopBridgeRequest(r)
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

func (s *Server) sessionService(w http.ResponseWriter, r *http.Request) *gatewaysession.Service {
	return gatewaysession.NewService(gatewaysession.WithConnectArtifactIssuer(artifactIssuer{
		server:          s,
		request:         r,
		responseWriter:  w,
		bindingAudience: bindingAudience(r),
	}))
}

type artifactIssuer struct {
	server          *Server
	request         *http.Request
	responseWriter  http.ResponseWriter
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
	token, expiresAt, err := i.server.mintProfileSession(profile)
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	i.server.setProfileSessionCookie(i.responseWriter, i.request, token, expiresAt)
	return i.issueSignedArtifact(req, "gateway_profile_url")
}

func (i artifactIssuer) issueSignedArtifact(req gatewayprotocol.OpenSessionRequest, connectionKind string) (gatewaysession.GatewayConnectArtifactIssue, error) {
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
			TTL:                 10 * time.Minute,
		})
	}
	entryURL := gatewayEnvAppEntryURL(i.request)
	if strings.TrimSpace(entryURL) == "" {
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
		URL:                 entryURL,
		GatewayPrivateKey:   privateKey,
		TTL:                 10 * time.Minute,
	})
	if err != nil {
		return gatewaysession.GatewayConnectArtifactIssue{}, err
	}
	if issue.DiagnosticsHint != nil {
		issue.DiagnosticsHint.ConnectionKind = strings.TrimSpace(connectionKind)
	}
	return issue, nil
}

func gatewayEnvAppEntryURL(r *http.Request) string {
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
	return (&url.URL{Scheme: scheme, Host: host, Path: "/_redeven_proxy/env/"}).String()
}

func (s *Server) mintProfileSession(profile gatewayenvprofiles.EnvironmentProfile) (string, int64, error) {
	token, err := randomB64u(24)
	if err != nil {
		return "", 0, err
	}
	expiresAt := time.Now().Add(envProxySessionTTL).UnixMilli()
	session := profileSession{
		GatewayEnvID:    strings.TrimSpace(profile.GatewayEnvID),
		TargetBaseURL:   strings.TrimSpace(profile.AccessRoute.URL),
		ExpiresAtUnixMS: expiresAt,
	}
	if session.GatewayEnvID == "" || session.TargetBaseURL == "" {
		return "", 0, errors.New("Gateway profile session is incomplete")
	}
	s.profileSessionsMu.Lock()
	s.profileSessions[token] = session
	s.profileSessionsMu.Unlock()
	return token, expiresAt, nil
}

func (s *Server) profileSessionFromRequest(r *http.Request) (profileSession, bool) {
	if s == nil || r == nil {
		return profileSession{}, false
	}
	cookie, err := r.Cookie(envSessionCookieName)
	if err != nil || cookie == nil {
		return profileSession{}, false
	}
	token := strings.TrimSpace(cookie.Value)
	if token == "" {
		return profileSession{}, false
	}
	now := time.Now().UnixMilli()
	s.profileSessionsMu.Lock()
	defer s.profileSessionsMu.Unlock()
	session, ok := s.profileSessions[token]
	if !ok {
		return profileSession{}, false
	}
	if session.ExpiresAtUnixMS <= now || strings.TrimSpace(session.TargetBaseURL) == "" {
		delete(s.profileSessions, token)
		return profileSession{}, false
	}
	return session, true
}

func (s *Server) revokeProfileSessions(gatewayEnvID string) {
	cleanEnvID := strings.TrimSpace(gatewayEnvID)
	if cleanEnvID == "" {
		return
	}
	s.profileSessionsMu.Lock()
	for token, session := range s.profileSessions {
		if strings.TrimSpace(session.GatewayEnvID) == cleanEnvID {
			delete(s.profileSessions, token)
		}
	}
	s.profileSessionsMu.Unlock()
}

func (s *Server) hasProfileSessionCookie(r *http.Request) bool {
	cookie, err := r.Cookie(envSessionCookieName)
	return err == nil && cookie != nil && strings.TrimSpace(cookie.Value) != ""
}

func setProfileSessionCookie(w http.ResponseWriter, token string, expiresAtUnixMs int64, secure bool) {
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     envSessionCookieName,
		Value:    strings.TrimSpace(token),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.UnixMilli(expiresAtUnixMs),
	})
}

func (s *Server) setProfileSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiresAtUnixMs int64) {
	setProfileSessionCookie(w, token, expiresAtUnixMs, requestIsSecure(r))
}

func requestIsSecure(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func clearProfileSessionCookie(w http.ResponseWriter) {
	if w == nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     envSessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func shouldProxyRequest(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return false
	}
	path := strings.TrimSpace(r.URL.Path)
	return path == "/" ||
		path == "/favicon.ico" ||
		path == "/logo.png" ||
		strings.HasPrefix(path, "/_redeven_proxy/") ||
		strings.HasPrefix(path, "/_redeven_direct/") ||
		strings.HasPrefix(path, "/api/local/")
}

func shouldBlockStaleSession(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return false
	}
	return !strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/gateway/v1/")
}

func targetOrigin(target *url.URL) string {
	if target == nil {
		return ""
	}
	return (&url.URL{Scheme: target.Scheme, Host: target.Host}).String()
}

func stripProfileCookie(header string) string {
	parts := strings.Split(header, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		clean := strings.TrimSpace(part)
		if clean == "" {
			continue
		}
		name, _, _ := strings.Cut(clean, "=")
		if strings.EqualFold(strings.TrimSpace(name), envSessionCookieName) {
			continue
		}
		out = append(out, clean)
	}
	return strings.Join(out, "; ")
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

func (s *Server) withProfileProxy(next http.Handler) http.Handler {
	if next == nil {
		return http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := s.profileSessionFromRequest(r)
		if !ok || !shouldProxyRequest(r) {
			if !ok && s.hasProfileSessionCookie(r) && shouldBlockStaleSession(r) {
				clearProfileSessionCookie(w)
				http.Error(w, "Gateway profile session is no longer available", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
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
				pr.Out.URL.Path = pr.In.URL.Path
				pr.Out.URL.RawPath = pr.In.URL.RawPath
				pr.Out.URL.RawQuery = pr.In.URL.RawQuery
				if origin != "" {
					pr.Out.Header.Set("Origin", origin)
					if strings.TrimSpace(pr.Out.Header.Get("Referer")) != "" {
						pr.Out.Header.Set("Referer", origin)
					}
				}
				if cookie := stripProfileCookie(pr.Out.Header.Get("Cookie")); cookie != "" {
					pr.Out.Header.Set("Cookie", cookie)
				} else {
					pr.Out.Header.Del("Cookie")
				}
				pr.Out.Header.Del("Forwarded")
				pr.Out.Header.Del("X-Forwarded-Host")
				pr.Out.Header.Del("X-Forwarded-Proto")
				pr.Out.Header.Del("X-Forwarded-For")
				pr.Out.Header.Del("X-Forwarded-Port")
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
	now := time.Now().UnixMilli()
	s.profileSessionsMu.Lock()
	for k, v := range s.profileSessions {
		if v.ExpiresAtUnixMS > 0 && now > v.ExpiresAtUnixMS {
			delete(s.profileSessions, k)
		}
	}
	s.profileSessionsMu.Unlock()
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
