package gatewayservice

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaycloud"

	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewaystate"
	gatewayauth "github.com/floegence/redeven/internal/runtimegateway/auth"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
)

const (
	HostAdminHeader = "X-Redeven-Gateway-Host-Token"
)

type Options struct {
	Version                string
	StateRoot              string
	DesktopBridgeTransport bool
	ManagedBridgeToken     string
	HostAdminToken         string
	MemberURL              string
	MemberListen           string
	MemberEndpoints        []gp.GatewayEndpoint
	Hooks                  gatewaymembership.HookConfig
}

type Server struct {
	cloud             *gatewaycloud.Gateway
	version           string
	stateRoot         string
	hostAdminToken    string
	trust             *gatewaytrust.Store
	auth              *gatewayauth.Verifier
	members           *gatewaymembership.Store
	connections       *gatewaymembership.Connections
	memberListener    *gatewaymembership.Listener
	hooks             *gatewaymembership.PolicyHooks
	listenerMu        sync.Mutex
	listenerAddresses []string
	activeBindings    []string
}

type envelope struct {
	OK    bool        `json:"ok"`
	Data  any         `json:"data,omitempty"`
	Error *errorShape `json:"error,omitempty"`
}
type errorShape struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func New(options Options) (*Server, error) {
	if options.HostAdminToken != "" && len(options.HostAdminToken) < 32 {
		return nil, errors.New("invalid Gateway host administrator token")
	}
	root := strings.TrimSpace(options.StateRoot)
	if root == "" {
		root = filepath.Join(defaultStateRoot(), "gateways", "default", "state")
	}
	trust := gatewaytrust.NewStore(filepath.Join(root, "gateway-trust.json"))
	if err := trust.Initialize(); err != nil {
		return nil, err
	}
	metadata, _, err := trust.GatewayMetadata("")
	if err != nil {
		return nil, err
	}
	private, err := trust.GatewayPrivateKey()
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(private))
	if block == nil {
		return nil, errors.New("invalid Gateway machine identity")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("invalid Gateway identity key")
	}
	hookConfig := options.Hooks
	if hookConfig == nil {
		hookConfig = gatewaymembership.HookConfig{}
		if err := gatewaystate.Read(filepath.Join(root, "policy-hooks.json"), &hookConfig); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	hooks, err := gatewaymembership.NewPolicyHooks(hookConfig)
	if err != nil {
		return nil, err
	}
	memberURL, memberListen := options.MemberURL, options.MemberListen
	if memberURL == "" && len(options.MemberEndpoints) > 0 {
		memberURL = options.MemberEndpoints[0].Address
	}
	if memberListen == "" {
		memberListen = ":7443"
	}
	membersPath := filepath.Join(root, "members.json")
	_, stateErr := os.Stat(membersPath)
	initialSetup := errors.Is(stateErr, os.ErrNotExist)
	members, err := gatewaymembership.NewStore(membersPath, gatewaymembership.GatewayIdentity{ID: metadata.GatewayID, DisplayName: metadata.DisplayName, PrivateKey: key}, memberURL, memberListen, hooks)
	if err != nil {
		return nil, err
	}
	if err := members.Readdress("", options.MemberListen); err != nil {
		return nil, err
	}
	if initialSetup && len(options.MemberEndpoints) > 0 {
		if err := members.UpdateEndpoints(options.MemberEndpoints); err != nil {
			return nil, err
		}
	}
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	cloud, err := gatewaycloud.NewGateway(root, gatewaymembership.GatewayIdentity{ID: metadata.GatewayID, PrivateKey: key}, members, connections, budget, slog.Default())
	if err != nil {
		return nil, err
	}
	members.SetCommitHandler(func(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
		connections.Apply(records, policy)
		cloud.Apply(records, policy)
	})
	listener, err := gatewaymembership.NewListener(members, connections, func(keyID string) bool { return trust.ClientPermissions(keyID).Access })
	if err != nil {
		return nil, err
	}
	server := &Server{cloud: cloud, version: options.Version, stateRoot: root, hostAdminToken: options.HostAdminToken, trust: trust, auth: gatewayauth.NewVerifier(trust), members: members, connections: connections, memberListener: listener, hooks: hooks}
	for _, name := range []string{"environments.json", "membership-migration.json"} {
		if _, err := os.Lstat(filepath.Join(root, name)); err == nil {
			return nil, errors.New("retired Gateway configuration; create a new state root and register again; existing files were not changed")
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return server, nil
}

// ReloadHooks is called only by the owning host process. Remote interfaces may
// request evaluation, but cannot select or change executable configuration.
func (s *Server) ReloadHooks() error {
	configuration := gatewaymembership.HookConfig{}
	err := gatewaystate.Read(filepath.Join(s.stateRoot, "policy-hooks.json"), &configuration)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		// An unreadable replacement invalidates previous grants immediately.
		return errors.Join(err, s.members.InvalidateHooks())
	}
	return s.members.RefreshHooks(configuration)
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
	mux := http.NewServeMux()
	mux.HandleFunc("POST /gateway/v6/pairing/challenge", s.handlePairingChallenge)
	mux.HandleFunc("POST /gateway/v6/pairing/complete", s.handlePairingComplete)
	mux.HandleFunc("POST /gateway/v6/catalog", s.handleCatalog)
	mux.HandleFunc("POST /gateway/v6/clients/access-codes", s.handleClientAccessCode)
	mux.HandleFunc("POST /gateway/v6/clients/list", s.handleClientList)
	mux.HandleFunc("POST /gateway/v6/clients/revoke", s.handleClientRevoke)
	mux.HandleFunc("POST /gateway/v6/identity", s.handleIdentity)
	mux.HandleFunc("POST /gateway/v6/cloud/configure", s.handleConfigureCloud)
	mux.HandleFunc("POST /gateway/v6/cloud/status", s.handleCloudStatus)
	mux.HandleFunc("POST /gateway/v6/members/reevaluate", s.handleReevaluate)
	mux.HandleFunc("POST /gateway/v6/invitation-codes", s.handleInvitation)
	mux.HandleFunc("POST /gateway/v6/endpoints", s.handleEndpoints)
	mux.HandleFunc("POST /gateway/v6/network-settings", s.handleNetworkSettings)
	mux.HandleFunc("POST /gateway/v6/members/remove", s.handleRemove)
	mux.HandleFunc("POST /gateway/v6/members/policy", s.handleMemberPolicy)
	mux.HandleFunc("POST /gateway/v6/policy", s.handlePolicy)
	mux.HandleFunc("POST /gateway/v6/access/open", s.handleOpen)
	mux.HandleFunc("POST /gateway/v6/access/service", s.handleServiceIdentity)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This API is a signed native-client surface, never a browser endpoint.
		if r.Header.Get("Origin") != "" {
			writeError(w, http.StatusForbidden, "BROWSER_REQUEST_DENIED")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) Start(ctx context.Context, listen string) (*http.Server, []net.Listener, error) {
	if listen == "" {
		listen = "127.0.0.1:0"
	}
	admin, err := net.Listen("tcp", listen)
	if err != nil {
		return nil, nil, err
	}
	listeners := []net.Listener{admin}
	memberClosers := []func(){}
	shutdown := func() {
		for _, closeServer := range memberClosers {
			closeServer()
		}
		for _, listener := range listeners {
			_ = listener.Close()
		}
		s.listenerMu.Lock()
		s.listenerAddresses = nil
		s.activeBindings = nil
		s.listenerMu.Unlock()
	}
	bindings := s.members.Endpoint().ListenAddresses
	for _, address := range bindings {
		member, err := net.Listen("tcp", address)
		if err != nil {
			shutdown()
			return nil, nil, err
		}
		listeners = append(listeners, member)
	}
	tlsConfig, err := s.members.TLSConfig()
	if err != nil {
		shutdown()
		return nil, nil, err
	}
	adminServer := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	ctx, cancel := context.WithCancel(ctx)
	starters := []func(){}
	for _, member := range listeners[1:] {
		memberServer, err := s.memberListener.Server(tlsConfig.Clone(), s.cloud)
		if err != nil {
			cancel()
			shutdown()
			return nil, nil, err
		}
		memberClosers = append(memberClosers, func() { _ = memberServer.Close() })
		starters = append(starters, func() { defer cancel(); _ = memberServer.Serve(member) })
	}
	s.listenerMu.Lock()
	s.activeBindings = slices.Clone(bindings)
	for _, member := range listeners[1:] {
		s.listenerAddresses = append(s.listenerAddresses, member.Addr().String())
	}
	s.listenerMu.Unlock()
	go s.cloud.Run(ctx)
	go func() { <-ctx.Done(); s.connections.Close(); _ = adminServer.Close(); shutdown() }()
	go func() { defer cancel(); _ = adminServer.Serve(admin) }()
	for _, start := range starters {
		go start()
	}
	return adminServer, listeners, nil
}

func (s *Server) handlePairingChallenge(w http.ResponseWriter, r *http.Request) {
	var request gp.PairingChallengeRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	response, err := s.trust.PairingChallenge(request, s.isHostAdminRequest(r))
	writeResult(w, response, err)
}
func (s *Server) handlePairingComplete(w http.ResponseWriter, r *http.Request) {
	var request gp.PairingCompleteRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	response, err := s.trust.CompletePairing(request, s.isHostAdminRequest(r))
	writeResult(w, response, err)
}
func (s *Server) handleClientAccessCode(w http.ResponseWriter, r *http.Request) {
	var request gp.ClientAccessCodeRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "HOST_MANAGEMENT_REQUIRED")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response, err := s.trust.IssueAccessCode()
	writeResult(w, response, err)
}
func (s *Server) handleClientList(w http.ResponseWriter, r *http.Request) {
	var request gp.ClientListRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "HOST_MANAGEMENT_REQUIRED")
		return
	}
	clients, err := s.trust.ListClients()
	writeResult(w, gp.ClientListResponse{Clients: clients}, err)
}
func (s *Server) handleClientRevoke(w http.ResponseWriter, r *http.Request) {
	var request gp.ClientRevokeRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "HOST_MANAGEMENT_REQUIRED")
		return
	}
	if err := s.trust.RevokeClient(request.ClientKeyID); err != nil {
		writeResult(w, nil, err)
		return
	}
	s.memberListener.RevokeClient(request.ClientKeyID)
	writeResult(w, struct{}{}, nil)
}
func (s *Server) authenticated(w http.ResponseWriter, r *http.Request, value any) (gatewayauth.VerifiedRequest, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return gatewayauth.VerifiedRequest{}, false
	}
	audience := strings.TrimSpace(r.Header.Get("X-Redeven-Gateway-Binding-Audience"))
	var verified gatewayauth.VerifiedRequest
	hostAdmin := s.isHostAdminRequest(r)
	signed := false
	for _, header := range []string{"X-Redeven-Gateway-ID", "X-Redeven-Client-Key-ID", "X-Redeven-Client-Nonce", "X-Redeven-Request-Signature", "X-Redeven-Request-TS"} {
		if r.Header.Get(header) != "" {
			signed = true
		}
	}
	if hostAdmin && !signed {
		verified = gatewayauth.VerifiedRequest{ClientKeyID: "gateway_host"}
	} else {
		verified, err = s.auth.Verify(r.Context(), r, raw, audience)
	}
	if err == nil && hostAdmin && signed {
		err = s.trust.RecordVerified(verified.ClientKeyID, true)
	}
	if err == nil && hostAdmin {
		verified.Permissions = gp.GatewayPermissions{Access: true, ManageMembers: true, ConfigureCloud: true}
	}
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED")
		return verified, false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return verified, false
	}
	var version struct {
		ProtocolVersion string `json:"protocol_version"`
	}
	if json.Unmarshal(raw, &version) != nil || version.ProtocolVersion != gp.Version {
		writeError(w, http.StatusBadRequest, "PROTOCOL_MISMATCH")
		return verified, false
	}
	return verified, true
}

func (s *Server) isHostAdminRequest(r *http.Request) bool {
	if s.hostAdminToken == "" {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(r.Header.Get(HostAdminHeader)), []byte(s.hostAdminToken)) == 1
}
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	var request gp.CatalogRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	records, policy, revision := s.members.Snapshot()
	metadata, _, err := s.trust.GatewayMetadata(client.BindingAudience)
	if err != nil {
		writeResult(w, nil, err)
		return
	}
	endpoint := s.members.Endpoint()
	metadata.ListenerAddress = endpoint.ListenAddress
	metadata.ListenerAddresses = append([]string(nil), endpoint.ListenAddresses...)
	s.listenerMu.Lock()
	metadata.ListenerRunning = len(s.listenerAddresses) > 0
	metadata.ActiveListenerAddresses = append([]string{}, s.listenerAddresses...)
	metadata.ListenerRestartRequired = metadata.ListenerRunning && !slices.Equal(s.activeBindings, endpoint.ListenAddresses)
	metadata.AllowedHosts = append([]string{}, endpoint.AllowedHosts...)
	s.listenerMu.Unlock()
	metadata.EndpointLastUsedAt = s.members.EndpointUsage()
	metadata.MemberEndpoints, metadata.MemberTLSRootPEM, metadata.Permissions = s.members.Endpoints(), endpoint.RootPEM, client.Permissions
	members := make([]gp.Member, 0, len(records))
	for _, record := range records {
		if record.Member.State != "active" {
			continue
		}
		member := record.Member
		member.Connected = s.connections.IsConnected(member.MemberID)
		member.EffectiveCloudAllowed = gatewaymembership.EffectiveCloudAllowed(record, policy)
		member.CloudState = s.cloud.MemberContext(record).State
		members = append(members, member)
	}
	writeResult(w, gp.CatalogResponse{ProtocolVersion: gp.Version, Gateway: metadata, Members: members, Policy: policy, Revision: revision, HookStatus: s.hooks.Status()}, nil)
}

func (s *Server) handleNetworkSettings(w http.ResponseWriter, r *http.Request) {
	var request gp.NetworkSettingsRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "MEMBER_MANAGEMENT_REQUIRED")
		return
	}
	if err := s.members.UpdateNetworkSettings(request.Settings); err != nil {
		writeResult(w, nil, err)
		return
	}
	settings := s.members.NetworkSettings()
	s.listenerMu.Lock()
	restart := len(s.listenerAddresses) > 0 && !slices.Equal(s.activeBindings, settings.ListenAddresses)
	s.listenerMu.Unlock()
	writeResult(w, gp.NetworkSettingsResponse{ProtocolVersion: gp.Version, Settings: settings, RestartRequired: restart}, nil)
}

func (s *Server) handleEndpoints(w http.ResponseWriter, r *http.Request) {
	var request gp.EndpointUpdateRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "MEMBER_MANAGEMENT_REQUIRED")
		return
	}
	if err := s.members.UpdateEndpoints(request.Endpoints); err != nil {
		writeResult(w, nil, err)
		return
	}
	writeResult(w, gp.EndpointUpdateResponse{ProtocolVersion: gp.Version, Endpoints: s.members.Endpoints()}, nil)
}

func (s *Server) handleInvitation(w http.ResponseWriter, r *http.Request) {
	var request gp.InvitationRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "MEMBER_MANAGEMENT_REQUIRED")
		return
	}
	invitation, err := s.members.IssueInvitationCode(client.ClientKeyID)
	writeResult(w, invitation, err)
}
func (s *Server) handleRemove(w http.ResponseWriter, r *http.Request) {
	var request gp.RemoveMemberRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "MEMBER_MANAGEMENT_REQUIRED")
		return
	}
	writeResult(w, struct{}{}, s.members.Remove(request.MemberID, request.ExpectedMemberVersion))
}
func (s *Server) handlePolicy(w http.ResponseWriter, r *http.Request) {
	var request gp.UpdatePolicyRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ConfigureCloud {
		writeError(w, http.StatusForbidden, "CLOUD_CONFIGURATION_REQUIRED")
		return
	}
	writeResult(w, struct{}{}, s.members.UpdatePolicy(r.Context(), request.ExpectedRevision, request.Policy))
}
func (s *Server) handleMemberPolicy(w http.ResponseWriter, r *http.Request) {
	var request gp.UpdateMembersRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ConfigureCloud {
		writeError(w, http.StatusForbidden, "CLOUD_CONFIGURATION_REQUIRED")
		return
	}
	if len(request.Items) == 0 || len(request.Items) > gp.MaxMembers {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	results := make([]gp.MemberOperationResult, 0, len(request.Items))
	for _, update := range request.Items {
		result := gp.MemberOperationResult{MemberID: update.MemberID}
		if err := s.members.UpdateMemberPolicy(r.Context(), update); err != nil {
			result.ErrorCode = memberErrorCode(err)
		}
		results = append(results, result)
	}
	writeResult(w, results, nil)
}
func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	var request gp.OpenSessionRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.Access {
		writeError(w, http.StatusForbidden, "ACCESS_REQUIRED")
		return
	}
	if !s.connections.IsActive(request.MemberID) {
		writeError(w, http.StatusForbidden, "MEMBER_DENIED")
		return
	}
	if !s.connections.IsConnected(request.MemberID) {
		writeError(w, http.StatusConflict, "MEMBER_OFFLINE")
		return
	}
	response, err := s.members.AccessOffer(r.Context(), request.MemberID, client.ClientKeyID)
	writeResult(w, response, err)
}
func (s *Server) handleServiceIdentity(w http.ResponseWriter, r *http.Request) {
	var request gp.MemberServiceRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.Access {
		writeError(w, http.StatusForbidden, "ACCESS_REQUIRED")
		return
	}
	response, err := s.members.ServiceIdentity(request.MemberID, request.ExpectedMemberVersion)
	writeResult(w, response, err)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, value any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return false
	}
	return true
}
func memberErrorCode(err error) string {
	switch err.Error() {
	case "ACCESS_CODE_INVALID_OR_EXPIRED", "ACCESS_CODE_USED", "CLIENT_ACCESS_REVOKED", "HOST_CONNECTION_MANAGED_ON_HOST":
		return err.Error()
	}
	switch {
	case errors.Is(err, gatewaymembership.ErrConflict):
		return "MEMBER_VERSION_CONFLICT"
	case errors.Is(err, gatewaymembership.ErrDenied):
		return "MEMBER_DENIED"
	case errors.Is(err, gatewaymembership.ErrCapacity):
		return "MEMBER_CAPACITY"
	default:
		return "GATEWAY_UNAVAILABLE"
	}
}
func writeResult(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeError(w, http.StatusConflict, memberErrorCode(err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(envelope{OK: true, Data: value})
}
func writeError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: &errorShape{Code: code, Message: fmt.Sprintf("Gateway request failed (%s).", code)}})
}

func (s *Server) handleConfigureCloud(w http.ResponseWriter, r *http.Request) {
	var request gp.ConfigureCloudRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ConfigureCloud {
		writeError(w, http.StatusForbidden, "CLOUD_CONFIGURATION_REQUIRED")
		return
	}
	result, err := s.cloud.Configure(r.Context(), request.CloudOrigin, s.version, request.Reauthorize)
	writeResult(w, result, err)
}
func (s *Server) handleCloudStatus(w http.ResponseWriter, r *http.Request) {
	var request gp.CatalogRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ConfigureCloud {
		writeError(w, http.StatusForbidden, "CLOUD_CONFIGURATION_REQUIRED")
		return
	}
	writeResult(w, s.cloud.Summary(), nil)
}
func (s *Server) handleReevaluate(w http.ResponseWriter, r *http.Request) {
	var request gp.RemoveMemberRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageMembers {
		writeError(w, http.StatusForbidden, "MEMBER_MANAGEMENT_REQUIRED")
		return
	}
	writeResult(w, struct{}{}, s.members.ReevaluateCloud(r.Context(), request.MemberID, request.ExpectedMemberVersion))
}
