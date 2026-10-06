package gatewaymembership

import (
	"net"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Readdress is a host configuration change applied before the listener starts.
// The member authority and stable machine identity survive an address change.
func (s *Store) Readdress(origin, listen string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	endpoint := s.state.Endpoint
	if origin != "" {
		canonical, err := canonicalOrigin(origin)
		if err != nil {
			return err
		}
		endpoint.URL = canonical
	}
	if listen != "" {
		endpoint.ListenAddress = listen
	}
	if endpoint.URL == s.state.Endpoint.URL && endpoint.ListenAddress == s.state.Endpoint.ListenAddress {
		return nil
	}
	if !validOrigin(endpoint.URL) {
		return ErrState
	}
	if _, _, err := net.SplitHostPort(endpoint.ListenAddress); err != nil {
		return ErrState
	}
	endpoint, err := renewEndpoint(endpoint)
	if err != nil {
		return err
	}
	next := s.clone()
	next.Endpoint = endpoint
	// Outstanding access tickets contain the old audience; they cannot authorize
	// connections to the new endpoint. Existing member records remain unchanged.
	next.Admissions = map[string]Admission{}
	return s.commit(next)
}

// PrepareAddressUpdate consumes only the signed address descriptor from a
// fresh invitation. It does not redeem the invitation or create a membership.
func (r *RuntimeConfig) PrepareAddressUpdate(invitation gp.MemberInvitation) (*RuntimeConfig, error) {
	if r == nil || r.Leaving || r.PendingJoin != nil || r.PendingRotation != nil || VerifyInvitation(invitation, time.Now()) != nil {
		return nil, ErrState
	}
	if invitation.GatewayID != r.GatewayID || invitation.GatewayPublicKey != r.GatewayPublicKey || invitation.GatewayTLSRootPEM != r.GatewayTLSRootPEM {
		return nil, ErrInvalidProof
	}
	if err := r.validateClient(); err != nil {
		return nil, err
	}
	next := r.Clone()
	next.GatewayURL = invitation.GatewayURL
	return next, nil
}
