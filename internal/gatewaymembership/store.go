package gatewaymembership

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var (
	ErrState    = errors.New("MEMBER_STATE_INVALID")
	ErrConflict = errors.New("MEMBER_VERSION_CONFLICT")
	ErrDenied   = errors.New("MEMBER_DENIED")
	ErrCapacity = errors.New("MEMBER_CAPACITY")
)

type GatewayIdentity struct {
	ID         string
	PrivateKey ed25519.PrivateKey
}

type Endpoint struct {
	URL            string `json:"url"`
	ListenAddress  string `json:"listen_address"`
	RootPEM        string `json:"root_pem"`
	RootKeyPEM     string `json:"root_key_pem"`
	CertificatePEM string `json:"certificate_pem"`
	PrivateKeyPEM  string `json:"private_key_pem"`
}

func (Endpoint) String() string   { return "Gateway.MemberEndpoint" }
func (Endpoint) GoString() string { return "Gateway.MemberEndpoint" }

// MemberRecord is the only durable local member. Cloud policy and registration
// must refer to its ID and version rather than maintaining another member map.
type MemberRecord struct {
	Member                  gp.Member           `json:"member"`
	Delegation              gp.MemberDelegation `json:"delegation"`
	Service                 gp.MemberService    `json:"service"`
	ClientCertificatePEM    string              `json:"client_certificate_pem"`
	ClientCertificateSHA256 string              `json:"client_certificate_sha256"`
	ClientExpiresAtUnixMS   int64               `json:"client_expires_at_unix_ms"`
	HookCloudAllowed        bool                `json:"hook_cloud_allowed"`
	HookPolicyRevision      int64               `json:"hook_policy_revision"`
	ConnectionGeneration    uint64              `json:"connection_generation"`
	Rotation                *rotationDelivery   `json:"rotation,omitempty"`
}

type rotationDelivery struct {
	PreviousSHA256          string                  `json:"previous_sha256"`
	PreviousExpiresAtUnixMS int64                   `json:"previous_expires_at_unix_ms"`
	RequestSHA256           string                  `json:"request_sha256"`
	Response                gp.MemberRotateResponse `json:"response"`
}

type invitationRecord struct {
	IssuanceID      string                 `json:"issuance_id,omitempty"`
	Issued          *gp.MemberInvitation   `json:"issued,omitempty"`
	Canceled        bool                   `json:"canceled"`
	TokenSHA256     string                 `json:"token_sha256"`
	CreatedBy       string                 `json:"created_by"`
	IssuedAtUnixMS  int64                  `json:"issued_at_unix_ms"`
	ExpiresAtUnixMS int64                  `json:"expires_at_unix_ms"`
	DeliveryID      string                 `json:"delivery_id,omitempty"`
	RequestSHA256   string                 `json:"request_sha256,omitempty"`
	Response        *gp.MemberJoinResponse `json:"response,omitempty"`
}

type memberState struct {
	SchemaVersion    int                             `json:"schema_version"`
	CloudNamespaceID string                          `json:"cloud_namespace_id,omitempty"`
	GatewayID        string                          `json:"gateway_id"`
	Revision         int64                           `json:"revision"`
	Endpoint         Endpoint                        `json:"endpoint"`
	Policy           gp.GatewayPolicy                `json:"policy"`
	Members          map[string]MemberRecord         `json:"members"`
	Invitations      map[string]invitationRecord     `json:"invitations"`
	CloudCommands    map[string]cloudCommandDelivery `json:"cloud_commands"`
	Admissions       map[string]Admission            `json:"admissions"`
}

type Store struct {
	mu       sync.Mutex
	path     string
	identity GatewayIdentity
	state    memberState
	hooks    *PolicyHooks
	// Applied under the transaction lock, after persistence and before returning
	// to the caller. It must not call Store methods. This lets the service fence
	// removed permissions synchronously and in committed revision order.
	onCommit func([]MemberRecord, gp.GatewayPolicy)
}

func NewStore(path string, identity GatewayIdentity, endpointURL, listen string, hooks *PolicyHooks) (*Store, error) {
	if path == "" || !validID(identity.ID) || len(identity.PrivateKey) != ed25519.PrivateKeySize || hooks == nil {
		return nil, ErrState
	}
	s := &Store{path: path, identity: GatewayIdentity{ID: identity.ID, PrivateKey: append(ed25519.PrivateKey(nil), identity.PrivateKey...)}, hooks: hooks}
	err := gatewaystate.Read(path, &s.state)
	if errors.Is(err, os.ErrNotExist) {
		endpoint, err := newEndpoint(endpointURL, listen)
		if err != nil {
			return nil, err
		}
		s.state = memberState{SchemaVersion: 1, GatewayID: identity.ID, Revision: 1, Endpoint: endpoint, Policy: gp.GatewayPolicy{Revision: 1, PublicationMode: gp.PublicationManual}, Members: map[string]MemberRecord{}, Invitations: map[string]invitationRecord{}, CloudCommands: map[string]cloudCommandDelivery{}, Admissions: map[string]Admission{}}
		if err := gatewaystate.Write(path, s.state); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if s.state.SchemaVersion != 1 || s.state.GatewayID != identity.ID || s.state.Revision < 1 || s.state.Policy.Revision < 1 || s.state.Members == nil || s.state.Invitations == nil {
		return nil, ErrState
	}
	if s.state.CloudCommands == nil {
		s.state.CloudCommands = map[string]cloudCommandDelivery{}
	}
	if s.state.Admissions == nil {
		return nil, ErrState
	}
	active := 0
	for id, member := range s.state.Members {
		if id != member.Member.MemberID || member.Member.MemberVersion < 1 || member.Delegation.GatewayID != identity.ID || VerifyDelegation(member.Delegation) != nil {
			return nil, ErrState
		}
		if member.Member.State == "active" {
			active++
		} else if member.Member.State != "removed" {
			return nil, ErrState
		}
	}
	if active > gp.MaxMembers || len(s.state.Members) > gp.MaxMembers*2 || len(s.state.Invitations) > gp.MaxMembers*2 || len(s.state.Admissions) > gp.MaxGatewayConnections*2 {
		return nil, ErrState
	}
	if err := s.ensureEndpoint(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) SetCommitHandler(handler func([]MemberRecord, gp.GatewayPolicy)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onCommit = handler
	if handler != nil {
		handler(s.recordsLocked(), s.state.Policy)
	}
}

func cloneMember(member MemberRecord) MemberRecord {
	if member.Rotation != nil {
		rotation := *member.Rotation
		member.Rotation = &rotation
	}
	return member
}

func (s *Store) recordsLocked() []MemberRecord {
	result := make([]MemberRecord, 0, len(s.state.Members))
	for _, member := range s.state.Members {
		result = append(result, cloneMember(member))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Member.MemberID < result[j].Member.MemberID })
	return result
}

func (s *Store) Snapshot() ([]MemberRecord, gp.GatewayPolicy, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.recordsLocked(), s.state.Policy, s.state.Revision
}

func (s *Store) Endpoint() Endpoint { s.mu.Lock(); defer s.mu.Unlock(); return s.state.Endpoint }

func (s *Store) commit(next memberState) error {
	next.Revision = s.state.Revision + 1
	for id, member := range next.Members {
		previous, exists := s.state.Members[id]
		if exists && EffectiveCloudAllowed(previous, s.state.Policy) && !EffectiveCloudAllowed(member, next.Policy) {
			member.Member.CloudRevocationPending = true
			next.Members[id] = member
		}
	}
	if err := gatewaystate.Write(s.path, next); err != nil {
		return err
	}
	s.state = next
	if s.onCommit != nil {
		s.onCommit(s.recordsLocked(), s.state.Policy)
	}
	return nil
}

func (s *Store) clone() memberState {
	next := s.state
	next.CloudCommands = maps.Clone(s.state.CloudCommands)
	next.Members = maps.Clone(next.Members)
	next.Invitations = maps.Clone(next.Invitations)
	next.Admissions = maps.Clone(next.Admissions)
	return next
}

func randomID(prefix string) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}
func digest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

// Invite requires the caller's member-management authorization. Only the token
// digest and signed public descriptor are retained in the invitation record.
func (s *Store) Invite(createdBy string) (gp.MemberInvitation, error) {
	return s.issueInvitation(createdBy, "", time.Time{})
}

// InviteForCommand recovers one authorized Cloud command's exact delivery.
// The token is derived from the private Gateway key and never stored as plaintext.
func (s *Store) InviteForCommand(createdBy, commandID string, expires time.Time) (gp.MemberInvitation, error) {
	if !validID(commandID) || expires.IsZero() {
		return gp.MemberInvitation{}, ErrState
	}
	return s.issueInvitation(createdBy, commandID, expires)
}

func (s *Store) invitationToken(id string) string {
	mac := hmac.New(sha256.New, s.identity.PrivateKey.Seed())
	_, _ = mac.Write([]byte("redeven.gateway.invitation-token.v4\x00" + id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Store) issueInvitation(createdBy, commandID string, deadline time.Time) (gp.MemberInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if createdBy == "" {
		return gp.MemberInvitation{}, ErrDenied
	}
	now := time.Now()
	id := ""
	if commandID != "" {
		id = "invite_" + digest([]byte("redeven.gateway.invitation-command.v4\x00" + commandID))[:48]
		if record, ok := s.state.Invitations[id]; ok {
			if record.IssuanceID != commandID || record.CreatedBy != createdBy || record.Canceled || record.Issued == nil || record.ExpiresAtUnixMS <= now.UnixMilli() {
				return gp.MemberInvitation{}, ErrDenied
			}
			invitation := *record.Issued
			invitation.Token = s.invitationToken(id)
			if digest([]byte(invitation.Token)) != record.TokenSHA256 {
				return gp.MemberInvitation{}, ErrState
			}
			return invitation, nil
		}
		if !now.Before(deadline) || deadline.After(now.Add(10*time.Minute)) {
			return gp.MemberInvitation{}, ErrDenied
		}
	} else {
		var err error
		id, err = randomID("invite_")
		if err != nil {
			return gp.MemberInvitation{}, err
		}
	}
	invitation := gp.MemberInvitation{ProtocolVersion: gp.Version, InvitationID: id, GatewayID: s.identity.ID, GatewayURL: s.state.Endpoint.URL, GatewayPublicKey: base64.RawURLEncoding.EncodeToString(s.identity.PrivateKey.Public().(ed25519.PublicKey)), GatewayTLSRootPEM: s.state.Endpoint.RootPEM, Token: s.invitationToken(id), IssuedAtUnixMS: now.UnixMilli(), ExpiresAtUnixMS: now.Add(10 * time.Minute).UnixMilli()}
	if err := SignInvitation(&invitation, s.identity.PrivateKey); err != nil {
		return gp.MemberInvitation{}, err
	}
	next := s.clone()
	for key, member := range next.Members {
		if member.Member.State == "removed" && next.CloudNamespaceID == "" {
			delete(next.Members, key)
		}
	}
	for key, record := range next.Invitations {
		if (record.Response == nil && record.ExpiresAtUnixMS <= now.UnixMilli()) || (record.Response != nil && (record.Response.ClientExpiresAtUnixMS <= now.UnixMilli() || (record.ExpiresAtUnixMS <= now.UnixMilli() && next.Members[record.Response.MemberID].Member.State != "active"))) {
			delete(next.Invitations, key)
		}
	}
	if len(next.Invitations) >= gp.MaxMembers*2 {
		return gp.MemberInvitation{}, ErrCapacity
	}
	descriptor := invitation
	descriptor.Token = ""
	next.Invitations[id] = invitationRecord{IssuanceID: commandID, Issued: &descriptor, TokenSHA256: digest([]byte(invitation.Token)), CreatedBy: createdBy, IssuedAtUnixMS: invitation.IssuedAtUnixMS, ExpiresAtUnixMS: invitation.ExpiresAtUnixMS}
	if err := s.commit(next); err != nil {
		return gp.MemberInvitation{}, err
	}
	return invitation, nil
}

func (s *Store) Join(ctx context.Context, request gp.MemberJoinRequest) (_ gp.MemberJoinResponse, resultErr error) {
	now := time.Now()
	defer func() { gatewayflow.Observe(ctx, "member.join", now, resultErr) }()
	if err := VerifyJoin(request, s.identity.ID, now); err != nil {
		return gp.MemberJoinResponse{}, err
	}
	s.mu.Lock()
	policy := s.state.Policy
	namespace := s.state.CloudNamespaceID
	record, ok := s.state.Invitations[request.InvitationID]
	if !ok || record.Canceled || record.TokenSHA256 != digest([]byte(request.Token)) {
		s.mu.Unlock()
		return gp.MemberJoinResponse{}, ErrDenied
	}
	if record.Response != nil {
		response, err := s.recoverJoinLocked(request, record, now)
		s.mu.Unlock()
		return response, err
	}
	if record.ExpiresAtUnixMS <= now.UnixMilli() || request.Delegation.ConsentedAtUnixMS < record.IssuedAtUnixMS {
		s.mu.Unlock()
		return gp.MemberJoinResponse{}, ErrDenied
	}
	s.mu.Unlock()
	decision := s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookMemberAdmit, GatewayID: s.identity.ID, MemberID: request.Delegation.MemberID, RuntimePublicID: request.Delegation.RuntimePublicID, PolicyRevision: policy.Revision})
	if !decision.Allowed {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	cloudAllowed := false
	if namespace != "" && policy.DefaultCloudAllowed {
		cloudAllowed = s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookCloudPublish, GatewayID: s.identity.ID, MemberID: request.Delegation.MemberID, RuntimePublicID: request.Delegation.RuntimePublicID, NamespacePublicID: namespace, PolicyRevision: policy.Revision}).Allowed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Policy.Revision != policy.Revision {
		return gp.MemberJoinResponse{}, ErrConflict
	}
	now = time.Now()
	if err := VerifyJoin(request, s.identity.ID, now); err != nil {
		return gp.MemberJoinResponse{}, err
	}
	record, ok = s.state.Invitations[request.InvitationID]
	if !ok || record.Canceled || record.TokenSHA256 != digest([]byte(request.Token)) {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	raw, _ := json.Marshal(request)
	requestHash := digest(raw)
	if record.Response != nil {
		return s.recoverJoinLocked(request, record, now)
	}
	if record.ExpiresAtUnixMS <= now.UnixMilli() || request.Delegation.ConsentedAtUnixMS < record.IssuedAtUnixMS {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	active := 0
	for _, current := range s.state.Members {
		if current.Member.State == "active" {
			active++
		}
	}
	if active >= gp.MaxMembers || len(s.state.Members) >= gp.MaxMembers*2 {
		return gp.MemberJoinResponse{}, ErrCapacity
	}
	for _, member := range s.state.Members {
		if member.Member.MemberID == request.Delegation.MemberID || (member.Member.State == "active" && member.Member.RuntimePublicID == request.Delegation.RuntimePublicID) {
			return gp.MemberJoinResponse{}, ErrConflict
		}
	}
	certificate, fingerprint, expires, err := issueClientCertificate(s.state.Endpoint, request.ClientCSRPEM, request.Delegation.MemberID)
	if err != nil {
		return gp.MemberJoinResponse{}, err
	}
	response := gp.MemberJoinResponse{ProtocolVersion: gp.Version, GatewayID: s.identity.ID, MemberID: request.Delegation.MemberID, MemberVersion: 1, DeliveryID: request.DeliveryID, ClientCertificatePEM: certificate, ClientExpiresAtUnixMS: expires}
	member := MemberRecord{HookCloudAllowed: cloudAllowed, HookPolicyRevision: policy.Revision, Member: gp.Member{MemberID: request.Delegation.MemberID, RuntimePublicID: request.Delegation.RuntimePublicID, MemberVersion: 1, DisplayName: request.Metadata.Hostname, State: "active", CloudPermission: gp.CloudInherit, CloudState: "not_configured", Metadata: request.Metadata}, Delegation: request.Delegation, Service: request.Service, ClientCertificatePEM: certificate, ClientCertificateSHA256: fingerprint, ClientExpiresAtUnixMS: expires}
	next := s.clone()
	next.Members[response.MemberID] = member
	record.DeliveryID = request.DeliveryID
	record.RequestSHA256 = requestHash
	record.Response = &response
	next.Invitations[request.InvitationID] = record
	if err := s.commit(next); err != nil {
		return gp.MemberJoinResponse{}, err
	}
	return response, nil
}

func EffectiveCloudAllowed(member MemberRecord, policy gp.GatewayPolicy) bool {
	return member.Member.State == "active" && member.Member.CloudPermission != gp.CloudDeny && (member.Member.CloudPermission == gp.CloudAllow || policy.DefaultCloudAllowed) && member.HookCloudAllowed && member.HookPolicyRevision == policy.Revision
}

func (s *Store) Remove(memberID string, version int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.removeLocked(memberID, version)
}

func (s *Store) removeLocked(memberID string, version int64) error {
	member, ok := s.state.Members[memberID]
	if !ok {
		return ErrDenied
	}
	if member.Member.State == "removed" && member.Member.MemberVersion == version+1 {
		return nil
	}
	if member.Member.MemberVersion != version {
		return ErrConflict
	}
	member.Member.State = "removed"
	member.Member.MemberVersion++
	member.Member.CloudRevocationPending = true
	member.HookCloudAllowed = false
	next := s.clone()
	next.Members[memberID] = member
	return s.commit(next)
}

func (s *Store) recoverJoinLocked(request gp.MemberJoinRequest, record invitationRecord, now time.Time) (gp.MemberJoinResponse, error) {
	response := *record.Response
	member, ok := s.state.Members[response.MemberID]
	raw, _ := json.Marshal(request)
	if !ok || member.Member.State != "active" || member.Member.MemberVersion != response.MemberVersion || response.ClientExpiresAtUnixMS <= now.UnixMilli() || record.DeliveryID != request.DeliveryID || record.RequestSHA256 != digest(raw) || member.ClientCertificatePEM != response.ClientCertificatePEM {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	return response, nil
}
