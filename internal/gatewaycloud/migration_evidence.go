package gatewaycloud

import (
	"context"
	"crypto/ed25519"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
)

// MigrationEvidence can only prove a previous binding through a new member.
// It has no proxy, recovery, enrollment or network-route capability.
type MigrationEvidence struct {
	CloudOrigin       string      `json:"cloud_origin"`
	RegionOrigin      string      `json:"region_origin"`
	NamespacePublicID string      `json:"namespace_public_id"`
	GatewayPublicID   string      `json:"gateway_public_id"`
	RequestPublicID   string      `json:"request_public_id"`
	RuntimePublicID   string      `json:"runtime_public_id"`
	PrivateKeyB64u    string      `json:"private_key_b64u"`
	Binding           *gc.Binding `json:"binding"`
}

func (MigrationEvidence) String() string   { return "Gateway.MigrationEvidence" }
func (MigrationEvidence) GoString() string { return "Gateway.MigrationEvidence" }
func (r *MigrationEvidence) Clone() *MigrationEvidence {
	if r == nil {
		return nil
	}
	copy := *r
	if r.Binding != nil {
		binding := *r.Binding
		copy.Binding = &binding
	}
	return &copy
}
func (r *MigrationEvidence) Identity() (Identity, error) {
	if r == nil || !gc.ValidOrigin(r.CloudOrigin) || !gc.ValidOrigin(r.RegionOrigin) || r.RequestPublicID == "" || r.Binding == nil {
		return Identity{}, ErrState
	}
	b := r.Binding
	if b.PublicID == "" || b.EnvPublicID == "" || b.Region == "" || b.Generation <= 0 || b.NamespacePublicID == "" || b.GatewayPublicID == "" || b.RuntimePublicID == "" || b.NamespacePublicID != r.NamespacePublicID || b.GatewayPublicID != r.GatewayPublicID || b.RuntimePublicID != r.RuntimePublicID {
		return Identity{}, ErrState
	}
	key, err := gc.DecodeKey(r.PrivateKeyB64u)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return Identity{}, ErrState
	}
	return Identity{PrivateKey: ed25519.PrivateKey(key), NamespacePublicID: r.NamespacePublicID, GatewayPublicID: r.GatewayPublicID, RuntimePublicID: r.RuntimePublicID, BindingPublicID: b.PublicID, BindingGeneration: b.Generation}, nil
}
func (r *MigrationEvidence) Fence() *gc.BindingFence {
	if r == nil || r.Binding == nil {
		return nil
	}
	b := r.Binding
	return &gc.BindingFence{ProtocolVersion: gc.ProtocolVersion, PublicID: b.PublicID, NamespacePublicID: b.NamespacePublicID, GatewayPublicID: b.GatewayPublicID, RuntimePublicID: b.RuntimePublicID, Generation: b.Generation}
}
func (r *RuntimeConfig) MigrationEvidence() *MigrationEvidence {
	if r == nil {
		return nil
	}
	evidence := &MigrationEvidence{CloudOrigin: r.CloudOrigin, RegionOrigin: r.RegionOrigin, NamespacePublicID: r.NamespacePublicID, GatewayPublicID: r.GatewayPublicID, RequestPublicID: r.RequestPublicID, RuntimePublicID: r.RuntimePublicID, PrivateKeyB64u: r.PrivateKeyB64u, Binding: r.Binding}
	if _, err := evidence.Identity(); err != nil {
		return nil
	}
	return evidence.Clone()
}

// ConsentMigration sends the old path proof through the new path. Losing the
// old Gateway does not invalidate the Runtime's independently held identity.
func (r *MigrationEvidence) ConsentMigration(ctx context.Context, member *gatewaymembership.RuntimeConfig, target *RuntimeConfig) error {
	return r.consentPathChange(ctx, member, target, false)
}

// ConsentReauthorization proves ownership through the new route without
// restoring the removed membership or using its forwarding credentials.
func (r *MigrationEvidence) ConsentReauthorization(ctx context.Context, member *gatewaymembership.RuntimeConfig, target *RuntimeConfig) error {
	return r.consentPathChange(ctx, member, target, true)
}

func (r *MigrationEvidence) consentPathChange(ctx context.Context, member *gatewaymembership.RuntimeConfig, target *RuntimeConfig, reauthorize bool) error {
	if r == nil || target == nil || r.Fence() == nil || r.CloudOrigin != target.CloudOrigin || r.NamespacePublicID != target.NamespacePublicID || r.RegionOrigin != target.RegionOrigin || r.RuntimePublicID != target.RuntimePublicID || (!reauthorize && r.GatewayPublicID == target.GatewayPublicID) || r.RequestPublicID == target.RequestPublicID {
		return ErrState
	}
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	client, err := target.Client(member)
	if err != nil {
		return err
	}
	defer client.Close()
	purpose := gc.PurposeRuntimeMigrate
	if reauthorize {
		purpose = gc.PurposeRuntimeReauthorize
	}
	_, err = signedCloudCall[gc.MigrationConsent, gc.Candidate](client, ctx, identity, purpose, "migration-consent", gc.MigrationConsent{Current: *r.Fence(), TargetRequestPublicID: target.RequestPublicID, Reauthorize: reauthorize})
	return err
}

// ConsentPreservation chooses the existing authority's migration state. Both
// paths consume the same old proof, and neither restores old network access.
func (r *MigrationEvidence) ConsentPreservation(ctx context.Context, member *gatewaymembership.RuntimeConfig, target *RuntimeConfig) error {
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	client, err := target.Client(member)
	if err != nil {
		return err
	}
	defer client.Close()
	identity.BindingPublicID, identity.BindingGeneration = "", 0
	status, err := client.RuntimeStatusPage(ctx, identity, r.RequestPublicID, "")
	if err != nil {
		return err
	}
	if status.Candidate.RuntimePublicID != r.RuntimePublicID {
		return ErrState
	}
	if status.Candidate.State == "rejoin_required" || status.Candidate.State == "revoked" || status.Candidate.State == "unpublished" {
		return r.ConsentReauthorization(ctx, member, target)
	}
	return r.ConsentMigration(ctx, member, target)
}
