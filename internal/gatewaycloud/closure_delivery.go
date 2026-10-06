package gatewaycloud

import (
	"context"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// ClosureDelivery is a terminal receipt outbox, never an executable membership.
// The public relay trust can call only the fixed receipt endpoint. No member
// certificate, recovery path, or data session authority survives here.
type ClosureDelivery struct {
	GatewayURL        string                           `json:"gateway_url"`
	GatewayTLSRootPEM string                           `json:"gateway_tls_root_pem"`
	Evidence          *MigrationEvidence               `json:"evidence,omitempty"`
	Receipt           gc.RuntimeClosureExchangeRequest `json:"receipt"`
}

func (d ClosureDelivery) String() string         { return "Gateway.ClosureDelivery" }
func (d ClosureDelivery) GoString() string       { return d.String() }
func (d ClosureDelivery) Clone() ClosureDelivery { d.Evidence = d.Evidence.Clone(); return d }

func NewClosureDelivery(route *RuntimeConfig, member *gatewaymembership.RuntimeConfig) (*ClosureDelivery, error) {
	if route == nil || member == nil || route.Binding == nil || route.ValidateMember(member) != nil {
		return nil, ErrState
	}
	evidence := route.MigrationEvidence()
	if evidence == nil {
		return nil, ErrState
	}
	return &ClosureDelivery{GatewayURL: member.GatewayURL, GatewayTLSRootPEM: member.GatewayTLSRootPEM, Evidence: evidence, Receipt: gc.RuntimeClosureExchangeRequest{CloudOrigin: route.CloudOrigin, Binding: *route.Fence()}}, nil
}

// Seal is called only after the exact old generation has been durably fenced
// and every matching live session has left the Runtime registry.
func (d *ClosureDelivery) Seal(now time.Time) error {
	if d.Evidence == nil {
		if d.Receipt.Closed && d.Receipt.Signature != "" {
			return nil
		}
		return ErrState
	}
	identity, err := d.Evidence.Identity()
	if err != nil {
		return err
	}
	if d.Evidence.Fence() == nil || *d.Evidence.Fence() != d.Receipt.Binding {
		return ErrState
	}
	d.Receipt.IssuedAtUnixMS = now.UnixMilli()
	d.Receipt.Closed = true
	if err := d.Receipt.Sign(identity.PrivateKey); err != nil {
		return err
	}
	d.Evidence = nil
	return nil
}
func (d *ClosureDelivery) Deliver(ctx context.Context) (*gc.RuntimeClosureExchangeResponse, error) {
	if d == nil || !d.Receipt.Closed || d.Evidence != nil {
		return nil, ErrState
	}
	return exchangeClosure(ctx, d.GatewayURL, d.GatewayTLSRootPEM, d.Receipt)
}
func (r *RuntimeConfig) ObserveClosure(ctx context.Context, member *gatewaymembership.RuntimeConfig) (*gc.RuntimeClosureExchangeResponse, error) {
	if r == nil || r.Binding == nil || member == nil || r.ValidateMember(member) != nil {
		return nil, ErrState
	}
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	request := gc.RuntimeClosureExchangeRequest{CloudOrigin: r.CloudOrigin, Binding: *r.Fence(), IssuedAtUnixMS: time.Now().UnixMilli()}
	if err := request.Sign(identity.PrivateKey); err != nil {
		return nil, err
	}
	return exchangeClosure(ctx, member.GatewayURL, member.GatewayTLSRootPEM, request)
}
func exchangeClosure(ctx context.Context, endpoint, root string, request gc.RuntimeClosureExchangeRequest) (*gc.RuntimeClosureExchangeResponse, error) {
	// Only public trust is used after removal; expired or revoked member credentials
	// are never presented as a fallback authentication method.
	relay := gatewaymembership.RuntimeConfig{ProtocolVersion: gp.Version, GatewayURL: endpoint, GatewayTLSRootPEM: root}
	var result gc.RuntimeClosureExchangeResponse
	if err := relay.Request(ctx, "/v4/member/cloud-closure", request, &result, false); err != nil {
		return nil, err
	}
	if c := result.Closure; c != nil && (c.BindingPublicID != request.Binding.PublicID || c.Generation != request.Binding.Generation || c.GatewayPublicID != request.Binding.GatewayPublicID || c.RuntimePublicID != request.Binding.RuntimePublicID) {
		return nil, ErrState
	}
	if result.Accepted && (result.Closure == nil || !result.Closure.RuntimeClosed) {
		return nil, ErrState
	}
	return &result, nil
}
