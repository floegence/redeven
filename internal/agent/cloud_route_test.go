package agent

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func routeAgentFixture(t *testing.T) *Agent {
	t.Helper()
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	cfg := &config.Config{LocalEnvironmentPublicID: "runtime", AgentInstanceID: "instance", CloudRoute: &config.CloudRoute{Kind: config.CloudRouteDirect, Revision: 1}, CloudAssociation: &config.CloudAssociation{Revision: 1, Enabled: true, CloudID: "redeven", CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", RuntimePublicID: "runtime", PublicKeyB64u: public, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), ApprovalState: rc.ApprovalApproved, Binding: &rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding", CloudID: "redeven", RuntimePublicID: "runtime", EnvPublicID: "env", NamespacePublicID: "namespace", OwnerKind: rc.OwnerNamespace, OwnerPublicID: "namespace", Generation: 7}, Region: "region", State: "active", PublicKeyB64u: public, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}}}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	return &Agent{configPath: path, cfg: cfg, sessions: map[string]*activeSession{}}
}

func TestCloudRoutePreflightCommitAndUnknownResultQuery(t *testing.T) {
	a := routeAgentFixture(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"protocol_version": rc.ProtocolVersion, "cloud_id": "redeven"})
	}))
	defer server.Close()
	a.controlTrustRoots = server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	a.cfg.CloudAssociation.CloudOrigin = server.URL
	if err := config.Save(a.configPath, a.cfg); err != nil {
		t.Fatal(err)
	}
	old, cancel := context.WithCancel(t.Context())
	defer cancel()
	a.sessions["cloud"] = &activeSession{cancel: cancel, cloudRouteRevision: 1, cloudBindingPublicID: "binding", cloudBindingGeneration: 9}
	op := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	prepared, err := a.PreflightCloudRoute(t.Context(), rc.RoutePreflightRequest{OperationID: op, ExpectedRouteRevision: 1, Selection: rc.RouteSelection{Kind: "direct"}})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.State != "awaiting_confirmation" || old.Err() != nil {
		t.Fatal("preflight must leave the original connection running")
	}
	queried, err := a.CloudRouteOperation(op)
	if err != nil || *queried != *prepared {
		t.Fatalf("query original operation: %v", err)
	}
	result, err := a.CommitCloudRoute(t.Context(), rc.RouteCommitRequest{OperationID: op, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "committed" || result.CommittedRouteRevision != 2 || old.Err() == nil || a.cfg.CloudAssociation.Binding.Generation != 7 {
		t.Fatal("commit must close every old-route generation and preserve Cloud ownership")
	}
	result, err = a.CancelCloudRoute(op)
	if err != nil || result.State != "committed" {
		t.Fatal("cancellation cannot hide a committed route")
	}
	result, err = a.CommitCloudRoute(t.Context(), rc.RouteCommitRequest{OperationID: op, Confirmed: true})
	if err != nil || result.CommittedRouteRevision != 2 {
		t.Fatal("original operation must replay without another route revision")
	}
}

func TestCloudRouteFailureAndConcurrentChangePreserveWorkingRoute(t *testing.T) {
	a := routeAgentFixture(t)
	op := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	_, err := a.PreflightCloudRoute(t.Context(), rc.RoutePreflightRequest{OperationID: op, ExpectedRouteRevision: 1, Selection: rc.RouteSelection{Kind: "gateway", MemberID: "missing"}})
	if err == nil || a.cfg.CloudRoute.Revision != 1 {
		t.Fatal("failed preflight must preserve the working route")
	}
	operation := rc.RouteOperation{OperationID: op, ExpectedRouteRevision: 1, AssociationRevision: 1, Selection: rc.RouteSelection{Kind: "direct"}, State: "awaiting_confirmation", ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	a.cfg.CloudRouteOperations = []rc.RouteOperation{operation}
	if err := config.Save(a.configPath, a.cfg); err != nil {
		t.Fatal(err)
	}
	_, err = config.SaveCloudRoute(a.configPath, 1, config.CloudRoute{Kind: config.CloudRouteDirect})
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.CommitCloudRoute(t.Context(), rc.RouteCommitRequest{OperationID: op, Confirmed: true})
	if !errors.Is(err, config.ErrCloudRouteConflict) {
		t.Fatalf("stale route commit: %v", err)
	}
	current, err := config.Load(a.configPath)
	if err != nil || current.CloudRoute.Revision != 2 || current.CloudAssociation.Binding.Generation != 7 {
		t.Fatal("stale commit overwrote the newer route")
	}
}

func TestCloudRouteCommitRejectsChangedTargetTrust(t *testing.T) {
	a := routeAgentFixture(t)
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	a.cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
	selection := config.CloudRoute{Kind: config.CloudRouteGateway, MemberID: member.MemberID, Revision: 2}
	fingerprint, err := routePreflightFingerprint(a.cfg, selection)
	if err != nil {
		t.Fatal(err)
	}
	id := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	a.cfg.CloudRouteOperations = []rc.RouteOperation{{RouteFingerprint: fingerprint, OperationID: id, AssociationRevision: 1, ExpectedRouteRevision: 1, Selection: rc.RouteSelection{Kind: "gateway", MemberID: member.MemberID}, State: "awaiting_confirmation", ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}
	if err := config.Save(a.configPath, a.cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := config.Update(a.configPath, func(cfg *config.Config) error { cfg.Gateways[0].ClientCertificatePEM += "\n"; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CommitCloudRoute(t.Context(), rc.RouteCommitRequest{OperationID: id, Confirmed: true}); err == nil {
		t.Fatal("unverified target certificate accepted")
	}
	saved, err := config.Load(a.configPath)
	if err != nil || saved.CloudRoute.Kind != config.CloudRouteDirect || saved.CloudRoute.Revision != 1 {
		t.Fatal("failed commit changed original route", err)
	}
}
