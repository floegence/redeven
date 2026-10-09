package gatewaymembership

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"net"
	"slices"
	"strconv"
	"strings"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Readdress is a host configuration change applied before the listener starts.
// The member authority and stable machine identity survive an address change.
func (s *Store) Readdress(origin, listen string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	endpoint := s.state.Endpoint
	advertised := append([]gp.GatewayEndpoint(nil), s.state.AdvertisedEndpoints...)
	if origin != "" {
		canonical, err := canonicalOrigin(origin)
		if err != nil {
			return err
		}
		endpoint.URL = canonical
		scope := gp.GatewayEndpointLAN
		priority := 0
		if len(advertised) > 0 {
			scope = advertised[0].Scope
			priority = advertised[0].Priority
		}
		advertised = []gp.GatewayEndpoint{{EndpointID: "endpoint_primary", Address: canonical, Scope: scope, Priority: priority}}
	}
	if listen != "" {
		endpoint.ListenAddresses = strings.Split(listen, ",")
		endpoint.ListenAddress = endpoint.ListenAddresses[0]
	}
	if endpoint.URL == s.state.Endpoint.URL && slices.Equal(endpoint.ListenAddresses, s.state.Endpoint.ListenAddresses) && endpointsEqual(advertised, s.state.AdvertisedEndpoints) {
		return nil
	}
	if !validOrigin(endpoint.URL) {
		return ErrState
	}
	for _, address := range endpoint.ListenAddresses {
		if _, _, err := net.SplitHostPort(address); err != nil {
			return ErrState
		}
	}
	endpoint, err := renewEndpointForOrigins(endpoint, endpointAddresses(advertised))
	if err != nil {
		return err
	}
	next := s.clone()
	next.Endpoint = endpoint
	next.AdvertisedEndpoints = advertised
	// Outstanding access tickets contain the old audience; they cannot authorize
	// connections to the new endpoint. Existing member records remain unchanged.
	next.Admissions = map[string]Admission{}
	return s.commit(next)
}

func endpointsEqual(left, right []gp.GatewayEndpoint) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// PrepareConnectionEndpoints preserves member identity and durably stages one
// signed redemption. Enroll completes that same delivery after response loss.
func (r *RuntimeConfig) PrepareConnectionEndpoints(invitation gp.EnrollmentDescriptor) (*RuntimeConfig, error) {
	if r == nil || r.Leaving || r.PendingJoin != nil || r.PendingRotation != nil || r.PendingEndpointUpdate != nil || VerifyEnrollmentDescriptor(invitation, time.Now()) != nil {
		return nil, ErrState
	}
	if invitation.GatewayID != r.GatewayID || invitation.GatewayPublicKey != r.GatewayPublicKey || invitation.GatewayTLSRootPEM != r.GatewayTLSRootPEM {
		return nil, ErrInvalidProof
	}
	if err := r.validateClient(); err != nil {
		return nil, err
	}
	next := r.Clone()
	next.GatewayEndpoints = append([]gp.GatewayEndpoint(nil), invitation.Endpoints...)
	next.LastEndpointID = ""
	// The invitation is single-use, so its endpoint redemption identity is
	// stable across a lost response or a local persistence failure. Gateway
	// returns the exact committed receipt for this request instead of treating
	// a retry as a second endpoint update.
	digest := sha256.Sum256([]byte("redeven.gateway.endpoint-delivery.v1\x00" + invitation.InvitationID + "\x00" + r.MemberID + "\x00" + strconv.FormatInt(r.MemberVersion, 10)))
	delivery := "delivery_" + hex.EncodeToString(digest[:])[:48]
	request := gp.MemberEndpointUpdateRequest{ProtocolVersion: gp.Version, GatewayID: r.GatewayID, InvitationID: invitation.InvitationID, Token: invitation.Token, MemberID: r.MemberID, MemberVersion: r.MemberVersion, DeliveryID: delivery}
	key, err := decodeKey(r.PrivateKeyB64u, ed25519.PrivateKeySize)
	if err != nil {
		return nil, err
	}
	request.Signature, err = signValue("redeven.gateway.member-endpoints.v1", request, ed25519.PrivateKey(key))
	if err != nil {
		return nil, err
	}
	next.PendingEndpointUpdate = &request
	return next, nil
}

func (s *Store) RedeemEndpointUpdate(leaf *x509.Certificate, request gp.MemberEndpointUpdateRequest) (gp.MemberEndpointUpdateResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	member, err := s.authenticateLocked(leaf)
	if err != nil {
		return gp.MemberEndpointUpdateResponse{}, err
	}
	if request.ProtocolVersion != gp.Version || request.GatewayID != s.identity.ID || request.MemberID != member.Member.MemberID || request.MemberVersion != member.Member.MemberVersion || !validID(request.DeliveryID) {
		return gp.MemberEndpointUpdateResponse{}, ErrDenied
	}
	signature := request.Signature
	request.Signature = ""
	if err := verifyValue("redeven.gateway.member-endpoints.v1", request, member.Delegation.PublicKeyB64u, signature); err != nil {
		return gp.MemberEndpointUpdateResponse{}, err
	}
	raw, _ := json.Marshal(request)
	hash := digest(raw)
	record, ok := s.state.Invitations[request.InvitationID]
	if !ok || record.Canceled || record.Response != nil || record.TokenSHA256 != digest([]byte(request.Token)) {
		return gp.MemberEndpointUpdateResponse{}, ErrDenied
	}
	if receipt := record.EndpointReceipt; receipt != nil {
		if record.RequestSHA256 != hash || receipt.MemberID != request.MemberID || receipt.MemberVersion != request.MemberVersion {
			return gp.MemberEndpointUpdateResponse{}, ErrDenied
		}
		return *receipt, nil
	}
	if record.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return gp.MemberEndpointUpdateResponse{}, ErrInvitationExpired
	}
	response := gp.MemberEndpointUpdateResponse{ProtocolVersion: gp.Version, GatewayID: s.identity.ID, MemberID: request.MemberID, MemberVersion: request.MemberVersion, DeliveryID: request.DeliveryID}
	record.EndpointReceipt, record.RequestSHA256, record.DeliveryID = &response, hash, request.DeliveryID
	next := s.clone()
	next.Invitations[request.InvitationID] = record
	if err := s.commit(next); err != nil {
		return gp.MemberEndpointUpdateResponse{}, err
	}
	return response, nil
}

func (r *RuntimeConfig) DeliverPendingEndpointUpdate(ctx context.Context, persist func(*RuntimeConfig) error) error {
	if r == nil || r.PendingEndpointUpdate == nil || persist == nil {
		return ErrState
	}
	request := r.PendingEndpointUpdate
	var response gp.MemberEndpointUpdateResponse
	if err := r.Request(ctx, "/v5/member/update-endpoints", request, &response, true); err != nil {
		return err
	}
	if response.ProtocolVersion != gp.Version || response.GatewayID != r.GatewayID || response.MemberID != r.MemberID || response.MemberVersion != r.MemberVersion || response.DeliveryID != request.DeliveryID {
		return ErrInvalidProof
	}
	next := r.Clone()
	next.PendingEndpointUpdate = nil
	if err := persist(next); err != nil {
		return err
	}
	*r = *next
	return nil
}
