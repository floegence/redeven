package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func testCloudAssociation() *CloudAssociation {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	return &CloudAssociation{Revision: 1, Enabled: true, CloudID: "cloud", CloudOrigin: "https://cloud.example", NamespacePublicID: "namespace", RegionOrigin: "https://region.example", RuntimePublicID: "runtime", PublicKeyB64u: public, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), ApprovalState: rc.ApprovalApproved, Binding: &rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding", CloudID: "cloud", RuntimePublicID: "runtime", EnvPublicID: "environment", NamespacePublicID: "namespace", OwnerKind: rc.OwnerNamespace, OwnerPublicID: "namespace", Generation: 7}, Region: "region", State: "active", PublicKeyB64u: public, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}}
}

func TestCloudAssociationSurvivesRouteFailureAndMemberRemoval(t *testing.T) {
	cfg := &Config{LocalEnvironmentPublicID: "runtime", CloudAssociation: testCloudAssociation(), CloudRoute: &CloudRoute{Kind: CloudRouteGateway, MemberID: "selected", Revision: 1}}
	if err := cfg.ValidateCloudAssociation(); err != nil {
		t.Fatal(err)
	}
	if cfg.ValidateCloudRoute() == nil {
		t.Fatal("missing selected member must block the route")
	}
	if err := cfg.ValidateCloudAssociation(); err != nil {
		t.Fatalf("route loss changed Cloud authorization: %v", err)
	}
	cfg.Gateways = []*gatewaymembership.RuntimeConfig{{MemberID: "unrelated", GatewayID: "other"}}
	if cfg.CloudRouteMember() != nil {
		t.Fatal("unrelated membership must not silently replace the selected route")
	}
	cfg.CloudRoute = &CloudRoute{Kind: CloudRouteDirect, Revision: 2}
	if err := cfg.ValidateCloudRoute(); err != nil {
		t.Fatal(err)
	}
	if cfg.CloudAssociation.Binding.Generation != 7 {
		t.Fatal("route change must preserve Cloud generation")
	}
}

func TestCloudRouteCommitUsesRevisionAndPreservesAssociation(t *testing.T) {
	cfg := &Config{LocalEnvironmentPublicID: "runtime", CloudAssociation: testCloudAssociation(), CloudRoute: &CloudRoute{Kind: CloudRouteDirect, Revision: 3}}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var persisted []byte
	persistence := configPersistence{readFile: func(string) ([]byte, error) { return raw, nil }, writeConfig: func(_ string, next *Config) error { var err error; persisted, err = json.Marshal(next); return err }}
	_, err = saveCloudRoute("config", 2, CloudRoute{Kind: CloudRouteDirect}, persistence)
	if !errors.Is(err, ErrCloudRouteConflict) || len(persisted) > 0 {
		t.Fatal("stale revision must not write configuration")
	}
	next, err := saveCloudRoute("config", 3, CloudRoute{Kind: CloudRouteDirect}, persistence)
	if err != nil {
		t.Fatal(err)
	}
	if next.CloudRoute.Revision != 4 || next.CloudAssociation.Binding.Generation != 7 || cfg.CloudRoute.Revision != 3 {
		t.Fatal("route CAS changed ownership or the caller's snapshot")
	}
	var stored Config
	if err := json.Unmarshal(persisted, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.CloudRoute == nil || stored.CloudRoute.Revision != 4 {
		t.Fatal("persisted route must contain the committed revision")
	}
	writeErr := errors.New("disk full")
	persistence.writeConfig = func(string, *Config) error { return writeErr }
	_, err = saveCloudRoute("config", 3, CloudRoute{Kind: CloudRouteDirect}, persistence)
	if !errors.Is(err, writeErr) || cfg.CloudRoute.Revision != 3 {
		t.Fatal("failed persistence must retain the current route")
	}
}

func TestNamespaceReenrollmentPreservesDirectRouteAndClosureReceipts(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	association := testCloudAssociation()
	association.ApprovalState = rc.ApprovalIdentityRequired
	association.ClosureOutbox = []rc.ClosureAck{{ClosurePublicID: "closure", BindingPublicID: "binding", Generation: 7}}
	cfg := &Config{LocalEnvironmentPublicID: "runtime", CloudAssociation: association, CloudRoute: &CloudRoute{Kind: CloudRouteDirect, Revision: 9}, Gateways: []*gatewaymembership.RuntimeConfig{member}, EnvironmentID: "environment"}
	context := gp.MemberCloudContext{Allowed: true, CloudOrigin: association.CloudOrigin, RegionOrigin: association.RegionOrigin, NamespacePublicID: association.NamespacePublicID, GatewayPublicID: "gateway", MemberID: member.MemberID}
	next, err := cfg.PrepareNamespaceCloud(member.MemberID, context)
	if err != nil {
		t.Fatal(err)
	}
	if next.CloudAssociation.Revision != 2 || next.CloudAssociation.PublicKeyB64u != association.PublicKeyB64u || next.CloudAssociation.Binding.Generation != 7 || next.EnvironmentID != "environment" || *next.CloudRoute != *cfg.CloudRoute || len(next.CloudAssociation.ClosureOutbox) != 1 {
		t.Fatal("explicit reenrollment replaced ownership, route or closure receipts")
	}
	context.NamespacePublicID = "another"
	if _, err := cfg.PrepareNamespaceCloud(member.MemberID, context); err == nil {
		t.Fatal("Gateway delegation took over a different Namespace")
	}
	cfg.CloudAssociation.ApprovalState = rc.ApprovalRevoked
	context.NamespacePublicID = association.NamespacePublicID
	if _, err := cfg.PrepareNamespaceCloud(member.MemberID, context); err == nil {
		t.Fatal("revocation was bypassed instead of requiring Cloud reapproval")
	}
}
