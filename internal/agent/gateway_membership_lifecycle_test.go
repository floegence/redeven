package agent

import (
	"context"
	"errors"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayConnectionChangesInvalidateOnlyTheControlOwner(t *testing.T) {
	for _, field := range []string{"address", "certificate", "key", "trust", "bookkeeping"} {
		t.Run(field, func(t *testing.T) {
			store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
			member := gatewayfixture.Enroll(t, store, "runtime")
			control, cancel := context.WithCancel(t.Context())
			defer cancel()
			data, closeData := context.WithCancel(t.Context())
			defer closeData()
			a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, LocalEnvironmentPublicID: "runtime"}, controlCancel: cancel, sessions: map[string]*activeSession{"data": {cancel: closeData}}}
			before := a.remoteConfigSnapshot()
			next := member.Clone()
			switch field {
			case "address":
				next.GatewayEndpoints = []gp.GatewayEndpoint{{EndpointID: "new", Address: "https://new.gateway.internal:7443", Scope: gp.GatewayEndpointLAN, Priority: 0}}
			case "certificate":
				next.ClientCertificatePEM += "\n"
			case "key":
				next.ClientPrivateKeyPEM += "\n"
			case "trust":
				next.GatewayTLSRootPEM += "\n"
			case "bookkeeping":
				next.LastSpentChannelID = "channel_next"
			}
			if err := a.persistGatewayMember(next); err != nil {
				t.Fatal(err)
			}
			changed := false
			if (control.Err() != nil) != changed {
				t.Fatal("control owner does not match the saved connection configuration")
			}
			if sameControlBinding(before, a.remoteConfigSnapshot()) == changed {
				t.Fatal("stale proxy configuration can acquire control credentials")
			}
			if data.Err() != nil {
				t.Fatal("connection configuration update closed an independent data session")
			}
		})
	}
}

func TestGatewayLeaveFencesCloudBeforeRemovalDelivery(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	publication, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	publication.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "environment", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	remote, cancelRemote := context.WithCancel(t.Context())
	local, cancelLocal := context.WithCancel(t.Context())
	defer cancelRemote()
	defer cancelLocal()
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, GatewayPublication: publication, LocalEnvironmentPublicID: "runtime", ControlArtifactPool: config.NewControlArtifactPool(1)}, sessions: map[string]*activeSession{
		"cloud": {cancel: cancelRemote, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 1},
		"local": {cancel: cancelLocal},
	}}
	previous := a.remoteConfigSnapshot()
	if err := a.UnpairGateway(member.GatewayID, false); !errors.Is(err, ErrGatewayCloudImpactRequired) {
		t.Fatal("Cloud interruption bypassed explicit consent", err)
	}
	if remote.Err() != nil || !reflect.DeepEqual(previous, a.remoteConfigSnapshot()) {
		t.Fatal("rejected removal changed Cloud authority")
	}
	if err := a.UnpairGateway(member.GatewayID, true); err != nil {
		t.Fatal(err)
	}
	saved, err := config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.GatewayMember("").Leaving || saved.GatewayPublication != nil || saved.ControlArtifactPool != nil || saved.GatewayMigrationEvidence == nil {
		t.Fatal("leaving membership retained executable Cloud authority")
	}
	if remote.Err() == nil || local.Err() != nil {
		t.Fatal("leave did not isolate Cloud session closure")
	}
	if sameControlBinding(previous, saved) {
		t.Fatal("old controller can still spend its credentials")
	}
	if _, err := gatewayProxy(saved); err == nil {
		t.Fatal("leaving member fell back to direct Cloud access")
	}
	if err := a.persistGatewayMember(nil); err != nil {
		t.Fatal(err)
	}
	saved, err = config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.GatewayMember("") != nil || saved.GatewayMigrationEvidence.Binding.EnvPublicID != "environment" {
		t.Fatal("removal lost original ownership evidence")
	}
	if _, err := gatewayProxy(saved); err == nil {
		t.Fatal("removed member restored direct access")
	}
}

func TestGatewaySelectionFencesExistingDirectController(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{EnvironmentID: "existing", LocalEnvironmentPublicID: "runtime", BindingGeneration: 2}}
	previous := a.remoteConfigSnapshot()
	if err := a.changeGateway(invitation, "", false); err != nil {
		t.Fatal(err)
	}
	if !sameControlBinding(previous, a.remoteConfigSnapshot()) {
		t.Fatal("pairing stopped direct Cloud control")
	}
	member := a.GatewayMembership()
	response, err := store.Join(t.Context(), *member.PendingJoin)
	if err != nil {
		t.Fatal(err)
	}
	member.MemberVersion, member.ClientCertificatePEM, member.ClientExpiresAtUnixMS = response.MemberVersion, response.ClientCertificatePEM, response.ClientExpiresAtUnixMS
	member.PendingJoin = nil
	a.cfg.SetGatewayMember(member.GatewayID, member)
	if err := a.PublishGateway(member.GatewayID, "preserve"); err != nil {
		t.Fatal(err)
	}
	if sameControlBinding(previous, a.remoteConfigSnapshot()) {
		t.Fatal("explicit publication did not fence direct control")
	}
	if _, err := gatewayProxy(a.remoteConfigSnapshot()); err == nil {
		t.Fatal("pending membership silently uses public egress")
	}
}

func TestGatewayReplacementFencesOfflineOldPathAndRetainsOnlyRemoval(t *testing.T) {
	oldStore, _ := gatewayfixture.New(t, "https://offline.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, oldStore, "runtime")
	route, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	route.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "env", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	nextStore, _ := gatewayfixture.NewWithID(t, "gateway_next", "https://next.internal:7443", "127.0.0.1:8443")
	invitation, err := nextStore.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	oldSession, cancel := context.WithCancel(t.Context())
	defer cancel()
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, GatewayPublication: route, EnvironmentID: "env", LocalEnvironmentPublicID: "runtime"}, sessions: map[string]*activeSession{"old": {cancel: cancel, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 1}}}
	if err := a.changeGateway(invitation, "", true); err != nil {
		t.Fatal(err)
	}
	saved, err := config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.GatewayMember("").GatewayID != invitation.GatewayID || saved.GatewayPublication != nil || saved.GatewayMember("").PendingJoin == nil || saved.GatewayMigrationEvidence.Binding.EnvPublicID != "env" {
		t.Fatal("replacement did not select one route and preserve original proof")
	}
	if oldSession.Err() == nil || len(saved.GatewayRemovalOutbox) != 1 || len(saved.GatewayClosureOutbox) != 1 {
		t.Fatal("replacement lost pending removal or left old sessions active")
	}
	if err := a.persistGatewayMember(member); err == nil {
		t.Fatal("old connection owner overwrote replacement")
	}
	if err := a.persistGatewayMember(nil); err == nil {
		t.Fatal("old removal completion deleted replacement")
	}
	if _, err := gatewayProxy(saved); err == nil {
		t.Fatal("replacement restored direct Cloud path")
	}
}
