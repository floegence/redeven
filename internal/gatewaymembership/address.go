package gatewaymembership

import (
	"net"
	"slices"
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

// PrepareConnectionEndpoints consumes only the signed endpoint descriptor from
// a fresh invitation. It does not redeem the invitation or create a membership.
func (r *RuntimeConfig) PrepareConnectionEndpoints(invitation gp.MemberInvitation) (*RuntimeConfig, error) {
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
	next.GatewayEndpoints = append([]gp.GatewayEndpoint(nil), invitation.Endpoints...)
	next.LastEndpointID = ""
	return next, nil
}
