package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"runtime"

	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// PrepareNamespaceCloud records explicit batch-enrollment intent. Pairing a
// Gateway alone never publishes or replaces an existing Cloud association.
func (c *Config) PrepareNamespaceCloud(memberID string, context gp.MemberCloudContext) (*Config, error) {
	var selected *gatewaymembership.RuntimeConfig
	for _, member := range c.Gateways {
		if member != nil && member.MemberID == memberID {
			selected = member
		}
	}
	if selected == nil || context.MemberID != memberID || !context.Allowed || context.CloudOrigin == "" || context.RegionOrigin == "" || context.NamespacePublicID == "" || context.GatewayPublicID == "" {
		return nil, errors.New("gateway batch enrollment is not available")
	}
	next := *c
	route := &CloudRoute{Kind: CloudRouteGateway, MemberID: memberID, Revision: 1}
	if c.CloudRoute != nil {
		if c.CloudRoute.Revision == 1<<63-1 {
			return nil, errors.New("cloud route revision exhausted")
		}
		route.Revision = c.CloudRoute.Revision + 1
	}
	next.CloudRoute = route
	member := selected
	if err := next.ValidateCloudRoute(); err != nil {
		return nil, err
	}
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if previous := c.CloudAssociation; previous != nil {
		if previous.Revision == 1<<63-1 || previous.CloudOrigin != context.CloudOrigin || previous.NamespacePublicID != context.NamespacePublicID || previous.RuntimePublicID != member.RuntimePublicID || previous.Binding == nil || previous.Binding.OwnerKind != rc.OwnerNamespace {
			return nil, errors.New("existing Cloud association needs its own ownership authorization")
		}
		if previous.ApprovalState != rc.ApprovalIdentityRequired && previous.ApprovalState != rc.ApprovalActionRequired {
			return nil, errors.New("cloud is already associated; change its route or manage its approval instead")
		}
		key, err = previous.Identity()
		if err != nil {
			return nil, err
		}
		public = key.Public().(ed25519.PublicKey)
		next.CloudRoute = c.CloudRoute
	}
	op, err := runtimecloud.NewOperationID()
	if err != nil {
		return nil, err
	}
	delegation, err := json.Marshal(member.Delegation)
	if err != nil {
		return nil, err
	}
	hostname, _ := os.Hostname()
	next.CloudAssociation = &CloudAssociation{EnrollmentMetadata: rc.Metadata{Hostname: hostname, OS: runtime.GOOS, Arch: runtime.GOARCH}, Revision: 1, Enabled: true, CloudID: "redeven", CloudOrigin: context.CloudOrigin, NamespacePublicID: context.NamespacePublicID, RegionOrigin: context.RegionOrigin, RuntimePublicID: member.RuntimePublicID, PublicKeyB64u: base64.RawURLEncoding.EncodeToString(public), PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), ApprovalState: rc.ApprovalPending, ReasonCode: rc.ReasonAwaitingApproval, EnrollmentOperationID: op, DeliveryRequestID: op, EnrollmentAuthorization: &rc.EnrollmentAuthorization{GatewayPublicID: context.GatewayPublicID, MemberID: memberID, MemberVersion: member.MemberVersion, Delegation: delegation}}
	if previous := c.CloudAssociation; previous != nil {
		next.CloudAssociation.Revision = previous.Revision + 1
		next.CloudAssociation.Binding = previous.Clone().Binding
		next.CloudAssociation.ClosureOutbox = previous.Clone().ClosureOutbox
	}
	next.ControlArtifactPool = nil
	next.CloudID, next.CloudOrigin, next.AccessPointOrigin = "redeven", context.CloudOrigin, context.RegionOrigin
	return &next, nil
}
