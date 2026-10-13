package agent

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/gatewaymembership"

	"github.com/floegence/redeven/internal/config"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayConnectionChangesInvalidateOnlyTheControlOwner(t *testing.T) {
	for _, field := range []string{"address", "certificate", "key", "trust", "bookkeeping"} {
		for _, selected := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/selected-%t", field, selected), func(t *testing.T) {
				store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
				member := gatewayfixture.Enroll(t, store, "runtime")
				control, cancel := context.WithCancel(t.Context())
				defer cancel()
				data, closeData := context.WithCancel(t.Context())
				defer closeData()
				a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, LocalEnvironmentPublicID: "runtime"}, controlCancel: cancel, sessions: map[string]*activeSession{"data": {cancel: closeData}}}
				if selected {
					a.cfg.CloudAssociation = routeAgentFixture(t).cfg.CloudAssociation
					a.cfg.CloudRoute = &config.CloudRoute{Kind: config.CloudRouteGateway, MemberID: member.MemberID, Revision: 1}
				}
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
				changed := selected && field != "bookkeeping"
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
}

func TestGatewayMaintenancePreservesSavedChatGPTBindingAfterRestart(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	path := filepath.Join(t.TempDir(), "config.json")
	startup := &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, LocalEnvironmentPublicID: "runtime"}
	if err := config.Save(path, startup); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: startup, configPath: path}
	saved, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	saved.AI = &config.AIConfig{CurrentModelID: "openai/gpt-6.1-sol", Providers: []config.AIProvider{{
		ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: "saved-account",
		ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}},
	}}}
	saved.Shell = "/bin/zsh"
	saved.CodeServerPortMin, saved.CodeServerPortMax = 32000, 32100
	if err := config.Save(path, saved); err != nil {
		t.Fatal(err)
	}
	refreshed := member.Clone()
	refreshed.LastSpentChannelID = "next-channel"
	if err := a.persistGatewayMember(refreshed); err != nil {
		t.Fatal(err)
	}
	restarted, err := config.LoadForStartup(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restarted.AI, saved.AI) || restarted.Shell != saved.Shell || restarted.CodeServerPortMin != saved.CodeServerPortMin || restarted.CodeServerPortMax != saved.CodeServerPortMax {
		t.Fatal("connection maintenance overwrote saved local settings or ChatGPT binding")
	}
	if restarted.GatewayMember(member.GatewayID).LastSpentChannelID != "next-channel" {
		t.Fatal("connection maintenance was not persisted")
	}
}

func TestGatewayLeaveClosesOnlySelectedRouteAndPreservesCloudAuthority(t *testing.T) {
	for _, selected := range []bool{false, true} {
		t.Run(map[bool]string{true: "selected", false: "unrelated"}[selected], func(t *testing.T) {
			store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
			member := gatewayfixture.Enroll(t, store, "runtime")
			a := routeAgentFixture(t)
			a.cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
			if selected {
				a.cfg.CloudRoute = &config.CloudRoute{Kind: config.CloudRouteGateway, MemberID: member.MemberID, Revision: 1}
			}
			if err := config.Save(a.configPath, a.cfg); err != nil {
				t.Fatal(err)
			}
			remote, cancelRemote := context.WithCancel(t.Context())
			defer cancelRemote()
			local, cancelLocal := context.WithCancel(t.Context())
			defer cancelLocal()
			a.sessions["cloud"] = &activeSession{cancel: cancelRemote, cloudRouteRevision: 1}
			a.sessions["local"] = &activeSession{cancel: cancelLocal}
			previous := a.remoteConfigSnapshot()
			if selected {
				if err := a.UnpairGateway(member.GatewayID, false); !errors.Is(err, ErrGatewayRouteImpactRequired) {
					t.Fatal("route interruption bypassed consent", err)
				}
				if remote.Err() != nil || !reflect.DeepEqual(previous, a.remoteConfigSnapshot()) {
					t.Fatal("unconfirmed removal changed the working route")
				}
			}
			if err := a.UnpairGateway(member.GatewayID, true); err != nil {
				t.Fatal(err)
			}
			saved, err := config.Load(a.configPath)
			if err != nil {
				t.Fatal(err)
			}
			if !saved.GatewayMember("").Leaving || !reflect.DeepEqual(saved.CloudAssociation, previous.CloudAssociation) || *saved.CloudRoute != *previous.CloudRoute {
				t.Fatal("local removal changed Cloud authority or silently selected another route")
			}
			if (remote.Err() != nil) != selected || local.Err() != nil {
				t.Fatal("removal crossed its selected route")
			}
			if selected {
				if _, err := gatewayProxy(saved); err == nil {
					t.Fatal("leaving member authorized direct fallback")
				}
			}
			if err := a.persistGatewayMember(nil); err != nil {
				t.Fatal(err)
			}
			saved, err = config.Load(a.configPath)
			if err != nil || saved.GatewayMember("") != nil || !reflect.DeepEqual(saved.CloudAssociation, previous.CloudAssociation) {
				t.Fatal("removal lost Cloud identity or authorization", err)
			}
			if selected {
				if _, err := gatewayProxy(saved); err == nil {
					t.Fatal("missing member restored direct access")
				}
			}
		})
	}
}

func TestGatewayPairingDoesNotSelectRouteOrReplaceCloudAssociation(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	a := routeAgentFixture(t)
	previous := a.remoteConfigSnapshot()
	if err := a.changeGateway(invitation, "", false); err != nil {
		t.Fatal(err)
	}
	if !sameCloudOwner(previous, a.remoteConfigSnapshot()) || a.cfg.CloudAssociation.Binding.Generation != 7 {
		t.Fatal("pairing replaced the direct Cloud owner")
	}
	if err := a.PublishGateway(t.Context(), invitation.GatewayID); err == nil {
		t.Fatal("pending pairing replaced an existing Cloud association")
	}
}

func TestGatewayReplacementClosesOldRouteWithoutMigratingCloud(t *testing.T) {
	oldStore, _ := gatewayfixture.New(t, "https://offline.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, oldStore, "runtime")
	nextStore, _ := gatewayfixture.NewWithID(t, "gateway_next", "https://next.internal:7443", "127.0.0.1:8443")
	invitation, err := nextStore.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	a := routeAgentFixture(t)
	a.cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
	a.cfg.CloudRoute = &config.CloudRoute{Kind: config.CloudRouteGateway, MemberID: member.MemberID, Revision: 1}
	if err := config.Save(a.configPath, a.cfg); err != nil {
		t.Fatal(err)
	}
	original := a.remoteConfigSnapshot()
	oldSession, cancel := context.WithCancel(t.Context())
	defer cancel()
	a.sessions["old"] = &activeSession{cancel: cancel, cloudRouteRevision: 1}
	if err := a.changeGateway(invitation, "", true); err != nil {
		t.Fatal(err)
	}
	saved, err := config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.GatewayMember("").GatewayID != invitation.GatewayID || saved.GatewayMember("").PendingJoin == nil || !reflect.DeepEqual(saved.CloudAssociation, original.CloudAssociation) || *saved.CloudRoute != *original.CloudRoute {
		t.Fatal("replacement migrated Cloud or silently chose a new route")
	}
	if oldSession.Err() == nil || len(saved.GatewayRemovalOutbox) != 1 {
		t.Fatal("replacement left old sessions active or lost removal delivery")
	}
	if err := a.persistGatewayMember(member); err == nil {
		t.Fatal("late member response overwrote replacement")
	}
	if err := a.persistGatewayMember(nil); err == nil {
		t.Fatal("old removal completion deleted replacement")
	}
	if _, err := gatewayProxy(saved); err == nil {
		t.Fatal("replacement restored direct fallback")
	}
}
