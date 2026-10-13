package gatewaymembership

import (
	"context"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// RemovalDelivery can only finish a previously approved removal. It cannot
// enroll, reconnect, open streams, rotate identity, or carry Cloud egress.
type RemovalDelivery struct {
	GatewayEndpoints     []gp.GatewayEndpoint  `json:"gateway_endpoints,omitempty"`
	GatewayTLSRootPEM    string                `json:"gateway_tls_root_pem"`
	MemberID             string                `json:"member_id"`
	MemberVersion        int64                 `json:"member_version"`
	ClientPrivateKeyPEM  string                `json:"client_private_key_pem"`
	ClientCertificatePEM string                `json:"client_certificate_pem"`
	PendingJoin          *gp.MemberJoinRequest `json:"pending_join,omitempty"`
}

func (RemovalDelivery) String() string   { return "Gateway.RemovalDelivery" }
func (RemovalDelivery) GoString() string { return "Gateway.RemovalDelivery" }
func (r *RuntimeConfig) RemovalDelivery() RemovalDelivery {
	return RemovalDelivery{GatewayEndpoints: append([]gp.GatewayEndpoint(nil), r.connectionEndpoints()...), GatewayTLSRootPEM: r.GatewayTLSRootPEM, MemberID: r.MemberID, MemberVersion: r.MemberVersion, ClientPrivateKeyPEM: r.ClientPrivateKeyPEM, ClientCertificatePEM: r.ClientCertificatePEM, PendingJoin: r.Clone().PendingJoin}
}
func (r RemovalDelivery) Deliver(ctx context.Context) error {
	member := RuntimeConfig{ProtocolVersion: gp.Version, GatewayEndpoints: append([]gp.GatewayEndpoint(nil), r.GatewayEndpoints...), GatewayTLSRootPEM: r.GatewayTLSRootPEM, MemberID: r.MemberID, MemberVersion: r.MemberVersion, ClientPrivateKeyPEM: r.ClientPrivateKeyPEM, ClientCertificatePEM: r.ClientCertificatePEM, PendingJoin: r.PendingJoin, Leaving: true}
	return member.Leave(ctx)
}
