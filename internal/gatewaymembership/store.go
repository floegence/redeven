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
	"net"
	"os"
	"sort"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var (
	ErrState    = errors.New("ATTACHMENT_STATE_INVALID")
	ErrConflict = errors.New("ATTACHMENT_VERSION_CONFLICT")
	ErrDenied   = errors.New("ATTACHMENT_DENIED")
	ErrCapacity = errors.New("ATTACHMENT_CAPACITY")
)

type GatewayIdentity struct {
	ID          string
	DisplayName string
	PrivateKey  ed25519.PrivateKey
}

type Endpoint struct {
	URL                string   `json:"url"`
	ListenAddress      string   `json:"listen_address"`
	ListenAddresses    []string `json:"listen_addresses,omitempty"`
	AllowedHosts       []string `json:"allowed_hosts"`
	CertificateOrigins []string `json:"certificate_origins,omitempty"`
	RootPEM            string   `json:"root_pem"`
	RootKeyPEM         string   `json:"root_key_pem"`
	CertificatePEM     string   `json:"certificate_pem"`
	PrivateKeyPEM      string   `json:"private_key_pem"`
}

func (Endpoint) String() string   { return "Gateway.MemberEndpoint" }
func (Endpoint) GoString() string { return "Gateway.MemberEndpoint" }

// MemberRecord owns one local device attachment and its certificate.
// Egress admission is derived from this record and the committed local policy.
type MemberRecord struct {
	Member                  gp.RuntimeAttachment `json:"member"`
	Delegation              gp.MemberDelegation  `json:"delegation"`
	Service                 gp.MemberService     `json:"service"`
	ClientCertificatePEM    string               `json:"client_certificate_pem"`
	ClientCertificateSHA256 string               `json:"client_certificate_sha256"`
	ClientExpiresAtUnixMS   int64                `json:"client_expires_at_unix_ms"`
	HookEgressAllowed       bool                 `json:"hook_egress_allowed"`
	HookPolicyRevision      int64                `json:"hook_policy_revision"`
	// A denial is delivered even if a later edit permits egress again. The
	// transaction revision prevents an older receipt from clearing a newer denial.
	ConnectionGeneration uint64            `json:"connection_generation"`
	Rotation             *rotationDelivery `json:"rotation,omitempty"`
}

type rotationDelivery struct {
	PreviousSHA256          string                  `json:"previous_sha256"`
	PreviousExpiresAtUnixMS int64                   `json:"previous_expires_at_unix_ms"`
	RequestSHA256           string                  `json:"request_sha256"`
	Response                gp.MemberRotateResponse `json:"response"`
}

type invitationRecord struct {
	CodeLookupID    string                           `json:"code_lookup_id,omitempty"`
	EndpointReceipt *gp.MemberEndpointUpdateResponse `json:"endpoint_receipt,omitempty"`
	IssuanceID      string                           `json:"issuance_id,omitempty"`
	Issued          *gp.EnrollmentDescriptor         `json:"issued,omitempty"`
	Canceled        bool                             `json:"canceled"`
	TokenSHA256     string                           `json:"token_sha256"`
	CreatedBy       string                           `json:"created_by"`
	IssuedAtUnixMS  int64                            `json:"issued_at_unix_ms"`
	ExpiresAtUnixMS int64                            `json:"expires_at_unix_ms"`
	DeliveryID      string                           `json:"delivery_id,omitempty"`
	RequestSHA256   string                           `json:"request_sha256,omitempty"`
	Response        *gp.MemberJoinResponse           `json:"response,omitempty"`
}

type memberState struct {
	SchemaVersion       int                         `json:"schema_version"`
	GatewayID           string                      `json:"gateway_id"`
	Revision            int64                       `json:"revision"`
	Endpoint            Endpoint                    `json:"endpoint"`
	AdvertisedEndpoints []gp.GatewayEndpoint        `json:"advertised_endpoints"`
	EndpointLastUsedAt  map[string]int64            `json:"endpoint_last_used_at"`
	Policy              gp.GatewayPolicy            `json:"policy"`
	Members             map[string]MemberRecord     `json:"members"`
	Invitations         map[string]invitationRecord `json:"invitations"`
	Admissions          map[string]Admission        `json:"admissions"`
}

type Store struct {
	mu          sync.Mutex
	path        string
	identity    GatewayIdentity
	state       memberState
	hooks       *PolicyHooks
	unpersisted bool
	// Applied under the transaction lock before returning to the caller. Policy
	// invalidation also publishes a denial when persistence fails. It must not call Store methods. This lets the service fence
	// removed permissions synchronously and in committed revision order.
	onCommit func([]MemberRecord, gp.GatewayPolicy)
}

// CheckStateFile rejects incompatible persisted contracts before a service
// initializes any identity or other state. Missing state means a new Gateway.
func CheckStateFile(path string) error {
	var state memberState
	err := gatewaystate.ReadVersioned(path, &state, 6)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.Join(ErrState, err)
	}
	return nil
}

func NewStore(path string, identity GatewayIdentity, endpointURL, listen string, hooks *PolicyHooks) (*Store, error) {
	if path == "" || !validID(identity.ID) || len(identity.PrivateKey) != ed25519.PrivateKeySize || hooks == nil {
		return nil, ErrState
	}
	s := &Store{path: path, identity: GatewayIdentity{ID: identity.ID, DisplayName: identity.DisplayName, PrivateKey: append(ed25519.PrivateKey(nil), identity.PrivateKey...)}, hooks: hooks}
	err := gatewaystate.ReadVersioned(path, &s.state, 6)
	if errors.Is(err, os.ErrNotExist) {
		confirmedURL := endpointURL
		if endpointURL == "" {
			endpointURL = "https://localhost:7443"
		}
		endpoint, err := newEndpoint(endpointURL, listen)
		if err != nil {
			return nil, err
		}
		endpoint.AllowedHosts = []string{}
		s.state = memberState{SchemaVersion: 6, GatewayID: identity.ID, Revision: 1, Endpoint: endpoint, Policy: gp.GatewayPolicy{Revision: 1, Destinations: []string{}}, Members: map[string]MemberRecord{}, Invitations: map[string]invitationRecord{}, Admissions: map[string]Admission{}}
		if confirmedURL != "" {
			s.state.AdvertisedEndpoints = []gp.GatewayEndpoint{{EndpointID: "endpoint_primary", Address: endpoint.URL, Scope: gp.GatewayEndpointLAN, Priority: 0}}
		}
		if err := gatewaystate.Write(path, s.state); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, errors.Join(ErrState, err)
	}
	if gp.ValidateEgressDestinations(s.state.Policy.Destinations) != nil || s.state.Endpoint.AllowedHosts == nil || s.state.SchemaVersion != 6 || s.state.GatewayID != identity.ID || s.state.Revision < 1 || s.state.Policy.Revision < 1 || s.state.Members == nil || s.state.Invitations == nil {
		return nil, ErrState
	}
	if len(s.state.Endpoint.ListenAddresses) == 0 {
		return nil, ErrState
	}
	if _, err := normalizeNetworkSettings(gp.GatewayNetworkSettings{ListenAddresses: s.state.Endpoint.ListenAddresses, AllowedHosts: s.state.Endpoint.AllowedHosts, Endpoints: s.state.AdvertisedEndpoints}); err != nil {
		return nil, ErrState
	}
	for _, address := range s.state.Endpoint.ListenAddresses {
		if _, _, err := net.SplitHostPort(address); err != nil {
			return nil, ErrState
		}
	}
	if s.state.EndpointLastUsedAt == nil {
		s.state.EndpointLastUsedAt = make(map[string]int64)
	}
	if s.state.Admissions == nil {
		return nil, ErrState
	}
	if err := validateStoredEndpoints(s.state.AdvertisedEndpoints); err != nil {
		return nil, err
	}
	if len(s.state.Endpoint.CertificateOrigins) == 0 {
		for _, endpoint := range s.state.AdvertisedEndpoints {
			s.state.Endpoint.CertificateOrigins = append(s.state.Endpoint.CertificateOrigins, endpoint.Address)
		}
	}
	active := 0
	for id, member := range s.state.Members {
		if id != member.Member.AttachmentID || member.Member.AttachmentVersion < 1 || member.Delegation.GatewayID != identity.ID || VerifyDelegation(member.Delegation) != nil {
			return nil, ErrState
		}
		if member.Member.State == "active" {
			active++
		} else if member.Member.State != "removed" {
			return nil, ErrState
		}
	}
	if active > gp.MaxAttachments || len(s.state.Members) > gp.MaxAttachments*2 || len(s.state.Invitations) > gp.MaxAttachments*2 || len(s.state.Admissions) > gp.MaxGatewayConnections*2 {
		return nil, ErrState
	}
	if err := s.ensureEndpoint(); err != nil {
		return nil, err
	}
	if len(s.state.Members) > 0 {
		// Executable policy may change while the host is stopped. Evaluate before
		// any caller can install persisted egress grants or expose a listener.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		next := s.clone()
		if err := s.evaluateEgress(ctx, &next, policyAttachmentIDs(next)); err != nil {
			return nil, err
		}
		for id, current := range next.Members {
			previous := s.state.Members[id]
			if current.HookEgressAllowed != previous.HookEgressAllowed || current.HookPolicyRevision != previous.HookPolicyRevision {
				if err := s.commit(next); err != nil {
					return nil, err
				}
				break
			}
		}
	}
	return s, nil
}

func (s *Store) SetCommitHandler(handler func([]MemberRecord, gp.GatewayPolicy)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onCommit = handler
	if handler != nil {
		handler(s.recordsLocked(), clonePolicy(s.state.Policy))
	}
}

func clonePolicy(policy gp.GatewayPolicy) gp.GatewayPolicy {
	policy.Destinations = append([]string{}, policy.Destinations...)
	return policy
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
	sort.Slice(result, func(i, j int) bool { return result[i].Member.AttachmentID < result[j].Member.AttachmentID })
	return result
}

func (s *Store) Snapshot() ([]MemberRecord, gp.GatewayPolicy, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	policy := s.state.Policy
	policy.Destinations = append([]string{}, policy.Destinations...)
	return s.recordsLocked(), policy, s.state.Revision
}

// DurableSnapshot returns only a durably committed local policy revision. Local
// invalidation still fences egress immediately while storage is unavailable.
func (s *Store) DurableSnapshot() ([]MemberRecord, gp.GatewayPolicy, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.unpersisted {
		if err := gatewaystate.Write(s.path, s.state); err != nil {
			return nil, gp.GatewayPolicy{}, 0, err
		}
		s.unpersisted = false
	}
	policy := s.state.Policy
	policy.Destinations = append([]string{}, policy.Destinations...)
	return s.recordsLocked(), policy, s.state.Revision, nil
}

func (s *Store) Endpoint() Endpoint { s.mu.Lock(); defer s.mu.Unlock(); return s.state.Endpoint }

func (s *Store) Endpoints() []gp.GatewayEndpoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]gp.GatewayEndpoint{}, s.state.AdvertisedEndpoints...)
}

func (s *Store) EndpointOrigins() []string {
	endpoints := s.Endpoints()
	origins := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		origins = append(origins, endpoint.Address)
	}
	return origins
}

// UpdateEndpoints replaces only the administrator-confirmed Runtime paths.
// Listener binding, Gateway identity and member credentials remain unchanged.
func (s *Store) UpdateEndpoints(endpoints []gp.GatewayEndpoint) error {
	if len(endpoints) > 0 && validateStoredEndpoints(endpoints) != nil {
		return ErrState
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(endpoints) == 0 {
		if len(s.state.AdvertisedEndpoints) == 0 {
			return nil
		}
		next := s.clone()
		next.AdvertisedEndpoints = nil
		next.Admissions = map[string]Admission{}
		return s.commit(next)
	}
	current := s.state.AdvertisedEndpoints
	if len(current) == len(endpoints) {
		equal := true
		for index := range endpoints {
			if endpoints[index] != current[index] {
				equal = false
				break
			}
		}
		if equal {
			return nil
		}
	}
	primary := endpoints[0].Address
	endpoint := s.state.Endpoint
	endpoint.URL = primary
	updated, err := renewEndpointForOrigins(endpoint, endpointAddresses(endpoints))
	if err != nil {
		return err
	}
	next := s.clone()
	next.Endpoint = updated
	next.AdvertisedEndpoints = append([]gp.GatewayEndpoint(nil), endpoints...)
	next.Admissions = map[string]Admission{}
	return s.commit(next)
}

func endpointAddresses(endpoints []gp.GatewayEndpoint) []string {
	addresses := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		addresses = append(addresses, endpoint.Address)
	}
	return addresses
}

func validateStoredEndpoints(endpoints []gp.GatewayEndpoint) error {
	if len(endpoints) == 0 {
		return nil
	}
	return validateGatewayEndpoints(endpoints)
}

func (s *Store) nextRevision(next memberState) memberState {
	next.Revision = s.state.Revision + 1
	return next
}

func (s *Store) commit(next memberState) error {
	next = s.nextRevision(next)
	if err := gatewaystate.Write(s.path, next); err != nil {
		return err
	}
	s.unpersisted = false
	s.applyLocked(next)
	return nil
}

func (s *Store) applyLocked(next memberState) {
	s.state = next
	if s.onCommit != nil {
		s.onCommit(s.recordsLocked(), clonePolicy(s.state.Policy))
	}
}

func (s *Store) clone() memberState {
	next := s.state
	next.Policy = clonePolicy(s.state.Policy)
	next.EndpointLastUsedAt = maps.Clone(s.state.EndpointLastUsedAt)
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
func (s *Store) Invite(createdBy string) (gp.EnrollmentDescriptor, error) {
	return s.issueInvitation(createdBy, "", time.Time{})
}

// InviteForOperation recovers one host-authorized operation's exact delivery.
// The token is derived from the private Gateway key and never stored as plaintext.
func (s *Store) InviteForOperation(createdBy, commandID string, expires time.Time) (gp.EnrollmentDescriptor, error) {
	if !validID(commandID) || expires.IsZero() {
		return gp.EnrollmentDescriptor{}, ErrState
	}
	return s.issueInvitation(createdBy, commandID, expires)
}

func (s *Store) invitationToken(id string) string {
	mac := hmac.New(sha256.New, s.identity.PrivateKey.Seed())
	_, _ = mac.Write([]byte("redeven.gateway.enrollment-token.v1\x00" + id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Store) issueInvitation(createdBy, commandID string, deadline time.Time) (gp.EnrollmentDescriptor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if createdBy == "" {
		return gp.EnrollmentDescriptor{}, ErrDenied
	}
	now := time.Now()
	id := ""
	if commandID != "" {
		id = "invite_" + digest([]byte("redeven.gateway.invitation-command.v5\x00" + commandID))[:48]
		if record, ok := s.state.Invitations[id]; ok {
			// A record written before the code-delivery migration is retained only
			// for historical member recovery. It must never be re-exposed as a
			// current invitation-code result.
			if record.CodeLookupID == "" || record.IssuanceID != commandID || record.CreatedBy != createdBy || record.Canceled || record.Issued == nil || record.ExpiresAtUnixMS <= now.UnixMilli() {
				return gp.EnrollmentDescriptor{}, ErrDenied
			}
			invitation := *record.Issued
			invitation.Token = s.invitationToken(id)
			if digest([]byte(invitation.Token)) != record.TokenSHA256 {
				return gp.EnrollmentDescriptor{}, ErrState
			}
			return invitation, nil
		}
		if !now.Before(deadline) || deadline.After(now.Add(10*time.Minute)) {
			return gp.EnrollmentDescriptor{}, ErrDenied
		}
	} else {
		var err error
		id, err = randomID("invite_")
		if err != nil {
			return gp.EnrollmentDescriptor{}, err
		}
	}
	if err := validateStoredEndpoints(s.state.AdvertisedEndpoints); err != nil {
		return gp.EnrollmentDescriptor{}, ErrDenied
	}
	if len(s.state.AdvertisedEndpoints) == 0 {
		return gp.EnrollmentDescriptor{}, ErrDenied
	}
	invitation := gp.EnrollmentDescriptor{ProtocolVersion: gp.Version, InvitationID: id, GatewayID: s.identity.ID, Endpoints: append([]gp.GatewayEndpoint(nil), s.state.AdvertisedEndpoints...), GatewayPublicKey: base64.RawURLEncoding.EncodeToString(s.identity.PrivateKey.Public().(ed25519.PublicKey)), GatewayTLSRootPEM: s.state.Endpoint.RootPEM, Token: s.invitationToken(id), IssuedAtUnixMS: now.UnixMilli(), ExpiresAtUnixMS: now.Add(10 * time.Minute).UnixMilli()}
	invitation.GatewayName = s.identity.DisplayName
	if invitation.GatewayName == "" {
		invitation.GatewayName = "Gateway"
	}
	if err := SignEnrollmentDescriptor(&invitation, s.identity.PrivateKey); err != nil {
		return gp.EnrollmentDescriptor{}, err
	}
	next := s.clone()
	if commandID == "" {
		// Regeneration is an explicit revocation boundary: only the newest
		// administrator delivery remains redeemable. Consumed receipts stay
		// durable for response recovery and audit.
		for key, record := range next.Invitations {
			if record.Response == nil && record.EndpointReceipt == nil && !record.Canceled {
				record.Canceled = true
				record.Issued = nil
				next.Invitations[key] = record
			}
		}
	}
	for key, member := range next.Members {
		if member.Member.State == "removed" {
			delete(next.Members, key)
		}
	}
	for key, record := range next.Invitations {
		if (record.Response == nil && record.EndpointReceipt == nil && record.ExpiresAtUnixMS+int64(24*time.Hour/time.Millisecond) <= now.UnixMilli()) || (record.Response != nil && (record.Response.ClientExpiresAtUnixMS <= now.UnixMilli() || (record.ExpiresAtUnixMS <= now.UnixMilli() && next.Members[record.Response.AttachmentID].Member.State != "active"))) {
			delete(next.Invitations, key)
		}
	}
	if len(next.Invitations) >= gp.MaxAttachments*2 {
		return gp.EnrollmentDescriptor{}, ErrCapacity
	}
	descriptor := invitation
	descriptor.Token = ""
	code, err := flowersec.DeriveInvitationCode(s.identity.PrivateKey.Seed(), id)
	if err != nil {
		return gp.EnrollmentDescriptor{}, err
	}
	next.Invitations[id] = invitationRecord{CodeLookupID: code.LookupID(), IssuanceID: commandID, Issued: &descriptor, TokenSHA256: digest([]byte(invitation.Token)), CreatedBy: createdBy, IssuedAtUnixMS: invitation.IssuedAtUnixMS, ExpiresAtUnixMS: invitation.ExpiresAtUnixMS}
	if err := s.commit(next); err != nil {
		return gp.EnrollmentDescriptor{}, err
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
	record, ok := s.state.Invitations[request.InvitationID]
	if !ok || record.Canceled || record.EndpointReceipt != nil || record.TokenSHA256 != digest([]byte(request.Token)) {
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
	decision := s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookAttachmentAdmit, GatewayID: s.identity.ID, AttachmentID: request.Delegation.AttachmentID, RuntimePublicID: request.Delegation.RuntimePublicID, PolicyRevision: policy.Revision})
	if !decision.Allowed {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	egressAllowed := false
	if policy.DefaultEgressAllowed {
		egressAllowed = s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookEgressOpen, GatewayID: s.identity.ID, AttachmentID: request.Delegation.AttachmentID, RuntimePublicID: request.Delegation.RuntimePublicID, PolicyRevision: policy.Revision}).Allowed
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
	if !ok || record.Canceled || record.EndpointReceipt != nil || record.TokenSHA256 != digest([]byte(request.Token)) {
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
	if active >= gp.MaxAttachments || len(s.state.Members) >= gp.MaxAttachments*2 {
		return gp.MemberJoinResponse{}, ErrCapacity
	}
	for _, member := range s.state.Members {
		if member.Member.AttachmentID == request.Delegation.AttachmentID || (member.Member.State == "active" && member.Member.RuntimePublicID == request.Delegation.RuntimePublicID) {
			return gp.MemberJoinResponse{}, ErrConflict
		}
	}
	certificate, fingerprint, expires, err := issueClientCertificate(s.state.Endpoint, request.ClientCSRPEM, request.Delegation.AttachmentID)
	if err != nil {
		return gp.MemberJoinResponse{}, err
	}
	response := gp.MemberJoinResponse{ProtocolVersion: gp.Version, GatewayID: s.identity.ID, AttachmentID: request.Delegation.AttachmentID, AttachmentVersion: 1, DeliveryID: request.DeliveryID, ClientCertificatePEM: certificate, ClientExpiresAtUnixMS: expires}
	member := MemberRecord{HookEgressAllowed: egressAllowed, HookPolicyRevision: policy.Revision, Member: gp.RuntimeAttachment{AttachmentID: request.Delegation.AttachmentID, RuntimePublicID: request.Delegation.RuntimePublicID, AttachmentVersion: 1, DisplayName: request.Metadata.Hostname, State: "active", EgressPermission: gp.EgressInherit, Metadata: request.Metadata}, Delegation: request.Delegation, Service: request.Service, ClientCertificatePEM: certificate, ClientCertificateSHA256: fingerprint, ClientExpiresAtUnixMS: expires}
	next := s.clone()
	next.Members[response.AttachmentID] = member
	record.DeliveryID = request.DeliveryID
	record.RequestSHA256 = requestHash
	record.Response = &response
	next.Invitations[request.InvitationID] = record
	if err := s.commit(next); err != nil {
		return gp.MemberJoinResponse{}, err
	}
	return response, nil
}

func EffectiveEgressAllowed(member MemberRecord, policy gp.GatewayPolicy) bool {
	return egressPolicyAllows(member, policy)
}

func egressPolicyAllows(member MemberRecord, policy gp.GatewayPolicy) bool {
	return member.Member.State == "active" && member.Member.EgressPermission != gp.EgressDeny && (member.Member.EgressPermission == gp.EgressAllow || policy.DefaultEgressAllowed) && member.HookEgressAllowed && member.HookPolicyRevision == policy.Revision
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
	if member.Member.State == "removed" && member.Member.AttachmentVersion == version+1 {
		return nil
	}
	if member.Member.AttachmentVersion != version {
		return ErrConflict
	}
	member.Member.State = "removed"
	member.Member.AttachmentVersion++
	member.HookEgressAllowed = false
	next := s.clone()
	next.Members[memberID] = member
	return s.commit(next)
}

func (s *Store) recoverJoinLocked(request gp.MemberJoinRequest, record invitationRecord, now time.Time) (gp.MemberJoinResponse, error) {
	response := *record.Response
	member, ok := s.state.Members[response.AttachmentID]
	raw, _ := json.Marshal(request)
	if !ok || member.Member.State != "active" || member.Member.AttachmentVersion != response.AttachmentVersion || response.ClientExpiresAtUnixMS <= now.UnixMilli() || record.DeliveryID != request.DeliveryID || record.RequestSHA256 != digest(raw) || member.ClientCertificatePEM != response.ClientCertificatePEM {
		return gp.MemberJoinResponse{}, ErrDenied
	}
	return response, nil
}
