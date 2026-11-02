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
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewayegress"

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
	PublicURL              string
	PublicListen           string
	Endpoints              []gp.GatewayEndpoint
	Hooks                  gatewaymembership.HookConfig
}

type Server struct {
	operations        *hostOperations
	egress            *gatewayegress.Controller
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
	// Reject retired configuration before creating identities or member state.
	for _, name := range []string{"environments.json", "membership-migration.json", "cloud-access.json"} {
		if _, err := os.Lstat(filepath.Join(root, name)); err == nil {
			return nil, &gatewaystate.ReadError{Code: "gateway_state_unsupported", File: name, Message: "retired Gateway configuration; recreate local state and register again; existing files were not changed"}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, &gatewaystate.ReadError{Code: "gateway_state_unavailable", File: name, Message: "configuration could not be inspected; check file access"}
		}
	}
	if err := gatewaymembership.CheckStateFile(filepath.Join(root, "members.json")); err != nil {
		return nil, err
	}
	operations, err := loadHostOperations(root)
	if err != nil {
		return nil, err
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
	memberURL, memberListen := options.PublicURL, options.PublicListen
	if memberURL == "" && len(options.Endpoints) > 0 {
		memberURL = options.Endpoints[0].Address
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
	if err := members.Readdress("", options.PublicListen); err != nil {
		return nil, err
	}
	if initialSetup && len(options.Endpoints) > 0 {
		if err := members.UpdateEndpoints(options.Endpoints); err != nil {
			return nil, err
		}
	}
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	egress, err := gatewayegress.NewController(budget)
	if err != nil {
		return nil, err
	}
	members.SetCommitHandler(func(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
		connections.Apply(records, policy)
		egress.Apply(records, policy)
	})
	listener, err := gatewaymembership.NewListener(members, connections, func(keyID string) bool { return trust.ClientPermissions(keyID).Access })
	if err != nil {
		return nil, err
	}
	server := &Server{operations: operations, egress: egress, version: options.Version, stateRoot: root, hostAdminToken: options.HostAdminToken, trust: trust, auth: gatewayauth.NewVerifier(trust), members: members, connections: connections, memberListener: listener, hooks: hooks}
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

// PublicHandler exposes device pairing and access without host administration.
func (s *Server) PublicHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /gateway/v6/pairing/challenge", s.handlePairingChallenge)
	mux.HandleFunc("POST /gateway/v6/pairing/complete", s.handlePairingComplete)
	mux.HandleFunc("POST /gateway/v6/catalog", s.handleCatalog)
	mux.HandleFunc("POST /gateway/v6/identity", s.handleIdentity)
	mux.HandleFunc("POST /gateway/v6/access/open", s.handleOpen)
	mux.HandleFunc("POST /gateway/v6/access/service", s.handleServiceIdentity)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			writeError(w, http.StatusForbidden, "BROWSER_REQUEST_DENIED")
			return
		}
		request := r.Clone(r.Context())
		request.Header.Del(HostAdminHeader)
		mux.ServeHTTP(w, request)
	})
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
	mux.HandleFunc("POST /gateway/v6/attachments/reevaluate", s.handleReevaluate)
	mux.HandleFunc("POST /gateway/v6/invitation-codes", s.handleInvitation)
	mux.HandleFunc("POST /gateway/v6/endpoints", s.handleEndpoints)
	mux.HandleFunc("POST /gateway/v6/network-settings", s.handleNetworkSettings)
	mux.HandleFunc("POST /gateway/v6/attachments/remove", s.handleRemove)
	mux.HandleFunc("POST /gateway/v6/attachments/policy", s.handleMemberPolicy)
	mux.HandleFunc("POST /gateway/v6/policy", s.handlePolicy)
	mux.HandleFunc("POST /gateway/v6/access/open", s.handleOpen)
	mux.HandleFunc("POST /gateway/v6/access/service", s.handleServiceIdentity)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This API is a signed native-client surface, never a browser endpoint.
		if r.Header.Get("Origin") != "" {
			writeError(w, http.StatusForbidden, "BROWSER_REQUEST_DENIED")
			return
		}
		s.hostOperationHandler(mux).ServeHTTP(w, r)
	})
}

func (s *Server) Start(ctx context.Context) (*http.Server, []net.Listener, error) {
	socketDirectory, err := os.MkdirTemp("", "rdg-")
	if err != nil {
		return nil, nil, err
	}
	socketPath := filepath.Join(socketDirectory, "host.sock")
	admin, err := net.Listen("unix", socketPath)
	if err != nil {
		_ = os.RemoveAll(socketDirectory)
		return nil, nil, err
	}
	if err := os.Chmod(socketPath, 0600); err != nil {
		_ = admin.Close()
		_ = os.RemoveAll(socketDirectory)
		return nil, nil, err
	}
	listeners := []net.Listener{admin}
	memberClosers := []func(){}
	shutdown := func() {
		defer os.RemoveAll(socketDirectory)
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
	adminServer := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Handler().ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), hostSocketKey{}, s)))
	}), ReadHeaderTimeout: 10 * time.Second}
	ctx, cancel := context.WithCancel(ctx)
	starters := []func(){}
	for _, member := range listeners[1:] {
		memberServer, err := s.memberListener.Server(tlsConfig.Clone(), s.egress, s.PublicHandler())
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
	go func() { <-ctx.Done(); _ = s.egress.Close() }()
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
	_, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !s.isHostAdminRequest(r) {
		writeError(w, http.StatusForbidden, "HOST_MANAGEMENT_REQUIRED")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response, err := s.trust.IssueAccessCode()
	if err == nil {
		metadata, _, metadataErr := s.trust.GatewayMetadata("")
		publicKey, keyErr := s.trust.GatewayPublicKey()
		if metadataErr == nil {
			metadataErr = keyErr
		}
		if metadataErr != nil {
			err = metadataErr
		} else {
			response.AccessCode, err = gp.EncodeClientAccessPackage(gp.ClientAccessPackage{Purpose: gp.ClientAccessPurpose, Version: 1, AccessCode: response.AccessCode, GatewayID: metadata.GatewayID, GatewayPublicKey: publicKey, TLSRootPEM: s.members.Endpoint().RootPEM, ExpiresAtUnixMS: response.ExpiresAtUnixMS})
		}
	}
	writeResult(w, response, err)
}
func (s *Server) handleClientList(w http.ResponseWriter, r *http.Request) {
	var request gp.ClientListRequest
	_, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !s.isHostAdminRequest(r) {
		writeError(w, http.StatusForbidden, "HOST_MANAGEMENT_REQUIRED")
		return
	}
	clients, err := s.trust.ListClients()
	writeResult(w, gp.ClientListResponse{Clients: clients}, err)
}
func (s *Server) handleClientRevoke(w http.ResponseWriter, r *http.Request) {
	var request gp.ClientRevokeRequest
	_, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !s.isHostAdminRequest(r) {
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
		verified = gatewayauth.VerifiedRequest{ClientKeyID: "gateway_host", BindingAudience: audience}
	} else {
		verified, err = s.auth.Verify(r.Context(), r, raw, audience)
	}
	if err == nil && hostAdmin {
		verified.Permissions = gp.GatewayPermissions{Access: true, ManageAttachments: true, ManageNetwork: true}
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

type hostSocketKey struct{}

func (s *Server) isHostAdminRequest(r *http.Request) bool {
	if s.hostAdminToken == "" {
		return false
	}
	if r.Context().Value(hostSocketKey{}) != s {
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
	metadata.Endpoints, metadata.TLSRootPEM, metadata.Permissions = s.members.Endpoints(), endpoint.RootPEM, client.Permissions
	members := make([]gp.RuntimeAttachment, 0, len(records))
	for _, record := range records {
		if record.Member.State != "active" {
			continue
		}
		member := record.Member
		member.Connected = s.connections.IsConnected(member.AttachmentID)
		member.EffectiveEgressAllowed = gatewaymembership.EffectiveEgressAllowed(record, policy)
		members = append(members, member)
	}
	writeResult(w, gp.CatalogResponse{ProtocolVersion: gp.Version, Gateway: metadata, Attachments: members, Policy: policy, Revision: revision, HookStatus: s.hooks.Status()}, nil)
}

func (s *Server) handleNetworkSettings(w http.ResponseWriter, r *http.Request) {
	var request gp.NetworkSettingsRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageNetwork {
		writeError(w, http.StatusForbidden, "NETWORK_CONFIGURATION_REQUIRED")
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
	if !client.Permissions.ManageNetwork {
		writeError(w, http.StatusForbidden, "NETWORK_CONFIGURATION_REQUIRED")
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
	if !client.Permissions.ManageAttachments {
		writeError(w, http.StatusForbidden, "ATTACHMENT_MANAGEMENT_REQUIRED")
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
	if !client.Permissions.ManageAttachments {
		writeError(w, http.StatusForbidden, "ATTACHMENT_MANAGEMENT_REQUIRED")
		return
	}
	writeResult(w, struct{}{}, s.members.Remove(request.AttachmentID, request.ExpectedAttachmentVersion))
}
func (s *Server) handlePolicy(w http.ResponseWriter, r *http.Request) {
	var request gp.UpdatePolicyRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageNetwork {
		writeError(w, http.StatusForbidden, "NETWORK_CONFIGURATION_REQUIRED")
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
	if !client.Permissions.ManageNetwork {
		writeError(w, http.StatusForbidden, "NETWORK_CONFIGURATION_REQUIRED")
		return
	}
	if len(request.Items) == 0 || len(request.Items) > gp.MaxAttachments {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	results := make([]gp.MemberOperationResult, 0, len(request.Items))
	for _, update := range request.Items {
		result := gp.MemberOperationResult{AttachmentID: update.AttachmentID}
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
	if !client.Permissions.Access || !s.trust.ClientPermissions(client.ClientKeyID).Access {
		writeError(w, http.StatusForbidden, "ACCESS_REQUIRED")
		return
	}
	if !s.connections.IsActive(request.AttachmentID) {
		writeError(w, http.StatusForbidden, "ATTACHMENT_DENIED")
		return
	}
	if !s.connections.IsConnected(request.AttachmentID) {
		writeError(w, http.StatusConflict, "ATTACHMENT_OFFLINE")
		return
	}
	response, err := s.members.AccessOffer(r.Context(), request.AttachmentID, client.ClientKeyID)
	writeResult(w, response, err)
}
func (s *Server) handleServiceIdentity(w http.ResponseWriter, r *http.Request) {
	var request gp.MemberServiceRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.Access || !s.trust.ClientPermissions(client.ClientKeyID).Access {
		writeError(w, http.StatusForbidden, "ACCESS_REQUIRED")
		return
	}
	response, err := s.members.ServiceIdentity(request.AttachmentID, request.ExpectedAttachmentVersion)
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
	case "ACCESS_CODE_INVALID_OR_EXPIRED", "ACCESS_CODE_USED", "CLIENT_ACCESS_REVOKED":
		return err.Error()
	}
	switch {
	case errors.Is(err, gatewaymembership.ErrConflict):
		return "ATTACHMENT_VERSION_CONFLICT"
	case errors.Is(err, gatewaymembership.ErrDenied):
		return "ATTACHMENT_DENIED"
	case errors.Is(err, gatewaymembership.ErrCapacity):
		return "ATTACHMENT_CAPACITY"
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

func (s *Server) handleReevaluate(w http.ResponseWriter, r *http.Request) {
	var request gp.RemoveMemberRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if !client.Permissions.ManageNetwork {
		writeError(w, http.StatusForbidden, "NETWORK_MANAGEMENT_REQUIRED")
		return
	}
	writeResult(w, struct{}{}, s.members.ReevaluateEgress(r.Context(), request.AttachmentID, request.ExpectedAttachmentVersion))
}
