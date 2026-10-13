package agent

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayReplacementConfirmationRecoversLostResponse(t *testing.T) {
	_, address, delivery := previewGatewayServer(t)
	previous, _ := gatewayfixture.NewWithID(t, "previous", "https://previous.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, previous, "runtime")
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{LocalEnvironmentPublicID: "runtime", AgentInstanceID: "agent", Gateways: []*gatewaymembership.RuntimeConfig{member}}}
	preview, err := a.PreviewGateway(t.Context(), address, delivery.Code, "replace")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "replace", ""); err != nil {
		t.Fatal(err)
	}
	confirmed := a.remoteConfigSnapshot()
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "replace", ""); err != nil {
		t.Fatalf("lost response recovery: %v", err)
	}
	if !reflect.DeepEqual(confirmed, a.remoteConfigSnapshot()) {
		t.Fatal("recovery changed committed membership")
	}
	other, _ := gatewayfixture.NewWithID(t, "other", "https://other.internal:7443", "127.0.0.1:7443")
	invitation, _ := other.Invite("admin")
	a.cfg, err = a.cfg.PrepareGatewayJoin(invitation, gp.MemberMetadata{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "replace", ""); !errors.Is(err, ErrGatewayPreviewChanged) {
		t.Fatal("replacement recovery ignored a changed collection")
	}
}

func TestGatewayEndpointConfirmationRecoversLostResponse(t *testing.T) {
	store, address, _ := previewGatewayServer(t)
	member := gatewayfixture.Enroll(t, store, "runtime")
	delivery, err := store.IssueInvitationCode("administrator")
	if err != nil {
		t.Fatal(err)
	}
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{LocalEnvironmentPublicID: "runtime", AgentInstanceID: "agent", Gateways: []*gatewaymembership.RuntimeConfig{member}}}
	preview, err := a.PreviewGateway(t.Context(), address, delivery.Code, "update-endpoints")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "update-endpoints", ""); err != nil {
		t.Fatal(err)
	}
	staged := a.remoteConfigSnapshot()
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "update-endpoints", ""); err != nil {
		t.Fatalf("lost confirmation response: %v", err)
	}
	if !reflect.DeepEqual(staged, a.remoteConfigSnapshot()) {
		t.Fatal("confirmation recovery changed the staged delivery")
	}
	// A second preview of the unconsumed invitation must reuse durable consent;
	// only the reconnect controller owns asynchronous endpoint delivery.
	repeated, err := a.PreviewGateway(t.Context(), address, delivery.Code, "update-endpoints")
	if err != nil {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	a.gatewayMember.ctx = canceled
	if err := a.ConfirmGatewayPreview(repeated.PreviewID, "update-endpoints", ""); err != nil {
		t.Fatalf("repeated consent attempted a second network delivery: %v", err)
	}
	if !reflect.DeepEqual(staged, a.remoteConfigSnapshot()) {
		t.Fatal("repeated preview replaced the pending delivery")
	}
	current := a.GatewayMembership(member.GatewayID)
	if err := current.Enroll(t.Context(), a.persistGatewayMember); err != nil {
		t.Fatal(err)
	}
	delivered := a.remoteConfigSnapshot()
	if current.PendingEndpointUpdate != nil {
		t.Fatal("controller delivery remained pending")
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "update-endpoints", ""); err != nil {
		t.Fatalf("confirmation recovery after asynchronous delivery: %v", err)
	}
	if !reflect.DeepEqual(delivered, a.remoteConfigSnapshot()) {
		t.Fatal("completed confirmation recovery changed membership")
	}
	leaving := a.GatewayMembership(member.GatewayID)
	leaving.Leaving = true
	if err := a.persistGatewayMember(leaving); err != nil {
		t.Fatal(err)
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "update-endpoints", ""); !errors.Is(err, ErrGatewayPreviewChanged) {
		t.Fatalf("confirmation recovery ignored removed consent: %v", err)
	}
}

func previewGatewayServer(t *testing.T) (*gatewaymembership.Store, string, gc.InvitationCodeDelivery) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := "https://" + listener.Addr().String()
	store, _ := gatewayfixture.New(t, address, listener.Addr().String())
	handler, err := store.InvitationExchangeHandler()
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("GET "+gatewaymembership.InvitationExchangePath, handler)
	store.RegisterMemberHandlers(mux)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: time.Second}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(tls.NewListener(listener, trust)) }()
	t.Cleanup(func() { _ = server.Close(); <-done })
	delivery, err := store.IssueInvitationCode("administrator")
	if err != nil {
		t.Fatal(err)
	}
	return store, address, delivery
}

func TestGatewayPreviewSelfSignedExchangeAndExplicitConsent(t *testing.T) {
	store, address, delivery := previewGatewayServer(t)
	control, cancel := context.WithCancel(t.Context())
	defer cancel()
	cfg := routeAgentFixture(t).remoteConfigSnapshot()
	cfg.LocalEnvironmentPublicID, cfg.EnvironmentID = "runtime", "existing"
	cfg.CloudAssociation.Binding.EnvPublicID = "existing"
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: cfg, controlCancel: cancel}
	if err := config.Save(a.configPath, cfg); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := a.PreviewGateway(t.Context(), address, delivery.Code, "join")
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	members, _, _ := store.Snapshot()
	if !bytes.Equal(before, after) || a.cfg != cfg || control.Err() != nil || len(members) != 0 {
		t.Fatal("preview changed configuration, membership, or the existing controller")
	}
	if preview.TargetRuntimeID != "runtime" || preview.ExistingEnvironmentID != "existing" || len(preview.PreviewID) != 43 || preview.ExpiresAtUnixMS > time.Now().Add(5*time.Minute).UnixMilli() {
		t.Fatal("preview did not bind the target and consent boundary")
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "join", "preserve"); err == nil || a.cfg != cfg {
		t.Fatal("pairing accepted a Cloud ownership change")
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "join", ""); err != nil {
		t.Fatal(err)
	}
	saved := a.GatewayMembership()
	if saved == nil || saved.PendingJoin == nil || a.cfg.EnvironmentID != "existing" || control.Err() != nil {
		t.Fatal("confirmation did not persist consent before selecting the Gateway path")
	}
	if err := a.ConfirmGatewayPreview(preview.PreviewID, "join", ""); err != nil || !reflect.DeepEqual(saved, a.GatewayMembership()) {
		t.Fatalf("lost confirmation response could not be retried: %v", err)
	}
	if _, err := gatewaymembership.PreviewInvitation(t.Context(), address, delivery.Code); err != nil {
		t.Fatalf("local consent consumed the Gateway invitation prematurely: %v", err)
	}
	request := *saved.PendingJoin
	if _, err := store.Join(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	var rejection *flowersec.InvitationExchangeError
	if _, err := gatewaymembership.PreviewInvitation(t.Context(), address, delivery.Code); !errors.As(err, &rejection) || rejection.Code != "GATEWAY_INVITATION_USED" {
		t.Fatalf("consumed invitation did not report its state: %v", err)
	}
}

func TestGatewayPreviewRejectsChangedContextAndSaveFailure(t *testing.T) {
	_, address, delivery := previewGatewayServer(t)
	for _, change := range []string{"target", "purpose", "expired", "missing", "save_failure"} {
		t.Run(change, func(t *testing.T) {
			control, cancel := context.WithCancel(t.Context())
			defer cancel()
			cfg := routeAgentFixture(t).remoteConfigSnapshot()
			cfg.LocalEnvironmentPublicID, cfg.EnvironmentID = "runtime", "existing"
			cfg.CloudAssociation.Binding.EnvPublicID = "existing"
			a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: cfg, controlCancel: cancel}
			preview, err := a.PreviewGateway(t.Context(), address, delivery.Code, "join")
			if err != nil {
				t.Fatal(err)
			}
			purpose, expected := "join", ErrGatewayPreviewChanged
			switch change {
			case "target":
				cfg.LocalEnvironmentPublicID = "other"
			case "environment":
				cfg.EnvironmentID = "other"
			case "purpose":
				purpose = "replace"
			case "expired":
				value := a.gatewayMember.previews[preview.PreviewID]
				value.ExpiresAtUnixMS = time.Now().Add(-time.Second).UnixMilli()
				a.gatewayMember.previews[preview.PreviewID] = value
				expected = ErrGatewayPreviewExpired
			case "missing":
				preview.PreviewID = "another-runtime-preview"
				expected = ErrGatewayPreviewExpired
			case "save_failure":
				a.configPath = t.TempDir()
			}
			err = a.ConfirmGatewayPreview(preview.PreviewID, purpose, "")
			if err == nil || change != "save_failure" && !errors.Is(err, expected) {
				t.Fatalf("context was accepted: %v", err)
			}
			if a.cfg != cfg || a.cfg.GatewayMember("") != nil || control.Err() != nil {
				t.Fatal("rejected confirmation changed configuration or stopped the controller")
			}
		})
	}
}
