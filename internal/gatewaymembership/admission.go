package gatewaymembership

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"net/url"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type Admission struct {
	ChannelID         string `json:"channel_id"`
	MemberID          string `json:"member_id"`
	MemberVersion     int64  `json:"member_version"`
	CertificateSHA256 string `json:"certificate_sha256"`
	PolicyRevision    int64  `json:"policy_revision"`
	Generation        uint64 `json:"generation"`
	DesktopKeyID      string `json:"desktop_key_id,omitempty"`
	Authorization     []byte `json:"authorization"`
	ExpiresAtUnixMS   int64  `json:"expires_at_unix_ms"`
	Consumed          bool   `json:"consumed"`
}

func (Admission) String() string   { return "Gateway.Admission" }
func (Admission) GoString() string { return "Gateway.Admission" }

type ConnectionOffer struct {
	ProtocolVersion string              `json:"protocol_version"`
	ChannelID       string              `json:"channel_id"`
	MemberID        string              `json:"member_id"`
	MemberVersion   int64               `json:"member_version"`
	Generation      uint64              `json:"generation"`
	Artifact        json.RawMessage     `json:"artifact"`
	Service         gp.MemberService    `json:"service"`
	Delegation      gp.MemberDelegation `json:"delegation"`
	ExpiresAtUnixMS int64               `json:"expires_at_unix_ms"`
}

func (ConnectionOffer) String() string   { return "Gateway.ConnectionOffer" }
func (ConnectionOffer) GoString() string { return "Gateway.ConnectionOffer" }

func (s *Store) MemberOffer(leaf *x509.Certificate) (ConnectionOffer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	member, err := s.authenticateLocked(leaf)
	if err != nil {
		return ConnectionOffer{}, err
	}
	return s.offerLocked(member, "")
}

// AccessOffer is called after paired-Desktop permission verification. The hook
// cannot bypass that check, and its result is fenced against concurrent policy edits.
func (s *Store) AccessOffer(ctx context.Context, memberID, desktopKeyID string) (ConnectionOffer, error) {
	s.mu.Lock()
	member, ok := s.state.Members[memberID]
	policy, revision := s.state.Policy, s.state.Revision
	s.mu.Unlock()
	if !ok || member.Member.State != "active" || desktopKeyID == "" {
		return ConnectionOffer{}, ErrDenied
	}
	decision := s.hooks.Evaluate(ctx, gp.HookInput{Version: 1, Action: gp.HookAccessOpen, GatewayID: s.identity.ID, MemberID: memberID, RuntimePublicID: member.Member.RuntimePublicID, DesktopKeyID: desktopKeyID, PolicyRevision: policy.Revision})
	if !decision.Allowed {
		return ConnectionOffer{}, ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if revision != s.state.Revision {
		return ConnectionOffer{}, ErrConflict
	}
	if err := VerifyMemberService(member.Service, member.Delegation, time.Now()); err != nil {
		return ConnectionOffer{}, err
	}
	return s.offerLocked(member, desktopKeyID)
}

func (s *Store) offerLocked(member MemberRecord, desktopKeyID string) (ConnectionOffer, error) {
	now := time.Now()
	next := s.clone()
	for key, ticket := range next.Admissions {
		if ticket.ExpiresAtUnixMS <= now.UnixMilli() {
			delete(next.Admissions, key)
		}
	}
	if len(next.Admissions) >= gp.MaxGatewayConnections*2 {
		return ConnectionOffer{}, ErrCapacity
	}
	channelID, err := randomID("gateway_")
	if err != nil {
		return ConnectionOffer{}, err
	}
	u, _ := url.Parse(s.state.Endpoint.URL)
	u.Scheme, u.Path = "wss", flowersec.WebSocketDirectPath
	endpoints, err := controlplane.NewEndpointSet(controlplane.EndpointConfig{ID: "gateway", URL: u.String(), TLS: controlplane.CAPolicy()})
	if err != nil {
		return ConnectionOffer{}, err
	}
	expires := now.Add(2 * time.Minute).Truncate(time.Second)
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{Session: controlplane.SessionOptions{ChannelID: channelID, ExpiresAt: expires, MaxInboundStreams: gp.MaxMemberConnections}, Endpoints: endpoints, RendezvousGroupID: s.identity.ID, ListenerAudience: s.identity.ID, UpstreamAddress: "127.0.0.1:1"})
	if err != nil {
		return ConnectionOffer{}, err
	}
	authorization, err := issued.AuthorizationRecord().Encode()
	if err != nil {
		return ConnectionOffer{}, err
	}
	if desktopKeyID == "" {
		member.ConnectionGeneration++
		if member.ConnectionGeneration == 0 {
			return ConnectionOffer{}, ErrState
		}
		next.Members[member.Member.MemberID] = member
	}
	next.Admissions[issued.LookupKey()] = Admission{ChannelID: channelID, MemberID: member.Member.MemberID, MemberVersion: member.Member.MemberVersion, Generation: member.ConnectionGeneration, DesktopKeyID: desktopKeyID, Authorization: authorization, CertificateSHA256: member.ClientCertificateSHA256, PolicyRevision: s.state.Policy.Revision, ExpiresAtUnixMS: expires.UnixMilli()}
	if err := s.commit(next); err != nil {
		return ConnectionOffer{}, err
	}
	return ConnectionOffer{ProtocolVersion: gp.Version, ChannelID: channelID, MemberID: member.Member.MemberID, MemberVersion: member.Member.MemberVersion, Generation: member.ConnectionGeneration, Artifact: issued.ArtifactJSON(), Service: member.Service, Delegation: member.Delegation, ExpiresAtUnixMS: expires.UnixMilli()}, nil
}

// ConsumeAdmission commits the one-time spend before Flowersec may accept the
// session. Its expiry limits redemption only; no application-session timer is added.
func (s *Store) ConsumeAdmission(request controlplane.RuntimeAuthorizationRequest, desktopAllowed func(string) bool) (controlplane.AuthorizationResponse, Admission, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ticket, ok := s.state.Admissions[request.LookupKey()]
	member, exists := s.state.Members[ticket.MemberID]
	if !ok || !exists || ticket.Consumed || ticket.ExpiresAtUnixMS <= time.Now().UnixMilli() || member.Member.State != "active" || member.Member.MemberVersion != ticket.MemberVersion || (ticket.DesktopKeyID == "" && (ticket.Generation != member.ConnectionGeneration || ticket.CertificateSHA256 != member.ClientCertificateSHA256 || member.ClientExpiresAtUnixMS <= time.Now().UnixMilli())) || ticket.PolicyRevision != s.state.Policy.Revision {
		return controlplane.AuthorizationResponse{}, Admission{}, ErrDenied
	}
	if ticket.DesktopKeyID != "" && (desktopAllowed == nil || !desktopAllowed(ticket.DesktopKeyID)) {
		return controlplane.AuthorizationResponse{}, Admission{}, ErrDenied
	}
	record, err := controlplane.ParseAuthorizationRecord(ticket.Authorization)
	if err != nil {
		return controlplane.AuthorizationResponse{}, Admission{}, err
	}
	response, err := controlplane.AuthorizeRuntime(request, record, ticket.ChannelID)
	if err != nil {
		return controlplane.AuthorizationResponse{}, Admission{}, err
	}
	ticket.Consumed = true
	next := s.clone()
	next.Admissions[request.LookupKey()] = ticket
	if err := s.commit(next); err != nil {
		return controlplane.AuthorizationResponse{}, Admission{}, err
	}
	ticket.Authorization = append([]byte(nil), ticket.Authorization...)
	return response, ticket, nil
}
