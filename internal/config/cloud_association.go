package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

// CloudAssociation is explicit local connection intent and the selected Cloud
// authorization. Gateway membership is never a condition of this association.
type CloudAssociation struct {
	Revision                int64                       `json:"revision"`
	Enabled                 bool                        `json:"enabled"`
	CloudID                 string                      `json:"cloud_id"`
	CloudOrigin             string                      `json:"cloud_origin"`
	NamespacePublicID       string                      `json:"namespace_public_id"`
	RegionOrigin            string                      `json:"region_origin,omitempty"`
	RuntimePublicID         string                      `json:"runtime_public_id"`
	PublicKeyB64u           string                      `json:"public_key_b64u"`
	PrivateKeyB64u          string                      `json:"private_key_b64u"`
	IdentityExpiresAtUnixMS int64                       `json:"identity_expires_at_unix_ms,omitempty"`
	Binding                 *rc.Binding                 `json:"binding,omitempty"`
	ApprovalState           rc.ApprovalState            `json:"approval_state"`
	ReasonCode              string                      `json:"reason_code,omitempty"`
	EnrollmentOperationID   string                      `json:"enrollment_operation_id,omitempty"`
	EnrollmentMetadata      rc.Metadata                 `json:"enrollment_metadata"`
	EnrollmentSubmitted     bool                        `json:"enrollment_submitted"`
	EnrollmentAuthorization *rc.EnrollmentAuthorization `json:"enrollment_authorization,omitempty"`
	DeliveryRequestID       string                      `json:"delivery_request_id,omitempty"`
	ClosureOutbox           []rc.ClosureAck             `json:"closure_outbox,omitempty"`
}

func (a *CloudAssociation) Clone() *CloudAssociation {
	if a == nil {
		return nil
	}
	copy := *a
	if a.EnrollmentAuthorization != nil {
		authorization := *a.EnrollmentAuthorization
		authorization.Delegation = append(json.RawMessage(nil), authorization.Delegation...)
		copy.EnrollmentAuthorization = &authorization
	}
	if a.Binding != nil {
		binding := *a.Binding
		copy.Binding = &binding
	}
	copy.ClosureOutbox = append([]rc.ClosureAck(nil), a.ClosureOutbox...)
	return &copy
}

// ApplyCloudDelivery uses the same one-shot reserve for every selected route.
func (c *Config) ApplyCloudDelivery(delivery *rc.CredentialDelivery) error {
	a := c.CloudAssociation
	if a == nil || delivery == nil || delivery.ProtocolVersion != rc.ProtocolVersion || !delivery.Binding.Valid() || delivery.Binding.RuntimePublicID != a.RuntimePublicID || delivery.Binding.NamespacePublicID != a.NamespacePublicID || delivery.Binding.PublicKeyB64u != a.PublicKeyB64u || delivery.CloudOrigin != a.CloudOrigin || delivery.Binding.CloudID != a.CloudID || delivery.ControlArtifactPool == nil || delivery.DeliveryRequestID != a.DeliveryRequestID {
		return errors.New("runtime Cloud credential delivery identity mismatch")
	}
	if a.Binding != nil && (a.Binding.PublicID != delivery.Binding.PublicID || a.Binding.EnvPublicID != delivery.Binding.EnvPublicID || a.Binding.Generation > delivery.Binding.Generation) {
		return errors.New("runtime Cloud credential delivery replaced the association")
	}
	encoded, err := json.Marshal(delivery.ControlArtifactPool)
	if err != nil {
		return err
	}
	var raw bootstrapControlArtifactPool
	if err := json.Unmarshal(encoded, &raw); err != nil {
		return err
	}
	pool, err := controlArtifactPoolFromDelivery(raw, delivery.Binding.Generation, time.Now(), false)
	if err != nil {
		return err
	}
	if pool.LogicalBindingID != "runtime-cloud-v5:"+delivery.Binding.PublicID {
		return errors.New("runtime Cloud credential pool identity mismatch")
	}
	if previous := c.ControlArtifactPool; previous != nil && previous.LogicalBindingID == pool.LogicalBindingID && previous.BindingGeneration == pool.BindingGeneration {
		var highest uint64
		for _, entry := range previous.Entries {
			if entry.Sequence > highest {
				highest = entry.Sequence
			}
		}
		if pool.Entries[0].Sequence <= highest {
			return errors.New("runtime Cloud credential delivery did not advance the reserve")
		}
	}
	next := a.Clone()
	binding := delivery.Binding
	next.Binding = &binding
	next.ApprovalState = rc.ApprovalApproved
	next.ReasonCode = ""
	next.RegionOrigin = delivery.RegionOrigin
	next.IdentityExpiresAtUnixMS = binding.IdentityExpiresAtUnixMS
	next.DeliveryRequestID = ""
	c.CloudAssociation = next
	c.CloudOrigin, c.CloudID, c.AccessPointOrigin, c.EnvironmentID, c.BindingGeneration = next.CloudOrigin, next.CloudID, next.RegionOrigin, binding.EnvPublicID, binding.Generation
	c.ControlArtifactPool = pool
	return nil
}

func (a *CloudAssociation) Identity() (ed25519.PrivateKey, error) {
	if a == nil || !rc.ValidPublicKey(a.PublicKeyB64u) {
		return nil, errors.New("cloud machine identity is missing")
	}
	key, err := base64.RawURLEncoding.DecodeString(a.PrivateKeyB64u)
	if err != nil || len(key) != ed25519.PrivateKeySize || base64.RawURLEncoding.EncodeToString(key) != a.PrivateKeyB64u || base64.RawURLEncoding.EncodeToString(ed25519.PrivateKey(key).Public().(ed25519.PublicKey)) != a.PublicKeyB64u {
		return nil, errors.New("cloud machine identity key mismatch")
	}
	return ed25519.PrivateKey(key), nil
}

func (a *CloudAssociation) Validate(runtimeID string) error {
	if a == nil || a.Revision < 1 || a.CloudID == "" || strings.TrimSpace(a.CloudID) != a.CloudID || a.NamespacePublicID == "" || a.RuntimePublicID != runtimeID {
		return errors.New("invalid Cloud association")
	}
	if _, err := normalizeAccessPointOrigin(a.CloudOrigin); err != nil {
		return errors.New("invalid Cloud origin")
	}
	if a.RegionOrigin != "" {
		if _, err := normalizeAccessPointOrigin(a.RegionOrigin); err != nil {
			return errors.New("invalid Cloud Region origin")
		}
	}
	if _, err := a.Identity(); err != nil {
		return err
	}
	if a.Binding != nil {
		b := a.Binding
		if !b.BindingFence.Valid() || b.CloudID != a.CloudID || b.NamespacePublicID != a.NamespacePublicID || b.RuntimePublicID != runtimeID || b.PublicKeyB64u != a.PublicKeyB64u {
			return errors.New("cloud association and binding identity do not match")
		}
	}
	if a.ApprovalState == rc.ApprovalApproved && (a.Binding == nil || !a.Binding.Valid() || a.RegionOrigin == "") {
		return errors.New("approved Cloud association requires a complete binding")
	}
	switch a.ApprovalState {
	case rc.ApprovalApproved, rc.ApprovalPending, rc.ApprovalRevoked, rc.ApprovalIdentityRequired, rc.ApprovalActionRequired:
		return nil
	default:
		return errors.New("invalid Cloud approval state")
	}
}

type CloudRouteKind string

const (
	CloudRouteDirect  CloudRouteKind = "direct"
	CloudRouteGateway CloudRouteKind = "gateway"
)

// CloudRoute selects one explicit transport. Its revision is independent of
// Cloud binding generation; route failures never authorize direct fallback.
type CloudRoute struct {
	Kind     CloudRouteKind `json:"kind"`
	MemberID string         `json:"member_id,omitempty"`
	Revision int64          `json:"route_revision"`
}

func (r CloudRoute) Valid() bool {
	return r.Revision > 0 && (r.Kind == CloudRouteDirect && r.MemberID == "" || r.Kind == CloudRouteGateway && r.MemberID != "" && strings.TrimSpace(r.MemberID) == r.MemberID)
}

func (c *Config) ValidateCloudAssociation() error {
	if c == nil {
		return errors.New("missing runtime configuration")
	}
	if c.CloudAssociation == nil {
		return nil
	}
	return c.CloudAssociation.Validate(c.LocalEnvironmentPublicID)
}

func (c *Config) ValidateCloudRoute() error {
	if c == nil || c.CloudRoute == nil || !c.CloudRoute.Valid() {
		return errors.New("select a Cloud connection route")
	}
	if c.CloudRoute.Kind == CloudRouteDirect {
		return nil
	}
	member := c.CloudRouteMember()
	if member == nil || member.Leaving {
		return errors.New("selected Gateway member is unavailable; rejoin or select another route")
	}
	return member.Validate(c.LocalEnvironmentPublicID)
}

func (c *Config) CloudRouteMember() *gatewaymembership.RuntimeConfig {
	if c == nil || c.CloudRoute == nil || c.CloudRoute.Kind != CloudRouteGateway {
		return nil
	}
	for _, member := range c.Gateways {
		if member != nil && member.MemberID == c.CloudRoute.MemberID {
			return member
		}
	}
	return nil
}
