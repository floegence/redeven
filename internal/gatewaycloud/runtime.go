package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var ErrState = errors.New("Gateway Cloud state is invalid or unavailable")

// RuntimeConfig is an optional Cloud association of the sole Gateway member.
// It stores no Gateway address, CA, client certificate, invitation or join token.
type RuntimeConfig struct {
	ProtocolVersion          int                `json:"protocol_version"`
	MemberID                 string             `json:"member_id"`
	MemberVersion            int64              `json:"member_version"`
	CloudOrigin              string             `json:"cloud_origin"`
	RegionOrigin             string             `json:"region_origin"`
	NamespacePublicID        string             `json:"namespace_public_id"`
	GatewayPublicID          string             `json:"gateway_public_id"`
	RequestPublicID          string             `json:"request_public_id"`
	RuntimePublicID          string             `json:"runtime_public_id"`
	PrivateKeyB64u           string             `json:"private_key_b64u"`
	PendingPrivateKeyB64u    string             `json:"pending_private_key_b64u,omitempty"`
	KeyRotatedAtUnixMS       int64              `json:"key_rotated_at_unix_ms"`
	Proven                   bool               `json:"proven"`
	NewEnvironment           bool               `json:"new_environment"`
	Binding                  *gc.Binding        `json:"binding,omitempty"`
	DeliveryRequestID        string             `json:"delivery_request_id,omitempty"`
	PendingGenerationRenewal bool               `json:"pending_generation_renewal,omitempty"`
	PreviousBinding          *MigrationEvidence `json:"previous_binding,omitempty"`
	Revoked                  bool               `json:"revoked"`
}

func (RuntimeConfig) String() string   { return "Gateway.RuntimeCloudAssociation" }
func (RuntimeConfig) GoString() string { return "Gateway.RuntimeCloudAssociation" }
func (r *RuntimeConfig) Clone() *RuntimeConfig {
	if r == nil {
		return nil
	}
	next := *r
	if r.Binding != nil {
		binding := *r.Binding
		next.Binding = &binding
	}
	next.PreviousBinding = r.PreviousBinding.Clone()
	return &next
}

func PrepareRuntime(member *gatewaymembership.RuntimeConfig, association gp.MemberCloudContext) (*RuntimeConfig, error) {
	if member == nil || member.Leaving || member.PendingJoin != nil || association.ProtocolVersion != gp.Version || association.GatewayID != member.GatewayID || association.MemberID != member.MemberID || association.MemberVersion != member.MemberVersion || !association.Allowed || !gc.ValidOrigin(association.CloudOrigin) || !gc.ValidOrigin(association.RegionOrigin) || association.NamespacePublicID == "" || association.GatewayPublicID == "" {
		return nil, ErrState
	}
	if err := member.Validate(member.RuntimePublicID); err != nil {
		return nil, err
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &RuntimeConfig{ProtocolVersion: gc.ProtocolVersion, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: association.CloudOrigin, RegionOrigin: association.RegionOrigin, NamespacePublicID: association.NamespacePublicID, GatewayPublicID: association.GatewayPublicID, RuntimePublicID: member.RuntimePublicID, RequestPublicID: gc.CandidateID(association.GatewayPublicID, member.MemberID), PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), KeyRotatedAtUnixMS: time.Now().UnixMilli()}, nil
}

func (r *RuntimeConfig) Identity() (Identity, error) {
	if r == nil || r.ProtocolVersion != gc.ProtocolVersion || r.MemberID == "" || r.MemberVersion < 1 || !gc.ValidOrigin(r.CloudOrigin) || !gc.ValidOrigin(r.RegionOrigin) || r.NamespacePublicID == "" || r.GatewayPublicID == "" || r.RuntimePublicID == "" || r.RequestPublicID != gc.CandidateID(r.GatewayPublicID, r.MemberID) {
		return Identity{}, ErrState
	}
	key, err := gc.DecodeKey(r.PrivateKeyB64u)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return Identity{}, ErrState
	}
	identity := Identity{PrivateKey: ed25519.PrivateKey(key), NamespacePublicID: r.NamespacePublicID, GatewayPublicID: r.GatewayPublicID, RuntimePublicID: r.RuntimePublicID}
	if b := r.Binding; b != nil {
		if b.MemberID != r.MemberID || b.MemberVersion != r.MemberVersion || b.PublicID == "" || b.EnvPublicID == "" || b.Region == "" || b.Generation <= 0 || b.State != "active" || b.NamespacePublicID != r.NamespacePublicID || b.GatewayPublicID != r.GatewayPublicID || b.RuntimePublicID != r.RuntimePublicID {
			return Identity{}, ErrState
		}
		identity.BindingPublicID, identity.BindingGeneration = b.PublicID, b.Generation
	}
	return identity, nil
}
func (r *RuntimeConfig) Fence() *gc.BindingFence {
	if r == nil || r.Binding == nil {
		return nil
	}
	b := r.Binding
	return &gc.BindingFence{ProtocolVersion: gc.ProtocolVersion, PublicID: b.PublicID, NamespacePublicID: b.NamespacePublicID, GatewayPublicID: b.GatewayPublicID, RuntimePublicID: b.RuntimePublicID, Generation: b.Generation}
}
func (r *RuntimeConfig) ValidateMember(member *gatewaymembership.RuntimeConfig) error {
	if r == nil || member == nil || member.MemberID != r.MemberID || member.MemberVersion != r.MemberVersion || member.RuntimePublicID != r.RuntimePublicID || member.PendingJoin != nil {
		return ErrState
	}
	return member.Validate(r.RuntimePublicID)
}
func (r *RuntimeConfig) Proxy(member *gatewaymembership.RuntimeConfig) (*egress.HTTPSProxy, error) {
	if _, err := r.Identity(); err != nil {
		return nil, err
	}
	if r.Revoked || member == nil || member.Leaving {
		return nil, ErrState
	}
	if err := r.ValidateMember(member); err != nil {
		return nil, err
	}
	tlsConfig, err := member.TLSConfig(true)
	if err != nil {
		return nil, err
	}
	endpoints := member.ConnectionEndpoints()
	if len(endpoints) == 0 {
		return nil, ErrState
	}
	addresses := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		addresses = append(addresses, endpoint.Address)
	}
	return egress.NewHTTPSProxy(egress.HTTPSProxyOptions{URLs: addresses, TLSConfig: tlsConfig})
}
func (r *RuntimeConfig) Client(member *gatewaymembership.RuntimeConfig) (*Client, error) {
	if _, err := r.Identity(); err != nil {
		return nil, err
	}
	if r.Revoked || member == nil || member.Leaving {
		return nil, ErrState
	}
	if err := r.ValidateMember(member); err != nil {
		return nil, err
	}
	transport, err := member.NewGatewayEndpointTransport(true)
	if err != nil {
		return nil, err
	}
	return NewClient(r.CloudOrigin, transport)
}
func (r *RuntimeConfig) Join(ctx context.Context, member *gatewaymembership.RuntimeConfig, metadata gc.RuntimeMetadata) (*gc.Candidate, error) {
	client, err := r.Client(member)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	memberKey, err := gc.DecodeKey(member.PrivateKeyB64u)
	if err != nil || len(memberKey) != ed25519.PrivateKeySize {
		return nil, ErrState
	}
	identity.MemberKey = ed25519.PrivateKey(memberKey)
	return client.Join(ctx, identity, gc.RuntimeJoin{NewEnvironment: r.NewEnvironment, MemberVersion: r.MemberVersion, Delegation: gc.MemberDelegation(member.Delegation), PublicKeyB64u: base64.RawURLEncoding.EncodeToString(identity.PrivateKey.Public().(ed25519.PublicKey)), Metadata: metadata})
}

func (r *RuntimeConfig) Status(ctx context.Context, member *gatewaymembership.RuntimeConfig) (*gc.RuntimeStatus, error) {
	return r.StatusPage(ctx, member, "")
}

func (r *RuntimeConfig) StatusPage(ctx context.Context, member *gatewaymembership.RuntimeConfig, after string) (*gc.RuntimeStatus, error) {
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	client, err := r.Client(member)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	// Status follows the locally enrolled identity even while the canonical binding changes.
	identity.BindingPublicID = ""
	identity.BindingGeneration = 0
	return client.RuntimeStatusPage(ctx, identity, r.RequestPublicID, after)
}

type CredentialDelivery struct {
	ProtocolVersion     int             `json:"protocol_version"`
	CloudOrigin         string          `json:"cloud_origin"`
	RegionOrigin        string          `json:"region_origin"`
	Binding             gc.Binding      `json:"binding"`
	DeliveryRequestID   string          `json:"delivery_request_id"`
	ControlArtifactPool json.RawMessage `json:"control_artifact_pool"`
}

func NewDeliveryID() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (r *RuntimeConfig) Recover(ctx context.Context, member *gatewaymembership.RuntimeConfig) (_ *CredentialDelivery, resultErr error) {
	start := time.Now()
	defer func() { gatewayflow.Observe(ctx, "cloud.recover", start, resultErr) }()
	identity, err := r.Identity()
	if err != nil {
		return nil, err
	}
	fence := r.Fence()
	if fence == nil || !fence.Valid() || r.DeliveryRequestID == "" {
		return nil, ErrState
	}
	transport, err := member.NewGatewayEndpointTransport(true)
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	client, err := NewClient(r.CloudOrigin, transport)
	if err != nil {
		return nil, err
	}
	signed, err := client.Sign(ctx, identity, gc.PurposeRuntimeRecover, gc.RecoverRequest{Binding: *fence, DeliveryRequestID: r.DeliveryRequestID})
	if err != nil {
		return nil, err
	}
	region, err := NewClient(r.RegionOrigin, transport)
	if err != nil {
		return nil, err
	}
	delivery, err := cloudCallPath[gc.SignedRequest, CredentialDelivery](region, ctx, "/api/gateway-cloud/v2/credentials", signed)
	if err != nil {
		return nil, err
	}
	if delivery.ProtocolVersion != gc.ProtocolVersion || delivery.CloudOrigin != r.CloudOrigin || delivery.RegionOrigin != r.RegionOrigin || delivery.DeliveryRequestID != r.DeliveryRequestID || delivery.Binding != *r.Binding {
		return nil, errors.New("Gateway credential binding mismatch")
	}
	return delivery, nil
}

// ForgetExpiredDelivery changes the idempotency key only after the authority
// explicitly rejects its replay. Network failures must retain the same key.
func (r *RuntimeConfig) ForgetExpiredDelivery(err error) bool {
	var cloud *CloudError
	if r == nil || !errors.As(err, &cloud) || cloud.Code != "GATEWAY_DELIVERY_EXPIRED" {
		return false
	}
	r.DeliveryRequestID = ""
	return true
}

// AcknowledgePreviousBinding runs after the old Runtime process has stopped. The
// target route carries acknowledgements only; the old identity cannot recover.
func (r *RuntimeConfig) AcknowledgePreviousBinding(ctx context.Context, member *gatewaymembership.RuntimeConfig) error {
	if r == nil || r.PreviousBinding == nil {
		return nil
	}
	old := r.PreviousBinding
	identity, err := old.Identity()
	if err != nil {
		return err
	}
	client, err := r.Client(member)
	if err != nil {
		return err
	}
	defer client.Close()
	identity.BindingPublicID = ""
	identity.BindingGeneration = 0
	after := ""
	for {
		identity.BindingPublicID, identity.BindingGeneration = "", 0
		status, err := client.RuntimeStatusPage(ctx, identity, old.RequestPublicID, after)
		if err != nil {
			return err
		}
		for _, closure := range status.Closures {
			if old.Binding == nil || closure.BindingPublicID != old.Binding.PublicID || closure.GatewayPublicID != old.GatewayPublicID || closure.RuntimePublicID != old.RuntimePublicID || closure.Generation > old.Binding.Generation {
				continue
			}
			identity.BindingPublicID, identity.BindingGeneration = closure.BindingPublicID, closure.Generation
			if _, err := client.Acknowledge(ctx, identity, gc.ClosureAck{ClosurePublicID: closure.PublicID, Generation: closure.Generation, Side: "runtime"}); err != nil {
				return err
			}
		}
		if status.NextClosureCursor == "" {
			break
		}
		if status.NextClosureCursor == after {
			return ErrCloudRequest
		}
		after = status.NextClosureCursor
	}
	return nil
}

// RotateIdentity stages the next private key before submitting either proof.
// A lost response is resolved by testing only that staged key against Cloud.
func (r *RuntimeConfig) RotateIdentity(ctx context.Context, member *gatewaymembership.RuntimeConfig, persist func(*RuntimeConfig) error) error {
	if r == nil || r.Revoked || r.Binding == nil || persist == nil {
		return ErrState
	}
	if r.PendingPrivateKeyB64u == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		r.PendingPrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
		if err := persist(r); err != nil {
			return err
		}
	}
	encoded := r.PendingPrivateKeyB64u
	pending, err := gc.DecodeKey(encoded)
	if err != nil || len(pending) != ed25519.PrivateKeySize {
		return ErrState
	}
	identity, err := r.Identity()
	if err != nil {
		return err
	}
	client, err := r.Client(member)
	if err != nil {
		return err
	}
	defer client.Close()
	if err := client.RotateKey(ctx, identity, ed25519.PrivateKey(pending)); err != nil {
		next := *r
		next.PrivateKeyB64u = encoded
		if _, statusErr := next.Status(ctx, member); statusErr != nil {
			return err
		}
	}
	r.PrivateKeyB64u = encoded
	r.PendingPrivateKeyB64u = ""
	r.KeyRotatedAtUnixMS = time.Now().UnixMilli()
	return persist(r)
}

// RenewGeneration advances only an exhausted, still-authorized binding. The
// old fence remains durable until the exact new generation is accepted locally.
func (r *RuntimeConfig) RenewGeneration(ctx context.Context, member *gatewaymembership.RuntimeConfig) (*gc.Binding, error) {
	identity, err := r.Identity()
	if err != nil || r.Binding == nil || r.Revoked {
		return nil, ErrState
	}
	client, err := r.Client(member)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	binding, err := signedCloudCall[gc.GenerationRenewal, gc.Binding](client, ctx, identity, gc.PurposeGenerationRenew, "renew-generation", gc.GenerationRenewal{Current: *r.Fence()})
	if err != nil {
		return nil, err
	}
	expected := *r.Binding
	if expected.Generation >= 1<<63-1 {
		return nil, ErrState
	}
	expected.Generation++
	if *binding != expected {
		return nil, ErrState
	}
	return binding, nil
}
